import { describe, expect, it } from 'vitest'
import { LEFT_SOURCE, makeRecord } from './finance'
import { intervalRates, lineSeries, windowMix } from './analysis'

const rec = (at: string, lines: [string, number][]) =>
  makeRecord(at, lines.map(([name, amount]) => ({ id: name, name, amount })))

const records = [
  rec('2026-10-01T08:00:00', [['Checking', 1000], ['Card', -300]]),
  rec('2026-10-11T08:00:00', [['Checking', 2000], ['Card', -500], ['Saving', 100]]),
  // same day: card paid from checking
  rec('2026-10-21T08:00:00', [['Checking', 1500], ['Card', -800], ['Saving', 100]]),
  rec('2026-10-21T20:00:00', [['Checking', 700], ['Card', 0], ['Saving', 100]]),
]

describe('history analysis', () => {
  it('each line at every record, missing rows as $0', () => {
    const s = lineSeries(records)
    expect(s.map((x) => x.name).sort()).toEqual(['Card', 'Checking', 'Saving'])
    expect(s.find((x) => x.name === 'Saving')!.points.map((p) => p.y)).toEqual([0, 100, 100, 100])
  })

  it('averages each line over the window, signed, leaving out $0 lines', () => {
    const m = windowMix(records, { mode: 'all' })
    expect(m.count).toBe(4)
    const get = (n: string) => m.slices.find((s) => s.name === n)!.average
    expect(get('Checking')).toBe(1300)
    expect(get('Card')).toBe(-400)
    expect(get('Saving')).toBe(75)
    expect(windowMix(records, { mode: 'lastRecords', count: 1 }).slices.map((s) => s.name).sort()).toEqual(['Checking', 'Saving'])
  })

  it('rate per day between records, using each day’s last record', () => {
    const r = intervalRates(records, 'Card')
    expect(r).toEqual([
      { from: '2026-10-01', to: '2026-10-11', days: 10, start: -300, end: -500, perDay: -20 },
      { from: '2026-10-11', to: '2026-10-21', days: 10, start: -500, end: 0, perDay: 50 },
    ])
    expect(intervalRates(records, LEFT_SOURCE).map((x) => x.perDay)).toEqual([90, -80])
  })

  it('nothing to compare with one day of records', () => {
    expect(intervalRates(records.slice(2), 'Card')).toEqual([])
  })
})
