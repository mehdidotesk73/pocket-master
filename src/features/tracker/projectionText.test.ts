import { describe, expect, it } from 'vitest'
import { type ProjectionFile, type ProjectionItem, type Recurring, makeRecord, project } from '../../lib/finance'
import { describeLink, describeMeasure, readBack, summarize } from './projectionText'

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
    expect(summarize(rent)).toEqual({ amount: '($2,030.00)', detail: 'every month on the 1st', linked: '', tone: 'neg' })
  })

  it('a linked projection says what it is measured from', () => {
    const link = { measure: 'rate', line: 'Amex', window: { mode: 'last', days: 90 }, direction: 'falling' } as const
    const amex: Recurring = { kind: 'recurring', id: 'a', name: 'Amex', amount: -20.51, every: { n: 1, unit: 'day' }, start: '2026-11-28', link }
    expect(summarize(amex).linked).toBe('Amex’s average daily change, falling days only, over the past 90 days')
    expect(say(amex, 30).sentence).toBe('Every day from Nov 28: Amex’s average daily change, falling days only, over the past 90 days, now ($20.51).')
    expect(describeLink({ measure: 'average', line: '', window: { mode: 'lastRecords', count: 6 } })).toBe('Net equity’s average over the last 6 records')
    const m = { value: -20.51, count: 22, from: '2026-08-20', to: '2026-11-17', days: 89 }
    expect(describeMeasure(link, m, { n: 1, unit: 'week' })).toBe('From 22 records, Aug 20 – Nov 17: ($20.51) a day × 7 days.')
    expect(describeMeasure(link, { value: 0, count: 0 }, { n: 1, unit: 'day' })).toBe('No records in that window yet, so it’s $0 for now.')
  })
})
