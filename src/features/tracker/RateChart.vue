<script setup lang="ts">
// How fast a value changed between records: one bar per interval, spanning it
// from one record's day to the next, as tall as the change per day. Growing
// bars rise above $0, shrinking ones hang below. Tap a bar to read it.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { IntervalRate } from '../../lib/analysis'
import { dayNum, fmtDate, fmtMoney, fromDayNum, monthFromIndex, monthIndex, monthLabel, ymd } from '../../lib/money'

/** `show` hides growing or shrinking bars without changing the scale. */
const props = withDefaults(defineProps<{ rates: IntervalRate[]; show?: 'both' | 'up' | 'down'; height?: number }>(), { show: 'both', height: 210 })

const wrap = ref<HTMLElement>()
const width = ref(320)
let ro: ResizeObserver | undefined
onMounted(() => {
  if (!wrap.value) return
  width.value = wrap.value.clientWidth || 320
  ro = new ResizeObserver((e) => {
    const w = Math.round(e[0].contentRect.width)
    if (w > 0) width.value = w
  })
  ro.observe(wrap.value)
})
onBeforeUnmount(() => ro?.disconnect())

const pad = { l: 56, r: 10, t: 12, b: 26 }
function niceStep(range: number, target: number) {
  const raw = range / Math.max(1, target)
  const mag = 10 ** Math.floor(Math.log10(raw || 1))
  const n = raw / mag
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag
}
const fmtAxis = (v: number) => {
  const a = Math.abs(v)
  const s = a >= 1000 ? `$${(a / 1000).toFixed(1).replace(/\.0$/, '')}k` : `$${Math.round(a)}`
  return v < 0 ? `(${s})` : s
}

const geom = computed(() => {
  const rs = props.rates
  if (!rs.length) return null
  const x0 = dayNum(rs[0].from)
  const x1 = Math.max(x0 + 1, dayNum(rs[rs.length - 1].to))
  let y0 = Math.min(0, ...rs.map((r) => r.perDay))
  let y1 = Math.max(0, ...rs.map((r) => r.perDay))
  if (y0 === y1) y1 = 1
  const step = niceStep(y1 - y0, 4)
  y0 = Math.floor(y0 / step) * step
  y1 = Math.ceil(y1 / step) * step
  const W = width.value
  const H = props.height
  const sx = (x: number) => pad.l + ((x - x0) / (x1 - x0)) * (W - pad.l - pad.r)
  const sy = (y: number) => pad.t + (1 - (y - y0) / (y1 - y0)) * (H - pad.t - pad.b)
  const yTicks: number[] = []
  for (let v = y0; v <= y1 + step / 2; v += step) yTicks.push(Math.round(v * 100) / 100)
  const months: { x: number; label: string }[] = []
  for (let mi = monthIndex(fromDayNum(x0)); mi <= monthIndex(fromDayNum(x1)) + 1; mi++) {
    const { y, m } = monthFromIndex(mi)
    const dn = dayNum(ymd(y, m, 1))
    if (dn >= x0 && dn <= x1) months.push({ x: dn, label: monthLabel(mi) })
  }
  const every = Math.ceil(months.length / Math.max(2, Math.floor((W - pad.l - pad.r) / 48)))
  const visible = (r: IntervalRate) => props.show === 'both' || (props.show === 'up' ? r.perDay >= 0 : r.perDay < 0)
  const bars = rs.flatMap((r, i) => {
    if (!visible(r)) return []
    const xa = sx(dayNum(r.from)) + 0.75
    const xb = sx(dayNum(r.to)) - 0.75
    const ya = sy(Math.max(0, r.perDay))
    const yb = sy(Math.min(0, r.perDay))
    return [{ i, x: xa, w: Math.max(1.5, xb - xa), y: ya, h: Math.max(1, yb - ya), up: r.perDay >= 0 }]
  })
  return { W, H, sy, yTicks, xTicks: months.filter((_, i) => i % every === 0).map((m) => ({ x: sx(m.x), label: m.label })), bars, zeroY: sy(0) }
})

const picked = ref<number | null>(null)
const readout = computed(() => (picked.value == null ? null : props.rates[picked.value] ?? null))
</script>

<template>
  <div ref="wrap" class="rate-chart">
    <svg v-if="geom" :width="geom.W" :height="geom.H" :viewBox="`0 0 ${geom.W} ${geom.H}`" role="img" aria-label="Change per day between records">
      <g class="grid">
        <g v-for="t in geom.yTicks" :key="'y' + t">
          <line :x1="pad.l" :x2="geom.W - pad.r" :y1="geom.sy(t)" :y2="geom.sy(t)" />
          <text :x="pad.l - 6" :y="geom.sy(t) + 4" text-anchor="end">{{ fmtAxis(t) }}</text>
        </g>
        <text v-for="t in geom.xTicks" :key="'x' + t.x" :x="t.x" :y="geom.H - 6" text-anchor="middle">{{ t.label }}</text>
      </g>
      <rect
        v-for="b in geom.bars"
        :key="b.i"
        :x="b.x"
        :y="b.y"
        :width="b.w"
        :height="b.h"
        rx="1.5"
        class="bar"
        :class="[b.up ? 'up' : 'down', { picked: picked === b.i }]"
        @click="picked = picked === b.i ? null : b.i"
      />
      <line class="zero" :x1="pad.l" :x2="geom.W - pad.r" :y1="geom.zeroY" :y2="geom.zeroY" />
    </svg>
    <p v-else class="muted small empty">Nothing to show here: it needs records on at least two days.</p>
    <p v-if="readout" class="readout small">
      {{ fmtDate(readout.from, { short: true }) }} → {{ fmtDate(readout.to, { short: true }) }} ({{ readout.days }} day{{ readout.days === 1 ? '' : 's' }}):
      <b class="money" :class="readout.perDay >= 0 ? 'pos' : 'neg'">{{ fmtMoney(readout.perDay, { sign: true }) }} a day</b>,
      {{ fmtMoney(readout.start) }} → {{ fmtMoney(readout.end) }}
    </p>
  </div>
</template>

<style scoped>
.rate-chart {
  width: 100%;
  min-width: 0;
}

svg {
  display: block;
  touch-action: pan-y;
}

.grid line {
  stroke: var(--line);
}

.grid text {
  fill: var(--mute);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.zero {
  stroke: var(--mute);
  stroke-width: 1.25;
}

.bar {
  cursor: pointer;
  opacity: 0.85;
}

.bar.up {
  fill: var(--pos);
}

.bar.down {
  fill: var(--negative);
}

.bar.picked {
  opacity: 1;
  stroke: var(--ink);
  stroke-width: 1.25;
}

.empty {
  padding: 1.5rem 0;
  text-align: center;
}

.readout {
  margin: 0.4rem 0 0;
}

.pos {
  color: var(--pos);
}

.neg {
  color: var(--negative);
}
</style>
