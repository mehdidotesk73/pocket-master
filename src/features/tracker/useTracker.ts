// App state: the stored files, and everything computed from them.
//
//   records/<YYYY-MM-DD>.json  one BalanceRecord per date (a same-day save is a new revision)
//   projections/<id>.json      one ProjectionFile per projection the user builds
//   template.json              TemplateFile: the rows every new record starts with
//
// Totals, averages and the projections' futures are computed in the app, never
// stored. Which projection is on screen is a per-device preference (localStorage).

import { computed, ref, shallowRef } from 'vue'
import {
  type BalanceRecord,
  type Every,
  type EveryUnit,
  type RecordWindow,
  type Recurring,
  type RecurringValue,
  type ProjectionFile,
  type ProjectionItem,
  type RecordLine,
  type StartLines,
  type TemplateFile,
  type TemplateLine,
  LEFT_SOURCE,
  MAX_HORIZON_DAYS,
  PREVIOUS_DEFAULT_TEMPLATE_IDS,
  defaultProjection,
  defaultTemplate,
  everydayItem,
  monthlyStart,
  itemResults,
  lineNames,
  byAt,
  makeRecord,
  newId,
  project,
  upsertRecord,
} from '../../lib/finance'
import { atKey, isISODate, isLocalDateTime, localFromISO, roundMoney, today } from '../../lib/money'
import { Store, getStore, init } from '../../lib/storage/store'
import { logDebug } from '../../debug'

export const TEMPLATE_ID = 'template'
export const projectionId = (id: string) => `projections/${id}`
const PROJECTIONS_PREFIX = 'projections/'
/** v0.3–v0.5: one projection in a single file. */
const LEGACY_PROJECTION_ID = 'projection'
/** v0.2: projection items, template and horizon together. */
const LEGACY_SETTINGS_ID = 'settings'
/** records/2026-11-26T14-05-33: one file per balance sheet, so a day can have several. */
export const recordId = (at: string) => `records/${atKey(at)}`

const projections = shallowRef<ProjectionFile[]>([defaultProjection()])
const template = shallowRef<TemplateFile>(defaultTemplate())
const records = shallowRef<BalanceRecord[]>([])
const loaded = ref(false)
const loadError = ref('')

const SELECTED_KEY = 'pocket-master:projection'
function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
const selectedId = ref<string>(readPref(SELECTED_KEY) ?? 'everything')
function selectProjection(id: string) {
  selectedId.value = id
  try {
    localStorage.setItem(SELECTED_KEY, id)
  } catch {
    /* private mode */
  }
}

// ---------------------------------------------------------------- normalizing (and migrating old shapes)

const num = (v: unknown, d = 0) =>
  typeof v === 'number' && Number.isFinite(v)
    ? v
    : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))
      ? Number(v)
      : d
const clampShare = (v: unknown) => Math.min(100, Math.max(0, num(v, 100)))
const clampDay = (v: unknown) => Math.min(31, Math.max(1, Math.round(num(v, 1))))
const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d)
const arr = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]).filter((x) => x && typeof x === 'object') : [])
const safeId = (v: unknown) => (str(v).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || newId())

// Old records gave every line a kind and kept amounts positive; old projection
// items had dir 'in' | 'out' with a positive amount.
const LEGACY_POSITIVE = ['account', 'receiving']
const LEGACY_KINDS = ['account', 'receiving', 'card', 'bill', 'paying']

function legacySigned(l: Record<string, unknown>): number {
  const kind = String(l.kind)
  if (kind === 'card') return -roundMoney((Math.abs(num(l.total ?? l.amount)) * clampShare(l.share)) / 100)
  const v = Math.abs(num(l.amount))
  return LEGACY_POSITIVE.includes(kind) ? v : -v
}

/** Signed amount from either `{ amount: signed }` or the old `{ dir, amount: positive }`. */
const signedAmount = (x: Record<string, unknown>) =>
  x.dir === 'in' || x.dir === 'out' ? (x.dir === 'in' ? 1 : -1) * Math.abs(roundMoney(num(x.amount))) : roundMoney(num(x.amount))

