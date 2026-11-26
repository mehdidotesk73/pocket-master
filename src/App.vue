<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import HelpModal from './components/HelpModal.vue'
import InstallHint from './components/InstallHint.vue'
import { debugState, logDebug, logAsText } from './debug'
import { setupPWAUpdates } from './pwa'
import { useVersionCheck } from './lib/useVersionCheck'
import { refreshHealth } from './lib/storage/store'
import { useStore } from './lib/storage/useStore'
import { loadTracker, useTracker } from './features/tracker/useTracker'
import TodayView from './features/tracker/TodayView.vue'
import ProjectionView from './features/tracker/ProjectionView.vue'
import HistoryView from './features/tracker/HistoryView.vue'
import SetupView from './features/tracker/SetupView.vue'

const buildId = __BUILD_ID__
const buildTime = __BUILD_TIME__
const showDebug = ref(false)
const copied = ref(false)

// Update available affordance: shown when the origin serves a different build
// (version.json) or a downloaded service worker is waiting for a quiet moment.
const { status: versionStatus, published, checkNow } = useVersionCheck()
const { reloadLatest, updateWaiting, applyUpdate } = setupPWAUpdates(() => {
  checkNow()
  refreshHealth()
})
const updateAvailable = computed(() => versionStatus.value === 'update-ready' || updateWaiting.value)

// ---- app state: storage + tracker
const { state: store, needsInstallWarning, usageLabel } = useStore()
const { loaded, records, loadError } = useTracker()
onMounted(() => loadTracker())

type Tab = 'today' | 'projection' | 'history' | 'setup'
const TABS: { id: Tab; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'projection', label: 'Projection' },
  { id: 'history', label: 'History' },
  { id: 'setup', label: 'Setup' },
]
function initialTab(): Tab {
  try {
    const t = localStorage.getItem('tab') as Tab | null
    if (t && TABS.some((x) => x.id === t)) return t
  } catch {
    /* private mode */
  }
  return 'today'
}
const tab = ref<Tab>(initialTab())
function go(t: Tab) {
  tab.value = t
  try {
    localStorage.setItem('tab', t)
  } catch {
    /* private mode */
  }
  window.scrollTo({ top: 0 })
}
const helpForTab: Record<Tab, string> = { today: 'today', projection: 'projection', history: 'history', setup: 'setup' }
const showUpdatePanel = ref(false)
const updateSlot = ref<HTMLElement>()
const alreadyLatest = ref(false)

function onDocClickUpdate(e: MouseEvent) {
  if (showUpdatePanel.value && updateSlot.value && !updateSlot.value.contains(e.target as Node)) {
    showUpdatePanel.value = false
  }
}
onMounted(() => document.addEventListener('click', onDocClickUpdate))
onBeforeUnmount(() => document.removeEventListener('click', onDocClickUpdate))

const errorCount = computed(() => debugState.logs.filter((l) => l.kind === 'error').length)

// Copy the log so the user can paste it back to Claude. This is the only
// channel from a phone with no console, so it gets a fallback: clipboard.*
// needs a secure context, and a silent failure here loses the whole report.
async function copyLog() {
  const text = logAsText(buildId, buildTime)
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0'
    document.body.appendChild(ta)
    ta.select()
    ta.setSelectionRange(0, text.length) // iOS ignores select() alone
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    if (!ok) {
      logDebug('Could not copy automatically — select the log text and copy it by hand.', 'warn')
      return
    }
  }
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}

// Reload to latest build. Ask the origin first: if we're already current,
// say so instead of reloading into the same version. 'unknown' (offline, or
// `vite dev`) falls through to the forced reload.
async function onReloadLatest() {
  if ((await checkNow()) === 'current') {
    alreadyLatest.value = true
    setTimeout(() => (alreadyLatest.value = false), 2000)
    return
  }
  // A worker already downloaded and waiting: just switch to it.
  if (updateWaiting.value) {
    await applyUpdate()
    return
  }
  logDebug('Reloading to latest build...')
  await reloadLatest()
}

// Help modal state
const showHelp = ref(false)
const helpDoc = ref('overview')
function openHelp() {
  helpDoc.value = helpForTab[tab.value]
  showHelp.value = true
}
</script>

