<script setup lang="ts">
// Side menu: slides out from the left (opened by the ☰ button in the header).
// Sections are collapsible and start collapsed; for now there's one, Records,
// with Import and Export.
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ChevronRight, Download, ShieldCheck, Upload, X } from '@lucide/vue'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'export'): void; (e: 'import'): void; (e: 'about'): void }>()

const recordsOpen = ref(false)
const panel = ref<HTMLElement>()

// Start collapsed each time the menu opens; move focus into it for keyboards.
watch(
  () => props.open,
  (o) => {
    if (o) {
      recordsOpen.value = false
      requestAnimationFrame(() => panel.value?.querySelector<HTMLElement>('button')?.focus())
    }
  },
)

function onKey(e: KeyboardEvent) {
  if (props.open && e.key === 'Escape') emit('close')
}
onMounted(() => document.addEventListener('keydown', onKey))
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
</script>

<template>
  <Transition name="fade">
    <div v-if="open" class="scrim" aria-hidden="true" @click="emit('close')"></div>
  </Transition>
  <Transition name="slide">
    <nav v-if="open" ref="panel" class="drawer" aria-label="Menu">
      <div class="top">
        <span class="title">Ledgerful</span>
        <button class="x" aria-label="Close menu" @click="emit('close')"><X class="ic" aria-hidden="true" /></button>
      </div>

      <section class="section">
        <button
          class="section-head"
          :aria-expanded="recordsOpen"
          aria-controls="menu-records"
          @click="recordsOpen = !recordsOpen"
        >
          <ChevronRight class="ic chev" :class="{ open: recordsOpen }" aria-hidden="true" />
          Records
        </button>
        <div v-show="recordsOpen" id="menu-records" class="section-body">
          <button class="tag-btn" @click="emit('import')"><Upload class="ic" aria-hidden="true" />Import</button>
          <button class="tag-btn" @click="emit('export')"><Download class="ic" aria-hidden="true" />Export</button>
        </div>
      </section>

      <button class="about" @click="emit('about')"><ShieldCheck class="ic" aria-hidden="true" />About Ledgerful</button>
    </nav>
  </Transition>
</template>

<style scoped>
.scrim {
  position: fixed;
  inset: 0;
  z-index: 85;
  background: var(--backdrop);
}

.drawer {
  position: fixed;
  z-index: 86;
  top: 0;
  bottom: 0;
  left: 0;
  width: min(80vw, 18rem);
  display: flex;
  flex-direction: column;
  padding: max(0.6rem, env(safe-area-inset-top)) 0.75rem max(1rem, env(safe-area-inset-bottom))
    max(0.75rem, env(safe-area-inset-left));
  background: var(--bg-elev);
  border-right: 1px solid var(--border);
  box-shadow: var(--shadow);
  overflow-y: auto;
}

.top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.75rem;
}

.title {
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 1.15rem;
}

.x {
  display: inline-grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border: none;
  background: none;
  color: var(--mute);
}

.ic {
  width: 1.05rem;
  height: 1.05rem;
  stroke-width: 1.75;
}

.section {
  border-top: 1px solid var(--line);
}

.section-head {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  min-height: var(--tap);
  padding: 0 0.2rem;
  border: none;
  background: none;
  color: var(--ink);
  font-weight: 650;
  text-align: left;
}

.about {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  min-height: var(--tap);
  margin-top: auto;
  padding: 0 0.2rem;
  border: none;
  border-top: 1px solid var(--line);
  background: none;
  color: var(--ink);
  font-weight: 650;
  text-align: left;
}

.chev {
  color: var(--mute);
  transition: transform 0.15s ease;
}

.chev.open {
  transform: rotate(90deg);
}

.section-body {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  padding: 0 0.2rem 0.75rem 1.65rem;
}

/* Small tag buttons, matte like the rest. */
.tag-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  height: 32px;
  padding: 0 0.65rem;
  border: 1px solid var(--btn-border);
  border-radius: var(--btn-radius);
  background: var(--btn-bg);
  color: var(--btn-text);
  font-size: 0.8rem;
  font-weight: 550;
}

.tag-btn:hover {
  background: var(--btn-bg-hover);
  border-color: var(--btn-border-hover);
}

.tag-btn:focus-visible,
.section-head:focus-visible,
.x:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.slide-enter-active,
.slide-leave-active {
  transition: transform 0.22s ease;
}
.slide-enter-from,
.slide-leave-to {
  transform: translateX(-100%);
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.22s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
