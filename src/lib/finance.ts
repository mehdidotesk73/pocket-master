// Budget calculations. Pure functions over the stored data:
//   records/<date>.json  → BalanceRecord
//   projection.json      → ProjectionFile (recurring, one-time, averaged items)
//   template.json        → TemplateFile (rows new records start with)
// Everything else (totals, averages, the projection) is computed from those.
// No Vue, no storage: unit-tested in finance.test.ts.
//
// All arithmetic is in integer cents. Amounts are signed everywhere:
// positive = money you have / money coming in, negative = owed / going out.

import { type ISODate, addDays, clampedDate, dayNum, fromCents, monthIndex, toCents } from './money'

// ---------------------------------------------------------------- types

/** One line of a record. Positive = asset, negative = liability. */
export interface RecordLine {
  id: string
  name: string
  amount: number
}

export interface BalanceRecord {
  schema: 2
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

/** A change that repeats every month on `day` (1–31, clamped to the month's last day). */
export interface Recurring {
  id: string
  name: string
  /** signed: + coming in, − going out */
  amount: number
  day: number
  /**
   * This month's amount already shows up as a line in the records (e.g. rent
   * listed until paid). Skipped in the latest record's month; counted at the
   * start of later months when working out averages.
   */
  inRecord: boolean
}

/** A single change on a date. */
export interface OneTime {
  id: string
  name: string
  /** signed */
  amount: number
  date: ISODate
}

/** `source` value meaning "left so far" rather than a named line. */
export const LEFT_SOURCE = ''

/**
 * A change worked out from past records.
 * - 'rate': the source's average change per month across the range becomes a
 *   steady daily drift. For left so far, scheduled items in the range are
 *   removed first (they're projected separately), so what's left is everyday
 *   spending.
 * - 'amount': the source line's average value across the range is applied once
 *   a month on `day`.
 */
export interface Averaged {
  id: string
  name: string
  /** LEFT_SOURCE for left so far, else a record line name (matched case-insensitively). */
  source: string
  mode: 'rate' | 'amount'
  /** Range of record dates to use (inclusive). Empty = from the first / up to the latest record. */
  from?: ISODate
  to?: ISODate
  /** 'amount' mode: day of month to apply it. */
  day: number
  /** When set, used instead of the computed figure (signed, per month). */
  manual?: number
}

export interface ProjectionFile {
  schema: 1
  recurring: Recurring[]
  oneTime: OneTime[]
  averaged: Averaged[]
}

export type Horizon = 30 | 90 | 180 | 365
export const HORIZONS: Horizon[] = [30, 90, 180, 365]

/** Average days per month, used to turn monthly ↔ daily rates. */
export const DAYS_PER_MONTH = 30.44
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

/** Build a complete record (with stored totals) from its lines. */
export function makeRecord(date: ISODate, lines: RecordLine[], savedAt = new Date().toISOString()): BalanceRecord {
  return { schema: 2, date, savedAt, lines, ...sheet(lines) }
}

/** Insert or replace by date; result sorted by date ascending. One record per date. */
export function upsertRecord(records: BalanceRecord[], rec: BalanceRecord): BalanceRecord[] {
  return [...records.filter((r) => r.date !== rec.date), rec].sort((a, b) => a.date.localeCompare(b.date))
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

// ---------------------------------------------------------------- scheduled flows

/**
 * Net scheduled flow (cents) in the window (s0, s1].
 * `inRecord` recurring items count once at the start of each month after s0's
 * month, because the next record will list them as due.
 */
export function scheduledCents(s0: ISODate, s1: ISODate, recurring: Recurring[], oneTime: OneTime[]): number {
  const d0 = dayNum(s0)
  const d1 = dayNum(s1)
  if (d1 <= d0) return 0
  const m0 = monthIndex(s0)
  const m1 = monthIndex(s1)
  let total = 0
  for (let M = m0; M <= m1; M++) {
    for (const r of recurring) {
      if (r.inRecord) {
        if (M > m0) total += toCents(r.amount)
      } else {
        const occ = dayNum(clampedDate(M, r.day))
        if (occ > d0 && occ <= d1) total += toCents(r.amount)
      }
    }
  }
  for (const o of oneTime) {
    const od = dayNum(o.date)
    if (od > d0 && od <= d1) total += toCents(o.amount)
  }
  return total
}

export function scheduled(s0: ISODate, s1: ISODate, recurring: Recurring[], oneTime: OneTime[]): number {
  return fromCents(scheduledCents(s0, s1, recurring, oneTime))
}

// ---------------------------------------------------------------- averaged items

export interface AveragedResult {
  /** Signed dollars per month from the records, or null when there isn't enough data. */
  computed: number | null
  /** What the projection uses: manual if set, else computed, else 0. */
  used: number
  /** Records used and the days they span. */
  count: number
  days: number
  /** Why `computed` is null, in plain words. */
  reason?: string
}

/** The source's signed value in a record, or null when the record doesn't have that line. */
function sourceValue(r: BalanceRecord, source: string): number | null {
  if (source === LEFT_SOURCE) return toCents(r.left)
  const k = norm(source)
  const hits = r.lines.filter((l) => norm(l.name) === k)
  return hits.length ? hits.reduce((s, l) => s + toCents(l.amount), 0) : null
}

export function evaluateAveraged(
  item: Averaged,
  records: BalanceRecord[],
  proj: Pick<ProjectionFile, 'recurring' | 'oneTime'>,
): AveragedResult {
  const inRange = [...records]
    .sort((a, b) => a.date.localeCompare(b.date))
    .filter((r) => (!item.from || r.date >= item.from) && (!item.to || r.date <= item.to))
  const points = inRange
    .map((r) => ({ date: r.date, v: sourceValue(r, item.source) }))
    .filter((p): p is { date: ISODate; v: number } => p.v != null)
  const days = points.length ? dayNum(points[points.length - 1].date) - dayNum(points[0].date) : 0
  const finish = (computed: number | null, reason?: string): AveragedResult => ({
    computed,
    used: item.manual ?? computed ?? 0,
    count: points.length,
    days,
    reason,
  })

  if (!points.length) return finish(null, item.source === LEFT_SOURCE ? 'No records in this range.' : `No records in this range have a line called “${item.source}”.`)

  if (item.mode === 'amount') {
    const avg = points.reduce((s, p) => s + p.v, 0) / points.length
    return finish(fromCents(avg))
  }

  // rate
  if (points.length < 2 || days < MIN_RATE_DAYS) {
    return finish(null, `Needs records spanning ${Math.ceil(MIN_RATE_DAYS / 7)}+ weeks (this range has ${days} day${days === 1 ? '' : 's'}).`)
  }
  let change = 0
  for (let i = 1; i < points.length; i++) {
    change += points[i].v - points[i - 1].v
    // For left so far, take out what the scheduled items explain.
    if (item.source === LEFT_SOURCE) change -= scheduledCents(points[i - 1].date, points[i].date, proj.recurring, proj.oneTime)
  }
  return finish(fromCents((change / days) * DAYS_PER_MONTH))
}

// ---------------------------------------------------------------- projection

export interface Point {
  date: ISODate
  value: number
}

export interface Projection {
  start: Point
  series: Point[]
  end: Point
  min: Point
  /** Per averaged item id. */
  averaged: Record<string, AveragedResult>
  /** Net daily drift from rate items (dollars/day). */
  dailyDrift: number
}

export function project(
  latest: Pick<BalanceRecord, 'date' | 'left'>,
  proj: ProjectionFile,
  records: BalanceRecord[],
  horizonDays: number,
): Projection {
  const latestMonth = monthIndex(latest.date)
  const averaged: Record<string, AveragedResult> = {}
  let driftCents = 0
  const monthlyAmounts: { day: number; cents: number }[] = []
  for (const a of proj.averaged) {
    const res = evaluateAveraged(a, records, proj)
    averaged[a.id] = res
    if (a.mode === 'rate') driftCents += toCents(res.used) / DAYS_PER_MONTH
    else monthlyAmounts.push({ day: a.day, cents: toCents(res.used) })
  }

  const oneByDate = new Map<ISODate, number>()
  for (const o of proj.oneTime) oneByDate.set(o.date, (oneByDate.get(o.date) ?? 0) + toCents(o.amount))

  let value = toCents(latest.left)
  const series: Point[] = []
  for (let i = 1; i <= horizonDays; i++) {
    const d = addDays(latest.date, i)
    const mi = monthIndex(d)
    for (const r of proj.recurring) {
      if (clampedDate(mi, r.day) !== d) continue
      if (r.inRecord && mi === latestMonth) continue
      value += toCents(r.amount)
    }
    for (const m of monthlyAmounts) if (clampedDate(mi, m.day) === d) value += m.cents
    value += oneByDate.get(d) ?? 0
    value += driftCents
    series.push({ date: d, value: fromCents(value) })
  }
  const start = { date: latest.date, value: latest.left }
  const end = series[series.length - 1] ?? start
  let min = series[0] ?? start
  for (const p of series) if (p.value < min.value) min = p
  return { start, series, end, min, averaged, dailyDrift: fromCents(driftCents) }
}

// ---------------------------------------------------------------- defaults & ids

export function newId(): string {
  const c = globalThis.crypto as Crypto | undefined
  if (c?.randomUUID) return c.randomUUID().slice(0, 8)
  return Math.random().toString(36).slice(2, 10)
}

export function everydayItem(): Averaged {
  return { id: 'everyday', name: 'Everyday spending', source: LEFT_SOURCE, mode: 'rate', day: 1 }
}

export function defaultProjection(): ProjectionFile {
  return { schema: 1, recurring: [], oneTime: [], averaged: [everydayItem()] }
}

/** First-run template: rows only, no amounts. */
export function defaultTemplate(): TemplateFile {
  const row = (id: string, name: string, negative: boolean): TemplateLine => ({ id, name, negative })
  return {
    schema: 1,
    rows: [
      row('checking', 'Checking', false),
      row('rent', 'Month’s rent', true),
      row('phone-ins', 'Phone and insurance', true),
      row('discover', 'Discover', true),
      row('capone', 'Capital One', true),
      row('amex', 'Amex', true),
      row('macys', 'Macy’s', true),
      row('paying', 'Paying', true),
      row('receiving', 'Receiving', false),
    ],
  }
}
