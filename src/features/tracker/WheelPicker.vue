<script setup lang="ts" generic="T extends string">
// iOS-style vertical wheel picker (ported from the bitcoin-explorer metric panel).
// Native scroll + CSS scroll-snap does the momentum and snapping; we read which
// row settled in the centre and emit it.
//
// At rest it's one row tall, like the inputs beside it. While held or scrolled
// it bulges into a slightly taller drum drawn as an overlay (it doesn't push
// layout), then closes once scrolling settles. The drum is always full height;
// only its clip animates, so scroll geometry never changes mid-gesture.
//
// Only a gesture the user made can change the value: scrolls the browser makes
// on its own (layout settling while the dock panel slides in) just re-centre.
// Without that guard a Rate projection could flip mode as the editor opened.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps<{ options: { id: T; label: string }[]; label: string }>()
const model = defineModel<T>({ required: true })

// Rows are packed tighter than the one-row slot, so the neighbours sit right
// against the selection and opening is a small bubble, not a panel.
const ITEM_H = 22 // px between row centres (= one scroll/snap step); keep in sync with --pitch
const scroller = ref<HTMLElement>()
const scrollTop = ref(0)
const open = ref(false)

// The slot takes its height from the root (the same height as the inputs),
// measured into --slot for the drum geometry.
const root = ref<HTMLElement>()
const slotPx = ref(0)
let ro: ResizeObserver | undefined

const selectedIndex = computed(() => Math.max(0, props.options.findIndex((o) => o.id === model.value)))

function scrollToIndex(i: number, smooth = true) {
  scroller.value?.scrollTo({ top: i * ITEM_H, behavior: smooth ? 'smooth' : 'auto' })
}

// User-gesture guard: a settle only commits within a moment of a real touch.
let touchedAt = 0
const byUser = () => Date.now() - touchedAt < 1500

// Open/close. A touch that turns into a scroll gets `pointercancel` (the
// browser takes over panning), so closing is driven by scroll settling, with
// `pointerup` covering a hold that never scrolled.
let held = false
let closeTimer: ReturnType<typeof setTimeout> | undefined
function expand() {
  clearTimeout(closeTimer)
  open.value = true
}
function scheduleClose(delay = 450) {
  clearTimeout(closeTimer)
  closeTimer = setTimeout(() => {
    if (!held) open.value = false
  }, delay)
}
function onPointerDown() {
  touchedAt = Date.now()
  held = true
  expand()
}
function onPointerUp() {
  held = false
  scheduleClose()
}
function onPointerCancel() {
  held = false
}

// Commit once scrolling settles (`scrollend` isn't in older Safari, so debounce).
let settleTimer: ReturnType<typeof setTimeout> | undefined
let raf = 0
function onScroll() {
  if (!raf)
    raf = requestAnimationFrame(() => {
      raf = 0
      scrollTop.value = scroller.value?.scrollTop ?? 0
    })
  if (byUser()) expand()
  clearTimeout(settleTimer)
  settleTimer = setTimeout(settle, 120)
}
function settle() {
  if (!scroller.value) return
  const i = Math.min(props.options.length - 1, Math.max(0, Math.round(scroller.value.scrollTop / ITEM_H)))
  const opt = props.options[i]
  if (opt && opt.id !== model.value) {
    if (byUser()) model.value = opt.id
    else scrollToIndex(selectedIndex.value)
  }
  scheduleClose()
}

function step(delta: number) {
  touchedAt = Date.now()
  const i = Math.min(props.options.length - 1, Math.max(0, selectedIndex.value + delta))
  scrollToIndex(i)
}
function pick(i: number) {
  touchedAt = Date.now()
  scrollToIndex(i)
}

// Drum effect from live scroll position: each row is a face of a cylinder,
// tilted by its distance from the centre line, shrunk and faded as it turns away.
function itemStyle(i: number) {
  const d = i - scrollTop.value / ITEM_H
  const a = Math.min(Math.abs(d), 2)
  // Closed, only the centred row shows.
  const fade = open.value ? Math.max(0, 1 - a * 0.4) : a < 0.5 ? 1 : 0
  return {
    transform: `perspective(110px) rotateX(${-d * 50}deg) scale(${1 - a * 0.12}, ${1 - a * 0.06})`,
    opacity: String(fade),
  }
}

