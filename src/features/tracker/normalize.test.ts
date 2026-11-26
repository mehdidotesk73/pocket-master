import { describe, expect, it } from 'vitest'
import { normalizeProjection, normalizeRecord, normalizeTemplate } from './useTracker'

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

describe('projection.json', () => {
  it('converts in/out items to signed amounts and everyday spending to an averaged item', () => {
    const p = normalizeProjection(oldSettings)
    expect(p.recurring.map((r) => [r.name, r.amount, r.day])).toEqual([
      ['Rent', -2000, 1],
      ['Pay', 3000, 31],
    ])
    expect(p.oneTime).toEqual([{ id: 'o', name: 'Trip', amount: -500, date: '2027-01-10' }])
    expect(p.averaged).toEqual([{ id: 'everyday', name: 'Everyday spending', source: '', mode: 'rate', day: 1, manual: -900 }])
  })

  it('maps the prototype’s covered/variable fields', () => {
    const p = normalizeProjection({
      recurring: [{ name: 'Rent', dir: 'out', amount: 1, day: 1, covered: true }],
      variable: { mode: 'auto', monthly: 0 },
    })
    expect(p.recurring[0].inRecord).toBe(true)
    expect(p.averaged[0].manual).toBeUndefined()
  })

  it('round-trips the current shape, keeping ranges and manual figures', () => {
    const cur = {
      schema: 1,
      recurring: [{ id: 'a', name: 'Pay', amount: 100, day: 15, inRecord: false }],
      oneTime: [],
      averaged: [{ id: 'x', name: 'Amex drift', source: 'Amex', mode: 'rate', from: '2026-01-01', to: '2026-06-30', day: 1 }],
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
