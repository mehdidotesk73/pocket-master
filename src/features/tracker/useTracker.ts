// App state: the three kinds of stored file, and everything computed from them.
//
//   records/<YYYY-MM-DD>.json  one BalanceRecord per date (a same-day save is a new revision)
//   projection.json            ProjectionFile: recurring, one-time and averaged changes
//   template.json              TemplateFile: the rows every new record starts with
//
// Totals, averages and the projection itself are computed in the app, never stored.
// The horizon (30/90/180/365) is a per-device view preference in localStorage.

import { computed, ref, shallowRef } from 'vue'
import {
  type Averaged,
  type BalanceRecord,
  type Horizon,
  type OneTime,
  type ProjectionFile,
  type RecordLine,
  type Recurring,
  type TemplateFile,
  type TemplateLine,
  HORIZONS,
  LEFT_SOURCE,
  defaultProjection,
  defaultTemplate,
  everydayItem,
  lineNames,
  makeRecord,
  newId,
  project,
  upsertRecord,
} from '../../lib/finance'
import { isISODate, roundMoney } from '../../lib/money'
import { Store, getStore, init } from '../../lib/storage/store'
import { logDebug } from '../../debug'

export const PROJECTION_ID = 'projection'
export const TEMPLATE_ID = 'template'
/** Schema-2 app stored projection items, template and horizon together here. */
const LEGACY_SETTINGS_ID = 'settings'
const recordId = (date: string) => `records/${date}`

const projection = shallowRef<ProjectionFile>(defaultProjection())
const template = shallowRef<TemplateFile>(defaultTemplate())
const records = shallowRef<BalanceRecord[]>([])
const loaded = ref(false)
const loadError = ref('')

