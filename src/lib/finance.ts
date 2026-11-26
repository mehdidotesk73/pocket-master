// Budget calculations (spec §4). Pure functions over settings + records:
// no Vue, no storage, so they're unit-tested in finance.test.ts and recompute
// instantly when a draft changes.
//
// All arithmetic is in integer cents. Inputs/outputs that leave this module as
// "dollars" are rounded to the cent.

import {
  type ISODate,
  addDays,
  clampedDate,
  dayNum,
  fromCents,
  monthIndex,
  toCents,
} from './money'

// ---------------------------------------------------------------- types

/**
 * One line of a record. `amount` is signed: positive = something you have
 * (bank balance, money coming in), negative = something you owe or have
 * committed (card balance, bill due, money going out).
 */
export interface RecordLine {
  id: string
  name: string
  amount: number
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

export type Direction = 'in' | 'out'

export interface Recurring {
  id: string
  name: string
  dir: Direction
  amount: number
  day: number
  inRecord: boolean
}

export interface OneTime {
  id: string
  name: string
  dir: Direction
  amount: number
  date: ISODate
}

export type Horizon = 30 | 90 | 180 | 365
export const HORIZONS: Horizon[] = [30, 90, 180, 365]

export interface Settings {
  schema: 2
  template: TemplateLine[]
  recurring: Recurring[]
  oneTime: OneTime[]
  everyday: { mode: 'auto' | 'manual'; monthly: number }
  horizonDays: Horizon
}

/** Average days per month, used to turn monthly ↔ daily rates. */
export const DAYS_PER_MONTH = 30.44
/** Auto everyday spending needs records spanning at least this many days. */
export const MIN_AUTO_DAYS = 28
/** …and looks back this far from the latest record. */
export const AUTO_LOOKBACK_DAYS = 120

// ---------------------------------------------------------------- 4.1 record

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

// ---------------------------------------------------------------- 4.2 scheduled flows

const signed = (dir: Direction, amount: number) => (dir === 'in' ? 1 : -1) * toCents(amount)

/**
 * Net scheduled flow (cents) in the window (s0, s1].
 * `inRecord` recurring items are counted at the start of each month after s0's
 * month, because the next record will list them as due.
 */
export function scheduledCents(
  s0: ISODate,
  s1: ISODate,
  recurring: Recurring[],
  oneTime: OneTime[],
): number {
  const d0 = dayNum(s0)
  const d1 = dayNum(s1)
  if (d1 <= d0) return 0
  const m0 = monthIndex(s0)
  const m1 = monthIndex(s1)
  let total = 0
  for (let M = m0; M <= m1; M++) {
    for (const r of recurring) {
      if (r.inRecord) {
        if (M > m0) total += signed(r.dir, r.amount)
      } else {
        const occ = dayNum(clampedDate(M, r.day))
        if (occ > d0 && occ <= d1) total += signed(r.dir, r.amount)
      }
    }
  }
  for (const o of oneTime) {
    const od = dayNum(o.date)
    if (od > d0 && od <= d1) total += signed(o.dir, o.amount)
  }
  return total
}

export function scheduled(s0: ISODate, s1: ISODate, recurring: Recurring[], oneTime: OneTime[]): number {
  return fromCents(scheduledCents(s0, s1, recurring, oneTime))
}

// ---------------------------------------------------------------- 4.3 everyday spending

export interface AutoEveryday {
  /** dollars per month, or null when records don't span MIN_AUTO_DAYS yet */
  monthly: number | null
  /** span of the records used, in days */
  days: number
  /** number of records used */
  count: number
}

export function autoEveryday(
  records: BalanceRecord[],
  recurring: Recurring[],
  oneTime: OneTime[],
): AutoEveryday {
  if (!records.length) return { monthly: null, days: 0, count: 0 }
  const sorted = [...records].sort((a, b) => a.date.localeCompare(b.date))
  const lastDay = dayNum(sorted[sorted.length - 1].date)
  const used = sorted.filter((r) => dayNum(r.date) >= lastDay - AUTO_LOOKBACK_DAYS)
  const days = used.length ? lastDay - dayNum(used[0].date) : 0
  if (used.length < 2 || days < MIN_AUTO_DAYS) return { monthly: null, days, count: used.length }

  let unexplained = 0
  for (let i = 1; i < used.length; i++) {
    const a = used[i - 1]
    const b = used[i]
    unexplained += toCents(b.left) - toCents(a.left) - scheduledCents(a.date, b.date, recurring, oneTime)
  }
  const monthlyCents = (-unexplained / days) * DAYS_PER_MONTH
  return { monthly: fromCents(monthlyCents), days, count: used.length }
}

/** The monthly everyday figure the projection actually uses. */
export function monthlyUsed(settings: Pick<Settings, 'everyday'>, auto: AutoEveryday): number {
  if (settings.everyday.mode === 'manual' || auto.monthly == null) return settings.everyday.monthly || 0
  return auto.monthly
}

// ---------------------------------------------------------------- 4.4 projection

export interface Point {
  date: ISODate
  value: number
}

export interface Projection {
  start: Point
  series: Point[]
  end: Point
  min: Point
  dailyEveryday: number
}

export function project(
  latest: Pick<BalanceRecord, 'date' | 'left'>,
  settings: Pick<Settings, 'recurring' | 'oneTime'>,
  monthlyEveryday: number,
  horizonDays: number,
): Projection {
  const latestMonth = monthIndex(latest.date)
  const daily = toCents(monthlyEveryday) / DAYS_PER_MONTH
  // one-time items keyed by date for O(1) lookup
  const oneByDate = new Map<ISODate, number>()
  for (const o of settings.oneTime) oneByDate.set(o.date, (oneByDate.get(o.date) ?? 0) + signed(o.dir, o.amount))

  let value = toCents(latest.left)
  const series: Point[] = []
  for (let i = 1; i <= horizonDays; i++) {
    const d = addDays(latest.date, i)
    const mi = monthIndex(d)
    for (const r of settings.recurring) {
      if (clampedDate(mi, r.day) !== d) continue
      if (r.inRecord && mi === latestMonth) continue
      value += signed(r.dir, r.amount)
    }
    value += oneByDate.get(d) ?? 0
    value -= daily
    series.push({ date: d, value: fromCents(value) })
  }
  const start = { date: latest.date, value: latest.left }
  const end = series[series.length - 1] ?? start
  let min = series[0] ?? start
  for (const p of series) if (p.value < min.value) min = p
  return { start, series, end, min, dailyEveryday: fromCents(daily) }
}

// ---------------------------------------------------------------- defaults & ids

export function newId(): string {
  const c = globalThis.crypto as Crypto | undefined
  if (c?.randomUUID) return c.randomUUID().slice(0, 8)
  return Math.random().toString(36).slice(2, 10)
}

/** First-run template (spec §8): rows only, no amounts. */
export function defaultSettings(): Settings {
  const row = (id: string, name: string, negative: boolean): TemplateLine => ({ id, name, negative })
  return {
    schema: 2,
    template: [
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
    recurring: [],
    oneTime: [],
    everyday: { mode: 'auto', monthly: 0 },
    horizonDays: 90,
  }
}
