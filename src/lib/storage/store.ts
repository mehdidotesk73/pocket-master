// Device-local file store on the Origin Private File System (storage spec §2).
//
// Layout in OPFS:
//   index.<seq>.json      manifest: schemaVersion + every file's current revision
//   files/<id>.<rev>.<ext>
//   tmp/                  scratch; emptied on every start
//
// Safe save: write the full new revision → write a new index pointing at it →
// delete the old revision and old index. If the app is killed at any point,
// the highest readable index still points at a complete file. Startup deletes
// anything the index doesn't reference.
//
// Every write goes through one queue, so two writes never race on a file.

import { reactive } from 'vue'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { logDebug } from '../../debug'
import type { WorkerRequest, WorkerResponse } from './worker'

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

/** Bump when the on-disk layout changes, and add a migration below. */
export const STORE_SCHEMA = 1
const APP_ID = 'pocket-master'

export interface FileMeta {
  id: string
  ext: string
  rev: number
  size: number
  updatedAt: string
}

interface IndexFile {
  schemaVersion: number
  seq: number
  files: Record<string, FileMeta>
}

export type SaveState = 'idle' | 'saving' | 'error'

export const storeState = reactive({
  ready: false,
  backend: 'none' as 'opfs' | 'memory' | 'none',
  saveState: 'idle' as SaveState,
  lastError: '' as string,
  pendingWrites: 0,
  /** Keys of on-screen drafts that haven't been saved (record modal, editors). */
  unsaved: [] as string[],
  health: {
    installed: false,
    persisted: null as boolean | null,
    usageBytes: null as number | null,
    quotaBytes: null as number | null,
  },
  lastExport: null as string | null,
})

// ---------------------------------------------------------------- backends

interface Backend {
  read(path: string): Promise<string | null>
  write(path: string, text: string): Promise<void>
  remove(path: string): Promise<void>
  list(dir: string): Promise<string[]>
  clear(dir: string): Promise<void>
}

class WorkerBackend implements Backend {
  private worker: Worker
  private seq = 0
  private waiting = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>()

  constructor() {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const w = this.waiting.get(ev.data.id)
      if (!w) return
      this.waiting.delete(ev.data.id)
      if (ev.data.ok) w.resolve(ev.data.result)
      else w.reject(new Error(ev.data.error))
    }
    this.worker.onerror = (ev) => {
      const err = new Error(`Storage worker failed: ${ev.message || 'unknown error'}`)
      for (const w of this.waiting.values()) w.reject(err)
      this.waiting.clear()
    }
  }

  call<T>(req: DistributiveOmit<WorkerRequest, 'id'>, timeoutMs = 15_000): Promise<T> {
    const id = ++this.seq
    return new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => {
        this.waiting.delete(id)
        reject(new Error(`Storage worker timed out on ${req.op}`))
      }, timeoutMs)
      this.waiting.set(id, {
        resolve: (v) => (clearTimeout(t), resolve(v as T)),
        reject: (e) => (clearTimeout(t), reject(e)),
      })
      this.worker.postMessage({ ...req, id } as WorkerRequest)
    })
  }

  read = (path: string) => this.call<string | null>({ op: 'read', path })
  write = async (path: string, text: string) => void (await this.call({ op: 'write', path, text }))
  remove = async (path: string) => void (await this.call({ op: 'remove', path }))
  list = (dir: string) => this.call<string[]>({ op: 'list', dir })
  clear = async (dir: string) => void (await this.call({ op: 'clear', dir }))
}

/** Used when OPFS isn't available (very old browsers, some private modes) and in tests. */
export class MemoryBackend implements Backend {
  files = new Map<string, string>()
  async read(path: string) {
    return this.files.get(path) ?? null
  }
  async write(path: string, text: string) {
    this.files.set(path, text)
  }
  async remove(path: string) {
    this.files.delete(path)
  }
  async list(dir: string) {
    const prefix = dir ? `${dir.replace(/\/$/, '')}/` : ''
    return [...this.files.keys()]
      .filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'))
      .map((k) => k.slice(prefix.length))
  }
  async clear(dir: string) {
    for (const k of [...this.files.keys()]) if (k.startsWith(`${dir}/`)) this.files.delete(k)
  }
}