/** A record window from the current shape, or the older `range` / `from`/`to` fields. */
function normalizeWindow(w: unknown, legacy: Record<string, unknown> = {}): RecordWindow {
  const r = (w ?? legacy.range ?? {}) as Record<string, unknown>
  if (r.mode === 'last') return { mode: 'last', days: Math.max(1, Math.round(num(r.days, 90))) }
  if (r.mode === 'lastRecords') return { mode: 'lastRecords', count: Math.max(1, Math.round(num(r.count, 6))) }
  if (r.mode === 'between' || (!w && !legacy.range && (isISODate(legacy.from) || isISODate(legacy.to)))) {
    const from = r.mode ? r.from : legacy.from
    const to = r.mode ? r.to : legacy.to
    const out: RecordWindow = { mode: 'between' }
    if (isISODate(from)) out.from = from
    if (isISODate(to)) out.to = to
    return out
  }
  return { mode: 'all' }
}

const UNITS: EveryUnit[] = ['day', 'week', 'month', 'year']
function normalizeEvery(v: unknown): Every {
  const e = (v ?? {}) as Record<string, unknown>
  return { n: Math.max(1, Math.min(999, Math.round(num(e.n, 1)))), unit: UNITS.includes(e.unit as EveryUnit) ? (e.unit as EveryUnit) : 'month' }
}

const monthlyFixed = (id: string, name: string, amount: number, day: number, inRecord = false): Recurring => ({
  kind: 'recurring',
  id,
  name,
  value: { mode: 'fixed', amount: roundMoney(amount) },
  every: { n: 1, unit: 'month' },
  start: monthlyStart(day),
  inRecord,
})

/**
 * One projection from any shape the app has written:
 *   v0.8+   recurring { value, every, start } / oneTime
 *   v0.6–7  recurring { amount, day } / oneTime / averaged { mode, range } / extrapolate
 *   v0.2–5  recurring/oneTime with dir in|out, averaged with from/to and "set it myself" (manual)
 * Extrapolate-to-month-end projections are dropped (that type was retired).
 */
function normalizeItem(x: Record<string, unknown>, kindHint?: string): ProjectionItem[] {
  const kind = (x.kind as string) ?? kindHint
  const id = str(x.id) || newId()
  const name = str(x.name)
  switch (kind) {
    case 'recurring': {
      if (x.value && typeof x.value === 'object') {
        const v = x.value as Record<string, unknown>
        const value: RecurringValue =
          v.mode === 'average' || v.mode === 'rate'
            ? { mode: v.mode, source: str(v.source, LEFT_SOURCE), window: normalizeWindow(v.window) }
            : { mode: 'fixed', amount: roundMoney(num(v.amount)) }
        return [
          {
            kind,
            id,
            name,
            value,
            every: normalizeEvery(x.every),
            start: isISODate(x.start) ? x.start : monthlyStart(1),
            inRecord: value.mode === 'fixed' && Boolean(x.inRecord),
          },
        ]
      }
      return [monthlyFixed(id, name, signedAmount(x), clampDay(x.day), Boolean(x.inRecord ?? x.covered))]
    }
    case 'oneTime':
      return isISODate(x.date) ? [{ kind, id, name, amount: signedAmount(x), date: x.date }] : []
    case 'averaged': {
      // "Set it myself" figures (v0.3–v0.5) became plain monthly amounts.
      if (x.manual != null && x.manual !== '') {
        return [monthlyFixed(id, name || 'Monthly amount', num(x.manual), x.mode === 'amount' ? clampDay(x.day) : 1)]
      }
      const window = normalizeWindow(null, x)
      const source = str(x.source, LEFT_SOURCE)
      if (x.mode === 'amount') {
        return [{ kind: 'recurring', id, name, value: { mode: 'average', source, window }, every: { n: 1, unit: 'month' }, start: monthlyStart(clampDay(x.day)), inRecord: false }]
      }
      return [{ ...everydayItem(), id, name, value: { mode: 'rate', source, window } }]
    }
    case 'extrapolate':
      logDebug(`Dropped “${name || 'month-end'}”: extrapolate-to-month-end projections were retired`, 'warn')
      return []
  }
  return []
}

function normalizeStart(v: unknown): StartLines {
  const s = (v ?? {}) as Record<string, unknown>
  if (s.mode === 'lines' && Array.isArray(s.names)) {
    return { mode: 'lines', names: (s.names as unknown[]).filter((n): n is string => typeof n === 'string') }
  }
  return { mode: 'all' }
}

