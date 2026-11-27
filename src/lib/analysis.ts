// History analysis for the Past tab: pure functions over saved records.
// No Vue, no storage: unit-tested in analysis.test.ts.
//
//   lineSeries     each record line's value at every record (for "Timeseries")
//   windowMix      each line's average value over a window (for "Averages")
//   dailyCandles   a line's value as one candle per day, by date (record days + the even rate between them)
//
// A line missing from a record counts as $0 there: records keep their own rows,
// and a row you removed is a balance you no longer hold.

import { type BalanceRecord, LEFT_SOURCE, type RecordWindow, byAt, lineNames, recordsInWindow } from './finance'
import { type ISODate, atNum, dayNum, fromCents, fromDayNum, toCents } from './money'

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
 * record's day to the last's, by date (time of day only orders records within
 * a day):
 * - a day with records closes at its last record; its candle runs from the
 *   previous day's close to that, with the day's records as the wick
 * - between two record days the value moves evenly, from the earlier day's
 *   last record to the later day's first record, so each day in between is a
 *   small candle of that average daily change
 * The daily changes add up to the whole change from first record to last.
 */
export function dailyCandles(records: BalanceRecord[], name: string): DayCandle[] {
  const sorted = [...records].sort(byAt)
  if (sorted.length < 2) return []
  // records grouped by date, in order
  const days: { d: number; date: ISODate; recs: { at: string; v: number }[] }[] = []
  for (const r of sorted) {
    const d = dayNum(r.date)
    const v = valueCents(r, name)
    const last = days[days.length - 1]
    if (last && last.d === d) last.recs.push({ at: r.at, v })
    else days.push({ d, date: r.date, recs: [{ at: r.at, v }] })
  }
  if (days.length < 2 && days[0].recs.length < 2) return []
  const out: DayCandle[] = []
  let prevClose = days[0].recs[0].v
  for (let k = 0; k < days.length; k++) {
    const day = days[k]
    if (k > 0) {
      // the stretch from the previous record day's last record to this day's first
      const a = days[k - 1]
      const from = a.recs[a.recs.length - 1].v
      const to = day.recs[0].v
      const span = day.d - a.d
      const perDay = fromCents((to - from) / span)
      for (let d = a.d + 1; d < day.d; d++) {
        const close = from + ((to - from) * (d - a.d)) / span
        out.push({
          date: fromDayNum(d),
          open: fromCents(prevClose),
          close: fromCents(close),
          high: fromCents(Math.max(prevClose, close)),
          low: fromCents(Math.min(prevClose, close)),
          records: [],
          between: { from: a.date, to: day.date, perDay },
        })
        prevClose = close
      }
    }
    const vals = [prevClose, ...day.recs.map((r) => r.v)]
    const close = day.recs[day.recs.length - 1].v
    out.push({
      date: day.date,
      open: fromCents(prevClose),
      close: fromCents(close),
      high: fromCents(Math.max(...vals)),
      low: fromCents(Math.min(...vals)),
      records: day.recs.map((r) => ({ at: r.at, value: fromCents(r.v) })),
    })
    prevClose = close
  }
  return out
}