// ---------------------------------------------------------------- paths

const encId = (id: string) => encodeURIComponent(id).replace(/\./g, '%2E')
const filePath = (m: Pick<FileMeta, 'id' | 'rev' | 'ext'>) => `files/${encId(m.id)}.${m.rev}.${m.ext}`
const indexName = (seq: number) => `index.${seq}.json`
const INDEX_RE = /^index\.(\d+)\.json$/

// ---------------------------------------------------------------- migrations

/**
 * Migrations run in init() before the UI loads, from the stored schemaVersion
 * up to STORE_SCHEMA. Key = the version being migrated FROM. New app versions
 * must open data written by older ones: auto-update delivers new code to people
 * who already have data.
 *
 * Example for a future v2:
 *   1: async (s) => { for (const m of Object.values(s.index.files)) { ...rewrite... } },
 */
const MIGRATIONS: Record<number, (s: Store) => Promise<void>> = {}

// ---------------------------------------------------------------- the store

export class Store {
  index: IndexFile = { schemaVersion: STORE_SCHEMA, seq: 0, files: {} }
  private queue: Promise<unknown> = Promise.resolve()
  private readOnly = false

  constructor(private backend: Backend) {}

  /** Run `fn` after every write queued before it. */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    storeState.pendingWrites++
    storeState.saveState = 'saving'
    const run = this.queue.then(fn, fn)
    this.queue = run.then(
      () => {
        storeState.pendingWrites--
        if (!storeState.pendingWrites && storeState.saveState !== 'error') storeState.saveState = 'idle'
      },
      (e: Error) => {
        storeState.pendingWrites--
        storeState.saveState = 'error'
        storeState.lastError = e.message
        logDebug(`Save failed: ${e.message}`, 'error')
      },
    )
    return run
  }

  async load(): Promise<void> {
    await this.backend.clear('tmp')

    // Highest index that parses wins.
    const rootNames = await this.backend.list('')
    const seqs = rootNames
      .map((n) => INDEX_RE.exec(n))
      .filter((m): m is RegExpExecArray => !!m)
      .map((m) => Number(m[1]))
      .sort((a, b) => b - a)
    let loaded: IndexFile | null = null
    for (const seq of seqs) {
      try {
        const text = await this.backend.read(indexName(seq))
        const parsed = text ? (JSON.parse(text) as IndexFile) : null
        if (parsed && typeof parsed.files === 'object') {
          loaded = { ...parsed, seq }
          break
        }
      } catch (e) {
        logDebug(`Skipping unreadable ${indexName(seq)}: ${(e as Error).message}`, 'warn')
      }
    }
    if (loaded) this.index = loaded

    if (this.index.schemaVersion > STORE_SCHEMA) {
      // Data written by a newer build (e.g. an old cached tab). Don't touch it.
      this.readOnly = true
      storeState.saveState = 'error'
      storeState.lastError = 'Your data was saved by a newer version of the app. Tap “Reload latest” in the footer.'
      return
    }
    while (this.index.schemaVersion < STORE_SCHEMA) {
      const from = this.index.schemaVersion
      await MIGRATIONS[from]?.(this)
      this.index.schemaVersion = from + 1
      await this.writeIndex()
      logDebug(`Migrated storage schema ${from} → ${from + 1}`)
    }

    // Orphans: old indexes, and revisions the index doesn't point at.
    for (const seq of seqs) if (seq !== this.index.seq) await this.backend.remove(indexName(seq))
    const live = new Set(Object.values(this.index.files).map(filePath))
    for (const n of await this.backend.list('files')) {
      if (!live.has(`files/${n}`)) await this.backend.remove(`files/${n}`)
    }
  }

  private async writeIndex() {
    const prev = this.index.seq
    const next = prev + 1
    await this.backend.write(indexName(next), JSON.stringify({ ...this.index, seq: next }))
    this.index.seq = next
    if (prev > 0) await this.backend.remove(indexName(prev))
  }

  private guard() {
    if (this.readOnly) throw new Error(storeState.lastError || 'Storage is read-only')
  }

  list(prefix = ''): FileMeta[] {
    return Object.values(this.index.files)
      .filter((m) => m.id.startsWith(prefix))
      .sort((a, b) => a.id.localeCompare(b.id))
  }

  has(id: string): boolean {
    return id in this.index.files
  }

  async read(id: string): Promise<string | null> {
    const m = this.index.files[id]
    if (!m) return null
    return this.backend.read(filePath(m))
  }

  async readJSON<T>(id: string): Promise<T | null> {
    const t = await this.read(id)
    return t == null ? null : (JSON.parse(t) as T)
  }

  /** Create or replace a file (safe save). */
  write(id: string, text: string, ext = 'json'): Promise<FileMeta> {
    return this.enqueue(async () => {
      this.guard()
      const prev = this.index.files[id]
      const meta: FileMeta = {
        id,
        ext,
        rev: (prev?.rev ?? 0) + 1,
        size: text.length,
        updatedAt: new Date().toISOString(),
      }
      await this.backend.write(filePath(meta), text) // 1. full new revision, flushed
      this.index.files[id] = meta
      try {
        await this.writeIndex() // 2. index now points at it
      } catch (e) {
        if (prev) this.index.files[id] = prev
        else delete this.index.files[id]
        await this.backend.remove(filePath(meta)).catch(() => {})
        throw e
      }
      if (prev) await this.backend.remove(filePath(prev)) // 3. old revision goes
      return meta
    })
  }

  writeJSON(id: string, value: unknown): Promise<FileMeta> {
    return this.write(id, JSON.stringify(value), 'json')
  }

  remove(id: string): Promise<void> {
    return this.enqueue(async () => {
      this.guard()
      const prev = this.index.files[id]
      if (!prev) return
      delete this.index.files[id]
      await this.writeIndex()
      await this.backend.remove(filePath(prev))
    })
  }

  /** Resolves once every write queued so far has finished (successfully or not). */
  async flush(): Promise<void> {
    let q: Promise<unknown>
    do {
      q = this.queue
      await q.catch(() => {})
    } while (q !== this.queue)
  }

  // -------------------------------------------------------------- export / import

  async exportZip(): Promise<Uint8Array> {
    await this.flush()
    const entries: Record<string, Uint8Array> = {}
    const files = this.list()
    for (const m of files) {
      const t = await this.read(m.id)
      if (t != null) entries[`files/${encId(m.id)}.${m.ext}`] = strToU8(t)
    }
    const manifest = {
      app: APP_ID,
      schemaVersion: this.index.schemaVersion,
      exportedAt: new Date().toISOString(),
      files: files.map(({ id, ext, updatedAt }) => ({ id, ext, updatedAt })),
    }
    entries['index.json'] = strToU8(JSON.stringify(manifest, null, 2))
    return zipSync(entries, { level: 6 })
  }

  /** Validate a bundle and return its files without writing anything. */
  static readZip(bytes: Uint8Array): { files: { id: string; ext: string; text: string }[]; exportedAt: string } {
    let entries: Record<string, Uint8Array>
    try {
      entries = unzipSync(bytes)
    } catch {
      throw new Error('That file isn’t a valid backup (couldn’t unzip it).')
    }
    if (!entries['index.json']) throw new Error('That zip has no index.json, so it isn’t a backup from this app.')
    const manifest = JSON.parse(strFromU8(entries['index.json'])) as {
      app?: string
      schemaVersion?: number
      exportedAt?: string
      files?: { id: string; ext: string }[]
    }
    if (manifest.app !== APP_ID || !Array.isArray(manifest.files)) {
      throw new Error('That backup was made by a different app.')
    }
    if ((manifest.schemaVersion ?? 0) > STORE_SCHEMA) {
      throw new Error('That backup was made by a newer version of the app. Tap “Reload latest” first.')
    }
    const files = manifest.files.map((f) => {
      const data = entries[`files/${encId(f.id)}.${f.ext}`]
      if (!data) throw new Error(`Backup is missing ${f.id}.`)
      return { id: f.id, ext: f.ext, text: strFromU8(data) }
    })
    return { files, exportedAt: manifest.exportedAt ?? '' }
  }

  /** Write a validated bundle. 'replace' removes files not in the bundle. */
  async importFiles(files: { id: string; ext: string; text: string }[], mode: 'merge' | 'replace'): Promise<number> {
    if (mode === 'replace') {
      const keep = new Set(files.map((f) => f.id))
      for (const m of this.list()) if (!keep.has(m.id)) await this.remove(m.id)
    }
    for (const f of files) await this.write(f.id, f.text, f.ext)
    await this.flush()
    if (storeState.saveState === 'error') throw new Error(storeState.lastError)
    return files.length
  }
}

