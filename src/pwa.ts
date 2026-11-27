import { ref, watch } from 'vue'
import { useRegisterSW } from 'virtual:pwa-register/vue'
import { getStore, isQuiet, storeState } from './lib/storage/store'
import { logDebug } from './debug'

async function flushStore() {
  try {
    await getStore().flush()
  } catch {
    /* store not initialised yet: nothing to flush */
  }
}

// A composable (useRegisterSW needs a component), so call it from App.vue's setup.
//
// registerType is 'prompt' (vite.config.ts), so a new service worker waits
// until we say so. We apply it only when nothing is being written and no
// on-screen draft is unsaved; otherwise the header shows "Update ready" and
// the update goes in after the next save or when the user taps it.
export function setupPWAUpdates(onResume?: () => void) {
  let registration: ServiceWorkerRegistration | undefined

  const { needRefresh, updateServiceWorker } = useRegisterSW({
    immediate: true,
    onRegisteredSW(_url, reg) {
      registration = reg
      // iOS keeps installed PWAs alive for a long time; without a periodic
      // update check an open app never notices a deploy.
      if (reg) setInterval(() => reg.update().catch(() => {}), 60_000)
    },
  })

  /** True while a downloaded update is waiting for a quiet moment. */
  const updateWaiting = ref(false)
  let applying = false

  /**
   * Switch to the waiting worker and reload. updateServiceWorker(true) reloads
   * only when the new worker reports it has taken control, and installed iOS
   * apps often never report it: the page stays put. So give it a few seconds,
   * then fall back to the forced reload. The flag is always released, so a
   * later tap can try again (it used to stay set, and taps did nothing).
   */
  async function applyUpdate() {
    if (applying) return
    applying = true
    try {
      await flushStore()
      logDebug('Applying app update…')
      await Promise.race([updateServiceWorker(true), new Promise((r) => setTimeout(r, 3000))])
      await new Promise((r) => setTimeout(r, 1500))
      // Still here: the switch didn't reload the page.
      logDebug('Update didn’t reload by itself; forcing a reload.', 'warn')
      await reloadLatest()
    } finally {
      applying = false
    }
  }

  function tryApply() {
    if (needRefresh.value && isQuiet()) void applyUpdate()
  }

  watch(needRefresh, (ready) => {
    updateWaiting.value = ready
    if (ready) tryApply()
  })
  // "apply after the next successful save": re-check whenever writes or drafts settle.
  watch(
    () => [storeState.pendingWrites, storeState.unsaved.length, storeState.saveState],
    () => {
      if (storeState.saveState !== 'error') tryApply()
    },
  )

  // iOS freezes timers in the background, so check again on resume.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return
    registration?.update().catch(() => {})
    onResume?.()
  })

  // The manual path. A polite updateServiceWorker(true) + reload often lands on
  // the same version on iOS: the old worker keeps control and replays the
  // precached bundle. This only runs when the user asked and version.json said
  // a newer build is live, so drop the worker and every Cache Storage entry.
  //
  // DATA SAFETY: this touches ONLY the service worker and Cache Storage. It
  // never touches OPFS (the user's files), IndexedDB or localStorage. Pending
  // writes are flushed first so a reload can't cut a save short.
  async function reloadLatest() {
    await flushStore()
    try {
      const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? []
      await Promise.all(regs.map((r) => r.unregister()))
      if (typeof caches !== 'undefined') {
        await Promise.all((await caches.keys()).map((k) => caches.delete(k)))
      }
    } finally {
      const url = new URL(location.href)
      url.searchParams.set('fresh', Date.now().toString())
      location.replace(url.toString())
    }
  }

  return { reloadLatest, updateWaiting, applyUpdate }
}
