// Budget calculations. Pure functions over the stored data:
//   records/<date>.json        → BalanceRecord
//   projections/<id>.json      → ProjectionFile (one per projection the user builds)
//   template.json              → TemplateFile (rows new records start with)
// Everything else (totals, the forecast) is computed from those. Projections are
// plain amounts you type; the old computed kinds live on in legacy.ts, only to
// convert old files.
// No Vue, no storage: unit-tested in finance.test.ts.
//
// All arithmetic is in integer cents. Amounts are signed everywhere:
// positive = money you have / money coming in, negative = owed / going out.

import {
  type ISODate,
  type LocalDateTime,
  addDays,
  clampedDate,
  dayNum,
  daysInMonth,
  fromCents,
  isISODate,
  monthIndex,
  parseDate,
  today as todayLocal,
  toCents,
  ymd,
} from './money'

// ---------------------------------------------------------------- types

/** One line of a record. Positive = asset, negative = liability. */
export interface RecordLine {
  id: string
  name: string
  amount: number
}

export interface BalanceRecord {
  schema: 3
  /** When the balance sheet was taken (local). Records are identified and ordered by this. */
  at: LocalDateTime
  /** The date part of `at`; every day-based calculation uses it. */
  date: ISODate
  savedAt: string
  lines: RecordLine[]
  /** Σ positive lines */
  assets: number
  /** Σ |negative lines| (stored as a positive number) */
  liabilities: number
  left: number
}

/** A row of the record template: what every new record starts with. */
export interface TemplateLine {
  id: string
  name: string
  /** Optional starting amount (signed). Prefill from the latest record wins over this. */
  amount?: number
  /** Sign to use while the amount is empty. */
  negative: boolean
}

export interface TemplateFile {
  schema: 1
  rows: TemplateLine[]
}

/** `source` value meaning "the forecast's starting total" (net equity) rather than one line. */
export const LEFT_SOURCE = ''

/** Which records an average or rate is worked out from. 'last'/'lastRecords' count back from the latest. */
export type RecordWindow =
  | { mode: 'all' }
  | { mode: 'last'; days: number }
  | { mode: 'lastRecords'; count: number }
  | { mode: 'between'; from?: ISODate; to?: ISODate }

/** Kept for older call sites. */
export type RecordRange = RecordWindow

export type EveryUnit = 'day' | 'week' | 'month' | 'year'
export interface Every {
  n: number
  unit: EveryUnit
}

/** Which days a rate counts: every day's change, or only the days a line went up / down. */
export type RateDirection = 'both' | 'rising' | 'falling'

/**
 * A measure of past records that a projection's amount is locked to (worked
 * out in lib/analysis.ts, measurePast). `line` is a record line's name, or
 * LEFT_SOURCE for net equity.
 * - average: the line's average value over the window's records
 * - rate:    its average change per day over the window (by date, as the Rates
 *            candles), optionally counting only rising or falling days;
 *            × the days between occurrences
 */
export type PastLink =
  | { measure: 'average'; line: string; window: RecordWindow }
  | { measure: 'rate'; line: string; window: RecordWindow; direction: RateDirection }

/** Repeats every `every` from `start` (its day of month / month of year set the rhythm). */
export interface Recurring {
  kind: 'recurring'
  id: string
  name: string
  /** signed: + coming in, − going out. For a linked projection, the last worked-out value. */
  amount: number
  every: Every
  start: ISODate
  /** Set: the amount is locked to this measure of past records and worked out again whenever they change. */
  link?: PastLink
}

/** A single amount on a date. */
export interface OneTime {
  kind: 'oneTime'
  id: string
  name: string
  /** signed */
  amount: number
  date: ISODate
}

export type ProjectionItem = Recurring | OneTime
export type ItemKind = ProjectionItem['kind']

/** Which lines of the latest record a forecast starts from. */
export type StartLines = { mode: 'all' } | { mode: 'lines'; names: string[] }

/**
 * A forecast: amounts you expect, added up from a starting total (the latest
 * record). Stored as projections/<id>.json. Schema 4: plain amounts only.
 */
export interface ProjectionFile {
  schema: 4
  id: string
  name: string
  start: StartLines
  /** How many days ahead to forecast. */
  horizonDays: number
  items: ProjectionItem[]
}