/**
 * Accepts a current projection file, the v0.3–v0.5 single projection file, the
 * v0.2 combined settings file, or the prototype's settings; returns a current
 * ProjectionFile.
 */
export function normalizeProjection(raw: unknown, fallback: { id?: string; name?: string; horizonDays?: number } = {}): ProjectionFile {
  const r = (raw ?? {}) as Record<string, unknown>
  const horizonDays = Math.min(MAX_HORIZON_DAYS, Math.max(1, Math.round(num(r.horizonDays ?? r.horizon, fallback.horizonDays ?? 90))))
  const base = {
    schema: 3 as const,
    id: r.id ? safeId(r.id) : (fallback.id ?? newId()),
    name: str(r.name) || fallback.name || 'Everything',
    start: normalizeStart(r.start),
    horizonDays,
  }
  if (Array.isArray(r.items)) return { ...base, items: arr(r.items).flatMap((x) => normalizeItem(x)) }

  // Older shapes: separate lists.
  const items: ProjectionItem[] = [
    ...arr(r.recurring).flatMap((x) => normalizeItem(x, 'recurring')),
    ...arr(r.oneTime).flatMap((x) => normalizeItem(x, 'oneTime')),
  ]
  if (Array.isArray(r.averaged)) {
    items.push(...arr(r.averaged).flatMap((x) => normalizeItem(x, 'averaged')))
  } else {
    // v0.2 `everyday` (or the prototype's `variable`): auto → an averaged item; a fixed figure → a monthly item.
    const ev = (r.everyday ?? r.variable) as Record<string, unknown> | undefined
    if (ev?.mode === 'manual') {
      items.push(monthlyFixed('everyday', 'Everyday spending', -Math.abs(num(ev.monthly)), 1))
    } else {
      items.push(everydayItem())
    }
  }
  return { ...base, items }
}

export function normalizeTemplate(raw: unknown): TemplateFile {
  const r = (raw ?? {}) as Record<string, unknown>
  let rows: TemplateLine[]
  if (Array.isArray(r.rows) || Array.isArray(r.template)) {
    rows = arr(r.rows ?? r.template).map((t) => {
      const amount = t.amount == null || t.amount === '' ? undefined : roundMoney(num(t.amount))
      const row: TemplateLine = {
        id: str(t.id) || newId(),
        name: str(t.name),
        negative: amount != null && amount !== 0 ? amount < 0 : Boolean(t.negative),
      }
      if (amount != null) row.amount = amount
      return row
    })
  } else if (Array.isArray(r.lines)) {
    // first app version: Setup lines with kinds
    rows = arr(r.lines)
      .filter((l) => LEGACY_KINDS.includes(String(l.kind)))
      .map((l) => ({ id: str(l.id) || newId(), name: str(l.name, 'Unnamed'), negative: !LEGACY_POSITIVE.includes(String(l.kind)) }))
  } else {
    rows = defaultTemplate().rows
  }
  return { schema: 1, rows }
}

/** True for a template that is still exactly the pre-v0.6.2 default (same rows, no amounts). */
export function isPreviousDefault(t: TemplateFile): boolean {
  return (
    t.rows.length === PREVIOUS_DEFAULT_TEMPLATE_IDS.length &&
    t.rows.every((r, i) => r.id === PREVIOUS_DEFAULT_TEMPLATE_IDS[i] && r.amount == null)
  )
}

/**
 * A record's moment. Records from before v0.7 have only a date: they take the
 * local time they were saved at when that falls on the same day, else noon.
 */
function recordAt(r: Record<string, unknown>): string | null {
  if (isLocalDateTime(r.at)) return r.at
  if (!isISODate(r.date)) return null
  const saved = typeof r.savedAt === 'string' ? localFromISO(r.savedAt) : null
  return saved && saved.startsWith(r.date) ? saved : `${r.date}T12:00:00`
}