// ---------------------------------------------------------------- singleton + init

let instance: Store | null = null
let initPromise: Promise<Store> | null = null

export function getStore(): Store {
  if (!instance) throw new Error('Store used before init()')
  return instance
}

async function pickBackend(): Promise<Backend> {
  if (typeof Worker !== 'undefined' && typeof navigator.storage?.getDirectory === 'function') {
    try {
      const b = new WorkerBackend()
      await b.call({ op: 'ping' }, 5000)
      // Probe the sync-access write path once; some browsers expose OPFS without it.
      await b.write('tmp/probe', 'ok')
      storeState.backend = 'opfs'
      return b
    } catch (e) {
      logDebug(`File storage unavailable (${(e as Error).message}) — using memory only.`, 'error')
    }
  }
  storeState.backend = 'memory'
  storeState.saveState = 'error'
  storeState.lastError =
    'This browser can’t store files for the app, so nothing you enter will be kept. Install the app to your Home Screen, or use Safari, Chrome or Edge.'
  return new MemoryBackend()
}

export function init(): Promise<Store> {
  if (initPromise) return initPromise
  initPromise = (async () => {
    const store = new Store(await pickBackend())
    try {
      await store.load()
    } catch (e) {
      storeState.saveState = 'error'
      storeState.lastError = (e as Error).message
      logDebug(`Storage load failed: ${(e as Error).message}`, 'error')
    }
    instance = store
    try {
      storeState.lastExport = localStorage.getItem('lastExport')
    } catch {
      /* private mode */
    }
    await requestPersistence()
    await refreshHealth()
    storeState.ready = true
    return store
  })()
  return initPromise
}

