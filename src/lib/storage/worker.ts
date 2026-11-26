/// <reference lib="webworker" />
// OPFS file operations, run in a dedicated Web Worker.
//
// Writes use FileSystemFileHandle.createSyncAccessHandle() (truncate → write →
// flush → close). That's the write path Safari supports dependably; the
// main-thread createWritable() is missing or flaky on older iOS.
//
// This worker is deliberately dumb: paths in, bytes out. The safe-save
// protocol (new revision, then index, then delete old) lives in store.ts.

export type WorkerRequest =
  | { id: number; op: 'ping' }
  | { id: number; op: 'read'; path: string }
  | { id: number; op: 'write'; path: string; text: string }
  | { id: number; op: 'remove'; path: string }
  | { id: number; op: 'list'; dir: string }
  | { id: number; op: 'listAll'; dir: string }
  | { id: number; op: 'clear'; dir: string }

export type WorkerResponse = { id: number; ok: true; result?: unknown } | { id: number; ok: false; error: string }

type SyncHandle = {
  truncate(n: number): void
  write(buf: ArrayBufferView, opts?: { at?: number }): number
  flush(): void
  close(): void
}

async function dirFor(path: string, create: boolean): Promise<{ dir: FileSystemDirectoryHandle; name: string }> {
  const parts = path.split('/').filter(Boolean)
  const name = parts.pop()!
  let dir = await navigator.storage.getDirectory()
  for (const p of parts) dir = await dir.getDirectoryHandle(p, { create })
  return { dir, name }
}

async function getDir(path: string, create: boolean): Promise<FileSystemDirectoryHandle> {
  let dir = await navigator.storage.getDirectory()
  for (const p of path.split('/').filter(Boolean)) dir = await dir.getDirectoryHandle(p, { create })
  return dir
}

const enc = new TextEncoder()

async function handle(req: WorkerRequest): Promise<unknown> {
  switch (req.op) {
    case 'ping':
      await navigator.storage.getDirectory()
      return 'pong'

    case 'read': {
      try {
        const { dir, name } = await dirFor(req.path, false)
        const fh = await dir.getFileHandle(name)
        return await (await fh.getFile()).text()
      } catch (e) {
        if ((e as DOMException)?.name === 'NotFoundError') return null
        throw e
      }
    }

    case 'write': {
      const { dir, name } = await dirFor(req.path, true)
      const fh = await dir.getFileHandle(name, { create: true })
      const access = (await (fh as unknown as { createSyncAccessHandle(): Promise<SyncHandle> }).createSyncAccessHandle())
      try {
        const bytes = enc.encode(req.text)
        access.truncate(0)
        let at = 0
        while (at < bytes.byteLength) at += access.write(bytes.subarray(at), { at })
        access.flush()
      } finally {
        access.close()
      }
      return true
    }

    case 'remove': {
      try {
        const { dir, name } = await dirFor(req.path, false)
        await dir.removeEntry(name)
      } catch (e) {
        if ((e as DOMException)?.name !== 'NotFoundError') throw e
      }
      return true
    }

    case 'list': {
      try {
        const dir = await getDir(req.dir, false)
        const names: string[] = []
        // @ts-expect-error — async iteration of directory handles isn't in every lib.dom version
        for await (const [n, h] of dir.entries()) if ((h as FileSystemHandle).kind === 'file') names.push(n)
        return names
      } catch (e) {
        if ((e as DOMException)?.name === 'NotFoundError') return []
        throw e
      }
    }

    case 'listAll': {
      const out: string[] = []
      async function walk(dir: FileSystemDirectoryHandle, prefix: string) {
        // @ts-expect-error — see above
        for await (const [n, h] of dir.entries()) {
          if ((h as FileSystemHandle).kind === 'file') out.push(prefix + n)
          else await walk(h as FileSystemDirectoryHandle, `${prefix}${n}/`)
        }
      }
      try {
        await walk(await getDir(req.dir, false), '')
      } catch (e) {
        if ((e as DOMException)?.name !== 'NotFoundError') throw e
      }
      return out
    }

    case 'clear': {
      const dir = await getDir(req.dir, true)
      const names: string[] = []
      // @ts-expect-error — see above
      for await (const [n] of dir.entries()) names.push(n)
      for (const n of names) await dir.removeEntry(n, { recursive: true })
      return names.length
    }
  }
}

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data
  try {
    const result = await handle(req)
    ;(self as unknown as Worker).postMessage({ id: req.id, ok: true, result } satisfies WorkerResponse)
  } catch (e) {
    const err = e as Error
    ;(self as unknown as Worker).postMessage({
      id: req.id,
      ok: false,
      error: `${err?.name ?? 'Error'}: ${err?.message ?? String(e)}`,
    } satisfies WorkerResponse)
  }
}