export const HORIZON_PRESETS = [30, 90, 180, 365]
export const MAX_HORIZON_DAYS = 1830

/** Average days per month / year, to turn a daily rate into an amount per occurrence. */
export const DAYS_PER_MONTH = 30.44
export const DAYS_PER_YEAR = 365.25
// ---------------------------------------------------------------- records

export interface Sheet {
  assets: number
  liabilities: number
  left: number
}

/** Positive lines are assets, negative lines are liabilities; left = assets − liabilities. */
export function sheet(lines: Pick<RecordLine, 'amount'>[]): Sheet {
  let a = 0
  let l = 0
  for (const line of lines) {
    const v = toCents(line.amount)
    if (v > 0) a += v
    else l -= v
  }
  return { assets: fromCents(a), liabilities: fromCents(l), left: fromCents(a - l) }
}

/** Oldest first, by date and time. */
export const byAt = (a: Pick<BalanceRecord, 'at'>, b: Pick<BalanceRecord, 'at'>) => a.at.localeCompare(b.at)

/**
 * Build a complete record (with stored totals) from its lines. `at` is a local
 * date-time; a bare date is taken as noon that day.
 */
export function makeRecord(at: LocalDateTime | ISODate, lines: RecordLine[], savedAt = new Date().toISOString()): BalanceRecord {
  const when = isISODate(at) ? `${at}T12:00:00` : at
  return { schema: 3, at: when, date: when.slice(0, 10), savedAt, lines, ...sheet(lines) }
}

/** Insert, or replace the record with the same `at`; result oldest first. Same-day records coexist. */
export function upsertRecord(records: BalanceRecord[], rec: BalanceRecord): BalanceRecord[] {
  return [...records.filter((r) => r.at !== rec.at), rec].sort(byAt)
}

/** Every line name that appears in any record, in first-seen order (newest records first). */
export function lineNames(records: BalanceRecord[]): string[] {
  const seen = new Map<string, string>()
  for (const r of [...records].reverse()) {
    for (const l of r.lines) {
      const k = norm(l.name)
      if (k && !seen.has(k)) seen.set(k, l.name.trim())
    }
  }
  return [...seen.values()]
}

const norm = (s: string) => s.trim().toLowerCase()

// ---------------------------------------------------------------- schedules

/** Days between occurrences (months and years on average). */
export function periodDays(e: Every): number {
  const n = Math.max(1, Math.round(e.n))
  return n * (e.unit === 'day' ? 1 : e.unit === 'week' ? 7 : e.unit === 'month' ? DAYS_PER_MONTH : DAYS_PER_YEAR)
}

/** Does a recurring projection occur on date d? Month/year days clamp to the month's last day. */
export function occursOn(r: Pick<Recurring, 'every' | 'start'>, d: ISODate): boolean {
  if (d < r.start) return false
  const n = Math.max(1, Math.round(r.every.n))
  const diff = dayNum(d) - dayNum(r.start)
  switch (r.every.unit) {
    case 'day':
      return diff % n === 0
    case 'week':
      return diff % (7 * n) === 0
    case 'month': {
      const months = monthIndex(d) - monthIndex(r.start)
      return months % n === 0 && clampedDate(monthIndex(d), parseDate(r.start).day) === d
    }
    case 'year': {
      const s = parseDate(r.start)
      const t = parseDate(d)
      return t.m === s.m && (t.y - s.y) % n === 0 && clampedDate(monthIndex(d), s.day) === d
    }
  }
}

/** Occurrence dates in (from, to]. */
export function occurrences(r: Pick<Recurring, 'every' | 'start'>, from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = []
  for (let k = dayNum(from) + 1; k <= dayNum(to); k++) {
    const d = fromDayNumLocal(k)
    if (occursOn(r, d)) out.push(d)
  }
  return out
}
const fromDayNumLocal = (k: number) => addDays('1970-01-01', k)

// ---------------------------------------------------------------- start lines

const inStart = (start: StartLines) => {
  if (start.mode === 'all') return () => true
  const keys = new Set(start.names.map(norm))
  return (name: string) => keys.has(norm(name))
}

/** The forecast's starting total in a record: the sum of its selected lines (all = net equity). */
export function startValueCents(r: BalanceRecord, start: StartLines): number {
  if (start.mode === 'all') return toCents(r.left)
  const has = inStart(start)
  return r.lines.filter((l) => has(l.name)).reduce((s, l) => s + toCents(l.amount), 0)
}

