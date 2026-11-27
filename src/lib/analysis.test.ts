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

  it('daily candles by date: an even rate between record days, the day\'s records as its wick', () => {
    const c = dailyCandles(records, 'Card')
    expect(c.map((x) => x.date)).toEqual(Array.from({ length: 21 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`))
    // Oct 1: one record, no change yet
    expect(c[0]).toMatchObject({ open: -300, close: -300 })
    // Oct 2: no record; from Oct 1 (−300) to Oct 11 (−500) is −20 a day
    expect(c[1]).toMatchObject({ open: -300, close: -320, records: [], between: { from: '2026-10-01', to: '2026-10-11', perDay: -20 } })
    // Oct 12–20 run toward Oct 21's FIRST record (−800), not its close: −30 a day
    expect(c[19]).toMatchObject({ date: '2026-10-20', close: -770, between: { perDay: -30 } })
    // Oct 21: opens at Oct 20's close, dips to the 8 AM record, closes at the 8 PM payoff
    expect(c[20]).toMatchObject({ open: -770, low: -800, high: 0, close: 0 })
    expect(c[20].records.map((r) => r.value)).toEqual([-800, 0])
    // the daily changes add up to the whole change
    const total = c.reduce((s, x) => s + (x.close - x.open), 0)
    expect(Math.round(total * 100) / 100).toBe(300)
  })

  it('a same-day pair with no change makes a flat day', () => {
    const pair = [
      rec('2026-09-16T20:00:00', [['Card', -929.03]]),
      rec('2026-09-17T08:00:00', [['Card', -987.1]]),
      rec('2026-09-17T20:00:00', [['Card', -987.1]]),
    ]
    expect(dailyCandles(pair, 'Card')[1]).toMatchObject({ open: -929.03, close: -987.1, low: -987.1, high: -929.03 })
  })

  it('net equity candles; nothing with fewer than two records', () => {
    expect(dailyCandles(records, LEFT_SOURCE).length).toBe(21)
    expect(dailyCandles(records.slice(0, 1), 'Card')).toEqual([])
  })
})
