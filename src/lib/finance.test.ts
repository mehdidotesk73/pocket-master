import { describe, expect, it } from 'vitest'
import {
  type BalanceRecord,
  type Recurring,
  type RecordLine,
  autoEveryday,
  makeRecord,
  monthlyUsed,
  project,
  scheduled,
  sheet,
  upsertRecord,
} from './finance'
import { addDays, clampedDate, monthIndex } from './money'

const rec = (date: string, left: number): BalanceRecord => ({
  schema: 2,
  date,
  savedAt: '',
  lines: [],
  assets: left,
  liabilities: 0,
  left,
})

describe('4.1 record', () => {
  it('the spreadsheet example gives 3,434.45', () => {
    const l = (name: string, amount: number): RecordLine => ({ id: name, name, amount })
    const lines: RecordLine[] = [
      l('Checking', 7718.6),
      l('Rent', 0),
      l('Phone and insurance', -2030),
      l('Discover', -65.26),
      l('Capital One', -1408.41),
      l('Amex', -730.48),
      l('Macy’s', 0),
      l('Paying', -50),
      l('Receiving', 0),
    ]
    const s = sheet(lines)
    expect(s.left).toBe(3434.45)
    expect(s.assets).toBe(7718.6)
    expect(s.liabilities).toBe(4284.15)
  })

  it('sorts positive lines into assets and negative into liabilities', () => {
    expect(sheet([{ amount: 100 }, { amount: -30.5 }, { amount: 0 }, { amount: 0.1 }, { amount: 0.2 }])).toEqual({
      assets: 100.3,
      liabilities: 30.5,
      left: 69.8,
    })
  })
})

describe('recurring day clamping', () => {
  it('day 31 lands on the last day of a 30-day month and of February', () => {
    expect(clampedDate(monthIndex('2026-04-01'), 31)).toBe('2026-04-30')
    expect(clampedDate(monthIndex('2026-02-01'), 31)).toBe('2026-02-28')
    expect(clampedDate(monthIndex('2028-02-01'), 31)).toBe('2028-02-29')
  })

  it('a day-31 item is applied on Apr 30 in a projection', () => {
    const r: Recurring = { id: 'r', name: 'r', dir: 'out', amount: 100, day: 31, inRecord: false }
    const p = project({ date: '2026-04-01', left: 1000 }, { recurring: [r], oneTime: [] }, 0, 40)
    expect(p.series.find((x) => x.date === '2026-04-29')!.value).toBe(1000)
    expect(p.series.find((x) => x.date === '2026-04-30')!.value).toBe(900)
    expect(p.series.find((x) => x.date === '2026-05-10')!.value).toBe(900)
  })
})

describe('4.4 projection', () => {
  const rent: Recurring = { id: 'rent', name: 'Rent', dir: 'out', amount: 2000, day: 1, inRecord: true }
  const late: Recurring = { id: 'x', name: 'x', dir: 'out', amount: 50, day: 28, inRecord: true }

  it('skips an inRecord item in the latest record’s month and applies it in later months', () => {
    const p = project({ date: '2026-11-10', left: 5000 }, { recurring: [rent, late], oneTime: [] }, 0, 60)
    // Nov 28 is in the record's month → skipped
    expect(p.series.find((x) => x.date === '2026-11-28')!.value).toBe(5000)
    // Dec 1 rent applied, Dec 28 applied
    expect(p.series.find((x) => x.date === '2026-12-01')!.value).toBe(3000)
    expect(p.series.find((x) => x.date === '2026-12-28')!.value).toBe(2950)
    expect(p.series.find((x) => x.date === '2027-01-01')!.value).toBe(950)
  })

  it('keeps the right months across a year boundary (Dec → Jan)', () => {
    const pay: Recurring = { id: 'p', name: 'Pay', dir: 'in', amount: 1000, day: 15, inRecord: false }
    const p = project({ date: '2026-12-20', left: 0 }, { recurring: [pay, rent], oneTime: [] }, 0, 60)
    expect(p.series[0].date).toBe('2026-12-21')
    expect(p.series.find((x) => x.date === '2026-12-31')!.value).toBe(0)
    expect(p.series.find((x) => x.date === '2027-01-01')!.value).toBe(-2000)
    expect(p.series.find((x) => x.date === '2027-01-15')!.value).toBe(-1000)
    expect(p.series.find((x) => x.date === '2027-02-01')!.value).toBe(-3000)
    expect(p.series.find((x) => x.date === '2027-02-15')!.value).toBe(-2000)
    expect(p.min).toEqual({ date: '2027-02-01', value: -3000 })
  })

  it('applies one-time items on their date and everyday spending daily', () => {
    const p = project(
      { date: '2026-01-01', left: 1000 },
      { recurring: [], oneTime: [{ id: 'o', name: 'o', dir: 'in', amount: 200, date: '2026-01-05' }] },
      304.4, // 10/day
      10,
    )
    expect(p.series[0].date).toBe('2026-01-02')
    expect(p.series[2]).toEqual({ date: '2026-01-04', value: 970 }) // 3 days × 10
    expect(p.series[3]).toEqual({ date: '2026-01-05', value: 1160 }) // +200 −10
    expect(p.end).toEqual({ date: '2026-01-11', value: 1100 })
  })
})