watch(model, () => {
  if (!scroller.value) return
  if (Math.round(scroller.value.scrollTop / ITEM_H) !== selectedIndex.value) scrollToIndex(selectedIndex.value)
})

onMounted(() => {
  if (root.value) {
    slotPx.value = root.value.clientHeight
    ro = new ResizeObserver(() => (slotPx.value = root.value?.clientHeight ?? 0))
    ro.observe(root.value)
  }
  scrollToIndex(selectedIndex.value, false)
  scrollTop.value = scroller.value?.scrollTop ?? 0
})
onBeforeUnmount(() => {
  ro?.disconnect()
  clearTimeout(settleTimer)
  clearTimeout(closeTimer)
  cancelAnimationFrame(raf)
})
</script>

<template>
  <!-- click.prevent: inside a <label> the default action would focus a neighbouring input. -->
  <div
    ref="root"
    class="wheel"
    :style="slotPx ? { '--slot': `${slotPx}px` } : undefined"
    :class="{ open }"
    role="listbox"
    :aria-label="label"
    tabindex="0"
    @click.prevent
    @blur="scheduleClose(0)"
    @keydown.up.prevent="step(-1)"
    @keydown.down.prevent="step(1)"
  >
    <div class="drum">
      <ul
        ref="scroller"
        class="scroller"
        @scroll.passive="onScroll"
        @pointerdown="onPointerDown"
        @pointerup="onPointerUp"
        @pointercancel="onPointerCancel"
        @wheel.passive="touchedAt = Date.now()"
      >
        <li
          v-for="(o, i) in options"
          :key="o.id"
          role="option"
          :aria-selected="i === selectedIndex"
          :class="{ sel: i === selectedIndex }"
          :style="itemStyle(i)"
          @click="pick(i)"
        >
          {{ o.label }}
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.wheel {
  --slot: 38px; /* fallback; overridden with the measured height */
  --pitch: 22px; /* ITEM_H */
  --side: 13px; /* how far the drum bulges past the slot when open */
  position: relative;
  height: 38px;
  width: 100%;
  min-width: 0;
  outline: none;
  user-select: none;
  -webkit-user-select: none;
}

/* Full-height drum centred on the one-row slot; clipped to that slot when closed.
   clip-path also clips hit-testing, so a closed drum doesn't block nearby taps. */
.drum {
  position: absolute;
  left: 0;
  right: 0;
  top: calc(var(--side) * -1);
  height: calc(var(--slot) + var(--side) * 2);
  z-index: 1;
  clip-path: inset(var(--side) 0 var(--side) 0 round 0.5rem);
  transition: clip-path 0.18s ease;
}

.wheel.open .drum {
  z-index: 20;
  clip-path: inset(0 0 0 0 round var(--radius));
}

/* Frame + background, sized to whatever is visible. */
.drum::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: var(--side);
  bottom: var(--side);
  background: var(--bg-input);
  border: 1px solid var(--line);
  border-radius: 0.5rem;
  transition:
    top 0.18s ease,
    bottom 0.18s ease,
    box-shadow 0.18s ease;
}

.wheel.open .drum::before {
  top: 0;
  bottom: 0;
  border-radius: var(--radius);
  border-color: var(--btn-border);
  box-shadow: 0 8px 24px rgba(var(--shadow-rgb), 0.45);
}

.wheel:focus-visible .drum::before {
  border-color: var(--accent);
}

.scroller {
  position: relative;
  list-style: none;
  margin: 0;
  /* Centres row i in the slot when scrollTop = i * pitch. */
  padding: calc(var(--side) + (var(--slot) - var(--pitch)) / 2) 0;
  height: 100%;
  box-sizing: border-box;
  overflow-x: hidden;
  overflow-y: scroll;
  touch-action: pan-y;
  scroll-snap-type: y mandatory;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}

.scroller::-webkit-scrollbar {
  display: none;
}

li {
  height: var(--pitch);
  line-height: var(--pitch);
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  scroll-snap-align: center;
  color: var(--mute);
  font-size: 0.95rem;
  cursor: pointer;
  backface-visibility: hidden;
  transition: opacity 0.15s ease;
}

li.sel {
  color: var(--ink);
  font-weight: 600;
}

@media (prefers-reduced-motion: reduce) {
  .drum,
  .drum::before,
  li {
    transition: none;
  }
}
</style>
