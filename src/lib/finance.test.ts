import { describe, expect, it } from 'vitest'
import {
  type BalanceRecord,
  type OneTime,
  type ProjectionFile,
  type Recurring,
  type RecordLine,
  defaultProjection,
  lineNames,
  makeRecord,
  monthlyStart,
  occurrences,
  occursOn,
  periodDays,
  project,
  recordsInWindow,
  sheet,
  startValueCents,
  upsertRecord,
} from './finance'
import { addDays, clampedDate, monthIndex } from './money'

const rec = (date: string, left: number, lines: RecordLine[] = []): BalanceRecord => ({
  schema: 3,
  at: date.length > 10 ? date : `${date}T12:00:00`,
  date: date.slice(0, 10),
  savedAt: '',
  lines,
  assets: left,
  liabilities: 0,
  left,
})
const line = (name: string, amount: number): RecordLine => ({ id: name, name, amount })
const proj = (p: Partial<ProjectionFile> = {}): ProjectionFile => ({
  schema: 4,
  id: 'p',
  name: 'P',
  start: { mode: 'all' },
  horizonDays: 60,
  items: [],
  ...p,
})
/** A monthly amount on `day`. */
const monthly = (amount: number, day: number, extra: Partial<Recurring> = {}): Recurring => ({
  kind: 'recurring',
  id: `m${day}${amount}`,
  name: 'm',
  amount,
  every: { n: 1, unit: 'month' },
  start: monthlyStart(day),
  ...extra,
})
const daily = (amount: number, start: string): Recurring => ({ kind: 'recurring', id: `d${amount}`, name: 'd', amount, every: { n: 1, unit: 'day' }, start })
const once = (amount: number, date: string): OneTime => ({ kind: 'oneTime', id: `o${date}`, name: 'o', amount, date })
const at = (p: ReturnType<typeof project>, d: string) => p!.series.find((x) => x.date === d)!.value

describe('records', () => {
  it('the spreadsheet example gives 3,434.45', () => {
    const s = sheet([
      line('Checking', 7718.6),
      line('Rent', 0),
      line('Phone and insurance', -2030),
      line('Discover', -65.26),
      line('Capital One', -1408.41),
      line('Amex', -730.48),
      line('Macy’s', 0),
      line('Paying', -50),
      line('Receiving', 0),
    ])
    expect(s).toEqual({ assets: 7718.6, liabilities: 4284.15, left: 3434.45 })
  })

  it('sorts positive lines into assets and negative into liabilities, in cents', () => {
    expect(sheet([{ amount: 100 }, { amount: -30.5 }, { amount: 0 }, { amount: 0.1 }, { amount: 0.2 }])).toEqual({
      assets: 100.3,
      liabilities: 30.5,
      left: 69.8,
    })
  })

  it('keeps several records on one day, in time order; the same moment replaces', () => {
    let list: BalanceRecord[] = []
    list = upsertRecord(list, makeRecord('2026-11-02T18:30:00', [line('a', 5)]))
    list = upsertRecord(list, makeRecord('2026-11-02T08:05:10', [line('a', 1)]))
    list = upsertRecord(list, makeRecord('2026-11-01', [line('a', 0)]))
    expect(list.map((r) => r.at)).toEqual(['2026-11-01T12:00:00', '2026-11-02T08:05:10', '2026-11-02T18:30:00'])
    list = upsertRecord(list, makeRecord('2026-11-02T18:30:00', [line('a', 9)]))
    expect(list.length).toBe(3)
    expect(list[2].left).toBe(9)
  })

  it('lists line names across records, newest spelling first, without duplicates', () => {
    const names = lineNames([rec('2026-01-01', 0, [line('amex', -1), line('Old', 1)]), rec('2026-02-01', 0, [line('Amex ', -2)])])
    expect(names).toEqual(['Amex', 'Old'])
  })
})

describe('dates', () => {
  it('day 31 lands on the last day of a 30-day month and of February', () => {
    expect(clampedDate(monthIndex('2026-04-01'), 31)).toBe('2026-04-30')
    expect(clampedDate(monthIndex('2026-02-01'), 31)).toBe('2026-02-28')
    expect(clampedDate(monthIndex('2028-02-01'), 31)).toBe('2028-02-29')
  })

  it('addDays crosses DST and year boundaries cleanly', () => {
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })
})

describe('schedules', () => {
  const every = (n: number, unit: Recurring['every']['unit'], start: string) => ({ every: { n, unit }, start })

  it('every N days / weeks from the start date', () => {
    expect(occurrences(every(3, 'day', '2026-11-01'), '2026-10-25', '2026-11-10')).toEqual(['2026-11-01', '2026-11-04', '2026-11-07', '2026-11-10'])
    expect(occurrences(every(2, 'week', '2026-11-02'), '2026-11-01', '2026-12-01')).toEqual(['2026-11-02', '2026-11-16', '2026-11-30'])
  })

  it('every N months on the start day, clamped to month end', () => {
    expect(occurrences(every(1, 'month', '2026-01-31'), '2026-01-31', '2026-05-01')).toEqual(['2026-02-28', '2026-03-31', '2026-04-30'])
    expect(occurrences(every(3, 'month', '2026-01-15'), '2026-01-01', '2026-12-31')).toEqual(['2026-01-15', '2026-04-15', '2026-07-15', '2026-10-15'])
  })

  it('every N years on the start month and day', () => {
    expect(occurrences(every(1, 'year', '2024-02-29'), '2024-03-01', '2027-03-01')).toEqual(['2025-02-28', '2026-02-28', '2027-02-28'])
    expect(occursOn(every(2, 'year', '2026-04-15'), '2027-04-15')).toBe(false)
    expect(occursOn(every(2, 'year', '2026-04-15'), '2028-04-15')).toBe(true)
  })

  it('nothing before the start date', () => {
    expect(occursOn(every(1, 'day', '2026-12-01'), '2026-11-30')).toBe(false)
  })

  it('period lengths', () => {
    expect(periodDays({ n: 1, unit: 'day' })).toBe(1)
    expect(periodDays({ n: 2, unit: 'week' })).toBe(14)
    expect(periodDays({ n: 1, unit: 'month' })).toBe(30.44)
  })
})