export function normalizeRecord(raw: unknown): BalanceRecord | null {
  const r = (raw ?? {}) as Record<string, unknown>
  const at = recordAt(r)
  if (!at || !Array.isArray(r.lines)) return null
  const lines: RecordLine[] = arr(r.lines).map((l) => ({
    id: str(l.id) || newId(),
    name: str(l.name, 'Unnamed'),
    amount: 'kind' in l ? legacySigned(l) : roundMoney(num(l.amount)),
  }))
  // Totals are recomputed rather than trusted.
  return makeRecord(at, lines, str(r.savedAt) || new Date().toISOString())
}

// ---------------------------------------------------------------- load

async function loadFrom(store: Store) {
  const readSafe = (id: string) =>
    store.readJSON<unknown>(id).catch((e) => {
      logDebug(`${id} unreadable: ${(e as Error).message}`, 'error')
      return null
    })
  const legacyHorizon = num(readPref('horizonDays'), 90)
  const hasProjections = () => store.list(PROJECTIONS_PREFIX).length > 0

  // v0.2 → split the combined settings file.
  if (store.has(LEGACY_SETTINGS_ID)) {
    const legacy = await readSafe(LEGACY_SETTINGS_ID)
    if (legacy) {
      if (!hasProjections() && !store.has(LEGACY_PROJECTION_ID)) {
        const p = normalizeProjection(legacy, { id: 'everything', horizonDays: legacyHorizon })
        await store.writeJSON(projectionId(p.id), p)
      }
      if (!store.has(TEMPLATE_ID)) await store.writeJSON(TEMPLATE_ID, normalizeTemplate(legacy))
      await store.remove(LEGACY_SETTINGS_ID)
      logDebug('Split settings into projections/ and template.json')
    }
  }
  // v0.3–v0.5 → the single projection file becomes the first of the projections.
  if (store.has(LEGACY_PROJECTION_ID)) {
    const legacy = await readSafe(LEGACY_PROJECTION_ID)
    if (legacy && !hasProjections()) {
      const p = normalizeProjection(legacy, { id: 'everything', horizonDays: legacyHorizon })
      await store.writeJSON(projectionId(p.id), p)
    }
    await store.remove(LEGACY_PROJECTION_ID)
    logDebug('Moved projection.json into projections/')
  }

  const list: ProjectionFile[] = []
  for (const m of store.list(PROJECTIONS_PREFIX)) {
    const raw = await readSafe(m.id)
    if (raw) list.push(normalizeProjection(raw, { id: m.id.slice(PROJECTIONS_PREFIX.length) }))
  }
  if (!list.length) {
    const p = defaultProjection()
    await store.writeJSON(projectionId(p.id), p)
    list.push(p)
  }
  projections.value = list.sort((a, b) => a.name.localeCompare(b.name))
  if (!list.some((p) => p.id === selectedId.value)) selectProjection(list[0].id)

  const rawTemplate = await readSafe(TEMPLATE_ID)
  template.value = rawTemplate == null ? defaultTemplate() : normalizeTemplate(rawTemplate)
  if (isPreviousDefault(template.value)) {
    // Never customised: move it to the current default rows.
    template.value = defaultTemplate()
    await store.writeJSON(TEMPLATE_ID, template.value)
    logDebug('Updated the record template to the new default rows')
  }
  if (!store.has(TEMPLATE_ID)) await store.writeJSON(TEMPLATE_ID, template.value)

  const recs: BalanceRecord[] = []
  for (const m of store.list('records/')) {
    try {
      const rec = normalizeRecord(await store.readJSON(m.id))
      if (!rec) {
        logDebug(`Skipped malformed record ${m.id}`, 'warn')
        continue
      }
      // Pre-v0.7 files are named by date only: rename to the date-time name.
      if (m.id !== recordId(rec.at)) {
        if (!store.has(recordId(rec.at))) await store.writeJSON(recordId(rec.at), rec)
        await store.remove(m.id)
      }
      recs.push(rec)
    } catch (e) {
      logDebug(`Couldn’t read ${m.id}: ${(e as Error).message}`, 'error')
    }
  }
  records.value = recs.sort(byAt)
}

let loading: Promise<void> | null = null
export function loadTracker(): Promise<void> {
  if (loading) return loading
  loading = (async () => {
    try {
      await loadFrom(await init())
    } catch (e) {
      loadError.value = (e as Error).message
      logDebug(`Load failed: ${(e as Error).message}`, 'error')
    } finally {
      loaded.value = true
    }
  })()
  return loading
}