<template>
  <main class="app">
    <header>
      <div class="title-row">
        <div class="update-slot" ref="updateSlot">
          <button
            v-if="updateAvailable"
            class="update-btn"
            @click="showUpdatePanel = !showUpdatePanel"
          >
            Update available
          </button>
          <div
            v-if="showUpdatePanel && updateAvailable"
            class="update-pop"
            role="dialog"
          >
            <div class="up-line">running {{ buildId }} · {{ buildTime }}</div>
            <div v-if="published" class="up-line">live {{ published.commit }} · {{ published.builtAt }}</div>
            <div v-if="store.unsaved.length" class="up-line">Finish or discard your edits first, or tap to update now.</div>
            <button class="reload-btn update-ready" @click="onReloadLatest">
              Update ready — Reload
            </button>
          </div>
        </div>
        <h1 class="app-title">Pocket Master</h1>
        <button class="help-btn" @click="openHelp" aria-label="Help" title="Help">
          ? Help
        </button>
      </div>
    </header>

    <nav class="tabs" aria-label="Sections">
      <button
        v-for="t in TABS"
        :key="t.id"
        :class="{ on: tab === t.id }"
        :aria-current="tab === t.id ? 'page' : undefined"
        @click="go(t.id)"
      >
        {{ t.label }}
      </button>
    </nav>

    <div class="content">
      <InstallHint v-if="loaded" :has-data="records.length > 0" />

      <p v-if="store.saveState === 'error'" class="store-error" role="alert">
        {{ store.lastError || 'Saving failed.' }} Tap <b>View logs</b> below for details.
      </p>
      <p v-if="loadError" class="store-error" role="alert">Couldn’t load your data: {{ loadError }}</p>

      <div v-if="!loaded" class="loading muted">Loading your data…</div>
      <template v-else>
        <TodayView v-if="tab === 'today'" @go="go" />
        <ProjectionView v-else-if="tab === 'projection'" />
        <HistoryView v-else-if="tab === 'history'" />
        <SetupView v-else />
      </template>
    </div>

    <footer class="debug">
      <div class="debug-bar">
        <span class="build-stamp">
          build {{ buildId }} · {{ buildTime }}
          <template v-if="versionStatus === 'current'"> · up to date</template>
          <template v-else-if="updateAvailable"> · {{ published?.commit ?? 'update' }} is ready</template>
          <br />
          <span class="save-state" :class="store.saveState">
            {{ store.saveState === 'saving' ? 'Saving…' : store.saveState === 'error' ? 'Save failed' : 'Saved' }}
          </span>
          · {{ store.health.installed ? 'installed' : 'browser tab' }}
          · {{ store.health.persisted ? 'persistent' : store.health.persisted === false ? 'not persistent' : 'persistence unknown' }}
          · {{ usageLabel }} used
        </span>

        <button
          class="reload-btn logs-btn"
          :class="{ 'has-errors': errorCount > 0 }"
          @click="showDebug = !showDebug"
        >
          {{ showDebug ? 'Hide logs' : 'View logs' }}
          <span v-if="errorCount" class="err-count">{{ errorCount }}</span>
        </button>

        <button
          class="reload-btn"
          :class="{ 'update-ready': updateAvailable }"
          @click="onReloadLatest"
        >
          {{
            alreadyLatest
              ? 'Already on the latest build ✓'
              : updateAvailable
                ? 'Update ready — Reload'
                : 'Reload latest'
          }}
        </button>
      </div>

      <p v-if="needsInstallWarning" class="storage-warn">
        Your files could be cleared by the browser. Install to Home Screen to keep them.
      </p>

      <div v-if="showDebug" class="log-window">
        <div class="log-head">
          <span class="muted">
            {{ debugState.logs.length }} {{ debugState.logs.length === 1 ? 'entry' : 'entries' }}
          </span>
          <button class="reload-btn" @click="copyLog">
            {{ copied ? 'Copied ✓' : 'Copy log' }}
          </button>
        </div>
        <p class="log-hint muted">
          Something not working? Tap <strong>Copy log</strong> and paste it to Claude.
        </p>
        <ul class="debug-log">
          <li v-if="!debugState.logs.length" class="muted">No log entries yet.</li>
          <li v-for="(l, i) in debugState.logs" :key="i" :class="l.kind">
            <span class="muted">{{ l.time }}</span> {{ l.msg
            }}<span v-if="l.count > 1" class="repeat">×{{ l.count }}</span>
          </li>
        </ul>
      </div>
    </footer>

    <HelpModal :open="showHelp" :initial-doc="helpDoc" @close="showHelp = false" />
  </main>
</template>

<style scoped>
.app {
  max-width: 60rem;
  margin: 0 auto;
  padding: max(0.75rem, env(safe-area-inset-top)) max(1rem, env(safe-area-inset-right))
    max(1.25rem, env(safe-area-inset-bottom)) max(1rem, env(safe-area-inset-left));
}

.tabs {
  position: sticky;
  top: 0;
  z-index: 30;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.25rem;
  padding: 0.35rem;
  margin: 0 -0.25rem;
  background: color-mix(in srgb, var(--bg) 92%, transparent);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--line);
}

.tabs button {
  min-height: var(--tap);
  border: none;
  border-radius: 0.5rem;
  background: transparent;
  color: var(--mute);
  font-weight: 700;
  font-size: 0.92rem;
  padding: 0 0.25rem;
}

