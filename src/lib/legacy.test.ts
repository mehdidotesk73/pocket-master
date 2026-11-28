import { describe, expect, it } from 'vitest'
import { type BalanceRecord, type OneTime, type RecordLine, type StartLines, monthlyStart, startValueCents } from './finance'
import { type LegacyItem, type LegacyRecurring, type RateStart, everydayItem, evaluateRecurring, freezeItems, rateStartDate, scheduled } from './legacy'

// The old computed projections, kept only to convert old forecasts at the same values.

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
const proj = (p: { items?: LegacyItem[]; start?: StartLines } = {}) => ({ items: p.items ?? [], start: p.start ?? ({ mode: 'all' } as StartLines) })
const monthly = (amount: number, day: number, extra: Partial<LegacyRecurring> = {}): LegacyRecurring => ({
  kind: 'recurring',
  id: `m${day}${amount}`,
  name: 'm',
  value: { mode: 'fixed', amount },
  every: { n: 1, unit: 'month' },
  start: monthlyStart(day),
  inRecord: false,
  ...extra,
})
const fromRecords = (mode: 'average' | 'rate', source: string, extra: Partial<LegacyRecurring> = {}): LegacyRecurring => ({
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

describe('rate start point', () => {
  const card = (balance: number, date: string) => rec(date, 0, [line('Capital One', balance)])
  const pace = (from: RateStart, extra: Partial<LegacyRecurring> = {}) =>
    fromRecords('rate', 'Capital One', { every: { n: 1, unit: 'day' }, start: '2000-01-01', ...extra, value: { mode: 'rate', source: 'Capital One', window: { mode: 'all' }, from } })

  it('one record and "$0 on the 1st" give the cycle pace; the 28-day minimum doesn’t apply', () => {
    const r = evaluateRecurring(pace({ amount: 0, day: 1 }), [card(-1500, '2026-11-26')], proj())
    expect(r.perDay).toBe(-60)
    expect(r.value).toBe(-60)
    expect(r.count).toBe(1)
    expect(r.days).toBe(25)
    expect(r.span).toEqual({ from: { date: '2026-11-01', value: 0 }, to: { date: '2026-11-26', value: -1500 } })
  })

  it('records on or before the start point are left out; later ones count', () => {
    const recs = [card(-900, '2026-10-20'), card(-400, '2026-11-11'), card(-1000, '2026-11-21')]
    const r = evaluateRecurring(pace({ amount: 0, date: '2026-11-01' }), recs, proj())
    expect(r.count).toBe(2)
    expect(r.perDay).toBe(-50) // 0 → −1,000 over 20 days
  })

  it('a day of the month rolls back a month when it’s after the latest record', () => {
    expect(rateStartDate({ amount: 0, day: 1 }, '2026-11-26')).toBe('2026-11-01')
    expect(rateStartDate({ amount: 0, day: 15 }, '2026-11-10')).toBe('2026-10-15')
    expect(rateStartDate({ amount: 0, day: 31 }, '2026-11-30')).toBe('2026-11-30')
    expect(rateStartDate({ amount: 0, date: '2026-09-09' }, '2026-11-30')).toBe('2026-09-09')
  })

  it('needs a record after the start point', () => {
    const r = evaluateRecurring(pace({ amount: 0, day: 26 }), [card(-1500, '2026-11-26')], proj())
    expect(r.value).toBeNull()
    expect(r.reason).toMatch(/No records after the start point/)
  })
})

describe('freezing old projections into plain amounts', () => {
  it('fixed amounts keep their amount; computed ones take their value now; targets and in-record go', () => {
    const records = [rec('2026-01-01', 0, [line('Amex', -100)]), rec('2026-01-31', 0, [line('Amex', -400)])]
    const items: LegacyItem[] = [
      monthly(-2000, 1, { inRecord: true, target: 'Checking' }),
      fromRecords('rate', 'Amex', { id: 'amex', name: 'Amex pace', every: { n: 1, unit: 'day' } }),
      fromRecords('average', 'Nope', { id: 'nope', name: 'Gone' }),
      { ...once(-50, '2026-02-03'), target: 'Amex' },
    ]
    const { items: out, frozen } = freezeItems(items, records, { mode: 'all' })
    expect(out).toEqual([
      { kind: 'recurring', id: 'm1-2000', name: 'm', amount: -2000, every: { n: 1, unit: 'month' }, start: '2026-01-01' },
      { kind: 'recurring', id: 'amex', name: 'Amex pace', amount: -10, every: { n: 1, unit: 'day' }, start: '2026-01-01' },
      { kind: 'recurring', id: 'nope', name: 'Gone', amount: 0, every: { n: 1, unit: 'month' }, start: '2026-01-01' },
      { kind: 'oneTime', id: 'o2026-02-03', name: 'o', amount: -50, date: '2026-02-03' },
    ])
    expect(frozen).toEqual([
      { id: 'amex', name: 'Amex pace', amount: -10 },
      { id: 'nope', name: 'Gone', amount: 0 },
    ])
  })
})
