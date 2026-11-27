<script setup lang="ts">
// A donut of how a set of amounts splits by size. Hand-rolled SVG.
// The legend lists every part; tapping a row leaves it out (or brings it back),
// so the donut and the centre total follow what's included.
import { computed } from 'vue'
import { fmtMoney } from '../../lib/money'

export interface DonutSlice {
  name: string
  /** Signed amount, shown in the legend; its size sets the slice. */
  amount: number
  color: string
  /** Left out: listed (struck) but not drawn or counted. */
  off?: boolean
}

const props = defineProps<{ slices: DonutSlice[]; centreLabel: string; centreValue: string }>()
const emit = defineEmits<{ (e: 'toggle', name: string): void }>()

const included = computed(() => props.slices.filter((s) => !s.off))
const size = computed(() => included.value.reduce((s, x) => s + Math.abs(x.amount), 0))
const R = 70
const W = 26
const C = 2 * Math.PI * R
const arcs = computed(() => {
  let acc = 0
  return included.value.map((s) => {
    const frac = size.value ? Math.abs(s.amount) / size.value : 0
    const arc = { ...s, dash: `${Math.max(0, frac * C - (included.value.length > 1 ? 1.5 : 0))} ${C}`, offset: -acc * C }
    acc += frac
    return arc
  })
})
const share = (s: DonutSlice) => (s.off || !size.value ? '' : `${((Math.abs(s.amount) / size.value) * 100).toFixed(Math.abs(s.amount) / size.value < 0.1 ? 1 : 0)}%`)
</script>

<template>
  <div class="donut">
    <svg viewBox="0 0 200 200" role="img" :aria-label="`${centreLabel} ${centreValue}`">
      <circle cx="100" cy="100" :r="R" fill="none" :stroke-width="W" class="track" />
      <circle
        v-for="a in arcs"
        :key="a.name"
        cx="100"
        cy="100"
        :r="R"
        fill="none"
        :stroke-width="W"
        :stroke-dasharray="a.dash"
        :stroke-dashoffset="a.offset"
        :style="{ stroke: a.color }"
        transform="rotate(-90 100 100)"
      />
      <text x="100" y="94" text-anchor="middle" class="c-label">{{ centreLabel }}</text>
      <text x="100" y="116" text-anchor="middle" class="c-value">{{ centreValue }}</text>
    </svg>
    <ul class="legend" aria-label="Tap a line to leave it out or bring it back">
      <li v-for="s in slices" :key="s.name">
        <button type="button" :class="{ off: s.off }" :aria-pressed="!s.off" @click="emit('toggle', s.name)">
          <span class="sw" :style="{ background: s.color }"></span>
          <span class="name">{{ s.name }}</span>
          <span class="money amt">{{ fmtMoney(s.amount) }}</span>
          <span class="pct">{{ share(s) }}</span>
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.donut {
  display: grid;
  grid-template-columns: minmax(0, 9.5rem) minmax(0, 1fr);
  gap: 0.8rem;
  align-items: center;
}

/* phone width: donut on top, legend full width underneath */
@media (max-width: 34rem) {
  .donut {
    grid-template-columns: 1fr;
    justify-items: center;
  }

  .legend {
    width: 100%;
  }
}

svg {
  width: 100%;
  max-width: 9.5rem;
  display: block;
}

.track {
  stroke: var(--line);
}

.c-label {
  fill: var(--mute);
  font-size: 12px;
}

.c-value {
  fill: var(--ink);
  font-size: 17px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}

.legend {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.1rem;
  min-width: 0;
}

.legend button {
  width: 100%;
  display: grid;
  grid-template-columns: 10px minmax(0, 1fr) auto 3rem;
  align-items: center;
  gap: 0.45rem;
  min-height: 36px;
  padding: 0 0.4rem;
  border: none;
  border-radius: 0.4rem;
  background: none;
  color: var(--ink);
  font: inherit;
  font-size: 0.88rem;
  text-align: left;
}

.legend button:hover {
  background: var(--panel-2);
}

.legend button.off {
  color: var(--mute);
}

.legend button.off .name,
.legend button.off .amt {
  text-decoration: line-through;
}

.legend button.off .sw {
  opacity: 0.35;
}

.sw {
  width: 10px;
  height: 10px;
  border-radius: 2px;
}

.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.amt {
  font-variant-numeric: tabular-nums;
}

.pct {
  text-align: right;
  color: var(--mute);
  font-variant-numeric: tabular-nums;
}
</style>
