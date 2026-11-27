import { describe, expect, it } from 'vitest'
import {
  type Averaged,
  type BalanceRecord,
  type ProjectionFile,
  type ProjectionItem,
  type Recurring,
  type RecordLine,
  LEFT_SOURCE,
  evaluateAveraged,
  evaluateExtrapolate,
  lineNames,
  makeRecord,
  project,
  recordsInRange,
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
  schema: 2,
  id: 'p',
  name: 'P',
  start: { mode: 'all' },
  horizonDays: 60,
  items: [],
  ...p,
})
const avg = (a: Partial<Averaged>): Averaged => ({
  kind: 'averaged',
  id: 'a',
  name: 'a',
  source: LEFT_SOURCE,
  mode: 'rate',
  range: { mode: 'all' },
  day: 1,
  ...a,
})
const recur = (r: Partial<Recurring>): Recurring => ({ kind: 'recurring', id: 'r', name: 'r', amount: 0, day: 1, inRecord: false, ...r })
const at = (p: ReturnType<typeof project>, d: string) => p!.series.find((x) => x.date === d)!.value
const TODAY = '2026-11-26'

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
    expect(list[2].date).toBe('2026-11-02')
  })

  it('the latest record by time is where a projection starts', () => {
    const p = project(proj({ horizonDays: 1 }), [rec('2026-11-26T20:00:00', 500), rec('2026-11-26T08:00:00', 100)], TODAY)
    expect(p!.start.value).toBe(500)
  })

  it('records on the same day count as zero days apart in rates', () => {
    const recs = [rec('2026-01-01T09:00:00', 1000), rec('2026-01-01T21:00:00', 900), rec('2026-01-31T12:00:00', 700)]
    expect(evaluateAveraged(avg({}), recs, proj()).value).toBeCloseTo((-300 / 30) * 30.44, 2)
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
    expect(addDays('2026-03-07', 1)).toBe('2026-03-08')
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })
})

describe('scheduled()', () => {
  const rent = recur({ id: 'rent', amount: -2000, day: 1, inRecord: true })
  const pay = recur({ id: 'pay', amount: 1500, day: 15 })

  it('counts an inRecord item once, at the new month, across a boundary', () => {
    expect(scheduled('2026-10-20', '2026-11-05', [rent], [])).toBe(-2000)
    expect(scheduled('2026-10-20', '2026-11-20', [rent], [])).toBe(-2000)
    expect(scheduled('2026-11-02', '2026-11-28', [rent], [])).toBe(0)
  })

  it('counts a normal item only when its day falls in (s0, s1]', () => {
    expect(scheduled('2026-11-01', '2026-11-14', [pay], [])).toBe(0)
    expect(scheduled('2026-11-01', '2026-11-15', [pay], [])).toBe(1500)
    expect(scheduled('2026-11-14', '2027-01-15', [pay], [])).toBe(4500)
  })

  it('includes signed one-time items in the window', () => {
    const o = [{ kind: 'oneTime' as const, id: 'o', name: 'o', amount: -99.99, date: '2026-11-10' }]
    expect(scheduled('2026-11-09', '2026-11-10', [], o)).toBe(-99.99)
    expect(scheduled('2026-11-10', '2026-11-11', [], o)).toBe(0)
  })
})

describe('start lines', () => {
  const r = rec('2026-11-26', 6988.12, [line('Checking', 7718.6), line('Amex', -730.48), line('Rent', -2000)])
  it('all lines = left so far; a selection sums just those lines', () => {
    expect(startValueCents(r, { mode: 'all' })).toBe(698812)
    expect(startValueCents(r, { mode: 'lines', names: ['checking', 'Amex'] })).toBe(698812)
    expect(startValueCents(r, { mode: 'lines', names: ['Checking'] })).toBe(771860)
    expect(startValueCents(r, { mode: 'lines', names: ['Gone'] })).toBe(0)
  })
})

describe('record ranges', () => {
  const recs = [rec('2026-01-01', 1), rec('2026-03-01', 2), rec('2026-05-01', 3), rec('2026-06-01', 4)]
  it('all, last N days (back from the latest record), and between dates', () => {
    expect(recordsInRange(recs, { mode: 'all' }).length).toBe(4)
    expect(recordsInRange(recs, { mode: 'last', days: 31 }).map((r) => r.date)).toEqual(['2026-05-01', '2026-06-01'])
    expect(recordsInRange(recs, { mode: 'between', from: '2026-02-01', to: '2026-05-01' }).map((r) => r.date)).toEqual(['2026-03-01', '2026-05-01'])
    expect(recordsInRange(recs, { mode: 'between', from: '2026-04-01' }).length).toBe(2)
  })
})

