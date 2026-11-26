// App state for the budget tracker: settings + records, loaded from the file
// store, with the derived figures every screen uses.
//
// Files (spec §3 "Mapping onto the file store"):
//   settings              → Settings
//   records/<YYYY-MM-DD>  → BalanceRecord (id = date, so a same-day save is a new revision)

import { computed, ref, shallowRef } from 'vue'
import {
  type BalanceRecord,
  type Horizon,
  type OneTime,
  type RecordLine,
  type Recurring,
  type Settings,
  type TemplateLine,
  HORIZONS,
  autoEveryday,
  defaultSettings,
  makeRecord,
  monthlyUsed,
  newId,
  project,
  upsertRecord,
} from '../../lib/finance'
import { isISODate, roundMoney } from '../../lib/money'
import { Store, getStore, init } from '../../lib/storage/store'
import { logDebug } from '../../debug'

const SETTINGS_ID = 'settings'
const recordId = (date: string) => `records/${date}`

const settings = shallowRef<Settings>(defaultSettings())
const records = shallowRef<BalanceRecord[]>([])
const loaded = ref(false)
const loadError = ref('')

// ---------------------------------------------------------------- normalizing (and schema migration)

const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : d)
const clampShare = (v: unknown) => Math.min(100, Math.max(0, num(v, 100)))
const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d)

// Schema 1 (and the prototype) gave every line a kind and kept amounts positive.
// Schema 2 has no kinds: the sign of the amount says which side it's on.
const LEGACY_POSITIVE = ['account', 'receiving']
const LEGACY_KINDS = ['account', 'receiving', 'card', 'bill', 'paying']

/** A schema-1 line → a signed amount (cards counted at their share). */
function legacySigned(l: Record<string, unknown>): number {
  const kind = String(l.kind)
  if (kind === 'card') return -roundMoney((Math.abs(num(l.total ?? l.amount)) * clampShare(l.share)) / 100)
  const v = Math.abs(num(l.amount))
  return LEGACY_POSITIVE.includes(kind) ? v : -v
}

/**
 * Accept any settings shape this app (or the prototype) has written and return
 * a current one. When `schema` is bumped, add the step here.
 */