describe('record windows', () => {
  const recs = [rec('2026-01-01', 1), rec('2026-03-01', 2), rec('2026-05-01', 3), rec('2026-06-01', 4)]
  it('all, past N days, past N records, between dates', () => {
    expect(recordsInWindow(recs, { mode: 'all' }).length).toBe(4)
    expect(recordsInWindow(recs, { mode: 'last', days: 31 }).map((r) => r.date)).toEqual(['2026-05-01', '2026-06-01'])
    expect(recordsInWindow(recs, { mode: 'lastRecords', count: 3 }).map((r) => r.date)).toEqual(['2026-03-01', '2026-05-01', '2026-06-01'])
    expect(recordsInWindow(recs, { mode: 'between', from: '2026-02-01', to: '2026-05-01' }).map((r) => r.date)).toEqual(['2026-03-01', '2026-05-01'])
  })
})

describe('starting total', () => {
  it('follows the forecast’s selected lines', () => {
    const r = rec('2026-11-26', 6988.12, [line('Checking', 7718.6), line('Amex', -730.48)])
    expect(startValueCents(r, { mode: 'all' })).toBe(698812)
    expect(startValueCents(r, { mode: 'lines', names: ['checking'] })).toBe(771860)
  })
})

describe('forecast (plain amounts)', () => {
  it('monthly amounts land on their day, across a year boundary', () => {
    const p = project(proj({ items: [monthly(1000, 15), monthly(-2000, 1)] }), [rec('2026-12-20', 0)])
    expect(at(p, '2027-01-01')).toBe(-2000)
    expect(at(p, '2027-01-15')).toBe(-1000)
    expect(p.min).toEqual({ date: '2027-02-01', value: -3000 })
  })

  it('a daily amount moves every day; one-time amounts land on their date', () => {
    const p = project(proj({ horizonDays: 10, items: [daily(-10, '2026-01-01'), once(200, '2026-01-05')] }), [rec('2026-01-01', 1000)])
    expect(at(p, '2026-01-04')).toBe(970)
    expect(at(p, '2026-01-05')).toBe(1160)
  })

  it('every 2 weeks from a start date', () => {
    const bi = { ...monthly(500, 1), every: { n: 2, unit: 'week' as const }, start: '2026-12-04' }
    const p = project(proj({ horizonDays: 30, items: [bi] }), [rec('2026-12-01', 0)])
    expect(at(p, '2026-12-03')).toBe(0)
    expect(at(p, '2026-12-04')).toBe(500)
    expect(at(p, '2026-12-18')).toBe(1000)
    expect(at(p, '2026-12-31')).toBe(1000)
  })

  it('tracks each projection’s cumulative share, adding up to the total', () => {
    const pay = monthly(1000, 5)
    const trip = once(-300, '2026-12-03')
    const p = project(proj({ horizonDays: 10, items: [pay, trip] }), [rec('2026-11-28', 50)])
    const i = p.series.findIndex((x) => x.date === '2026-12-05')
    expect(p.contributions[pay.id][i]).toBe(1000)
    expect(p.contributions[trip.id][i]).toBe(-300)
    p.series.forEach((pt, k) => expect(pt.value).toBeCloseTo(50 + p.contributions[pay.id][k] + p.contributions[trip.id][k], 6))
  })

  it('the latest record by time is where a forecast starts', () => {
    const p = project(proj({ horizonDays: 1 }), [rec('2026-11-26T20:00:00', 500), rec('2026-11-26T08:00:00', 100)])
    expect(p.start.value).toBe(500)
  })

  it('with no records it starts at zero on the given day', () => {
    const items = [monthly(100, 26), { ...monthly(-50, 1), every: { n: 1, unit: 'week' as const }, start: '2026-11-26' }]
    const p = project(proj({ horizonDays: 31, items }), [], '2026-11-26')
    expect(p.start).toEqual({ date: '2026-11-26', value: 0 })
    expect(at(p, '2026-12-03')).toBe(-50)
    expect(at(p, '2026-12-26')).toBe(-100) // 4 weekly −50s, +100 on the 26th
  })

  it('a forecast from picked lines starts from just those', () => {
    const r = rec('2026-11-26', 0, [line('Checking', 4000), line('Amex', -500)])
    const p = project(proj({ start: { mode: 'lines', names: ['Checking'] }, horizonDays: 7, items: [monthly(-100, 28)] }), [r])
    expect(p.start.value).toBe(4000)
    expect(p.end.value).toBe(3900)
  })

  it('a new forecast is empty: nothing until you add amounts', () => {
    expect(defaultProjection().items).toEqual([])
    expect(defaultProjection().schema).toBe(4)
  })
})