function readHorizon(): Horizon {
  try {
    const h = Number(localStorage.getItem('horizonDays')) as Horizon
    if (HORIZONS.includes(h)) return h
  } catch {
    /* private mode */
  }
  return 90
}
const horizon = ref<Horizon>(readHorizon())
function setHorizon(h: Horizon) {
  horizon.value = h
  try {
    localStorage.setItem('horizonDays', String(h))
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

/**
 * Accepts the current projection file, the older single `settings` file, or
 * the prototype's settings, and returns a current ProjectionFile.
 */
export function normalizeProjection(raw: unknown): ProjectionFile {
  const r = (raw ?? {}) as Record<string, unknown>
  const recurring: Recurring[] = arr(r.recurring).map((x) => ({
    id: str(x.id) || newId(),
    name: str(x.name),
    amount: signedAmount(x),
    day: clampDay(x.day),
    inRecord: Boolean(x.inRecord ?? x.covered),
  }))
  const oneTime: OneTime[] = arr(r.oneTime)
    .filter((x) => isISODate(x.date))
    .map((x) => ({ id: str(x.id) || newId(), name: str(x.name), amount: signedAmount(x), date: x.date as string }))

  let averaged: Averaged[]
  if (Array.isArray(r.averaged)) {
    averaged = arr(r.averaged).map((x) => {
      const a: Averaged = {
        id: str(x.id) || newId(),
        name: str(x.name),
        source: str(x.source, LEFT_SOURCE),
        mode: x.mode === 'amount' ? 'amount' : 'rate',
        day: clampDay(x.day),
      }
      if (isISODate(x.from)) a.from = x.from
      if (isISODate(x.to)) a.to = x.to
      if (x.manual != null && x.manual !== '') a.manual = roundMoney(num(x.manual))
      return a
    })
  } else {
    // Old `everyday` (or the prototype's `variable`) → one averaged item over left so far.
    const ev = (r.everyday ?? r.variable) as Record<string, unknown> | undefined
    const item = everydayItem()
    if (ev?.mode === 'manual') item.manual = -Math.abs(roundMoney(num(ev.monthly)))
    averaged = [item]
  }
  return { schema: 1, recurring, oneTime, averaged }
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

export function normalizeRecord(raw: unknown): BalanceRecord | null {
  const r = (raw ?? {}) as Record<string, unknown>
  if (!isISODate(r.date) || !Array.isArray(r.lines)) return null
  const lines: RecordLine[] = arr(r.lines).map((l) => ({
    id: str(l.id) || newId(),
    name: str(l.name, 'Unnamed'),
    amount: 'kind' in l ? legacySigned(l) : roundMoney(num(l.amount)),
  }))
  // Totals are recomputed rather than trusted.
  return makeRecord(r.date, lines, str(r.savedAt) || new Date().toISOString())
}

// ---------------------------------------------------------------- load

async function loadFrom(store: Store) {
  const readSafe = (id: string) =>
    store.readJSON<unknown>(id).catch((e) => {
      logDebug(`${id} unreadable: ${(e as Error).message}`, 'error')
      return null
    })

  // One-time split of the old combined settings file.
  if (store.has(LEGACY_SETTINGS_ID) && !store.has(PROJECTION_ID)) {
    const legacy = await readSafe(LEGACY_SETTINGS_ID)
    if (legacy) {
      await store.writeJSON(PROJECTION_ID, normalizeProjection(legacy))
      await store.writeJSON(TEMPLATE_ID, normalizeTemplate(legacy))
      const h = num((legacy as Record<string, unknown>).horizonDays) as Horizon
      if (HORIZONS.includes(h)) setHorizon(h)
      await store.remove(LEGACY_SETTINGS_ID)
      logDebug('Split settings into projection.json and template.json')
    }
  }

  const rawProjection = await readSafe(PROJECTION_ID)
  projection.value = rawProjection == null ? defaultProjection() : normalizeProjection(rawProjection)
  if (!store.has(PROJECTION_ID)) await store.writeJSON(PROJECTION_ID, projection.value)

  const rawTemplate = await readSafe(TEMPLATE_ID)
  template.value = rawTemplate == null ? defaultTemplate() : normalizeTemplate(rawTemplate)
  if (!store.has(TEMPLATE_ID)) await store.writeJSON(TEMPLATE_ID, template.value)

  const list: BalanceRecord[] = []
  for (const m of store.list('records/')) {
    try {
      const rec = normalizeRecord(await store.readJSON(m.id))
      if (rec) list.push(rec)
      else logDebug(`Skipped malformed record ${m.id}`, 'warn')
    } catch (e) {
      logDebug(`Couldn’t read ${m.id}: ${(e as Error).message}`, 'error')
    }
  }
  records.value = list.sort((a, b) => a.date.localeCompare(b.date))
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

async function saveRecord(date: string, lines: RecordLine[]) {
  const rec = makeRecord(date, lines)
  records.value = upsertRecord(records.value, rec)
  await getStore().writeJSON(recordId(date), rec)
}

async function deleteRecord(date: string) {
  records.value = records.value.filter((r) => r.date !== date)
  await getStore().remove(recordId(date))
}

async function saveProjection(next: ProjectionFile) {
  projection.value = normalizeProjection(next)
  await getStore().writeJSON(PROJECTION_ID, projection.value)
}

/** Save rows as the template every new record starts from. */
async function saveTemplate(rows: TemplateLine[]) {
  template.value = normalizeTemplate({ rows })
  await getStore().writeJSON(TEMPLATE_ID, template.value)
}

// ---------------------------------------------------------------- import

export type ImportBundle = { kind: 'zip' | 'prototype'; files: { id: string; ext: string; text: string }[]; recordCount: number }

/** Read a .zip backup or a prototype .json export; validates without writing. */
async function readImport(file: File): Promise<ImportBundle> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b
  let files: ImportBundle['files']
  let kind: ImportBundle['kind']
  if (isZip) {
    files = Store.readZip(bytes).files
    kind = 'zip'
    // Older backups carry the combined settings file: split it like loadFrom does.
    const legacy = files.find((f) => f.id === LEGACY_SETTINGS_ID)
    if (legacy && !files.some((f) => f.id === PROJECTION_ID)) {
      const parsed = JSON.parse(legacy.text)
      files = files.filter((f) => f !== legacy)
      files.push({ id: PROJECTION_ID, ext: 'json', text: JSON.stringify(normalizeProjection(parsed)) })
      files.push({ id: TEMPLATE_ID, ext: 'json', text: JSON.stringify(normalizeTemplate(parsed)) })
    }
  } else {
    let parsed: { settings?: unknown; records?: unknown[] }
    try {
      parsed = JSON.parse(new TextDecoder().decode(bytes))
    } catch {
      throw new Error('That file isn’t a backup zip or a JSON export.')
    }
    if (!parsed || (!parsed.settings && !Array.isArray(parsed.records))) {
      throw new Error('That JSON doesn’t have “settings” or “records”, so it isn’t an export from the prototype.')
    }
    files = []
    kind = 'prototype'
    if (parsed.settings) {
      files.push({ id: PROJECTION_ID, ext: 'json', text: JSON.stringify(normalizeProjection(parsed.settings)) })
      files.push({ id: TEMPLATE_ID, ext: 'json', text: JSON.stringify(normalizeTemplate(parsed.settings)) })
    }
    for (const raw of parsed.records ?? []) {
      const rec = normalizeRecord(raw)
      if (rec) files.push({ id: recordId(rec.date), ext: 'json', text: JSON.stringify(rec) })
    }
  }
  return { kind, files, recordCount: files.filter((f) => f.id.startsWith('records/')).length }
}

async function applyImport(bundle: ImportBundle, mode: 'merge' | 'replace') {
  const store = getStore()
  await store.importFiles(bundle.files, mode)
  await loadFrom(store)
}

// ---------------------------------------------------------------- derived

const latest = computed(() => records.value[records.value.length - 1] ?? null)
const previous = computed(() => records.value[records.value.length - 2] ?? null)
const recordDates = computed(() => new Set(records.value.map((r) => r.date)))
const knownLines = computed(() => lineNames(records.value))

function projectFor(p: ProjectionFile, h: number) {
  return latest.value ? project(latest.value, p, records.value, h) : null
}
const currentProjection = computed(() => projectFor(projection.value, horizon.value))

export function useTracker() {
  return {
    projection,
    template,
    records,
    loaded,
    loadError,
    horizon,
    latest,
    previous,
    recordDates,
    knownLines,
    currentProjection,
    projectFor,
    saveRecord,
    deleteRecord,
    saveProjection,
    saveTemplate,
    setHorizon,
    readImport,
    applyImport,
  }
}
