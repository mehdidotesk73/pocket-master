// Budget calculations. Pure functions over the stored data:
//   records/<date>.json        → BalanceRecord
//   projections/<id>.json      → ProjectionFile (one per projection the user builds)
//   template.json              → TemplateFile (rows new records start with)
// Everything else (totals, averages, the projection) is computed from those.
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

/**
 * What a recurring projection adds each time it occurs:
 * - fixed:   an amount you type (signed)
 * - average: the average value of a line (or the starting total) across the window
 * - rate:    how fast that value changed across the window, × the time between occurrences.
 *            For the starting total, the forecast's fixed and one-time projections in the
 *            window are taken out first, so what's left is everyday spending.
 */
export type RecurringValue =
  | { mode: 'fixed'; amount: number }
  | { mode: 'average' | 'rate'; source: string; window: RecordWindow }

/** Repeats every `every` from `start` (its day of month / month of year set the rhythm). */
export interface Recurring {
  kind: 'recurring'
  id: string
  name: string
  value: RecurringValue
  every: Every
  start: ISODate
  /**
   * Fixed monthly amounts only: this month's amount is already a line in the records
   * (e.g. rent listed until paid). Skipped in the latest record's month, and counted at
   * the start of its month when working out rates.
   */
  inRecord: boolean
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

/** A forecast: a set of projections added up from a starting total. Stored as projections/<id>.json. */
export interface ProjectionFile {
  schema: 3
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
/** A rate needs records spanning at least this many days. */
export const MIN_RATE_DAYS = 28

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

const fixedItems = (items: ProjectionItem[]) =>
  items.filter((i): i is Recurring => i.kind === 'recurring' && i.value.mode === 'fixed')
const oneTimes = (items: ProjectionItem[]) => items.filter((i): i is OneTime => i.kind === 'oneTime')

/**
 * Net change (cents) the fixed and one-time projections account for in (s0, s1].
 * `inRecord` items count at the start of the month they fall in, and only for
 * months after s0's (the record at s0 already lists them as due).
 */
export function scheduledCents(s0: ISODate, s1: ISODate, items: ProjectionItem[]): number {
  if (dayNum(s1) <= dayNum(s0)) return 0
  let total = 0
  for (const r of fixedItems(items)) {
    const amount = toCents((r.value as { amount: number }).amount)
    if (r.inRecord) {
      // count once per month after s0's month that has an occurrence, at that month's start
      const seen = new Set<number>()
      for (const d of occurrences(r, addDays(s0, -31), addDays(s1, 31))) {
        const mi = monthIndex(d)
        const first = clampedDate(mi, 1)
        if (mi > monthIndex(s0) && first > s0 && first <= s1 && !seen.has(mi)) {
          seen.add(mi)
          total += amount
        }
      }
    } else {
      total += amount * occurrences(r, s0, s1).length
    }
  }
  for (const o of oneTimes(items)) if (o.date > s0 && o.date <= s1) total += toCents(o.amount)
  return total
}

export function scheduled(s0: ISODate, s1: ISODate, items: ProjectionItem[]): number {
  return fromCents(scheduledCents(s0, s1, items))
}

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

/** The source's signed value in a record (cents), or null when the record doesn't have that line. */
function sourceValue(r: BalanceRecord, source: string, start: StartLines): number | null {
  if (source === LEFT_SOURCE) return startValueCents(r, start)
  const k = norm(source)
  const hits = r.lines.filter((l) => norm(l.name) === k)
  return hits.length ? hits.reduce((s, l) => s + toCents(l.amount), 0) : null
}

export function describeSource(source: string, start: StartLines): string {
  if (source !== LEFT_SOURCE) return source
  return start.mode === 'all' ? 'net equity' : 'the starting total'
}

// ---------------------------------------------------------------- values from records

export interface ItemResult {
  /** Signed dollars added per occurrence, or null when it can't be worked out from the records. */
  value: number | null
  /** What the forecast uses: value, or 0 when null. */
  used: number
  /** For a rate: dollars per day. */
  perDay?: number
  /** Records used and the days they span. */
  count: number
  days: number
  /** Why `value` is null, in plain words. */
  reason?: string
}

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

/** What a recurring projection adds each time it occurs. */
export function evaluateRecurring(item: Recurring, records: BalanceRecord[], proj: Pick<ProjectionFile, 'items' | 'start'>): ItemResult {
  const v = item.value
  if (v.mode === 'fixed') return { value: v.amount, used: v.amount, count: 0, days: 0 }

  const points = recordsInWindow(records, v.window)
    .map((r) => ({ date: r.date, v: sourceValue(r, v.source, proj.start) }))
    .filter((p): p is { date: ISODate; v: number } => p.v != null)
  const days = points.length ? dayNum(points[points.length - 1].date) - dayNum(points[0].date) : 0
  const base = { count: points.length, days }
  if (!points.length) {
    const reason = v.source === LEFT_SOURCE ? 'No records in this window.' : `No records in this window have a line called “${v.source}”.`
    return { ...base, value: null, used: 0, reason }
  }
  if (v.mode === 'average') {
    const avg = fromCents(points.reduce((s, p) => s + p.v, 0) / points.length)
    return { ...base, value: avg, used: avg }
  }
  if (points.length < 2 || days < MIN_RATE_DAYS) {
    return { ...base, value: null, used: 0, reason: `Needs records spanning ${Math.ceil(MIN_RATE_DAYS / 7)}+ weeks (this window has ${days} day${days === 1 ? '' : 's'}).` }
  }
  let change = 0
  const others = proj.items.filter((i) => i.id !== item.id)
  for (let i = 1; i < points.length; i++) {
    change += points[i].v - points[i - 1].v
    if (v.source === LEFT_SOURCE) change -= scheduledCents(points[i - 1].date, points[i].date, others)
  }
  const perDayCents = change / days
  const each = fromCents(perDayCents * periodDays(item.every))
  return { ...base, value: each, used: each, perDay: fromCents(perDayCents) }
}

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
  /** Per recurring projection id: what it adds per occurrence. */
  results: Record<string, ItemResult>
  /** Per projection id: its cumulative change by each day of `series` (dollars, same length). */
  contributions: Record<string, number[]>
}

export function itemResults(proj: ProjectionFile, records: BalanceRecord[]): Record<string, ItemResult> {
  const out: Record<string, ItemResult> = {}
  for (const it of proj.items) if (it.kind === 'recurring') out[it.id] = evaluateRecurring(it, records, proj)
  return out
}

/**
 * The forecast from the latest record. With no records yet it still runs: it
 * starts at zero on `startIfEmpty` (today), and record-based values count as 0.
 */
export function project(proj: ProjectionFile, records: BalanceRecord[], startIfEmpty: ISODate = todayLocal()): Projection {
  const sorted = [...records].sort(byAt)
  const latest = sorted[sorted.length - 1] ?? null
  const startDate = latest?.date ?? startIfEmpty
  const horizonDays = Math.min(MAX_HORIZON_DAYS, Math.max(1, Math.round(proj.horizonDays)))
  // "Already in my records" only applies when there's a record that lists it.
  const latestMonth = latest ? monthIndex(latest.date) : Number.NaN
  const results = itemResults(proj, sorted)

  const stepFor = (it: ProjectionItem): ((d: ISODate) => number) => {
    if (it.kind === 'oneTime') return (d) => (d === it.date ? toCents(it.amount) : 0)
    const each = toCents(results[it.id].used)
    const skipThisMonth = it.inRecord && it.value.mode === 'fixed'
    return (d) => (occursOn(it, d) && !(skipThisMonth && monthIndex(d) === latestMonth) ? each : 0)
  }
  const steps = proj.items.map((it) => ({ id: it.id, step: stepFor(it) }))
  const running = new Map<string, number>(proj.items.map((it) => [it.id, 0]))
  const contributions: Record<string, number[]> = Object.fromEntries(proj.items.map((it) => [it.id, [] as number[]]))

  const startCents = latest ? startValueCents(latest, proj.start) : 0
  let value = startCents
  const series: Point[] = []
  for (let i = 1; i <= horizonDays; i++) {
    const d = addDays(startDate, i)
    for (const { id, step } of steps) {
      const c = step(d)
      value += c
      running.set(id, running.get(id)! + c)
      contributions[id].push(fromCents(running.get(id)!))
    }
    series.push({ date: d, value: fromCents(value) })
  }
  const start = { date: startDate, value: fromCents(startCents) }
  const end = series[series.length - 1] ?? start
  let min = series[0] ?? start
  for (const p of series) if (p.value < min.value) min = p
  return { start, series, end, min, results, contributions }
}

// ---------------------------------------------------------------- defaults & ids

export function newId(): string {
  const c = globalThis.crypto as Crypto | undefined
  if (c?.randomUUID) return c.randomUUID().slice(0, 8)
  return Math.random().toString(36).slice(2, 10)
}

/** A start date that suits any day of month: January has 31 days. */
export const monthlyStart = (day: number, year = 2026) => ymd(year, 1, Math.min(31, Math.max(1, Math.round(day))))

/** Everyday spending: the rate of change of net equity, added every day. */
export function everydayItem(): Recurring {
  return {
    kind: 'recurring',
    id: 'everyday',
    name: 'Everyday spending',
    value: { mode: 'rate', source: LEFT_SOURCE, window: { mode: 'all' } },
    every: { n: 1, unit: 'day' },
    start: '2000-01-01',
    inRecord: false,
  }
}

export function defaultProjection(id = 'everything'): ProjectionFile {
  return { schema: 3, id, name: 'Everything', start: { mode: 'all' }, horizonDays: 90, items: [everydayItem()] }
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