describe('averaged items', () => {
  it('rate of the starting total removes this projection’s scheduled items (everyday spending)', () => {
    const pay = recur({ id: 'pay', amount: 1000, day: 15 })
    const r = evaluateAveraged(avg({}), [rec('2026-01-01', 1000), rec('2026-01-31', 1700)], proj({ items: [pay] }))
    expect(r.value).toBeCloseTo(-304.4, 2)
    expect(r.days).toBe(30)
  })

  it('rate of the starting total follows the projection’s selected lines', () => {
    const recs = [rec('2026-01-01', 0, [line('Checking', 1000), line('Amex', -100)]), rec('2026-01-31', 0, [line('Checking', 700), line('Amex', -900)])]
    const r = evaluateAveraged(avg({}), recs, proj({ start: { mode: 'lines', names: ['Checking'] } }))
    expect(r.value).toBeCloseTo((-300 / 30) * 30.44, 2)
  })

  it('rate needs records spanning 28+ days', () => {
    const r = evaluateAveraged(avg({}), [rec('2026-11-01', 1000), rec('2026-11-28', 700)], proj())
    expect(r.value).toBeNull()
    expect(r.used).toBe(0)
    expect(r.reason).toMatch(/27 days/)
  })

  it('rate of a named line uses only that line, case-insensitively, within the range', () => {
    const records = [
      rec('2026-01-01', 0, [line('Amex', -100)]),
      rec('2026-02-01', 0, [line('Amex', -400)]),
      rec('2026-03-01', 0, [line('Checking', 5)]),
      rec('2026-04-01', 0, [line('AMEX', -5000)]),
    ]
    const r = evaluateAveraged(avg({ source: 'amex', range: { mode: 'between', from: '2026-01-01', to: '2026-03-15' } }), records, proj())
    expect(r.count).toBe(2)
    expect(r.value).toBeCloseTo((-300 / 31) * 30.44, 2)
  })

  it('amount mode averages a line’s value over the range', () => {
    const records = [rec('2026-01-05', 0, [line('Phone', -1900)]), rec('2026-02-05', 0, [line('Phone', -2000)]), rec('2026-03-05', 0, [line('Phone', -2100.01)])]
    expect(evaluateAveraged(avg({ source: 'Phone', mode: 'amount' }), records, proj()).value).toBe(-2000)
    expect(evaluateAveraged(avg({ source: 'Phone', mode: 'amount', range: { mode: 'last', days: 0 } }), records, proj()).value).toBe(-2100.01)
  })

  it('reports a missing line by name', () => {
    expect(evaluateAveraged(avg({ source: 'Nope' }), [rec('2026-01-01', 1)], proj()).reason).toMatch(/Nope/)
  })
})

describe('extrapolate to month end', () => {
  const x = { kind: 'extrapolate' as const, id: 'x', name: 'Amex to month end', source: 'Amex' }
  const r = rec('2026-11-10', 0, [line('Amex', -300)])

  it('scales the value by month length ÷ day of the record, in the current month', () => {
    const res = evaluateExtrapolate(x, r, { mode: 'all' }, '2026-11-26')
    expect(res.value).toBe(-600) // −300 × 30/10 = −900 → 600 more to go
    expect(res.outdated).toBeFalsy()
  })

  it('a record from an earlier month is used as is and marked outdated', () => {
    const res = evaluateExtrapolate(x, r, { mode: 'all' }, '2026-12-02')
    expect(res.value).toBe(0)
    expect(res.outdated).toBe(true)
  })

  it('spreads the extra over the rest of the month in the projection, then stops', () => {
    const p = project(proj({ start: { mode: 'lines', names: ['Amex'] }, items: [x], horizonDays: 40 }), [r], '2026-11-26')
    expect(p!.start.value).toBe(-300)
    expect(at(p, '2026-11-20')).toBe(-600) // 10 of 20 days
    expect(at(p, '2026-11-30')).toBe(-900)
    expect(at(p, '2026-12-15')).toBe(-900)
  })
})

