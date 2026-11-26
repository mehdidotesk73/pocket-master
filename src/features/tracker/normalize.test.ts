import { describe, expect, it } from 'vitest'
import { defaultTemplate } from '../../lib/finance'
import { isPreviousDefault, normalizeProjection, normalizeRecord, normalizeTemplate } from './useTracker'

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

describe('projections', () => {
  it('converts the v0.2 settings: in/out → signed items, fixed everyday figure → a monthly item', () => {
    const p = normalizeProjection(oldSettings, { id: 'everything' })
    expect(p.id).toBe('everything')
    expect(p.horizonDays).toBe(180)
    expect(p.start).toEqual({ mode: 'all' })
    expect(p.items.map((i) => [i.kind, i.name, 'amount' in i ? i.amount : null])).toEqual([
      ['recurring', 'Rent', -2000],
      ['recurring', 'Pay', 3000],
      ['oneTime', 'Trip', -500],
      ['recurring', 'Everyday spending', -900],
    ])
  })

  it('maps the prototype’s covered/variable fields', () => {
    const p = normalizeProjection({ recurring: [{ name: 'Rent', dir: 'out', amount: 1, day: 1, covered: true }], variable: { mode: 'auto', monthly: 0 } })
    expect(p.items[0]).toMatchObject({ kind: 'recurring', inRecord: true })
    expect(p.items[1]).toMatchObject({ kind: 'averaged', id: 'everyday', mode: 'rate', range: { mode: 'all' } })
  })

  it('converts the v0.3 single projection: from/to → a between range, “set it myself” → a monthly item', () => {
    const p = normalizeProjection(
      {
        schema: 1,
        recurring: [{ id: 'a', name: 'Pay', amount: 100, day: 15, inRecord: false }],
        oneTime: [],
        averaged: [
          { id: 'x', name: 'Amex drift', source: 'Amex', mode: 'rate', from: '2026-01-01', day: 1 },
          { id: 'y', name: 'Phone', source: 'Phone', mode: 'amount', day: 12, manual: -80 },
        ],
      },
      { id: 'everything', horizonDays: 30 },
    )
    expect(p.horizonDays).toBe(30)
    expect(p.items).toEqual([
      { kind: 'recurring', id: 'a', name: 'Pay', amount: 100, day: 15, inRecord: false },
      { kind: 'averaged', id: 'x', name: 'Amex drift', source: 'Amex', mode: 'rate', range: { mode: 'between', from: '2026-01-01' }, day: 1 },
      { kind: 'recurring', id: 'y', name: 'Phone', amount: -80, day: 12, inRecord: false },
    ])
  })

  it('round-trips the current shape, with start lines, ranges and extrapolate items', () => {
    const cur = {
      schema: 2,
      id: 'checking',
      name: 'Checking',
      start: { mode: 'lines', names: ['Checking', 'Amex'] },
      horizonDays: 45,
      items: [
        { kind: 'averaged', id: 'e', name: 'Spending', source: '', mode: 'rate', range: { mode: 'last', days: 90 }, day: 1 },
        { kind: 'extrapolate', id: 'x', name: 'Amex to month end', source: 'Amex' },
      ],
    }
    expect(normalizeProjection(cur)).toEqual(cur)
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
