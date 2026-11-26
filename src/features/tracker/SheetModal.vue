<script setup lang="ts">
// Shared sheet: slides up from the bottom on phones, a centered dialog on wide
// screens. Closes with ✕ or Esc (not on a backdrop tap, so a stray touch can't
// lose what was typed). While open it counts as an unsaved draft, so an app
// update waits (see pwa.ts).
import { onBeforeUnmount, onMounted } from 'vue'
import { markUnsaved } from '../../lib/storage/store'

const props = defineProps<{ title: string; draftKey?: string }>()
const emit = defineEmits<{ (e: 'close'): void }>()

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}
onMounted(() => {
  if (props.draftKey) markUnsaved(props.draftKey, true)
  document.addEventListener('keydown', onKey)
  document.body.style.overflow = 'hidden'
})
onBeforeUnmount(() => {
  if (props.draftKey) markUnsaved(props.draftKey, false)
  document.removeEventListener('keydown', onKey)
  document.body.style.overflow = ''
})
</script>

<template>
  <div class="backdrop">
    <div class="panel" role="dialog" aria-modal="true" :aria-label="title">
      <header class="head">
        <h2>{{ title }}</h2>
        <button class="x" aria-label="Close" @click="emit('close')">✕</button>
      </header>
      <div class="body"><slot /></div>
      <footer v-if="$slots.footer" class="foot"><slot name="footer" /></footer>
    </div>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 95;
  background: var(--backdrop);
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.panel {
  width: min(32rem, 100%);
  max-height: 92dvh;
  display: flex;
  flex-direction: column;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--radius) var(--radius) 0 0;
  box-shadow: var(--shadow);
}

@media (min-width: 40rem) {
  .backdrop {
    align-items: center;
  }
  .panel {
    border-radius: var(--radius);
  }
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0.5rem 0.25rem 1rem;
}

.head h2 {
  margin: 0;
  font-size: 1.2rem;
}

.x {
  width: var(--tap);
  height: var(--tap);
  border: none;
  background: none;
  color: var(--mute);
  font-size: 1.3rem;
}

.body {
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 0.25rem 1rem 1rem;
}

.foot {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
  flex-wrap: wrap;
  padding: 0.6rem 1rem max(0.75rem, env(safe-area-inset-bottom));
  border-top: 1px solid var(--line);
  background: var(--panel-2);
}
</style>
