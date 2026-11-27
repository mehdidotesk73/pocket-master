import { describe, expect, it } from 'vitest'
import {
  type BalanceRecord,
  type OneTime,
  type ProjectionFile,
  type Recurring,
  type RecordLine,
  LEFT_SOURCE,
  evaluateRecurring,
  everydayItem,
  lineNames,
  makeRecord,
  monthlyStart,
  occurrences,
  occursOn,
  periodDays,
  project,
  recordsInWindow,
  scheduled,
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
  schema: 3,
  id: 'p',
  name: 'P',
  start: { mode: 'all' },
  horizonDays: 60,
  items: [],
  ...p,
})
/** A fixed monthly amount on `day` (like the old "every month" items). */
const monthly = (amount: number, day: number, extra: Partial<Recurring> = {}): Recurring => ({
  kind: 'recurring',
  id: `m${day}${amount}`,
  name: 'm',
  value: { mode: 'fixed', amount },
  every: { n: 1, unit: 'month' },
  start: monthlyStart(day),
  inRecord: false,
  ...extra,
})
const fromRecords = (mode: 'average' | 'rate', source: string, extra: Partial<Recurring> = {}): Recurring => ({
  kind: 'recurring',
  id: 'r',
  name: 'r',
  value: { mode, source, window: { mode: 'all' } },
  every: { n: 1, unit: 'month' },
  start: monthlyStart(1),
  inRecord: false,
  ...extra,
})
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

