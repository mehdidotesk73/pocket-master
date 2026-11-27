import { describe, expect, it } from 'vitest'
import { LEFT_SOURCE, makeRecord } from './finance'
import { dailyCandles, lineSeries, windowMix } from './analysis'

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

  it('daily candles: an even rate between records, record-to-record jumps on record days', () => {
    const c = dailyCandles(records, 'Card')
    expect(c.map((x) => x.date)).toEqual(Array.from({ length: 21 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`))
    // Oct 2: no record, between Oct 1 8 AM (−300) and Oct 11 8 AM (−500) → −20 a day
    expect(c[1]).toMatchObject({ open: -313.33, close: -333.33, records: [], between: { from: '2026-10-01', to: '2026-10-11', perDay: -20 } })
    // Oct 21: card climbs to −800 by 8 AM, then is paid to 0 at 8 PM
    const last = c[20]
    expect(last.records.map((r) => r.value)).toEqual([-800, 0])
    expect(last.low).toBe(-800)
    expect(last.close).toBe(0)
    expect(last.high).toBe(0)
  })

  it('net equity candles; nothing with fewer than two records', () => {
    expect(dailyCandles(records, LEFT_SOURCE).length).toBe(21)
    expect(dailyCandles(records.slice(0, 1), 'Card')).toEqual([])
  })
})
