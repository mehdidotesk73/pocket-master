import { describe, expect, it } from 'vitest'
import { defaultTemplate, makeRecord } from '../../lib/finance'
import { isPreviousDefault, normalizeProjection, normalizeRecord, normalizeTemplate, recordId } from './useTracker'

// The combined settings file the app wrote before projection.json / template.json existed.
const oldSettings = {
  schema: 2,
  template: [{ id: 't', name: 'Visa', amount: -12 }, { id: 'u', name: 'Pay', negative: false }],
  recurring: [
    { id: 'r', name: 'Rent', dir: 'out', amount: 2000, day: 1, inRecord: true },
    { id: 'p', name: 'Pay', dir: 'in', amount: 3000, day: 40, inRecord: false },
  ],
  oneTime: [{ id: 'o', name: 'Trip', dir: 'out', amount: 500, date: '2027-01-10' }, { id: 'bad', date: 'never' }],
  everyday: { mode: 'manual', monthly: 900 },
  horizonDays: 180,
}

const monthly = (id: string, name: string, amount: number, start: string) => ({ kind: 'recurring', id, name, amount, every: { n: 1, unit: 'month' }, start })

// Records an old computed projection is frozen against: Amex −100 → −400 over 30 days (−10 a day).
const recs = [
  makeRecord('2026-01-01', [{ id: 'a', name: 'Amex', amount: -100 }, { id: 'c', name: 'Checking', amount: 1000 }]),
  makeRecord('2026-01-31', [{ id: 'a', name: 'Amex', amount: -400 }, { id: 'c', name: 'Checking', amount: 1000 }]),
]

describe('projections (every old shape becomes plain amounts)', () => {
  it('converts the v0.2 settings: in/out → signed monthly amounts, the fixed everyday figure → a monthly amount', () => {
    const p = normalizeProjection(oldSettings, { id: 'everything' }, [])
    expect(p.schema).toBe(4)
    expect(p.id).toBe('everything')
    expect(p.horizonDays).toBe(180)
    expect(p.items).toEqual([
      monthly('r', 'Rent', -2000, '2026-01-01'),
      monthly('p', 'Pay', 3000, '2026-01-31'),
      { kind: 'oneTime', id: 'o', name: 'Trip', amount: -500, date: '2027-01-10' },
      monthly('everyday', 'Everyday spending', -900, '2026-01-01'),
    ])
  })

  it('a computed projection is frozen at its value with the records given; one that comes to $0 is dropped', () => {
    const p = normalizeProjection(
      {
        schema: 3,
        items: [
          { kind: 'recurring', id: 'x', name: 'Amex pace', target: 'Amex', value: { mode: 'rate', source: 'Amex', window: { mode: 'all' } }, every: { n: 1, unit: 'day' }, start: '2000-01-01', inRecord: false },
          { kind: 'recurring', id: 'y', name: 'Phone', value: { mode: 'average', source: 'Phone', window: { mode: 'all' } }, every: { n: 1, unit: 'month' }, start: '2026-01-12', inRecord: false },
          { kind: 'extrapolate', id: 'e', name: 'Amex to month end', source: 'Amex' },
        ],
      },
      {},
      recs,
    )
    expect(p.items).toEqual([{ kind: 'recurring', id: 'x', name: 'Amex pace', amount: -10, every: { n: 1, unit: 'day' }, start: '2000-01-01' }])
  })

  it('the prototype’s auto everyday spending becomes a daily amount from the records (dropped with none)', () => {
    expect(normalizeProjection({ variable: { mode: 'auto', monthly: 0 } }, {}, []).items).toEqual([])
    const p = normalizeProjection({ recurring: [{ name: 'Rent', dir: 'out', amount: 1, day: 1, covered: true }], variable: { mode: 'auto' } }, {}, recs)
    expect(p.items[0]).toMatchObject({ kind: 'recurring', name: 'Rent', amount: -1 })
    // net equity 900 → 600 over 30 days, with the $1 rent taken out: about −$10 a day
    expect(p.items[1]).toMatchObject({ id: 'everyday', every: { n: 1, unit: 'day' } })
    expect(p.items[1].amount).toBeCloseTo(-10, 0)
  })

  it('round-trips the current shape: start lines, every N units, one-time amounts', () => {
    const cur = {
      schema: 4,
      id: 'checking',
      name: 'Checking',
      start: { mode: 'lines', names: ['Checking', 'Amex'] },
      horizonDays: 45,
      items: [
        { kind: 'recurring', id: 'b', name: 'Pay', amount: 1800, every: { n: 2, unit: 'week' }, start: '2026-12-04' },
        { kind: 'oneTime', id: 'o', name: 'Refund', amount: 150, date: '2026-12-05' },
      ],
    }
    expect(normalizeProjection(cur, {}, [])).toEqual(cur)
  })
})

