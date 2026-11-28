// Vue-facing side of the store: reactive save state, health, and the
// export/import flows (which need the DOM: share sheet, file picker, download).

import { computed } from 'vue'
import { type Store, getStore, init, noteExported, refreshHealth, storeState } from './store'
import { logDebug } from '../../debug'
import { today } from '../money'

export function useStore() {
  const saveState = computed(() => storeState.saveState)
  const needsInstallWarning = computed(
    () => storeState.ready && (!storeState.health.installed || storeState.health.persisted === false),
  )
  /** Your data's real size, e.g. "3.3 KB in 6 files" (measured from the files, not the browser). */
  const dataLabel = computed(() => {
    const d = storeState.data
    return `${formatBytes(d.bytes)} in ${d.files} file${d.files === 1 ? '' : 's'}`
  })
  const daysSinceExport = computed(() => {
    if (!storeState.lastExport) return null
    return Math.floor((Date.now() - Date.parse(storeState.lastExport)) / 86_400_000)
  })
  return { state: storeState, saveState, needsInstallWarning, dataLabel, daysSinceExport, init, refreshHealth }
}

export function formatBytes(n: number | null): string {
  if (n == null) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`
}

/**
 * Export everything as a zip and hand it to the user:
 * iOS/Android → share sheet ("Save to Files"); desktop Chromium → save dialog;
 * anything else → a download.
 */
export async function exportAll(): Promise<'shared' | 'saved' | 'downloaded' | 'cancelled'> {
  const store: Store = getStore()
  const bytes = await store.exportZip()
  const name = `ledgerful-backup-${today()}.zip`
  const blob = new Blob([bytes as BlobPart], { type: 'application/zip' })
  const file = new File([blob], name, { type: 'application/zip' })

  const nav = navigator as Navigator & { canShare?(d: ShareData): boolean }
  const touch = matchMedia?.('(pointer: coarse)').matches
  if (touch && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: 'Ledgerful backup' })
      noteExported()
      return 'shared'
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return 'cancelled'
      logDebug(`Share failed, falling back to download: ${(e as Error).message}`, 'warn')
    }
  }

  const w = window as Window & {
    showSaveFilePicker?: (o: unknown) => Promise<FileSystemFileHandle>
  }
  if (w.showSaveFilePicker) {
    try {
      const h = await w.showSaveFilePicker({
        suggestedName: name,
        types: [{ description: 'Backup zip', accept: { 'application/zip': ['.zip'] } }],
      })
      const ws = await (h as FileSystemFileHandle & { createWritable(): Promise<FileSystemWritableFileStream> }).createWritable()
      await ws.write(blob)
      await ws.close()
      noteExported()
      return 'saved'
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return 'cancelled'
      logDebug(`Save dialog failed, falling back to download: ${(e as Error).message}`, 'warn')
    }
  }

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  noteExported()
  return 'downloaded'
}
