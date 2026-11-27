<script setup lang="ts" generic="T extends string">
// A "lens on a carousel" selector: the options sit on a horizontal strip that
// scrolls and snaps; whichever is under the fixed lens in the middle is chosen.
// Swipe the strip, tap an option, or use ←/→.
import { nextTick, onMounted, ref, watch } from 'vue'

const props = defineProps<{ options: { id: T; label: string }[]; label: string }>()
const model = defineModel<T>({ required: true })

const strip = ref<HTMLElement>()
let settleTimer: ReturnType<typeof setTimeout> | undefined
let programmatic = false

function centre(id: T, smooth = true) {
  const el = strip.value?.querySelector<HTMLElement>(`[data-id="${id}"]`)
  const s = strip.value
  if (!el || !s) return
  programmatic = true
  s.scrollTo({ left: el.offsetLeft + el.offsetWidth / 2 - s.clientWidth / 2, behavior: smooth ? 'smooth' : 'auto' })
  setTimeout(() => (programmatic = false), smooth ? 350 : 0)
}

// When a swipe settles, pick the option nearest the lens.
function onScroll() {
  if (programmatic) return
  clearTimeout(settleTimer)
  settleTimer = setTimeout(() => {
    const s = strip.value
    if (!s) return
    const mid = s.scrollLeft + s.clientWidth / 2
    let best: { id: T; d: number } | null = null
    for (const el of s.querySelectorAll<HTMLElement>('[data-id]')) {
      const d = Math.abs(el.offsetLeft + el.offsetWidth / 2 - mid)
      if (!best || d < best.d) best = { id: el.dataset.id as T, d }
    }
    if (best && best.id !== model.value) model.value = best.id
    else if (best) centre(best.id)
  }, 90)
}

function onKey(e: KeyboardEvent) {
  const i = props.options.findIndex((o) => o.id === model.value)
  const j = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : -1
  if (j < 0 || j >= props.options.length) return
  e.preventDefault()
  model.value = props.options[j].id
}

watch(model, (id) => nextTick(() => centre(id)))
onMounted(() => nextTick(() => centre(model.value, false)))
</script>

<template>
  <div class="lens-carousel" role="radiogroup" :aria-label="label" @keydown="onKey">
    <div class="lens" aria-hidden="true"></div>
    <div ref="strip" class="strip" @scroll.passive="onScroll">
      <button
        v-for="o in options"
        :key="o.id"
        :data-id="o.id"
        role="radio"
        :aria-checked="model === o.id"
        :tabindex="model === o.id ? 0 : -1"
        class="opt"
        :class="{ on: model === o.id }"
        @click="model = o.id"
      >
        {{ o.label }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.lens-carousel {
  position: relative;
  height: 40px;
  margin: 0.15rem -1rem 0.6rem;
  /* fade the strip's edges so it reads as a wheel */
  -webkit-mask-image: linear-gradient(90deg, transparent, #000 18%, #000 82%, transparent);
  mask-image: linear-gradient(90deg, transparent, #000 18%, #000 82%, transparent);
}

.lens {
  position: absolute;
  left: 50%;
  top: 2px;
  bottom: 2px;
  width: 7.5rem;
  transform: translateX(-50%);
  border-radius: 999px;
  background: var(--btn-primary-bg);
  pointer-events: none;
}

.strip {
  position: relative;
  display: flex;
  height: 100%;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  scrollbar-width: none;
  /* half the width on each side, so the first and last options can reach the lens */
  padding: 0 calc(50% - 3.75rem);
}

.strip::-webkit-scrollbar {
  display: none;
}

.opt {
  flex: 0 0 7.5rem;
  scroll-snap-align: center;
  border: none;
  background: none;
  color: var(--mute);
  font-weight: 600;
  font-size: 0.92rem;
  transition: color 0.15s ease;
}

.opt.on {
  color: var(--btn-primary-text);
}

.opt:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -4px;
  border-radius: 999px;
}
</style>
