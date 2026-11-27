<script setup lang="ts">
// One candle per day of a line's value: body from the day's open to its close,
// wick from its low to its high. Between records the value moves at an even
// rate, so those days are small candles; record days show the actual jumps.
// Green = it went up that day, red = down. Tap a candle to read it.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { DayCandle } from '../../lib/analysis'
import { dayNum, fmtDate, fmtMoney, fmtTime, fromDayNum, monthFromIndex, monthIndex, monthLabel, ymd } from '../../lib/money'

/** `show` hides rising or falling days without changing the scale. */
const props = withDefaults(defineProps<{ candles: DayCandle[]; show?: 'both' | 'up' | 'down'; height?: number }>(), { show: 'both', height: 220 })

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
  const s = a >= 10_000 ? `$${Math.round(a / 1000)}k` : a >= 1000 ? `$${(a / 1000).toFixed(1).replace(/\.0$/, '')}k` : `$${Math.round(a)}`
  return v < 0 ? `(${s})` : s
}
const up = (c: DayCandle) => c.close >= c.open

const geom = computed(() => {
  const cs = props.candles
  if (!cs.length) return null
  const x0 = dayNum(cs[0].date)
  const x1 = dayNum(cs[cs.length - 1].date) + 1
  let y0 = Math.min(0, ...cs.map((c) => c.low))
  let y1 = Math.max(0, ...cs.map((c) => c.high))
  if (y0 === y1) y1 = y0 + 1
  const step = niceStep(y1 - y0, 4)
  y0 = Math.floor(y0 / step) * step
  y1 = Math.ceil(y1 / step) * step
  const W = width.value
  const H = props.height
  const sx = (x: number) => pad.l + ((x - x0) / (x1 - x0)) * (W - pad.l - pad.r)
  const sy = (y: number) => pad.t + (1 - (y - y0) / (y1 - y0)) * (H - pad.t - pad.b)
  const dayW = (W - pad.l - pad.r) / (x1 - x0)
  const bodyW = Math.max(1.5, Math.min(14, dayW * 0.7))
  const yTicks: number[] = []
  for (let v = y0; v <= y1 + step / 2; v += step) yTicks.push(Math.round(v * 100) / 100)
  const months: { x: number; label: string }[] = []
  for (let mi = monthIndex(fromDayNum(x0)); mi <= monthIndex(fromDayNum(x1)) + 1; mi++) {
    const { y, m } = monthFromIndex(mi)
    const dn = dayNum(ymd(y, m, 1))
    if (dn >= x0 && dn <= x1) months.push({ x: dn, label: monthLabel(mi) })
  }
  const every = Math.ceil(months.length / Math.max(2, Math.floor((W - pad.l - pad.r) / 48)))
  const visible = (c: DayCandle) => props.show === 'both' || (props.show === 'up' ? up(c) && c.close !== c.open : !up(c))
  const candles = cs.flatMap((c, i) => {
    if (!visible(c)) return []
    const cx = sx(dayNum(c.date) + 0.5)
    const top = sy(Math.max(c.open, c.close))
    const bottom = sy(Math.min(c.open, c.close))
    return [{ i, cx, x: cx - bodyW / 2, w: bodyW, top, h: Math.max(1, bottom - top), hi: sy(c.high), lo: sy(c.low), up: up(c), rec: c.records.length > 0 }]
  })
  return {
    W,
    H,
    sy,
    yTicks,
    xTicks: months.filter((_, i) => i % every === 0).map((m) => ({ x: sx(m.x), label: m.label })),
    candles,
    zeroY: y0 < 0 && y1 > 0 ? sy(0) : null,
    pick: (px: number) => Math.max(0, Math.min(cs.length - 1, Math.floor(((px - pad.l) / (W - pad.l - pad.r)) * (x1 - x0)))),
  }
})

const picked = ref<number | null>(null)
function onTap(e: PointerEvent) {
  const g = geom.value
  if (!g) return
  const rect = (e.currentTarget as SVGElement).getBoundingClientRect()
  picked.value = g.pick(e.clientX - rect.left)
}
const readout = computed(() => (picked.value == null ? null : props.candles[picked.value] ?? null))
</script>

<template>
  <div ref="wrap" class="candle-chart">
    <svg v-if="geom" :width="geom.W" :height="geom.H" :viewBox="`0 0 ${geom.W} ${geom.H}`" role="img" aria-label="Daily candles" @pointerdown="onTap">
      <g class="grid">
        <g v-for="t in geom.yTicks" :key="'y' + t">
          <line :x1="pad.l" :x2="geom.W - pad.r" :y1="geom.sy(t)" :y2="geom.sy(t)" />
          <text :x="pad.l - 6" :y="geom.sy(t) + 4" text-anchor="end">{{ fmtAxis(t) }}</text>
        </g>
        <text v-for="t in geom.xTicks" :key="'x' + t.x" :x="t.x" :y="geom.H - 6" text-anchor="middle">{{ t.label }}</text>
      </g>
      <line v-if="geom.zeroY != null" class="zero" :x1="pad.l" :x2="geom.W - pad.r" :y1="geom.zeroY" :y2="geom.zeroY" />
      <g v-for="c in geom.candles" :key="c.i" :class="[c.up ? 'up' : 'down', { picked: picked === c.i, rec: c.rec }]">
        <line class="wick" :x1="c.cx" :x2="c.cx" :y1="c.hi" :y2="c.lo" />
        <rect class="body" :x="c.x" :y="c.top" :width="c.w" :height="c.h" rx="1" />
      </g>
    </svg>
    <p v-else class="muted small empty">Nothing to show here: it needs at least two records.</p>

    <div v-if="readout" class="readout small">
      <div>
        <b>{{ fmtDate(readout.date) }}</b>:
        {{ fmtMoney(readout.open) }} → {{ fmtMoney(readout.close) }}
        <b class="money" :class="readout.close >= readout.open ? 'pos' : 'neg'">({{ fmtMoney(readout.close - readout.open, { sign: true }) }})</b>
      </div>
      <div v-if="readout.records.length" class="muted">
        Records:
        <span v-for="(r, i) in readout.records" :key="r.at">{{ i ? ' → ' : '' }}{{ fmtTime(r.at) }} {{ fmtMoney(r.value) }}</span>
      </div>
      <div v-else-if="readout.between" class="muted">
        No record this day: between {{ fmtDate(readout.between.from, { short: true }) }} and {{ fmtDate(readout.between.to, { short: true }) }} it changed
        {{ fmtMoney(readout.between.perDay, { sign: true }) }} a day on average.
      </div>
    </div>
  </div>
</template>

<style scoped>
.candle-chart {
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

.wick {
  stroke-width: 1.25;
}

.up .wick {
  stroke: var(--pos);
}

.up .body {
  fill: var(--pos);
}

.down .wick {
  stroke: var(--negative);
}

.down .body {
  fill: var(--negative);
}

/* days without a record are averages: lighter */
g:not(.rec) .body {
  opacity: 0.45;
}

.picked .body {
  opacity: 1;
  stroke: var(--ink);
  stroke-width: 1.25;
}

.empty {
  padding: 1.5rem 0;
  text-align: center;
}

.readout {
  margin-top: 0.4rem;
  display: grid;
  gap: 0.15rem;
}

.pos {
  color: var(--pos);
}

.neg {
  color: var(--negative);
}
</style>
