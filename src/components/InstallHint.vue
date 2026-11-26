<script setup lang="ts">
// Explains how to install the app (storage spec §3 "Install banner").
// iOS has no install prompt, so we show instructions; Chromium gets a real
// Install button via beforeinstallprompt. Hidden inside the installed app.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { isStandalone } from '../lib/storage/store'

const props = defineProps<{ hasData: boolean }>()

const KEY = 'installHintDismissedAt'
const ua = navigator.userAgent
const isIOS =
  /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints ?? 0) > 1)
const isIPad = /iPad/.test(ua) || (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints ?? 0) > 1)

const standalone = ref(isStandalone())
const dismissedRecently = ref(false)
try {
  const at = Number(localStorage.getItem(KEY) || 0)
  dismissedRecently.value = Date.now() - at < 7 * 86_400_000
} catch {
  /* private mode */
}

type BIPEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> }
const deferred = ref<BIPEvent | null>(null)
function onBIP(e: Event) {
  e.preventDefault()
  deferred.value = e as BIPEvent
}
function onInstalled() {
  deferred.value = null
  standalone.value = true
}
onMounted(() => {
  window.addEventListener('beforeinstallprompt', onBIP)
  window.addEventListener('appinstalled', onInstalled)
})
onBeforeUnmount(() => {
  window.removeEventListener('beforeinstallprompt', onBIP)
  window.removeEventListener('appinstalled', onInstalled)
})

async function install() {
  const ev = deferred.value
  if (!ev) return
  await ev.prompt()
  await ev.userChoice.catch(() => null)
  deferred.value = null
}

function dismiss() {
  dismissedRecently.value = true
  try {
    localStorage.setItem(KEY, String(Date.now()))
  } catch {
    /* private mode */
  }
}

// A browser tab that already holds data is the risky case: its storage is
// separate from the installed app's. Warn even if the banner was dismissed.
const strong = computed(() => !standalone.value && props.hasData)
const show = computed(() => {
  if (standalone.value) return false
  if (strong.value) return true
  if (dismissedRecently.value) return false
  return isIOS || !!deferred.value
})
</script>

<template>
  <aside v-if="show" class="install" :class="{ strong, ipad: isIPad, iphone: isIOS && !isIPad }" role="note">
    <div class="text">
      <template v-if="strong">
        <b>You’re in a browser tab.</b> What you save here is kept separately from the installed app, and the
        browser may clear it. Install the app and use that instead (back up first, then import there).
      </template>
      <template v-else>
        <b>Install this app to keep your data safe.</b>
      </template>
      <span v-if="isIOS">
        Tap <b>Share</b>
        <svg class="share" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3v12M7 8l5-5 5 5M5 12v8h14v-8" fill="none" stroke="currentColor" stroke-width="2" />
        </svg>
        (on newer iPhones it’s under <b>⋯</b>), then <b>Add to Home Screen</b>. Leave <b>Open as Web App</b> on.
      </span>
    </div>
    <div class="btns">
      <button v-if="deferred" class="btn primary" @click="install">Install</button>
      <button v-if="!strong" class="btn ghost" @click="dismiss">Not now</button>
    </div>
    <span v-if="isIOS && !isIPad" class="arrow down" aria-hidden="true">↓</span>
  </aside>
</template>

<style scoped>
.install {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.75rem;
  margin-bottom: 1rem;
  padding: 0.75rem 0.9rem;
  border: 1px solid var(--accent);
  border-radius: var(--radius);
  background: color-mix(in srgb, var(--accent) 10%, var(--panel));
  font-size: 0.9rem;
}

.install.strong {
  border-color: var(--projection);
  background: color-mix(in srgb, var(--projection) 10%, var(--panel));
}

.text {
  flex: 1 1 16rem;
}

.share {
  width: 1.1em;
  height: 1.1em;
  vertical-align: -0.2em;
}

.btns {
  display: flex;
  gap: 0.4rem;
}

/* On iPhone Safari the Share control lives in the bottom bar, so point there. */
.install.iphone:not(.strong) {
  position: fixed;
  z-index: 60;
  left: 0.75rem;
  right: 0.75rem;
  bottom: calc(0.75rem + env(safe-area-inset-bottom));
  margin: 0;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
}

.arrow {
  display: none;
}

.install.iphone:not(.strong) .arrow {
  display: block;
  position: absolute;
  left: 50%;
  bottom: -1.6rem;
  transform: translateX(-50%);
  color: var(--accent);
  font-size: 1.4rem;
  font-weight: 800;
  animation: bob 1.4s ease-in-out infinite;
}

@keyframes bob {
  50% {
    transform: translate(-50%, 4px);
  }
}
</style>
