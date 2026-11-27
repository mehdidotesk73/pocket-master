import { describe, expect, it } from 'vitest'
import { type ProjectionFile, type ProjectionItem, type Recurring, everydayItem, makeRecord, project } from '../../lib/finance'
import { readBack, summarize } from './projectionText'

// The two records from the on-device test: net equity 5,950 → 5,350 over 56 days.
const records = [
  makeRecord('2026-10-01T22:56:00', [
    { id: 'c', name: 'Checking', amount: 6000 },
    { id: 'd', name: 'Discover', amount: -50 },
    { id: 'o', name: 'Capital One', amount: -1000 },
    { id: 'a', name: 'Amex', amount: -1000 },
    { id: 's', name: 'Saving', amount: 2000 },
  ]),
  makeRecord('2026-11-26T22:57:00', [
    { id: 'c', name: 'Checking', amount: 6000 },
    { id: 'd', name: 'Discover', amount: -50 },
    { id: 'o', name: 'Capital One', amount: -1500 },
    { id: 'a', name: 'Amex', amount: -1200 },
    { id: 's', name: 'Saving', amount: 2100 },
  ]),
]
const forecast = (items: ProjectionItem[], horizonDays = 365): ProjectionFile => ({ schema: 3, id: 'f', name: 'F', start: { mode: 'all' }, horizonDays, items })
const say = (item: ProjectionItem, others: ProjectionItem[] = [], horizonDays = 365) => {
  const p = forecast([...others, item], horizonDays)
  return readBack(item, project(p, records), p)
}

describe('projection readback', () => {
  it('reads the on-device example back: average of one card added to another, accumulating', () => {
    const item: Recurring = {
      kind: 'recurring',
      id: 'x',
      name: 'x',
      target: 'Discover',
      value: { mode: 'average', source: 'Capital One', window: { mode: 'all' } },
      every: { n: 30, unit: 'day' },
      start: '2027-09-01',
      inRecord: false,
    }
    const r = say(item)
    expect(r.sentence).toBe('Every 30 days from Sep 1, add Capital One’s average of ($1,250.00) to Discover.')
    expect(r.total).toMatch(/^It keeps adding: \(\$3,750\.00\) over 3 times by Nov 26, 2027\.$/)
    expect(r.line).toMatch(/^Discover: \(\$50\.00\) → \(\$3,800\.00\)/)
    expect(r.warnings).toContain('Measured on Capital One but changes Discover.')
    expect(r.tone).toBe('warn')
  })

  it('warns when an average repeats more often than monthly', () => {
    const item: Recurring = { ...everydayItem(), id: 'y', value: { mode: 'average', source: 'Amex', window: { mode: 'all' } } }
    expect(say(item).warnings.some((w) => w.startsWith('An average is a typical amount'))).toBe(true)
    expect(say({ ...item, every: { n: 1, unit: 'month' } }).warnings).toEqual([])
  })

  it('calls the default net-equity rate income and spending combined until pay is listed', () => {
    const d = everydayItem()
    expect(say(d, [], 30).sentence).toBe('Every day, add net equity’s change of ($10.71) a day to net equity only.')
    expect(say(d, [], 30).warnings[0]).toMatch(/income and spending combined/)
    const pay: Recurring = { kind: 'recurring', id: 'pay', name: 'Pay', value: { mode: 'fixed', amount: 3000 }, every: { n: 1, unit: 'month' }, start: '2026-01-15', inRecord: false }
    expect(say(d, [pay], 30).warnings).toEqual([])
    const p = forecast([d])
    expect(summarize(d, project(p, records).results[d.id], p).detail).toMatch(/income and spending combined/)
  })

  it('says when nothing happens in range, and a one-time date outside it', () => {
    const r = say({ kind: 'oneTime', id: 'o', name: 'o', amount: 100, date: '2030-01-01' }, [], 30)
    expect(r.total).toBe('Nothing happens by Dec 26, 2026.')
    expect(r.warnings[0]).toMatch(/outside this forecast/)
    expect(r.line).toBe('Moves the total only, not any particular line.')
  })
})
