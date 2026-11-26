import { describe, expect, it } from 'vitest'
import {
  type Averaged,
  type BalanceRecord,
  type ProjectionFile,
  type Recurring,
  type RecordLine,
  LEFT_SOURCE,
  evaluateAveraged,
  lineNames,
  makeRecord,
  project,
  scheduled,
  sheet,
  upsertRecord,
} from './finance'
import { addDays, clampedDate, monthIndex } from './money'

const rec = (date: string, left: number, lines: RecordLine[] = []): BalanceRecord => ({
  schema: 2,
  date,
  savedAt: '',
  lines,
  assets: left,
  liabilities: 0,
  left,
})
const line = (name: string, amount: number): RecordLine => ({ id: name, name, amount })
const proj = (p: Partial<ProjectionFile> = {}): ProjectionFile => ({ schema: 1, recurring: [], oneTime: [], averaged: [], ...p })
const avg = (a: Partial<Averaged>): Averaged => ({ id: 'a', name: 'a', source: LEFT_SOURCE, mode: 'rate', day: 1, ...a })

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

  it('a same-date save replaces the record and doesn’t duplicate it', () => {
    let list: BalanceRecord[] = []
    list = upsertRecord(list, makeRecord('2026-11-02', [line('a', 5)]))
    list = upsertRecord(list, makeRecord('2026-11-01', [line('a', 1)]))
    list = upsertRecord(list, makeRecord('2026-11-02', [line('a', 9)]))
    expect(list.map((r) => r.date)).toEqual(['2026-11-01', '2026-11-02'])
    expect(list[1].left).toBe(9)
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
  const rent: Recurring = { id: 'rent', name: 'Rent', amount: -2000, day: 1, inRecord: true }
  const pay: Recurring = { id: 'pay', name: 'Pay', amount: 1500, day: 15, inRecord: false }

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
    const o = [{ id: 'o', name: 'o', amount: -99.99, date: '2026-11-10' }]
    expect(scheduled('2026-11-09', '2026-11-10', [], o)).toBe(-99.99)
    expect(scheduled('2026-11-10', '2026-11-11', [], o)).toBe(0)
  })
})

describe('averaged items', () => {
  it('rate of left so far removes scheduled items (everyday spending)', () => {
    const pay: Recurring = { id: 'pay', name: 'Pay', amount: 1000, day: 15, inRecord: false }
    // Gained 700 over 30 days, but 1000 pay was scheduled → −300 unexplained
    const r = evaluateAveraged(avg({}), [rec('2026-01-01', 1000), rec('2026-01-31', 1700)], proj({ recurring: [pay] }))
    expect(r.computed).toBeCloseTo(-304.4, 2)
    expect(r.days).toBe(30)
  })

  it('rate needs records spanning 28+ days', () => {
    const r = evaluateAveraged(avg({}), [rec('2026-11-01', 1000), rec('2026-11-28', 700)], proj())
    expect(r.computed).toBeNull()
    expect(r.used).toBe(0)
    expect(r.reason).toMatch(/27 days/)
  })

  it('rate of a named line uses only that line, matched case-insensitively, within the range', () => {
    const records = [
      rec('2026-01-01', 0, [line('Amex', -100)]),
      rec('2026-02-01', 0, [line('Amex', -400)]), // −300 over 31 days
      rec('2026-03-01', 0, [line('Checking', 5)]), // no Amex: skipped
      rec('2026-04-01', 0, [line('AMEX', -5000)]), // outside range
    ]
    const r = evaluateAveraged(avg({ source: 'amex', from: '2026-01-01', to: '2026-03-15' }), records, proj())
    expect(r.count).toBe(2)
    expect(r.computed).toBeCloseTo((-300 / 31) * 30.44, 2)
  })

  it('amount mode averages a line’s value over the range', () => {
    const records = [rec('2026-01-05', 0, [line('Phone', -1900)]), rec('2026-02-05', 0, [line('Phone', -2000)]), rec('2026-03-05', 0, [line('Phone', -2100.01)])]
    const r = evaluateAveraged(avg({ source: 'Phone', mode: 'amount' }), records, proj())
    expect(r.computed).toBe(-2000)
  })

  it('a manual figure overrides the computed one', () => {
    const r = evaluateAveraged(avg({ manual: -500 }), [rec('2026-11-01', 1000)], proj())
    expect(r.computed).toBeNull()
    expect(r.used).toBe(-500)
  })

  it('reports a missing line by name', () => {
    expect(evaluateAveraged(avg({ source: 'Nope' }), [rec('2026-01-01', 1)], proj()).reason).toMatch(/Nope/)
  })
})

describe('projection', () => {
  const rent: Recurring = { id: 'rent', name: 'Rent', amount: -2000, day: 1, inRecord: true }

  it('skips an inRecord item in the latest record’s month and applies it later', () => {
    const late: Recurring = { id: 'x', name: 'x', amount: -50, day: 28, inRecord: true }
    const p = project({ date: '2026-11-10', left: 5000 }, proj({ recurring: [rent, late] }), [], 60)
    expect(p.series.find((x) => x.date === '2026-11-28')!.value).toBe(5000)
    expect(p.series.find((x) => x.date === '2026-12-01')!.value).toBe(3000)
    expect(p.series.find((x) => x.date === '2026-12-28')!.value).toBe(2950)
  })

  it('keeps the right months across a year boundary (Dec → Jan)', () => {
    const pay: Recurring = { id: 'p', name: 'Pay', amount: 1000, day: 15, inRecord: false }
    const p = project({ date: '2026-12-20', left: 0 }, proj({ recurring: [pay, rent] }), [], 60)
    expect(p.series[0].date).toBe('2026-12-21')
    expect(p.series.find((x) => x.date === '2027-01-01')!.value).toBe(-2000)
    expect(p.series.find((x) => x.date === '2027-01-15')!.value).toBe(-1000)
    expect(p.min).toEqual({ date: '2027-02-01', value: -3000 })
  })

  it('a day-31 item lands on Apr 30', () => {
    const r: Recurring = { id: 'r', name: 'r', amount: -100, day: 31, inRecord: false }
    const p = project({ date: '2026-04-01', left: 1000 }, proj({ recurring: [r] }), [], 40)
    expect(p.series.find((x) => x.date === '2026-04-29')!.value).toBe(1000)
    expect(p.series.find((x) => x.date === '2026-04-30')!.value).toBe(900)
  })

  it('applies one-time items on their date and a rate item as a daily drift', () => {
    const p = project(
      { date: '2026-01-01', left: 1000 },
      proj({
        oneTime: [{ id: 'o', name: 'o', amount: 200, date: '2026-01-05' }],
        averaged: [avg({ id: 'e', manual: -304.4 })], // −10/day
      }),
      [],
      10,
    )
    expect(p.series[2]).toEqual({ date: '2026-01-04', value: 970 })
    expect(p.series[3]).toEqual({ date: '2026-01-05', value: 1160 })
    expect(p.end).toEqual({ date: '2026-01-11', value: 1100 })
    expect(p.averaged.e.used).toBe(-304.4)
  })

  it('applies an amount item once a month on its day', () => {
    const p = project(
      { date: '2026-01-10', left: 0 },
      proj({ averaged: [avg({ mode: 'amount', day: 20, manual: -75 })] }),
      [],
      45,
    )
    expect(p.series.find((x) => x.date === '2026-01-19')!.value).toBe(0)
    expect(p.series.find((x) => x.date === '2026-01-20')!.value).toBe(-75)
    expect(p.series.find((x) => x.date === '2026-02-20')!.value).toBe(-150)
  })
})
