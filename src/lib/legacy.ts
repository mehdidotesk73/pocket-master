// Projections as they were before v0.15: a recurring value could be worked out
// from records (the average or rate of change of a line over a window, with an
// optional start point), could target a line, and could be "in my records until
// paid". The app no longer does any of that: projections are plain amounts.
// This module only exists to convert old forecasts once, at the value each
// computed projection had at the time (see freezeItems), and keeps the old
// calculations so that value is the same as before. Tested in legacy.test.ts.

import {
  type BalanceRecord,
  type Every,
  LEFT_SOURCE,
  type OneTime,
  type ProjectionItem,
  type RecordWindow,
  type StartLines,
  byAt,
  type Point,
  occurrences,
  periodDays,
  recordsInWindow,
  startValueCents,
} from './finance'
import { type ISODate, addDays, clampedDate, dayNum, fromCents, monthIndex, toCents } from './money'

export const MIN_RATE_DAYS = 28

/**
 * A known value a rate is measured from, placed before the window's records:
 * on a fixed date, or on a day of the latest record's month (so it rolls each
 * month: "$0 on the 1st" for a card paid in full).
 */
export type RateStart = { amount: number; date: ISODate } | { amount: number; day: number }

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
  | { mode: 'average' | 'rate'; source: string; window: RecordWindow; from?: RateStart }

/** Repeats every `every` from `start` (its day of month / month of year set the rhythm). */
export interface LegacyRecurring {
  kind: 'recurring'
  id: string
  name: string
  /** The line it changed (dropped). */
  target?: string
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

/** A one-time amount as stored before v0.15 (it could carry a target line). */
export type LegacyOneTime = OneTime & { target?: string }
export type LegacyItem = LegacyRecurring | LegacyOneTime

const norm = (s: string) => s.trim().toLowerCase()
const fixedItems = (items: LegacyItem[]) =>
  items.filter((i): i is LegacyRecurring => i.kind === 'recurring' && i.value.mode === 'fixed')
const oneTimes = (items: LegacyItem[]) => items.filter((i): i is LegacyOneTime => i.kind === 'oneTime')
/**
 * Net change (cents) the fixed and one-time projections account for in (s0, s1].
 * `inRecord` items count at the start of the month they fall in, and only for
 * months after s0's (the record at s0 already lists them as due).
 */
export function scheduledCents(s0: ISODate, s1: ISODate, items: LegacyItem[]): number {
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

export function scheduled(s0: ISODate, s1: ISODate, items: LegacyItem[]): number {
  return fromCents(scheduledCents(s0, s1, items))
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
  /** For a rate: the first and last points it was measured between (the start point, if set, first). */
  span?: { from: Point; to: Point }
}

/** The date a start point stands on, given the latest record's date. */
export function rateStartDate(from: RateStart, latest: ISODate): ISODate {
  if ('date' in from) return from.date
  const mi = monthIndex(latest)
  const here = clampedDate(mi, from.day)
  return here <= latest ? here : clampedDate(mi - 1, from.day)
}

/** What a recurring projection adds each time it occurs. */
export function evaluateRecurring(item: LegacyRecurring, records: BalanceRecord[], proj: { items: LegacyItem[]; start: StartLines }): ItemResult {
  const v = item.value
  if (v.mode === 'fixed') return { value: v.amount, used: v.amount, count: 0, days: 0 }

  let points = recordsInWindow(records, v.window)
    .map((r) => ({ date: r.date, v: sourceValue(r, v.source, proj.start) }))
    .filter((p): p is { date: ISODate; v: number } => p.v != null)
  if (!points.length) {
    const reason = v.source === LEFT_SOURCE ? 'No records in this window.' : `No records in this window have a line called “${v.source}”.`
    return { count: 0, days: 0, value: null, used: 0, reason }
  }
  // A start point stands in for everything before it: records on or before its date are dropped.
  const from = v.mode === 'rate' && v.from ? v.from : null
  if (from) {
    const d = rateStartDate(from, points[points.length - 1].date)
    points = [{ date: d, v: toCents(from.amount) }, ...points.filter((p) => p.date > d)]
  }
  const count = points.length - (from ? 1 : 0)
  const days = dayNum(points[points.length - 1].date) - dayNum(points[0].date)
  const base = { count, days }
  if (v.mode === 'average') {
    const avg = fromCents(points.reduce((s, p) => s + p.v, 0) / points.length)
    return { ...base, value: avg, used: avg }
  }
  if (from && count === 0) {
    return { ...base, value: null, used: 0, reason: 'No records after the start point yet.' }
  }
  // Without a start point, a short span gives a wild trend; with one, the user vouched for it.
  if (!from && (points.length < 2 || days < MIN_RATE_DAYS)) {
    return { ...base, value: null, used: 0, reason: `Needs records spanning ${Math.ceil(MIN_RATE_DAYS / 7)}+ weeks (this window has ${days} day${days === 1 ? '' : 's'}), or a start point.` }
  }
  let change = 0
  const others = proj.items.filter((i) => i.id !== item.id)
  for (let i = 1; i < points.length; i++) {
    change += points[i].v - points[i - 1].v
    if (v.source === LEFT_SOURCE) change -= scheduledCents(points[i - 1].date, points[i].date, others)
  }
  const perDayCents = change / days
  const each = fromCents(perDayCents * periodDays(item.every))
  const first = points[0]
  const last = points[points.length - 1]
  const span = { from: { date: first.date, value: fromCents(first.v) }, to: { date: last.date, value: fromCents(last.v) } }
  return { ...base, value: each, used: each, perDay: fromCents(perDayCents), span }
}

/** Everyday spending: the rate of change of net equity, added every day. */
export function everydayItem(): LegacyRecurring {
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

/**
 * Turn old projections into plain amounts. A fixed amount keeps its amount; one
 * worked out from records gets the value it had with these records (0 if it
 * couldn't be worked out). Target lines and "in my records" are dropped.
 */
export function freezeItems(items: LegacyItem[], records: BalanceRecord[], start: StartLines): { items: ProjectionItem[]; frozen: { id: string; name: string; amount: number }[] } {
  const sorted = [...records].sort(byAt)
  const frozen: { id: string; name: string; amount: number }[] = []
  const out = items.map((it): ProjectionItem => {
    if (it.kind === 'oneTime') return { kind: 'oneTime', id: it.id, name: it.name, amount: it.amount, date: it.date }
    let amount: number
    if (it.value.mode === 'fixed') amount = it.value.amount
    else {
      amount = evaluateRecurring(it, sorted, { items, start }).used
      frozen.push({ id: it.id, name: it.name, amount })
    }
    return { kind: 'recurring', id: it.id, name: it.name, amount, every: it.every, start: it.start }
  })
  return { items: out, frozen }
}

