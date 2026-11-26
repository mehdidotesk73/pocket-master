import { describe, expect, it } from 'vitest'
import { MemoryBackend, Store } from './store'

describe('file store (memory backend)', () => {
  it('writes, reads, replaces and removes with one live revision each', async () => {
    const b = new MemoryBackend()
    const s = new Store(b)
    await s.load()
    await s.write('settings', '{"a":1}')
    await s.write('settings', '{"a":2}')
    await s.write('records/2026-11-01', '{}')
    expect(await s.read('settings')).toBe('{"a":2}')
    expect(s.list('records/').map((m) => m.id)).toEqual(['records/2026-11-01'])
    // only the current revision of each file + one index remain
    expect([...b.files.keys()].sort()).toEqual([
      'files/records/2026-11-01.1.json',
      'files/settings.2.json',
      'index.3.json',
    ])
    await s.remove('settings')
    expect(await s.read('settings')).toBeNull()
  })

  it('survives a crash between writing a revision and the index', async () => {
    const b = new MemoryBackend()
    const s = new Store(b)
    await s.load()
    await s.write('settings', 'v1')
    // simulate: new revision written, app killed before index update
    b.files.set('files/settings.2.json', 'half-writ')
    b.files.set('tmp/junk', 'x')
    const s2 = new Store(b)
    await s2.load()
    expect(await s2.read('settings')).toBe('v1')
    expect(b.files.has('files/settings.2.json')).toBe(false)
    expect(b.files.has('tmp/junk')).toBe(false)
  })

  it('falls back to the previous index if the newest one is corrupt', async () => {
    const b = new MemoryBackend()
    const s = new Store(b)
    await s.load()
    await s.write('a', 'one')
    b.files.set('index.99.json', '{not json')
    const s2 = new Store(b)
    await s2.load()
    expect(await s2.read('a')).toBe('one')
  })

  it('exports and imports a bundle (replace)', async () => {
    const s = new Store(new MemoryBackend())
    await s.load()
    await s.write('settings', '{"x":1}')
    await s.write('records/2026-01-01', '{"left":5}')
    const zip = await s.exportZip()

    const t = new Store(new MemoryBackend())
    await t.load()
    await t.write('stray', 'gone after replace')
    const { files } = Store.readZip(zip)
    await t.importFiles(files, 'replace')
    expect(t.list().map((m) => m.id)).toEqual(['records/2026-01-01', 'settings'])
    expect(await t.read('records/2026-01-01')).toBe('{"left":5}')
  })

  it('migrates the schema-1 flat layout into real folders', async () => {
    const b = new MemoryBackend()
    b.files.set(
      'index.4.json',
      JSON.stringify({
        schemaVersion: 1,
        seq: 4,
        files: {
          settings: { id: 'settings', ext: 'json', rev: 2, size: 1, updatedAt: '' },
          'records/2026-11-01': { id: 'records/2026-11-01', ext: 'json', rev: 1, size: 1, updatedAt: '' },
        },
      }),
    )
    b.files.set('files/settings.2.json', 'S')
    b.files.set('files/records%2F2026-11-01.1.json', 'R')
    const s = new Store(b)
    await s.load()
    expect(s.index.schemaVersion).toBe(2)
    expect(await s.read('records/2026-11-01')).toBe('R')
    expect(await s.read('settings')).toBe('S')
    expect([...b.files.keys()].filter((k) => k.startsWith('files/')).sort()).toEqual([
      'files/records/2026-11-01.1.json',
      'files/settings.2.json',
    ])
  })

  it('zip entries mirror the folders, and old flat-layout zips still import', async () => {
    const s = new Store(new MemoryBackend())
    await s.load()
    await s.write('records/2026-01-01', '{"left":5}')
    const { unzipSync, zipSync, strToU8 } = await import('fflate')
    expect(Object.keys(unzipSync(await s.exportZip())).sort()).toEqual(['index.json', 'records/2026-01-01.json'])

    const legacy = zipSync({
      'index.json': strToU8(JSON.stringify({ app: 'pocket-master', schemaVersion: 1, files: [{ id: 'records/2026-01-02', ext: 'json' }] })),
      'files/records%2F2026-01-02.json': strToU8('{"left":7}'),
    })
    expect(Store.readZip(legacy).files).toEqual([{ id: 'records/2026-01-02', ext: 'json', text: '{"left":7}' }])
  })

  it('rejects a zip from another app', () => {
    expect(() => Store.readZip(new Uint8Array([1, 2, 3]))).toThrow()
  })
})
