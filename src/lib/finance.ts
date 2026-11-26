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

// ---------------------------------------------------------------- types (spec §3)

export type LineKind = 'account' | 'receiving' | 'card' | 'bill' | 'paying'

export interface LineDef {
  id: string
  name: string
  kind: LineKind
  /** cards only: default my-share %, 0–100 (default 100) */
  share?: number
}

export interface RecordLine {
  id: string
  name: string
  kind: LineKind
  /** non-card kinds */
  amount?: number
  /** cards */
  total?: number
  share?: number
}

export interface BalanceRecord {
  schema: 1
  date: ISODate
  savedAt: string
  lines: RecordLine[]
  assets: number
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
  schema: 1
  lines: LineDef[]
  recurring: Recurring[]
  oneTime: OneTime[]
  everyday: { mode: 'auto' | 'manual'; monthly: number }
  horizonDays: Horizon
}

export const POSITIVE_KINDS: LineKind[] = ['account', 'receiving']
export const KIND_LABEL: Record<LineKind, string> = {
  account: 'Bank account',
  receiving: 'Money coming in',
  card: 'Credit card',
  bill: 'Bill due',
  paying: 'Money going out',
}

export const isPositive = (k: LineKind) => POSITIVE_KINDS.includes(k)

/** Average days per month, used to turn monthly ↔ daily rates. */
export const DAYS_PER_MONTH = 30.44
/** Auto everyday spending needs records spanning at least this many days. */
export const MIN_AUTO_DAYS = 28
/** …and looks back this far from the latest record. */
export const AUTO_LOOKBACK_DAYS = 120

// ---------------------------------------------------------------- 4.1 line + record

/** A line's contribution in cents (always ≥ 0; the kind decides the sign). */
export function lineValueCents(l: RecordLine): number {
  if (l.kind === 'card') {
    const share = l.share ?? 100
    return Math.round((toCents(l.total) * share) / 100)
  }
  return toCents(l.amount)
}

export function lineValue(l: RecordLine): number {
  return fromCents(lineValueCents(l))
}

export interface Sheet {
  assets: number
  liabilities: number
  left: number
}

export function sheet(lines: RecordLine[]): Sheet {
  let a = 0
  let l = 0
  for (const line of lines) {
    const v = lineValueCents(line)
    if (isPositive(line.kind)) a += v
    else l += v
  }
  return { assets: fromCents(a), liabilities: fromCents(l), left: fromCents(a - l) }
}

/** Build a complete record (with stored totals) from its lines. */
export function makeRecord(date: ISODate, lines: RecordLine[], savedAt = new Date().toISOString()): BalanceRecord {
  return { schema: 1, date, savedAt, lines, ...sheet(lines) }
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

/** First-run setup (spec §8): lines only, no amounts. */
export function defaultSettings(): Settings {
  const line = (id: string, name: string, kind: LineKind): LineDef =>
    kind === 'card' ? { id, name, kind, share: 100 } : { id, name, kind }
  return {
    schema: 1,
    lines: [
      line('checking', 'Checking', 'account'),
      line('rent', 'Month’s rent', 'bill'),
      line('phone-ins', 'Phone and insurance', 'bill'),
      line('discover', 'Discover', 'card'),
      line('capone', 'Capital One', 'card'),
      line('amex', 'Amex', 'card'),
      line('macys', 'Macy’s', 'card'),
      line('paying', 'Paying', 'paying'),
      line('receiving', 'Receiving', 'receiving'),
    ],
    recurring: [],
    oneTime: [],
    everyday: { mode: 'auto', monthly: 0 },
    horizonDays: 90,
  }
}