// ---------------------------------------------------------------- record windows

export function recordsInWindow(records: BalanceRecord[], w: RecordWindow): BalanceRecord[] {
  const sorted = [...records].sort(byAt)
  if (w.mode === 'all' || !sorted.length) return sorted
  if (w.mode === 'lastRecords') return sorted.slice(-Math.max(1, Math.round(w.count)))
  if (w.mode === 'last') {
    const cut = dayNum(sorted[sorted.length - 1].date) - Math.max(0, Math.round(w.days))
    return sorted.filter((r) => dayNum(r.date) >= cut)
  }
  return sorted.filter((r) => (!w.from || r.date >= w.from) && (!w.to || r.date <= w.to))
}
/** Kept for older call sites. */
export const recordsInRange = recordsInWindow

// ---------------------------------------------------------------- forecast

export interface Point {
  date: ISODate
  value: number
}

export interface Projection {
  start: Point
  series: Point[]
  end: Point
  min: Point
  /** Per projection id: its cumulative change by each day of `series` (dollars, same length). */
  contributions: Record<string, number[]>
}

/**
 * The forecast from the latest record: its starting total, then each day every
 * projection that falls on it. With no records yet it starts at $0 on
 * `startIfEmpty` (today).
 */
export function project(proj: ProjectionFile, records: BalanceRecord[], startIfEmpty: ISODate = todayLocal()): Projection {
  const sorted = [...records].sort(byAt)
  const latest = sorted[sorted.length - 1] ?? null
  const startDate = latest?.date ?? startIfEmpty
  const horizonDays = Math.min(MAX_HORIZON_DAYS, Math.max(1, Math.round(proj.horizonDays)))
  const steps = proj.items.map((it) => ({
    id: it.id,
    cents: toCents(it.amount),
    on: it.kind === 'oneTime' ? (d: ISODate) => d === it.date : (d: ISODate) => occursOn(it, d),
  }))
  const running = new Map<string, number>(proj.items.map((it) => [it.id, 0]))
  const contributions: Record<string, number[]> = Object.fromEntries(proj.items.map((it) => [it.id, [] as number[]]))

  const startCents = latest ? startValueCents(latest, proj.start) : 0
  let value = startCents
  const series: Point[] = []
  for (let i = 1; i <= horizonDays; i++) {
    const d = addDays(startDate, i)
    for (const st of steps) {
      if (st.on(d)) {
        value += st.cents
        running.set(st.id, running.get(st.id)! + st.cents)
      }
      contributions[st.id].push(fromCents(running.get(st.id)!))
    }
    series.push({ date: d, value: fromCents(value) })
  }
  const start = { date: startDate, value: fromCents(startCents) }
  const end = series[series.length - 1] ?? start
  let min = series[0] ?? start
  for (const p of series) if (p.value < min.value) min = p
  return { start, series, end, min, contributions }
}

// ---------------------------------------------------------------- defaults & ids

export function newId(): string {
  const c = globalThis.crypto as Crypto | undefined
  if (c?.randomUUID) return c.randomUUID().slice(0, 8)
  return Math.random().toString(36).slice(2, 10)
}

/** A start date that suits any day of month: January has 31 days. */
export const monthlyStart = (day: number, year = 2026) => ymd(year, 1, Math.min(31, Math.max(1, Math.round(day))))

export function defaultProjection(id = 'everything'): ProjectionFile {
  return { schema: 4, id, name: 'Everything', start: { mode: 'all' }, horizonDays: 90, items: [] }
}

export const PREVIOUS_DEFAULT_TEMPLATE_IDS = ['checking', 'rent', 'phone-ins', 'discover', 'capone', 'amex', 'macys', 'paying', 'receiving']

/** First-run template: rows only, no amounts. */
export function defaultTemplate(): TemplateFile {
  const row = (id: string, name: string, negative: boolean): TemplateLine => ({ id, name, negative })
  return {
    schema: 1,
    rows: [
      row('checking', 'Checking', false),
      row('discover', 'Discover', true),
      row('capone', 'Capital One', true),
      row('amex', 'Amex', true),
      row('macys', 'Macy’s', true),
      row('saving', 'Saving', false),
    ],
  }
}
