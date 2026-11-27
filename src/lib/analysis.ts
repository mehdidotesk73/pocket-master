// History analysis for the Past tab: pure functions over saved records.
// No Vue, no storage: unit-tested in analysis.test.ts.
//
//   lineSeries     each record line's value at every record (for "Timeseries")
//   windowMix      each line's average value over a window (for "Averages")
//   dailyCandles   a line's value as one candle per day (records' jumps + the even rate between them)
//
// A line missing from a record counts as $0 there: records keep their own rows,
// and a row you removed is a balance you no longer hold.

import { type BalanceRecord, LEFT_SOURCE, type RecordWindow, byAt, lineNames, recordsInWindow } from './finance'
import { type ISODate, atNum, fromCents, fromDayNum, toCents } from './money'

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

export interface DayCandle {
  date: ISODate
  /** The line's value at the start and end of the day (dollars). */
  open: number
  close: number
  high: number
  low: number
  /** Records taken that day, in order (time and value). */
  records: { at: string; value: number }[]
  /** The record-to-record stretch the day sits in (for days with no record). */
  between?: { from: ISODate; to: ISODate; perDay: number }
}

/**
 * One candle per day for a line (or net equity, LEFT_SOURCE), from the first
 * record's day to the last's. Between records the value is taken to change at
 * an even rate, so a day with no record moves by that average rate; a day with
 * records also shows the record-to-record jumps (high/low include them).
 */
export function dailyCandles(records: BalanceRecord[], name: string): DayCandle[] {
  const sorted = [...records].sort(byAt)
  if (sorted.length < 2) return []
  const pts = sorted.map((r) => ({ x: atNum(r.at), v: valueCents(r, name), at: r.at, date: r.date }))
  const at = (x: number): number => {
    if (x <= pts[0].x) return pts[0].v
    const last = pts[pts.length - 1]
    if (x >= last.x) return last.v
    let i = 0
    while (pts[i + 1].x < x) i++
    const a = pts[i]
    const b = pts[i + 1]
    return b.x === a.x ? b.v : a.v + ((b.v - a.v) * (x - a.x)) / (b.x - a.x)
  }
  const first = Math.floor(pts[0].x)
  const lastDay = Math.floor(pts[pts.length - 1].x)
  const out: DayCandle[] = []
  for (let d = first; d <= lastDay; d++) {
    const from = Math.max(d, pts[0].x)
    const to = Math.min(d + 1, pts[pts.length - 1].x)
    const inside = pts.filter((p) => p.x >= d && p.x < d + 1)
    const vals = [at(from), at(to), ...inside.map((p) => p.v)]
    const candle: DayCandle = {
      date: fromDayNum(d),
      open: fromCents(at(from)),
      close: fromCents(at(to)),
      high: fromCents(Math.max(...vals)),
      low: fromCents(Math.min(...vals)),
      records: inside.map((p) => ({ at: p.at, value: fromCents(p.v) })),
    }
    if (!inside.length) {
      // the stretch between the records on either side of this day
      const j = pts.findIndex((p) => p.x > d)
      const a = pts[j - 1]
      const b = pts[j]
      candle.between = { from: a.date, to: b.date, perDay: fromCents((b.v - a.v) / (b.x - a.x)) }
    }
    out.push(candle)
  }
  return out
}
