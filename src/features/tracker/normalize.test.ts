import { describe, expect, it } from 'vitest'
import { normalizeRecord, normalizeSettings } from './useTracker'

describe('schema 1 / prototype import mapping', () => {
  it('maps covered → inRecord, variable → everyday, horizon → horizonDays, lines → template', () => {
    const s = normalizeSettings({
      lines: [
        { id: 'k', name: 'Checking', kind: 'account' },
        { id: 'c', name: 'Card', kind: 'card', share: 50 },
        { id: 'x', name: 'Bad', kind: 'nope' },
      ],
      recurring: [{ id: 'r', name: 'Rent', dir: 'out', amount: 2000, day: 1, covered: true }],
      variable: { mode: 'manual', monthly: 900 },
      horizon: 180,
    })
    expect(s.schema).toBe(2)
    expect(s.template).toEqual([
      { id: 'k', name: 'Checking', negative: false },
      { id: 'c', name: 'Card', negative: true },
    ])
    expect(s.recurring[0].inRecord).toBe(true)
    expect(s.everyday).toEqual({ mode: 'manual', monthly: 900 })
    expect(s.horizonDays).toBe(180)
  })

  it('converts schema-1 record lines to signed amounts (cards at their share)', () => {
    const r = normalizeRecord({
      schema: 1,
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
    expect(r?.liabilities).toBe(724.21)
  })

  it('keeps schema-2 signed lines and recomputes totals', () => {
    const r = normalizeRecord({ schema: 2, date: '2026-11-02', left: 1, lines: [{ id: 'a', name: 'A', amount: -5 }] })
    expect(r?.left).toBe(-5)
    expect(normalizeRecord({ date: 'nope', lines: [] })).toBeNull()
  })

  it('template rows take their sign from a saved amount', () => {
    const s = normalizeSettings({ template: [{ id: 't', name: 'Visa', amount: -12 }, { id: 'u', name: 'Pay', negative: false }] })
    expect(s.template).toEqual([
      { id: 't', name: 'Visa', amount: -12, negative: true },
      { id: 'u', name: 'Pay', negative: false },
    ])
  })
})
