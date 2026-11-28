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
import { ChevronDown, CircleHelp, History, Menu, Moon, Sun, TrendingUp, Wallet } from '@lucide/vue'
import SideMenu from './components/SideMenu.vue'
import { useTheme } from './lib/useTheme'
import { THEMES } from './lib/themes'
import TodayView from './features/tracker/TodayView.vue'
import FutureView from './features/tracker/FutureView.vue'
import HistoryView from './features/tracker/HistoryView.vue'
import BackupModal from './features/tracker/BackupModal.vue'

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
const { state: store, needsInstallWarning, dataLabel } = useStore()
const { loaded, records, loadError } = useTracker()
onMounted(() => loadTracker())

type Tab = 'past' | 'present' | 'future'
const TABS: { id: Tab; label: string; icon: typeof History }[] = [
  { id: 'past', label: 'Past', icon: History },
  { id: 'present', label: 'Present', icon: Wallet },
  { id: 'future', label: 'Future', icon: TrendingUp },
]
function initialTab(): Tab {
  try {
    const t = localStorage.getItem('tab') as Tab | null
    if (t && TABS.some((x) => x.id === t)) return t
  } catch {
    /* private mode */
  }
  return 'present'
}
// Side menu (☰) and the Export / Import sheet it opens.
const showMenu = ref(false)
const transfer = ref<'export' | 'import' | null>(null)
function openTransfer(section: 'export' | 'import') {
  showMenu.value = false
  transfer.value = section
}