export function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

async function requestPersistence() {
  try {
    if (!navigator.storage?.persisted) return
    if (!(await navigator.storage.persisted())) await navigator.storage.persist?.()
  } catch (e) {
    logDebug(`persist() failed: ${(e as Error).message}`, 'warn')
  }
}

export async function refreshHealth() {
  storeState.health.installed = isStandalone()
  try {
    storeState.health.persisted = (await navigator.storage?.persisted?.()) ?? null
    const est = await navigator.storage?.estimate?.()
    storeState.health.usageBytes = est?.usage ?? null
    storeState.health.quotaBytes = est?.quota ?? null
  } catch {
    /* not supported */
  }
}

export function markUnsaved(key: string, on: boolean) {
  const i = storeState.unsaved.indexOf(key)
  if (on && i < 0) storeState.unsaved.push(key)
  if (!on && i >= 0) storeState.unsaved.splice(i, 1)
}

/** True when nothing is being written and no on-screen draft is unsaved. */
export function isQuiet(): boolean {
  return storeState.pendingWrites === 0 && storeState.unsaved.length === 0
}

export function noteExported() {
  const now = new Date().toISOString()
  storeState.lastExport = now
  try {
    localStorage.setItem('lastExport', now)
  } catch {
    /* private mode */
  }
}