describe('template.json', () => {
  it('takes rows from the old combined settings, signs from saved amounts', () => {
    expect(normalizeTemplate(oldSettings).rows).toEqual([
      { id: 't', name: 'Visa', amount: -12, negative: true },
      { id: 'u', name: 'Pay', negative: false },
    ])
  })

  it('converts the first version’s Setup lines', () => {
    const t = normalizeTemplate({ lines: [{ id: 'k', name: 'Checking', kind: 'account' }, { id: 'c', name: 'Card', kind: 'card' }, { kind: 'nope' }] })
    expect(t.rows).toEqual([
      { id: 'k', name: 'Checking', negative: false },
      { id: 'c', name: 'Card', negative: true },
    ])
  })
})

describe('records', () => {
  it('converts kind-based lines to signed amounts (cards at their share)', () => {
    const r = normalizeRecord({
      date: '2026-11-01',
      left: 999999,
      lines: [
        { id: 'a', name: 'Checking', kind: 'account', amount: 100 },
        { id: 'c', name: 'Card', kind: 'card', total: 1408.41, share: 50 },
        { id: 'b', name: 'Phone', kind: 'bill', amount: 20 },
      ],
    })
    expect(r?.lines.map((l) => l.amount)).toEqual([100, -704.21, -20])
    expect(r?.left).toBe(-624.21)
  })

  it('keeps signed lines, recomputes totals, rejects bad dates', () => {
    expect(normalizeRecord({ date: '2026-11-02', left: 1, lines: [{ id: 'a', name: 'A', amount: -5 }] })?.left).toBe(-5)
    expect(normalizeRecord({ date: 'nope', lines: [] })).toBeNull()
  })
})

describe('default template', () => {
  it('is Checking, Discover, Capital One, Amex, Macy’s and Saving', () => {
    expect(defaultTemplate().rows.map((r) => [r.name, r.negative])).toEqual([
      ['Checking', false],
      ['Discover', true],
      ['Capital One', true],
      ['Amex', true],
      ['Macy’s', true],
      ['Saving', false],
    ])
  })

  it('spots a never-customised old default, but not a saved template', () => {
    const old = normalizeTemplate({ lines: [
      { id: 'checking', name: 'Checking', kind: 'account' }, { id: 'rent', name: 'Month’s rent', kind: 'bill' },
      { id: 'phone-ins', name: 'Phone and insurance', kind: 'bill' }, { id: 'discover', name: 'Discover', kind: 'card' },
      { id: 'capone', name: 'Capital One', kind: 'card' }, { id: 'amex', name: 'Amex', kind: 'card' },
      { id: 'macys', name: 'Macy’s', kind: 'card' }, { id: 'paying', name: 'Paying', kind: 'paying' },
      { id: 'receiving', name: 'Receiving', kind: 'receiving' },
    ] })
    expect(isPreviousDefault(old)).toBe(true)
    expect(isPreviousDefault({ ...old, rows: old.rows.slice(1) })).toBe(false)
    expect(isPreviousDefault(defaultTemplate())).toBe(false)
  })
})

describe('record moments (v0.7)', () => {
  it('a date-only record takes its saved time when that was the same day, else noon', () => {
    const lines = [{ id: 'a', name: 'A', amount: 1 }]
    const sameDay = new Date(2026, 10, 26, 14, 5, 33).toISOString()
    expect(normalizeRecord({ date: '2026-11-26', savedAt: sameDay, lines })?.at).toBe('2026-11-26T14:05:33')
    const later = new Date(2026, 10, 28, 9, 0, 0).toISOString()
    expect(normalizeRecord({ date: '2026-11-26', savedAt: later, lines })?.at).toBe('2026-11-26T12:00:00')
    expect(normalizeRecord({ date: '2026-11-26', lines })?.at).toBe('2026-11-26T12:00:00')
  })

  it('keeps an explicit moment and names the file by it', () => {
    const r = normalizeRecord({ at: '2026-11-26T08:15:00', date: 'ignored', lines: [] })
    expect(r?.at).toBe('2026-11-26T08:15:00')
    expect(r?.date).toBe('2026-11-26')
    expect(recordId(r!.at)).toBe('records/2026-11-26T08-15-00')
  })
})
