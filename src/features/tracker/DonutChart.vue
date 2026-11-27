<script setup lang="ts">
// A donut of how a total splits between parts: slice = value / total.
// Hand-rolled SVG (no chart library). Values are positive sizes; the legend
// shows each part's own signed amount and its share.
import { computed, ref } from 'vue'
import { fmtMoney } from '../../lib/money'

export interface DonutSlice {
  name: string
  /** Signed amount shown in the legend. */
  amount: number
  color: string
}

const props = defineProps<{ slices: DonutSlice[]; centreLabel: string; centreValue: string }>()

const total = computed(() => props.slices.reduce((s, x) => s + Math.abs(x.amount), 0))
const R = 70
const W = 26
const C = 2 * Math.PI * R
const arcs = computed(() => {
  let acc = 0
  return props.slices.map((s) => {
    const frac = total.value ? Math.abs(s.amount) / total.value : 0
    const arc = { ...s, frac, dash: `${Math.max(0, frac * C - (props.slices.length > 1 ? 1.5 : 0))} ${C}`, offset: -acc * C }
    acc += frac
    return arc
  })
})
const active = ref<string | null>(null)
const pct = (f: number) => `${(f * 100).toFixed(f < 0.1 ? 1 : 0)}%`
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
        :stroke-width="active === a.name ? W + 6 : W"
        :stroke-dasharray="a.dash"
        :stroke-dashoffset="a.offset"
        :style="{ stroke: a.color }"
        transform="rotate(-90 100 100)"
        class="arc"
        @click="active = active === a.name ? null : a.name"
      />
      <text x="100" y="94" text-anchor="middle" class="c-label">{{ centreLabel }}</text>
      <text x="100" y="116" text-anchor="middle" class="c-value">{{ centreValue }}</text>
    </svg>
    <ul class="legend">
      <li v-for="a in arcs" :key="a.name" :class="{ on: active === a.name }" @click="active = active === a.name ? null : a.name">
        <span class="sw" :style="{ background: a.color }"></span>
        <span class="name">{{ a.name }}</span>
        <span class="money amt">{{ fmtMoney(a.amount) }}</span>
        <span class="pct">{{ pct(a.frac) }}</span>
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

.arc {
  cursor: pointer;
  transition: stroke-width 0.15s;
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
  gap: 0.15rem;
  min-width: 0;
  font-size: 0.86rem;
}

.legend li {
  display: grid;
  grid-template-columns: 10px minmax(0, 1fr) auto 3rem;
  align-items: center;
  gap: 0.4rem;
  padding: 0.2rem 0.3rem;
  border-radius: 0.35rem;
  cursor: pointer;
}

.legend li.on {
  background: var(--panel-2);
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

@media (prefers-reduced-motion: reduce) {
  .arc {
    transition: none;
  }
}
</style>