describe('4.2 scheduled()', () => {
  const rent: Recurring = { id: 'rent', name: 'Rent', dir: 'out', amount: 2000, day: 1, inRecord: true }
  const pay: Recurring = { id: 'pay', name: 'Pay', dir: 'in', amount: 1500, day: 15, inRecord: false }

  it('counts an inRecord item once, at the new month, across a boundary', () => {
    expect(scheduled('2026-10-20', '2026-11-05', [rent], [])).toBe(-2000)
    // the 1st is not in a non-inRecord sense: even ending on Nov 20 it's still once
    expect(scheduled('2026-10-20', '2026-11-20', [rent], [])).toBe(-2000)
  })

  it('does not count an inRecord item within the same month', () => {
    expect(scheduled('2026-11-02', '2026-11-28', [rent], [])).toBe(0)
  })

  it('counts a normal item only when its day falls in (s0, s1]', () => {
    expect(scheduled('2026-11-01', '2026-11-14', [pay], [])).toBe(0)
    expect(scheduled('2026-11-01', '2026-11-15', [pay], [])).toBe(1500)
    expect(scheduled('2026-11-15', '2026-12-14', [pay], [])).toBe(0)
    expect(scheduled('2026-11-14', '2027-01-15', [pay], [])).toBe(4500)
  })

  it('includes one-time items in the window', () => {
    const o = [{ id: 'o', name: 'o', dir: 'out' as const, amount: 99.99, date: '2026-11-10' }]
    expect(scheduled('2026-11-09', '2026-11-10', [], o)).toBe(-99.99)
    expect(scheduled('2026-11-10', '2026-11-11', [], o)).toBe(0)
  })
})

describe('4.3 everyday spending (auto)', () => {
  it('returns null when records span less than 28 days', () => {
    const a = autoEveryday([rec('2026-11-01', 1000), rec('2026-11-28', 700)], [], [])
    expect(a.monthly).toBeNull()
    expect(a.days).toBe(27)
  })

  it('computes the unexplained drain per month once records span 28+ days', () => {
    // 30.44 days, lost 304.40 with nothing scheduled → 10/day → 304.40/month
    const recs = [rec('2026-01-01', 1000), rec('2026-01-15', 860), rec('2026-02-01', 695.6)]
    const a = autoEveryday(recs, [], [])
    expect(a.days).toBe(31)
    expect(a.monthly).toBeCloseTo((304.4 / 31) * 30.44, 2)
  })

  it('removes scheduled flows from the drain', () => {
    const pay: Recurring = { id: 'pay', name: 'Pay', dir: 'in', amount: 1000, day: 15, inRecord: false }
    // Gained 700 over 30 days, but 1000 pay was scheduled → 300 unexplained spending
    const a = autoEveryday([rec('2026-01-01', 1000), rec('2026-01-31', 1700)], [pay], [])
    expect(a.monthly).toBeCloseTo(304.4, 2)
  })

  it('uses manual (or the fallback) when asked or when auto is unavailable', () => {
    const auto = { monthly: 500, days: 40, count: 3 }
    expect(monthlyUsed({ everyday: { mode: 'auto', monthly: 200 } }, auto)).toBe(500)
    expect(monthlyUsed({ everyday: { mode: 'manual', monthly: 200 } }, auto)).toBe(200)
    expect(monthlyUsed({ everyday: { mode: 'auto', monthly: 200 } }, { monthly: null, days: 3, count: 2 })).toBe(200)
  })
})

describe('records', () => {
  it('a same-date save replaces the record and doesn’t duplicate it', () => {
    let list: BalanceRecord[] = []
    list = upsertRecord(list, makeRecord('2026-11-02', [{ id: 'a', name: 'a', amount: 5 }]))
    list = upsertRecord(list, makeRecord('2026-11-01', [{ id: 'a', name: 'a', amount: 1 }]))
    list = upsertRecord(list, makeRecord('2026-11-02', [{ id: 'a', name: 'a', amount: 9 }]))
    expect(list.map((r) => r.date)).toEqual(['2026-11-01', '2026-11-02'])
    expect(list[1].left).toBe(9)
  })

  it('addDays crosses DST and year boundaries cleanly', () => {
    expect(addDays('2026-03-07', 1)).toBe('2026-03-08')
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })
})
