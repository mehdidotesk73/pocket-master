import { describe, expect, it } from 'vitest'
import { normalizeRecord, normalizeSettings } from './useTracker'

describe('prototype import mapping', () => {
  it('maps covered → inRecord, variable → everyday, horizon → horizonDays', () => {
    const s = normalizeSettings({
      lines: [{ id: 'c', name: 'Card', kind: 'card', share: 50 }, { id: 'x', name: 'Bad', kind: 'nope' }],
      recurring: [{ id: 'r', name: 'Rent', dir: 'out', amount: 2000, day: 1, covered: true }],
      variable: { mode: 'manual', monthly: 900 },
      horizon: 180,
    })
    expect(s.lines).toEqual([{ id: 'c', name: 'Card', kind: 'card', share: 50 }])
    expect(s.recurring[0].inRecord).toBe(true)
    expect(s.everyday).toEqual({ mode: 'manual', monthly: 900 })
    expect(s.horizonDays).toBe(180)
  })

  it('recomputes record totals rather than trusting them', () => {
    const r = normalizeRecord({
      date: '2026-11-01',
      left: 999999,
      lines: [
        { id: 'a', name: 'Checking', kind: 'account', amount: 100 },
        { id: 'c', name: 'Card', kind: 'card', total: 50, share: 50 },
      ],
    })
    expect(r?.left).toBe(75)
    expect(normalizeRecord({ date: 'nope', lines: [] })).toBeNull()
  })
})
