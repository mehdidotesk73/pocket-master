import { describe, expect, it } from 'vitest'
import { type ProjectionFile, type ProjectionItem, type Recurring, makeRecord, project } from '../../lib/finance'
import { readBack, summarize } from './projectionText'

const records = [makeRecord('2026-11-26T22:57:00', [{ id: 'c', name: 'Checking', amount: 6000 }])]
const forecast = (items: ProjectionItem[], horizonDays = 365): ProjectionFile => ({ schema: 4, id: 'f', name: 'F', start: { mode: 'all' }, horizonDays, items })
const say = (item: ProjectionItem, horizonDays = 365) => readBack(item, project(forecast([item], horizonDays), records))
const rent: Recurring = { kind: 'recurring', id: 'r', name: 'Rent', amount: -2030, every: { n: 1, unit: 'month' }, start: '2026-11-01' }

describe('projection readback', () => {
  it('reads a recurring amount back, with what it adds up to', () => {
    const r = say(rent, 90)
    expect(r.sentence).toBe('Every month on the 1st: ($2,030.00).')
    expect(r.total).toBe('3 times, ($6,090.00) in all by Feb 24, 2027.')
    expect(r.warnings).toEqual([])
    expect(r.tone).toBe('neg')
  })

  it('every 2 weeks from a date; a one-time amount', () => {
    expect(say({ ...rent, amount: 1600, every: { n: 2, unit: 'week' }, start: '2026-12-04' }, 30).sentence).toBe('Every 2 weeks from Dec 4: +$1,600.00.')
    const once = say({ kind: 'oneTime', id: 'o', name: 'Trip', amount: -800, date: '2027-03-03' })
    expect(once.sentence).toBe('($800.00) on Mar 3, 2027.')
    expect(once.total).toBe('($800.00) by Nov 26, 2027.')
  })

  it('says when a one-time date is outside the forecast', () => {
    const r = say({ kind: 'oneTime', id: 'o', name: 'o', amount: 0, date: '2030-01-01' }, 30)
    expect(r.total).toBe('Nothing by Dec 26, 2026.')
    expect(r.warnings).toEqual(['That date is outside this forecast (Nov 26 – Dec 26, 2026).'])
    expect(r.tone).toBe('warn')
  })

  it('list summary: the amount, then when', () => {
    expect(summarize(rent)).toEqual({ amount: '($2,030.00)', detail: 'every month on the 1st', tone: 'neg' })
  })
})