export function normalizeSettings(raw: unknown): Settings {
  const r = (raw ?? {}) as Record<string, unknown>
  const base = defaultSettings()
  let template: TemplateLine[]
  if (Array.isArray(r.template)) {
    template = (r.template as Record<string, unknown>[]).map((t) => {
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
    // schema 1: Setup lines with kinds
    template = (r.lines as Record<string, unknown>[])
      .filter((l) => LEGACY_KINDS.includes(String(l?.kind)))
      .map((l) => ({ id: str(l.id) || newId(), name: str(l.name, 'Unnamed'), negative: !LEGACY_POSITIVE.includes(String(l.kind)) }))
  } else {
    template = base.template
  }
  const recurring: Recurring[] = Array.isArray(r.recurring)
    ? (r.recurring as Record<string, unknown>[]).map((x) => ({
        id: str(x.id) || newId(),
        name: str(x.name),
        dir: x.dir === 'in' ? 'in' : 'out',
        amount: roundMoney(Math.abs(num(x.amount))),
        day: Math.min(31, Math.max(1, Math.round(num(x.day, 1)))),
        inRecord: Boolean(x.inRecord ?? x.covered),
      }))
    : []
  const oneTime: OneTime[] = Array.isArray(r.oneTime)
    ? (r.oneTime as Record<string, unknown>[])
        .filter((x) => isISODate(x.date))
        .map((x) => ({
          id: str(x.id) || newId(),
          name: str(x.name),
          dir: x.dir === 'in' ? 'in' : 'out',
          amount: roundMoney(Math.abs(num(x.amount))),
          date: x.date as string,
        }))
    : []
  const ev = (r.everyday ?? r.variable ?? {}) as Record<string, unknown>
  const everyday = {
    mode: ev.mode === 'manual' ? ('manual' as const) : ('auto' as const),
    monthly: roundMoney(Math.abs(num(ev.monthly))),
  }
  const h = num(r.horizonDays ?? r.horizon, 90) as Horizon
  return { schema: 2, template, recurring, oneTime, everyday, horizonDays: HORIZONS.includes(h) ? h : 90 }
}

export function normalizeRecord(raw: unknown): BalanceRecord | null {
  const r = (raw ?? {}) as Record<string, unknown>
  if (!isISODate(r.date) || !Array.isArray(r.lines)) return null
  const lines: RecordLine[] = (r.lines as Record<string, unknown>[])
    .filter((l) => l && typeof l === 'object')
    .map((l) => ({
      id: str(l.id) || newId(),
      name: str(l.name, 'Unnamed'),
      amount: 'kind' in l ? legacySigned(l) : roundMoney(num(l.amount)),
    }))
  // Totals are recomputed rather than trusted.
  return makeRecord(r.date, lines, str(r.savedAt) || new Date().toISOString())
}

// ---------------------------------------------------------------- load

async function loadFrom(store: Store) {
  const rawSettings = await store.readJSON<unknown>(SETTINGS_ID).catch((e) => {
    logDebug(`settings unreadable: ${(e as Error).message}`, 'error')
    return null
  })
  if (rawSettings == null) {
    settings.value = defaultSettings()
    if (!store.has(SETTINGS_ID)) await store.writeJSON(SETTINGS_ID, settings.value)
  } else {
    settings.value = normalizeSettings(rawSettings)
  }

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

async function saveSettings(next: Settings) {
  settings.value = normalizeSettings(next)
  await getStore().writeJSON(SETTINGS_ID, settings.value)
}

/** Save the rows of a record as the template every new record starts from. */
async function saveTemplate(rows: TemplateLine[]) {
  await saveSettings({ ...settings.value, template: rows })
}

async function setHorizon(h: Horizon) {
  await saveSettings({ ...settings.value, horizonDays: h })
}

// ---------------------------------------------------------------- import

export type ImportBundle = { kind: 'zip' | 'prototype'; files: { id: string; ext: string; text: string }[]; recordCount: number }

/** Read a .zip backup or a prototype .json export; validates without writing. */
async function readImport(file: File): Promise<ImportBundle> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b
  if (isZip) {
    const { files } = Store.readZip(bytes)
    return { kind: 'zip', files, recordCount: files.filter((f) => f.id.startsWith('records/')).length }
  }
  let parsed: { settings?: unknown; records?: unknown[] }
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new Error('That file isn’t a backup zip or a JSON export.')
  }
  if (!parsed || (!parsed.settings && !Array.isArray(parsed.records))) {
    throw new Error('That JSON doesn’t have “settings” or “records”, so it isn’t an export from the prototype.')
  }
  const files: ImportBundle['files'] = []
  if (parsed.settings) files.push({ id: SETTINGS_ID, ext: 'json', text: JSON.stringify(normalizeSettings(parsed.settings)) })
  for (const raw of parsed.records ?? []) {
    const rec = normalizeRecord(raw)
    if (rec) files.push({ id: recordId(rec.date), ext: 'json', text: JSON.stringify(rec) })
  }
  return { kind: 'prototype', files, recordCount: files.length - (parsed.settings ? 1 : 0) }
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

function deriveFor(s: Pick<Settings, 'recurring' | 'oneTime' | 'everyday'>, horizonDays: number) {
  const auto = autoEveryday(records.value, s.recurring, s.oneTime)
  const monthly = monthlyUsed(s, auto)
  const projection = latest.value ? project(latest.value, s, monthly, horizonDays) : null
  return { auto, monthly, projection }
}

const derived = computed(() => deriveFor(settings.value, settings.value.horizonDays))

export function useTracker() {
  return {
    settings,
    records,
    loaded,
    loadError,
    latest,
    previous,
    recordDates,
    derived,
    deriveFor,
    saveRecord,
    deleteRecord,
    saveSettings,
    setHorizon,
    saveTemplate,
    readImport,
    applyImport,
  }
}