.tabs button.on {
  background: var(--panel-2);
  color: var(--ink);
  box-shadow: inset 0 -2px 0 var(--accent);
}

.store-error {
  margin: 0 0 1rem;
  padding: 0.6rem 0.75rem;
  border: 1px solid var(--negative);
  border-radius: 0.6rem;
  color: var(--ink);
  background: color-mix(in srgb, var(--negative) 15%, transparent);
  font-size: 0.9rem;
}

.storage-warn {
  margin: 0.4rem 0 0;
  font-size: 0.75rem;
  color: var(--projection);
}

.save-state.saving {
  color: var(--projection);
}

.save-state.error {
  color: var(--negative);
  font-weight: 700;
}

.loading {
  padding: 3rem 0;
  text-align: center;
}

.title-row {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.6rem;
}

.app-title {
  grid-column: 2;
  justify-self: center;
  margin: 0;
  font-family: var(--font-display);
  font-weight: 800;
  font-size: clamp(1.15rem, 4.5vw, 1.5rem);
  line-height: 1.1;
  white-space: nowrap;
}

.update-slot {
  grid-column: 1;
  justify-self: start;
  align-self: start;
  position: relative;
}

.update-btn {
  background: var(--bg-elev-2);
  border: 1px solid var(--accent-blue);
  color: var(--text);
  font-weight: 600;
  font-size: 0.78rem;
  padding: 0.3rem 0.6rem;
  border-radius: 0.4rem;
  cursor: pointer;
  white-space: nowrap;
}

.update-btn:hover {
  background: var(--accent-blue);
  border-color: var(--accent-blue);
  color: #fff;
}

.update-pop {
  position: absolute;
  top: calc(100% + 0.35rem);
  left: 0;
  z-index: 70;
  width: max-content;
  max-width: min(18rem, calc(100vw - 1rem));
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding: 0.6rem 0.7rem;
  background: var(--bg-elev);
  border: 1px solid var(--accent-blue);
  border-radius: 0.4rem;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
}

.up-line {
  font-size: 0.72rem;
  color: var(--text-muted);
}

.help-btn {
  grid-column: 3;
  justify-self: end;
  align-self: start;
  background: var(--bg-elev-2, transparent);
  border: 1px solid var(--border);
  color: var(--text-muted);
  font-size: 0.78rem;
  padding: 0.3rem 0.6rem;
  border-radius: 0.4rem;
  cursor: pointer;
}

.help-btn:hover {
  color: var(--text);
  border-color: var(--accent-blue);
}

.content {
  padding: 1rem 0;
  min-height: 60vh;
}

.muted {
  color: var(--text-muted);
  font-weight: 400;
  font-size: 0.85rem;
}

.debug {
  margin-top: 1.5rem;
  border-top: 1px solid var(--border);
  padding-top: 0.5rem;
}

.debug-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.build-stamp {
  color: var(--text-muted);
  font-size: 0.72rem;
  margin-right: auto;
}

/* An error the user can't notice is an error they won't report — so the
   button that opens the log carries the count, in the danger colour. */
.logs-btn.has-errors {
  border-color: var(--danger);
  color: var(--danger);
  font-weight: 600;
}

.err-count {
  display: inline-block;
  min-width: 1.05rem;
  margin-left: 0.3rem;
  padding: 0 0.25rem;
  border-radius: 999px;
  background: var(--danger);
  color: #fff;
  font-size: 0.65rem;
  line-height: 1.05rem;
  text-align: center;
}

.log-window {
  margin-top: 0.5rem;
}

.log-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.log-hint {
  margin: 0.25rem 0 0;
  font-size: 0.7rem;
}

.repeat {
  margin-left: 0.35rem;
  opacity: 0.65;
}

.reload-btn {
  font-size: 0.72rem;
  padding: 0.15rem 0.5rem;
  background: var(--bg-elev-2);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 0.4rem;
  cursor: pointer;
}

.reload-btn.update-ready {
  border-color: var(--accent-blue);
  color: var(--text);
  font-weight: 600;
}

.debug-log {
  list-style: none;
  padding: 0.5rem;
  margin: 0.4rem 0 0;
  background: #050a1c;
  color: #cdd3e0;
  border: 1px solid var(--border);
  border-radius: 0.4rem;
  font-family: ui-monospace, monospace;
  font-size: 0.7rem;
  line-height: 1.5;
  max-height: 12rem;
  overflow: auto;
}

.debug-log .error {
  color: var(--danger);
}

.debug-log .warn {
  color: #ff9800;
}

.help-btn,
.update-btn {
  min-height: 36px;
}

.reload-btn {
  min-height: 32px;
}
</style>