// ---- look: Dark / Light flips between the chosen looks; the menu picks one (as in the editor)
const { theme, mode, chosen, setTheme, toggleTheme } = useTheme()
const showThemeMenu = ref(false)
const themeGroup = ref<HTMLElement>()
const themeGroups = [
  { mode: 'dark' as const, label: 'Dark looks', items: THEMES.filter((t) => t.mode === 'dark') },
  { mode: 'light' as const, label: 'Light looks', items: THEMES.filter((t) => t.mode === 'light') },
]
function chooseTheme(id: string) {
  setTheme(id)
  showThemeMenu.value = false
}
function onDocClickTheme(e: MouseEvent) {
  if (showThemeMenu.value && themeGroup.value && !themeGroup.value.contains(e.target as Node)) showThemeMenu.value = false
}
onMounted(() => document.addEventListener('click', onDocClickTheme))
onBeforeUnmount(() => document.removeEventListener('click', onDocClickTheme))
const tab = ref<Tab>(initialTab())
/** Where the selected pill sits (0–2), and which way the page content slides in. */
const tabIndex = computed(() => TABS.findIndex((x) => x.id === tab.value))
const tabDir = ref<'fwd' | 'back'>('fwd')
function go(t: Tab) {
  tabDir.value = TABS.findIndex((x) => x.id === t) >= tabIndex.value ? 'fwd' : 'back'
  tab.value = t
  try {
    localStorage.setItem('tab', t)
  } catch {
    /* private mode */
  }
  window.scrollTo({ top: 0 })
}
const helpForTab: Record<Tab, string> = { past: 'past', present: 'present', future: 'future' }
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
  // A worker already downloaded and waiting: switch to it (falls back to a forced reload).
  if (updateWaiting.value) {
    await applyUpdate()
    return
  }
  if ((await checkNow()) === 'current') {
    alreadyLatest.value = true
    setTimeout(() => (alreadyLatest.value = false), 2000)
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
        <div class="head-left">
        <button
          class="head-btn"
          aria-label="Menu"
          title="Menu"
          :aria-expanded="showMenu"
          @click="showMenu = true"
        >
          <Menu class="ic" aria-hidden="true" />
        </button>
        <div class="update-slot" ref="updateSlot">
          <button
            v-if="updateAvailable"
            class="update-btn"
            @click="showUpdatePanel = !showUpdatePanel"
          >
            Update
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
        </div>
        <h1 class="app-title">Pocket Master</h1>
        <div class="head-right">
          <div ref="themeGroup" class="split-group" @keydown.esc="showThemeMenu = false">
            <button
              class="head-btn"
              :title="`Look: ${theme.label}. Tap for your ${mode === 'light' ? 'dark' : 'light'} look.`"
              :aria-label="`Switch to your ${mode === 'light' ? 'dark' : 'light'} look`"
              @click="toggleTheme"
            >
              <component :is="mode === 'light' ? Sun : Moon" class="ic" aria-hidden="true" />
            </button>
            <button
              class="head-btn narrow"
              :class="{ active: showThemeMenu }"
              :aria-expanded="showThemeMenu"
              aria-haspopup="menu"
              :aria-label="`Look: ${theme.label}. Choose another`"
              :title="`Look: ${theme.label}`"
              @click="showThemeMenu = !showThemeMenu"
            >
              <ChevronDown class="ic" aria-hidden="true" />
            </button>
            <div v-if="showThemeMenu" class="pop-menu theme-menu" role="menu" aria-label="Look">
              <template v-for="g in themeGroups" :key="g.mode">
                <span class="pop-menu-title">{{ g.label }}</span>
                <button
                  v-for="t in g.items"
                  :key="t.id"
                  class="pop-option"
                  :class="{ active: theme.id === t.id }"
                  role="menuitemradio"
                  :aria-checked="theme.id === t.id"
                  :title="chosen[t.mode] === t.id && theme.id !== t.id ? `Your ${t.mode} look` : undefined"
                  @click="chooseTheme(t.id)"
                >
                  <span class="swatch" :style="{ background: t.bg, color: t.swatch }" aria-hidden="true">●</span>
                  {{ t.label }}
                </button>
              </template>
            </div>
          </div>
          <button class="head-btn" aria-label="Help" title="Help" @click="openHelp">
            <CircleHelp class="ic" aria-hidden="true" />
          </button>
        </div>
      </div>
    </header>

    <nav class="tabs" aria-label="Sections">
      <div class="seg" :style="{ '--i': tabIndex }">
        <!-- the selected pill slides between tabs; a second, slower one trails it so it stretches as it moves -->
        <span class="pill trail" aria-hidden="true"></span>
        <span class="pill" aria-hidden="true"></span>
        <button
          v-for="t in TABS"
          :key="t.id"
          :class="{ on: tab === t.id }"
          :aria-current="tab === t.id ? 'page' : undefined"
          @click="go(t.id)"
        >
          <component :is="t.icon" class="tab-ic" aria-hidden="true" />{{ t.label }}
        </button>
      </div>
    </nav>

    <div class="content">
      <InstallHint v-if="loaded" :has-data="records.length > 0" />

      <p v-if="store.saveState === 'error'" class="store-error" role="alert">
        {{ store.lastError || 'Saving failed.' }} Tap <b>View logs</b> below for details.
      </p>
      <p v-if="loadError" class="store-error" role="alert">Couldn’t load your data: {{ loadError }}</p>

      <div v-if="!loaded" class="loading muted">Loading your data…</div>
      <Transition v-else :name="`page-${tabDir}`" mode="out-in">
        <HistoryView v-if="tab === 'past'" @open-future="go('future')" />
        <TodayView v-else-if="tab === 'present'" @backup="openTransfer('export')" />
        <FutureView v-else />
      </Transition>
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
          · your data {{ dataLabel }}
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

    <SideMenu :open="showMenu" @close="showMenu = false" @export="openTransfer('export')" @import="openTransfer('import')" />
    <BackupModal v-if="transfer" :key="transfer" :section="transfer" @close="transfer = null" />
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
  padding: 0.4rem 0;
  background: color-mix(in srgb, var(--bg) 92%, transparent);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

/* Segmented control: a neutral track with a card-coloured pill that slides to the open tab. */
.seg {
  --pad: 4px;
  position: relative;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  padding: var(--pad);
  border: 1px solid var(--line);
  border-radius: 0.75rem;
  background: color-mix(in srgb, var(--bg) 88%, #000);
}

.pill {
  position: absolute;
  top: var(--pad);
  bottom: var(--pad);
  left: var(--pad);
  width: calc((100% - 2 * var(--pad)) / 3);
  transform: translateX(calc(var(--i) * 100%));
  border-radius: 0.55rem;
  background: var(--panel);
  box-shadow:
    0 1px 2px rgba(var(--shadow-rgb), 0.25),
    0 0 0 1px var(--line);
  transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

/* lags behind the lead pill, so together they stretch while moving and settle as one */
.pill.trail {
  transition: transform 0.45s cubic-bezier(0.2, 0.7, 0.2, 1) 0.04s;
}

.seg button {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  min-height: 40px;
  border: none;
  background: none;
  color: var(--mute);
  font-weight: 650;
  font-size: 0.92rem;
  padding: 0 0.25rem;
  transition: color 0.2s;
}

.seg button.on,
.seg button:hover {
  color: var(--ink);
}

.tab-ic {
  width: 17px;
  height: 17px;
  stroke-width: 1.75;
}

/* page content: fades in, sliding a little from the side of travel */
.page-fwd-enter-active,
.page-back-enter-active {
  transition:
    opacity 0.22s ease-out,
    transform 0.22s ease-out;
}

.page-fwd-leave-active,
.page-back-leave-active {
  transition: opacity 0.12s ease-in;
}

.page-fwd-enter-from {
  opacity: 0;
  transform: translateY(10px);
}

.page-back-enter-from {
  opacity: 0;
  transform: translateY(-10px);
}

.page-fwd-leave-to,
.page-back-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .pill,
  .pill.trail,
  .seg button,
  .page-fwd-enter-active,
  .page-back-enter-active,
  .page-fwd-leave-active,
  .page-back-leave-active {
    transition: none;
  }
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
  font-weight: 600;
  font-size: clamp(1.15rem, 4.5vw, 1.5rem);
  line-height: 1.1;
  white-space: nowrap;
}

.head-left {
  grid-column: 1;
  justify-self: start;
  align-self: start;
  display: flex;
  align-items: flex-start;
  gap: 0.35rem;
  min-width: 0;
}

.update-slot {
  position: relative;
}

.update-btn {
  background: var(--btn-primary-bg);
  border: 1px solid var(--btn-primary-bg);
  color: var(--btn-primary-text);
  font-weight: 550;
  font-size: 0.78rem;
  padding: 0.3rem 0.6rem;
  border-radius: var(--btn-radius);
  white-space: nowrap;
}

.update-btn:hover {
  background: var(--btn-primary-hover);
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
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
}

.up-line {
  font-size: 0.72rem;
  color: var(--text-muted);
}

/* Header controls: matte icon buttons, as in the editor's top bar. */
.head-right {
  grid-column: 3;
  justify-self: end;
  align-self: start;
  display: flex;
  gap: 0.35rem;
}

.head-btn {
  display: inline-grid;
  place-items: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 1px solid var(--btn-border);
  border-radius: var(--btn-radius);
  background: var(--btn-bg);
  color: var(--btn-text);
}

.head-btn.narrow {
  width: 24px;
}

.head-btn:hover {
  background: var(--btn-bg-hover);
  border-color: var(--btn-border-hover);
}

.head-btn.active {
  background: var(--btn-primary-bg);
  border-color: var(--btn-primary-bg);
  color: var(--btn-primary-text);
}

.head-btn:focus-visible,
.pop-option:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.ic {
  width: 1.15rem;
  height: 1.15rem;
  stroke-width: 1.75;
}

.split-group {
  position: relative;
  display: inline-flex;
  gap: 1px;
}

.split-group > .head-btn:first-child {
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
}

.split-group > .head-btn:nth-child(2) {
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
}

.pop-menu {
  position: absolute;
  z-index: 80;
  top: calc(100% + 4px);
  right: 0;
  display: grid;
  gap: 0.3rem;
  min-width: 13rem;
  padding: 0.45rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-elev);
  box-shadow: var(--shadow);
}

.pop-menu-title {
  padding: 0.2rem 0.2rem 0.1rem;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.pop-option {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 40px;
  padding: 0 0.6rem;
  border: 1px solid var(--btn-border);
  border-radius: var(--btn-radius);
  background: var(--btn-bg);
  color: var(--btn-text);
  font-size: 0.88rem;
  font-weight: 550;
  text-align: left;
}

.pop-option:hover {
  background: var(--btn-bg-hover);
}

.pop-option.active {
  background: var(--btn-primary-bg);
  border-color: var(--btn-primary-bg);
  color: var(--btn-primary-text);
}

.swatch {
  display: inline-grid;
  place-items: center;
  width: 1rem;
  height: 1rem;
  border-radius: 50%;
  font-size: 0.55rem;
  line-height: 1;
  box-shadow: 0 0 0 1px var(--btn-border);
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
  font-weight: 550;
  padding: 0.15rem 0.5rem;
  background: var(--btn-bg);
  border: 1px solid var(--btn-border);
  color: var(--btn-text);
  border-radius: var(--btn-radius);
}

.reload-btn:hover {
  background: var(--btn-bg-hover);
  border-color: var(--btn-border-hover);
}

.reload-btn.update-ready {
  background: var(--btn-primary-bg);
  border-color: var(--btn-primary-bg);
  color: var(--btn-primary-text);
}

.debug-log {
  list-style: none;
  padding: 0.5rem;
  margin: 0.4rem 0 0;
  background: var(--paper-code-bg);
  color: var(--paper-text);
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
  color: var(--warn);
}

.update-btn {
  min-height: 36px;
}

.reload-btn {
  min-height: 32px;
}
</style>