describe('scheduled() (what fixed and one-time projections explain)', () => {
  const rent = monthly(-2000, 1, { inRecord: true })
  const pay = monthly(1500, 15)

  it('counts an inRecord item once, at the new month, across a boundary', () => {
    expect(scheduled('2026-10-20', '2026-11-05', [rent])).toBe(-2000)
    expect(scheduled('2026-10-20', '2026-11-20', [rent])).toBe(-2000)
    expect(scheduled('2026-11-02', '2026-11-28', [rent])).toBe(0)
  })

  it('counts a normal item only when it occurs in (s0, s1]', () => {
    expect(scheduled('2026-11-01', '2026-11-14', [pay])).toBe(0)
    expect(scheduled('2026-11-01', '2026-11-15', [pay])).toBe(1500)
    expect(scheduled('2026-11-14', '2027-01-15', [pay])).toBe(4500)
  })

  it('includes one-time items; ignores projections worked out from records', () => {
    expect(scheduled('2026-11-09', '2026-11-10', [once(-99.99, '2026-11-10'), fromRecords('average', 'X')])).toBe(-99.99)
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

describe('recurring values', () => {
  it('average of a line over the window', () => {
    const records = [rec('2026-01-05', 0, [line('Phone', -1900)]), rec('2026-02-05', 0, [line('Phone', -2000)]), rec('2026-03-05', 0, [line('Phone', -2100.01)])]
    expect(evaluateRecurring(fromRecords('average', 'phone'), records, proj()).value).toBe(-2000)
    const last2 = fromRecords('average', 'Phone', { value: { mode: 'average', source: 'Phone', window: { mode: 'lastRecords', count: 2 } } })
    expect(evaluateRecurring(last2, records, proj()).value).toBe(-2050) // (−2000 − 2100.01) ÷ 2 = −2050.005 → cents
  })

  it('rate of change × the time between occurrences', () => {
    const records = [rec('2026-01-01', 0, [line('Amex', -100)]), rec('2026-01-31', 0, [line('Amex', -400)])] // −10/day
    const monthlyRate = fromRecords('rate', 'Amex')
    const daily = fromRecords('rate', 'Amex', { every: { n: 1, unit: 'day' } })
    const weekly = fromRecords('rate', 'Amex', { every: { n: 2, unit: 'week' } })
    expect(evaluateRecurring(monthlyRate, records, proj()).value).toBeCloseTo(-304.4, 2)
    expect(evaluateRecurring(daily, records, proj()).value).toBe(-10)
    expect(evaluateRecurring(weekly, records, proj()).value).toBe(-140)
    expect(evaluateRecurring(daily, records, proj()).perDay).toBe(-10)
  })

  it('rate of the starting total takes out the forecast’s fixed and one-time projections (everyday spending)', () => {
    const pay = monthly(1000, 15)
    const ev = everydayItem()
    // Gained 700 over 30 days, but 1000 pay was scheduled → −300 unexplained → −10/day
    const r = evaluateRecurring(ev, [rec('2026-01-01', 1000), rec('2026-01-31', 1700)], proj({ items: [pay, ev] }))
    expect(r.value).toBe(-10)
  })

  it('rate needs records spanning 28+ days', () => {
    const r = evaluateRecurring(everydayItem(), [rec('2026-11-01', 1000), rec('2026-11-28', 700)], proj())
    expect(r.value).toBeNull()
    expect(r.used).toBe(0)
    expect(r.reason).toMatch(/27 days/)
  })

  it('reports a missing line by name', () => {
    expect(evaluateRecurring(fromRecords('average', 'Nope'), [rec('2026-01-01', 1)], proj()).reason).toMatch(/Nope/)
  })

  it('starting total follows the forecast’s selected lines', () => {
    const r = rec('2026-11-26', 6988.12, [line('Checking', 7718.6), line('Amex', -730.48)])
    expect(startValueCents(r, { mode: 'all' })).toBe(698812)
    expect(startValueCents(r, { mode: 'lines', names: ['checking'] })).toBe(771860)
  })
})

describe('forecast', () => {
  const rent = monthly(-2000, 1, { inRecord: true })

  it('skips an inRecord item in the latest record’s month and applies it later', () => {
    const p = project(proj({ items: [rent, monthly(-50, 28, { inRecord: true })] }), [rec('2026-11-10', 5000)])
    expect(at(p, '2026-11-28')).toBe(5000)
    expect(at(p, '2026-12-01')).toBe(3000)
    expect(at(p, '2026-12-28')).toBe(2950)
  })

  it('keeps the right months across a year boundary', () => {
    const p = project(proj({ items: [monthly(1000, 15), rent] }), [rec('2026-12-20', 0)])
    expect(at(p, '2027-01-01')).toBe(-2000)
    expect(at(p, '2027-01-15')).toBe(-1000)
    expect(p!.min).toEqual({ date: '2027-02-01', value: -3000 })
  })

  it('a daily rate (everyday spending) drifts every day; one-time items land on their date', () => {
    const records = [rec('2025-12-01', 1310), rec('2026-01-01', 1000)] // −310 over 31 days = −10/day
    const p = project(proj({ horizonDays: 10, items: [everydayItem(), once(200, '2026-01-05')] }), records)!
    expect(at(p, '2026-01-04')).toBe(970)
    expect(at(p, '2026-01-05')).toBe(1160)
    expect(p.results.everyday.value).toBe(-10)
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
    const p = project(proj({ horizonDays: 10, items: [pay, trip] }), [rec('2026-11-28', 50)])!
    const i = p.series.findIndex((x) => x.date === '2026-12-05')
    expect(p.contributions[pay.id][i]).toBe(1000)
    expect(p.contributions[trip.id][i]).toBe(-300)
    p.series.forEach((pt, k) => expect(pt.value).toBeCloseTo(50 + p.contributions[pay.id][k] + p.contributions[trip.id][k], 6))
  })

  it('the latest record by time is where a forecast starts; no records → none', () => {
    const p = project(proj({ horizonDays: 1 }), [rec('2026-11-26T20:00:00', 500), rec('2026-11-26T08:00:00', 100)])
    expect(p!.start.value).toBe(500)
    expect(project(proj(), [])).toBeNull()
  })

  it('a forecast from picked lines starts from just those', () => {
    const r = rec('2026-11-26', 0, [line('Checking', 4000), line('Amex', -500)])
    const p = project(proj({ start: { mode: 'lines', names: ['Checking'] }, horizonDays: 7, items: [monthly(-100, 28)] }), [r])
    expect(p!.start.value).toBe(4000)
    expect(p!.end.value).toBe(3900)
  })

  void LEFT_SOURCE
})