// ---------------------------------------------------------------- writes

/**
 * Save a balance sheet taken at `at`. When editing, `replacing` is the record's
 * original moment: if the time was changed, the old file goes.
 */
async function saveRecord(at: string, lines: RecordLine[], replacing?: string) {
  const rec = makeRecord(at, lines)
  let list = upsertRecord(records.value, rec)
  if (replacing && replacing !== at) list = list.filter((r) => r.at !== replacing)
  records.value = list
  await getStore().writeJSON(recordId(at), rec)
  if (replacing && replacing !== at) await getStore().remove(recordId(replacing))
}

async function deleteRecord(at: string) {
  records.value = records.value.filter((r) => r.at !== at)
  await getStore().remove(recordId(at))
}

/** Create or replace one projection file. */
async function saveProjection(next: ProjectionFile) {
  const p = normalizeProjection(next, { id: next.id })
  projections.value = [...projections.value.filter((x) => x.id !== p.id), p].sort((a, b) => a.name.localeCompare(b.name))
  await getStore().writeJSON(projectionId(p.id), p)
}

/** A new projection, empty or copied from another; selected straight away. */
async function createProjection(name: string, copyOf?: ProjectionFile): Promise<ProjectionFile> {
  const base = copyOf ? (JSON.parse(JSON.stringify(copyOf)) as ProjectionFile) : { ...defaultProjection(), items: [] }
  const p: ProjectionFile = { ...base, id: newId(), name: name.trim() || 'New projection' }
  if (copyOf) p.items = p.items.map((i) => ({ ...i, id: newId() }))
  await saveProjection(p)
  selectProjection(p.id)
  return p
}

async function deleteProjection(id: string) {
  if (projections.value.length <= 1) throw new Error('You need at least one projection.')
  projections.value = projections.value.filter((p) => p.id !== id)
  if (selectedId.value === id) selectProjection(projections.value[0].id)
  await getStore().remove(projectionId(id))
}

/** Save rows as the template every new record starts from. */
async function saveTemplate(rows: TemplateLine[]) {
  template.value = normalizeTemplate({ rows })
  await getStore().writeJSON(TEMPLATE_ID, template.value)
}

// ---------------------------------------------------------------- import / export

export type ImportBundle = {
  kind: 'zip' | 'json' | 'prototype'
  files: { id: string; ext: string; text: string }[]
  recordCount: number
  projectionCount: number
}

/** Identifies the clipboard / JSON export format. Bump `format` if its shape changes. */
export const TRANSFER_APP = 'pocket-master'
export const TRANSFER_FORMAT = 2
/** Clipboard copies above this size are refused (use the zip): big pastes stall phones. */
export const CLIPBOARD_LIMIT_BYTES = 500 * 1024

/**
 * Everything as one readable JSON document: the same data as the files,
 * `records` newest first. This is what Copy to clipboard puts on the clipboard.
 */
export function buildTransferJSON(ps: ProjectionFile[], t: TemplateFile, recs: BalanceRecord[]): string {
  const doc = {
    app: TRANSFER_APP,
    format: TRANSFER_FORMAT,
    exportedAt: new Date().toISOString(),
    projections: ps,
    template: t,
    records: [...recs].sort((a, b) => byAt(b, a)),
  }
  return JSON.stringify(doc, null, 1)
}

const bundle = (kind: ImportBundle['kind'], files: ImportBundle['files']): ImportBundle => ({
  kind,
  files,
  recordCount: files.filter((f) => f.id.startsWith('records/')).length,
  projectionCount: files.filter((f) => f.id.startsWith(PROJECTIONS_PREFIX)).length,
})

/**
 * Parse pasted or uploaded JSON: this app's export (format 1 or 2) or the
 * prototype's `{ settings, records }`. Validates and normalizes without writing.
 */