describe('projection', () => {
  const rent = recur({ id: 'rent', amount: -2000, day: 1, inRecord: true })
  const one = (p: Partial<ProjectionFile>, items: ProjectionItem[], latest: { date: string; left: number }) =>
    project(proj({ ...p, items }), [rec(latest.date, latest.left)], TODAY)

  it('skips an inRecord item in the latest record’s month and applies it later', () => {
    const late = recur({ id: 'x', amount: -50, day: 28, inRecord: true })
    const p = one({}, [rent, late], { date: '2026-11-10', left: 5000 })
    expect(at(p, '2026-11-28')).toBe(5000)
    expect(at(p, '2026-12-01')).toBe(3000)
    expect(at(p, '2026-12-28')).toBe(2950)
  })

  it('keeps the right months across a year boundary (Dec → Jan)', () => {
    const pay = recur({ id: 'p', amount: 1000, day: 15 })
    const p = one({}, [pay, rent], { date: '2026-12-20', left: 0 })
    expect(p!.series[0].date).toBe('2026-12-21')
    expect(at(p, '2027-01-01')).toBe(-2000)
    expect(at(p, '2027-01-15')).toBe(-1000)
    expect(p!.min).toEqual({ date: '2027-02-01', value: -3000 })
  })

  it('a day-31 item lands on Apr 30', () => {
    const p = one({ horizonDays: 40 }, [recur({ amount: -100, day: 31 })], { date: '2026-04-01', left: 1000 })
    expect(at(p, '2026-04-29')).toBe(1000)
    expect(at(p, '2026-04-30')).toBe(900)
  })

  it('applies one-time items on their date and a rate item as a daily drift', () => {
    const records = [rec('2025-12-01', 1304.4), rec('2026-01-01', 1000)] // −304.40 over 31 days
    const p = project(
      proj({ horizonDays: 10, items: [{ kind: 'oneTime', id: 'o', name: 'o', amount: 200, date: '2026-01-05' }, avg({ id: 'e' })] }),
      records,
      TODAY,
    )
    const daily = ((-304.4 / 31) * 30.44) / 30.44
    expect(at(p, '2026-01-04')).toBeCloseTo(1000 + 3 * daily, 1)
    expect(at(p, '2026-01-05')).toBeCloseTo(1200 + 4 * daily, 1)
    expect(p!.results.e.used).toBeCloseTo((-304.4 / 31) * 30.44, 2)
  })

  it('applies an amount item once a month on its day', () => {
    const records = [rec('2026-01-10', 0, [line('Phone', -75)])]
    const p = project(proj({ horizonDays: 45, start: { mode: 'lines', names: [] }, items: [avg({ source: 'Phone', mode: 'amount', day: 20 })] }), records, TODAY)
    expect(at(p, '2026-01-19')).toBe(0)
    expect(at(p, '2026-01-20')).toBe(-75)
    expect(at(p, '2026-02-20')).toBe(-150)
  })

  it('starts from the selected lines only, and runs for the projection’s horizon', () => {
    const r = rec('2026-11-26', 0, [line('Checking', 4000), line('Amex', -500)])
    const p = project(proj({ start: { mode: 'lines', names: ['Checking'] }, horizonDays: 7, items: [recur({ amount: -100, day: 28 })] }), [r], TODAY)
    expect(p!.start.value).toBe(4000)
    expect(p!.series.length).toBe(7)
    expect(p!.end.value).toBe(3900)
  })

  it('no records → no projection', () => {
    expect(project(proj(), [], TODAY)).toBeNull()
  })
})

describe('forecast contributions', () => {
  it('tracks each projection’s cumulative share, adding up to the total', () => {
    const pay = recur({ id: 'pay', amount: 1000, day: 5 })
    const trip = { kind: 'oneTime' as const, id: 'trip', name: 'Trip', amount: -300, date: '2026-12-03' }
    const p = project(proj({ horizonDays: 10, items: [pay, trip] }), [rec('2026-11-28', 50)], TODAY)!
    const i = p.series.findIndex((x) => x.date === '2026-12-05')
    expect(p.contributions.pay[i]).toBe(1000)
    expect(p.contributions.trip[i]).toBe(-300)
    expect(p.contributions.pay[i - 1]).toBe(0)
    p.series.forEach((pt, k) => expect(pt.value).toBeCloseTo(50 + p.contributions.pay[k] + p.contributions.trip[k], 6))
  })
})
