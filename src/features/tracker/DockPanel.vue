<script setup lang="ts">
// A mid-size editing panel docked to the bottom of the screen. Unlike a full
// sheet it leaves the page above visible (and scrollable), so the forecast
// chart can be watched while editing. Esc or ✕ closes. While open it counts as
// an unsaved draft, so an app update waits (see pwa.ts).
// `blur`: dim and blur the page behind (and stop it taking taps), for panels
// where the page above isn't a live preview (e.g. Project this on Past).
import { onBeforeUnmount, onMounted } from 'vue'
import { markUnsaved } from '../../lib/storage/store'

const props = defineProps<{ title: string; draftKey: string; blur?: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}
onMounted(() => {
  markUnsaved(props.draftKey, true)
  document.addEventListener('keydown', onKey)
  document.body.classList.add('dock-open')
})
onBeforeUnmount(() => {
  markUnsaved(props.draftKey, false)
  document.removeEventListener('keydown', onKey)
  document.body.classList.remove('dock-open')
})
</script>

<template>
  <div v-if="blur" class="scrim" aria-hidden="true"></div>
  <section class="dock" role="dialog" :aria-label="title">
    <header class="head">
      <h2>{{ title }}</h2>
      <button class="x" aria-label="Close" @click="emit('close')">✕</button>
    </header>
    <div class="body"><slot /></div>
    <div v-if="$slots.summary" class="summary"><slot name="summary" /></div>
    <footer v-if="$slots.footer" class="foot"><slot name="footer" /></footer>
  </section>
</template>

<style scoped>
.dock {
  position: fixed;
  z-index: 90;
  left: 50%;
  bottom: 0;
  transform: translateX(-50%);
  width: min(36rem, 100%);
  max-height: 56dvh;
  display: flex;
  flex-direction: column;
  background: var(--panel);
  border: 1px solid var(--line);
  border-bottom: none;
  border-radius: var(--radius) var(--radius) 0 0;
  box-shadow: 0 -12px 32px rgba(var(--shadow-rgb), 0.35);
  animation: rise 0.18s ease-out;
}

@keyframes rise {
  from {
    transform: translate(-50%, 24px);
    opacity: 0;
  }
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.35rem 0.4rem 0 1rem;
}

.head h2 {
  margin: 0;
  font-size: 1.05rem;
}

.x {
  width: 40px;
  height: 40px;
  border: none;
  background: none;
  color: var(--mute);
  font-size: 1.2rem;
}

.body {
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 0.25rem 1rem 0.75rem;
}

.summary {
  padding: 0.5rem 1rem;
  border-top: 1px solid var(--line);
  max-height: 20dvh;
  flex-shrink: 0;
  overflow-y: auto;
}

.foot {
  display: flex;
  gap: 0.45rem;
  justify-content: flex-end;
  padding: 0.4rem 1rem max(0.45rem, env(safe-area-inset-bottom));
  border-top: 1px solid var(--line);
  background: var(--panel-2);
}

/* compact action buttons (Save, Cancel, Remove, …) */
.foot :slotted(.btn) {
  min-height: 36px;
  padding: 0 0.85rem;
  font-size: 0.9rem;
}

.scrim {
  position: fixed;
  inset: 0;
  z-index: 89;
  background: rgba(var(--shadow-rgb), 0.35);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  animation: fade 0.18s ease-out;
}

@keyframes fade {
  from {
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .scrim {
    animation: none;
  }
}
</style>

<style>
/* Room to scroll the page's content above the docked panel. */
body.dock-open .app {
  padding-bottom: 58dvh !important;
}
</style>
