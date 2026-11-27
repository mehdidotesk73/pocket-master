// History analysis for the Past tab: pure functions over saved records.
// No Vue, no storage: unit-tested in analysis.test.ts.
//
//   lineSeries     each record line's value at every record (for "Each line")
//   windowMix      each line's average value over a window (for the donut)
//   intervalRates  how fast a line (or net equity) changed between records, per day
//
// A line missing from a record counts as $0 there: records keep their own rows,
// and a row you removed is a balance you no longer hold.

import { type BalanceRecord, LEFT_SOURCE, type RecordWindow, byAt, lineNames, recordsInWindow } from './finance'
import { type ISODate, atNum, dayNum, fromCents, toCents } from './money'

const norm = (s: string) => s.trim().toLowerCase()

/** A line's value in a record (cents); several rows with the same name add up; missing = 0. */
function valueCents(r: BalanceRecord, name: string): number {
  if (name === LEFT_SOURCE) return toCents(r.left)
  const k = norm(name)
  return r.lines.filter((l) => norm(l.name) === k).reduce((s, l) => s + toCents(l.amount), 0)
}

export interface LineSeries {
  name: string
  points: { x: number; y: number }[]
}

/** Every line that appears in any record, valued at each record (oldest first). */
export function lineSeries(records: BalanceRecord[]): LineSeries[] {
  const sorted = [...records].sort(byAt)
  return lineNames(sorted).map((name) => ({
    name,
    points: sorted.map((r) => ({ x: atNum(r.at), y: fromCents(valueCents(r, name)) })),
  }))
}

export interface MixSlice {
  name: string
  /** Signed average over the window's records (dollars). */
  average: number
}

/** Each line's average value across the window's records; $0 averages are left out. */
export function windowMix(records: BalanceRecord[], w: RecordWindow): { slices: MixSlice[]; count: number; from?: ISODate; to?: ISODate } {
  const inWin = recordsInWindow(records, w)
  if (!inWin.length) return { slices: [], count: 0 }
  const slices = lineNames(inWin)
    .map((name) => ({ name, average: fromCents(inWin.reduce((s, r) => s + valueCents(r, name), 0) / inWin.length) }))
    .filter((s) => s.average !== 0)
  return { slices, count: inWin.length, from: inWin[0].date, to: inWin[inWin.length - 1].date }
}

export interface IntervalRate {
  from: ISODate
  to: ISODate
  days: number
  /** Value at each end (dollars). */
  start: number
  end: number
  /** Change per day across the interval (dollars). */
  perDay: number
}

/**
 * How fast a line (or net equity, LEFT_SOURCE) changed between consecutive
 * records, per day. Several records on one day count as that day's last one,
 * so a same-day before/after pair (paying a card) doesn't make a spike.
 */
export function intervalRates(records: BalanceRecord[], name: string): IntervalRate[] {
  const lastOfDay = new Map<ISODate, BalanceRecord>()
  for (const r of [...records].sort(byAt)) lastOfDay.set(r.date, r)
  const days = [...lastOfDay.values()]
  const out: IntervalRate[] = []
  for (let i = 1; i < days.length; i++) {
    const a = days[i - 1]
    const b = days[i]
    const n = dayNum(b.date) - dayNum(a.date)
    const va = valueCents(a, name)
    const vb = valueCents(b, name)
    out.push({ from: a.date, to: b.date, days: n, start: fromCents(va), end: fromCents(vb), perDay: fromCents((vb - va) / n) })
  }
  return out
}