export function parseImportText(text: string): ImportBundle {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(text.trim())
  } catch {
    throw new Error('That isn’t valid JSON. Copy the whole export (it starts with { and ends with }) and try again.')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('That JSON isn’t an export from this app.')

  const files: ImportBundle['files'] = []
  const add = (id: string, value: unknown) => files.push({ id, ext: 'json', text: JSON.stringify(value) })
  const addProjection = (p: ProjectionFile) => add(projectionId(p.id), p)
  let kind: ImportBundle['kind']

  if (parsed.app === TRANSFER_APP) {
    if (num(parsed.format, 0) > TRANSFER_FORMAT) {
      throw new Error('That export was made by a newer version of the app. Tap “Reload latest” first.')
    }
    kind = 'json'
    for (const raw of arr(parsed.projections)) addProjection(normalizeProjection(raw))
    if (parsed.projection) addProjection(normalizeProjection(parsed.projection, { id: 'everything' })) // format 1
    if (parsed.template) add(TEMPLATE_ID, normalizeTemplate(parsed.template))
  } else if (parsed.settings || Array.isArray(parsed.records)) {
    kind = 'prototype'
    if (parsed.settings) {
      addProjection(normalizeProjection(parsed.settings, { id: 'everything' }))
      add(TEMPLATE_ID, normalizeTemplate(parsed.settings))
    }
  } else {
    throw new Error('That JSON isn’t an export from this app (no projections, template or records in it).')
  }
  let skipped = 0
  for (const raw of Array.isArray(parsed.records) ? parsed.records : []) {
    const rec = normalizeRecord(raw)
    if (rec) add(recordId(rec.at), rec)
    else skipped++
  }
  if (skipped) logDebug(`Import skipped ${skipped} record(s) without a valid date`, 'warn')
  if (!files.length) throw new Error('That export is empty: no records, projections or template.')
  return bundle(kind, files)
}

/** Read a .zip backup or a .json export (this app's or the prototype's); validates without writing. */
async function readImport(file: File): Promise<ImportBundle> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b
  if (!isZip) return parseImportText(new TextDecoder().decode(bytes))

  const out: ImportBundle['files'] = []
  for (const f of Store.readZip(bytes).files) {
    // Older backups: the combined settings file, or the single projection file.
    if (f.id === LEGACY_SETTINGS_ID) {
      const parsed = JSON.parse(f.text)
      const p = normalizeProjection(parsed, { id: 'everything' })
      out.push({ id: projectionId(p.id), ext: 'json', text: JSON.stringify(p) })
      out.push({ id: TEMPLATE_ID, ext: 'json', text: JSON.stringify(normalizeTemplate(parsed)) })
    } else if (f.id === LEGACY_PROJECTION_ID) {
      const p = normalizeProjection(JSON.parse(f.text), { id: 'everything' })
      out.push({ id: projectionId(p.id), ext: 'json', text: JSON.stringify(p) })
    } else {
      out.push(f)
    }
  }
  // If both a legacy settings and template were present, keep the last template only.
  const dedup = new Map(out.map((f) => [f.id, f]))
  return bundle('zip', [...dedup.values()])
}

async function applyImport(b: ImportBundle, mode: 'merge' | 'replace') {
  const store = getStore()
  await store.importFiles(b.files, mode)
  await loadFrom(store)
}

/** The current data as clipboard JSON, with its size in bytes. */
function exportText(): { text: string; bytes: number } {
  const text = buildTransferJSON(projections.value, template.value, records.value)
  return { text, bytes: new TextEncoder().encode(text).byteLength }
}

// ---------------------------------------------------------------- derived

const latest = computed(() => records.value[records.value.length - 1] ?? null)
const previous = computed(() => records.value[records.value.length - 2] ?? null)
const recordTimes = computed(() => new Set(records.value.map((r) => r.at)))
const knownLines = computed(() => lineNames(records.value))
const selected = computed(() => projections.value.find((p) => p.id === selectedId.value) ?? projections.value[0])

function projectFor(p: ProjectionFile) {
  return project(p, records.value)
}
function resultsFor(p: ProjectionFile) {
  return itemResults(p, records.value)
}
const currentProjection = computed(() => (selected.value ? projectFor(selected.value) : null))

export function useTracker() {
  return {
    projections,
    selected,
    selectedId,
    template,
    records,
    loaded,
    loadError,
    latest,
    previous,
    recordTimes,
    knownLines,
    currentProjection,
    projectFor,
    resultsFor,
    saveRecord,
    deleteRecord,
    saveProjection,
    createProjection,
    deleteProjection,
    selectProjection,
    saveTemplate,
    readImport,
    applyImport,
    exportText,
  }
}
