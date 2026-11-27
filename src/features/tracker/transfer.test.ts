import { describe, expect, it } from 'vitest'
import { defaultProjection, defaultTemplate, makeRecord } from '../../lib/finance'
import { CLIPBOARD_LIMIT_BYTES, buildTransferJSON, parseImportText } from './useTracker'

const records = [
  makeRecord('2026-10-01', [{ id: 'c', name: 'Checking', amount: 5000 }, { id: 'a', name: 'Amex', amount: -300 }]),
  makeRecord('2026-11-26', [{ id: 'c', name: 'Checking', amount: 7718.6 }, { id: 'a', name: 'Amex', amount: -730.48 }]),
]
const projection = {
  ...defaultProjection(),
  items: [
    {
      kind: 'recurring' as const,
      id: 'p',
      name: 'Paycheck',
      value: { mode: 'fixed' as const, amount: 3000 },
      every: { n: 1, unit: 'month' as const },
      start: '2026-01-15',
      inRecord: false,
    },
  ],
}
const checking = { ...defaultProjection('checking'), name: 'Checking', start: { mode: 'lines' as const, names: ['Checking'] }, items: [] }

describe('clipboard export / paste import', () => {
  it('round-trips every projection, the template and every record', () => {
    const text = buildTransferJSON([projection, checking], defaultTemplate(), records)
    const doc = JSON.parse(text)
    expect(doc.app).toBe('pocket-master')
    expect(doc.records.map((r: { date: string }) => r.date)).toEqual(['2026-11-26', '2026-10-01']) // newest first

    const b = parseImportText(text)
    expect(b.kind).toBe('json')
    expect(b.recordCount).toBe(2)
    expect(b.projectionCount).toBe(2)
    const byId = Object.fromEntries(b.files.map((f) => [f.id, JSON.parse(f.text)]))
    expect(Object.keys(byId).sort()).toEqual([
      'projections/checking',
      'projections/everything',
      'records/2026-10-01T12-00-00',
      'records/2026-11-26T12-00-00',
      'template',
    ])
    expect(byId['projections/everything']).toEqual(projection)
    expect(byId['projections/checking']).toEqual(checking)
    expect(byId.template).toEqual(defaultTemplate())
    expect(byId['records/2026-11-26T12-00-00'].left).toBe(6988.12)
  })

  it('tolerates whitespace around a paste and recomputes totals', () => {
    const doc = { app: 'pocket-master', format: 1, records: [{ date: '2026-01-01', left: 999, lines: [{ id: 'x', name: 'X', amount: -5 }] }] }
    const b = parseImportText(`\n  ${JSON.stringify(doc)}  \n`)
    expect(JSON.parse(b.files[0].text).left).toBe(-5)
  })

  it('accepts the earlier format 1 (one projection)', () => {
    const b = parseImportText(JSON.stringify({ app: 'pocket-master', format: 1, projection: { recurring: [], oneTime: [], averaged: [] }, records: [] }))
    expect(b.files.map((f) => f.id)).toEqual(['projections/everything'])
  })

  it('still accepts the prototype’s { settings, records }', () => {
    const b = parseImportText(JSON.stringify({ settings: { variable: { mode: 'manual', monthly: 100 } }, records: [] }))
    expect(b.kind).toBe('prototype')
    expect(b.files.map((f) => f.id).sort()).toEqual(['projections/everything', 'template'])
  })

  it('explains what’s wrong with text that isn’t an export', () => {
    expect(() => parseImportText('hello')).toThrow(/valid JSON/)
    expect(() => parseImportText('{"foo":1}')).toThrow(/isn’t an export/)
    expect(() => parseImportText('{"app":"pocket-master","format":99}')).toThrow(/newer version/)
    expect(() => parseImportText('{"app":"pocket-master","format":1,"records":[]}')).toThrow(/empty/)
  })

  it('a few years of weekly records fits well under the clipboard limit', () => {
    const many = Array.from({ length: 156 }, (_, i) => {
      const d = new Date(Date.UTC(2024, 0, 1 + i * 7)).toISOString().slice(0, 10)
      return makeRecord(d, Array.from({ length: 12 }, (_, j) => ({ id: `l${j}`, name: `Line number ${j}`, amount: -1234.56 })))
    })
    const bytes = new TextEncoder().encode(buildTransferJSON([projection], defaultTemplate(), many)).byteLength
    expect(bytes).toBeLessThan(CLIPBOARD_LIMIT_BYTES)
  })
})
