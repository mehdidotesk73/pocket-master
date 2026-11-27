<script setup lang="ts" generic="T extends string">
// A small vertical "lens on a carousel" (like an iOS picker wheel): the options
// sit in a column that scrolls and snaps; whichever is under the lens is chosen.
// Swipe it, tap an option, or use ↑/↓. `rows` = 3 shows the neighbours; 1 fits
// the height of an input (tap it to step to the next option).
//
// Only a swipe the user made can change the value: scrolls the browser makes on
// its own (layout settling while a panel slides in, iOS momentum) just re-centre.
import { nextTick, onMounted, ref, watch } from 'vue'

const props = withDefaults(defineProps<{ options: { id: T; label: string }[]; label: string; rows?: 1 | 3 }>(), { rows: 3 })
const model = defineModel<T>({ required: true })

let touchedAt = 0
const touched = () => (touchedAt = Date.now())
const byUser = () => Date.now() - touchedAt < 1500

const col = ref<HTMLElement>()
let settleTimer: ReturnType<typeof setTimeout> | undefined
let programmatic = false

function centre(id: T, smooth = true) {
  const el = col.value?.querySelector<HTMLElement>(`[data-id="${id}"]`)
  const c = col.value
  if (!el || !c) return
  programmatic = true
  c.scrollTo({ top: el.offsetTop + el.offsetHeight / 2 - c.clientHeight / 2, behavior: smooth ? 'smooth' : 'auto' })
  setTimeout(() => (programmatic = false), smooth ? 350 : 0)
}

// When a swipe settles, pick the option nearest the lens.
function onScroll() {
  if (programmatic) return
  clearTimeout(settleTimer)
  settleTimer = setTimeout(() => {
    const c = col.value
    if (!c) return
    const mid = c.scrollTop + c.clientHeight / 2
    let best: { id: T; d: number } | null = null
    for (const el of c.querySelectorAll<HTMLElement>('[data-id]')) {
      const d = Math.abs(el.offsetTop + el.offsetHeight / 2 - mid)
      if (!best || d < best.d) best = { id: el.dataset.id as T, d }
    }
    if (best && best.id !== model.value && byUser()) model.value = best.id
    else centre(model.value)
  }, 90)
}

function onTap(id: T) {
  touched()
  if (props.rows === 1 && id === model.value) {
    // one row: tapping steps to the next option
    const i = props.options.findIndex((o) => o.id === id)
    model.value = props.options[(i + 1) % props.options.length].id
  } else model.value = id
}

function onKey(e: KeyboardEvent) {
  const i = props.options.findIndex((o) => o.id === model.value)
  const j = e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowUp' ? i - 1 : -1
  if (j < 0 || j >= props.options.length) return
  e.preventDefault()
  model.value = props.options[j].id
}

watch(model, (id) => nextTick(() => centre(id)))
onMounted(() => nextTick(() => centre(model.value, false)))
</script>

<template>
  <div
    class="wheel"
    :class="{ one: rows === 1 }"
    role="radiogroup"
    :aria-label="label"
    @keydown="onKey"
    @pointerdown="touched"
    @touchstart.passive="touched"
    @wheel.passive="touched"
  >
    <div class="lens" aria-hidden="true"></div>
    <span v-if="rows === 1" class="hint" aria-hidden="true">⌃<br />⌄</span>
    <div ref="col" class="col" @scroll.passive="onScroll">
      <button
        v-for="o in options"
        :key="o.id"
        :data-id="o.id"
        type="button"
        role="radio"
        :aria-checked="model === o.id"
        :tabindex="model === o.id ? 0 : -1"
        :class="{ on: model === o.id }"
        @click="onTap(o.id)"
      >
        {{ o.label }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.wheel {
  --row: 26px;
  position: relative;
  height: calc(var(--row) * 3);
  border: 1px solid var(--btn-border);
  border-radius: var(--btn-radius);
  background: var(--bg-input);
  overflow: hidden;
}

.wheel.one {
  --row: 38px;
  height: var(--row);
}

.wheel.one .col {
  padding-block: 0;
}

.wheel.one .lens {
  left: 2px;
  right: 2px;
  top: 2px;
  height: calc(var(--row) - 4px);
}

.hint {
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 9px;
  line-height: 0.9;
  color: var(--btn-primary-text);
  opacity: 0.6;
  pointer-events: none;
  z-index: 1;
}

.lens {
  position: absolute;
  left: 3px;
  right: 3px;
  top: calc(50% - var(--row) / 2);
  height: var(--row);
  border-radius: calc(var(--btn-radius) - 2px);
  background: var(--btn-primary-bg);
  pointer-events: none;
}

.col {
  position: relative;
  height: 100%;
  overflow-y: auto;
  scroll-snap-type: y mandatory;
  scrollbar-width: none;
  /* room so the first and last option can sit under the lens */
  padding-block: var(--row);
  box-sizing: border-box;
}

.col::-webkit-scrollbar {
  display: none;
}

button {
  display: block;
  width: 100%;
  height: var(--row);
  scroll-snap-align: center;
  border: none;
  background: none;
  color: var(--mute);
  font-size: 0.84rem;
  font-weight: 550;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  padding: 0 0.3rem;
}

button.on {
  color: var(--btn-primary-text);
}

button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

@media (prefers-reduced-motion: reduce) {
  .col {
    scroll-behavior: auto;
  }
}
</style>
