<script setup lang="ts">
// Forecast chart: what each projection contributes, as stacked bars, with the
// forecast (their total) as a line, and past records leading into it.
//
// Each bar is one point in time. Its segments are the starting balance and
// every projection's cumulative change by then: positive segments stack up from
// zero, negative ones down. The forecast line passes through the net of each bar.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { fmtDate, fmtMoney, fromDayNum, monthIndex, monthLabel, monthFromIndex, dayNum, ymd } from '../../lib/money'

export interface Segment {
  id: string
  label: string
  color: string
}

const props = withDefaults(
  defineProps<{
    /** Past records: x = day number (fractional for time of day), y = starting total then. */
    past: { x: number; y: number }[]
    /** Where the forecast starts. */
    start: { x: number; y: number }
    /** Forecast days, aligned with every `values` array. */
    days: { date: string; total: number }[]
    /** The starting-balance segment and one per projection. */
    segments: Segment[]
    /** Per segment id, its value on each forecast day (the start segment is constant). */
    values: Record<string, number[]>
    height?: number
  }>(),
  { height: 240 },
)

const wrap = ref<HTMLElement>()
const width = ref(320)
let ro: ResizeObserver | undefined
onMounted(() => {
  if (!wrap.value) return
  width.value = wrap.value.clientWidth || 320
  ro = new ResizeObserver((entries) => {
    const w = Math.round(entries[0].contentRect.width)
    if (w > 0) width.value = w
  })
  ro.observe(wrap.value)
})
onBeforeUnmount(() => ro?.disconnect())

const pad = { l: 56, r: 10, t: 12, b: 26 }

/** About a dozen bars: daily for short forecasts, then weekly multiples. */
function barIndexes(n: number): number[] {
  if (!n) return []
  const step = n <= 14 ? 1 : 7 * Math.max(1, Math.ceil(n / 7 / 13))
  const out: number[] = []
  for (let i = step - 1; i < n; i += step) out.push(i)
  if (out[out.length - 1] !== n - 1) out.push(n - 1)
  return out
}

function niceStep(range: number, target: number) {
  const raw = range / Math.max(1, target)
  const mag = 10 ** Math.floor(Math.log10(raw || 1))
  const n = raw / mag
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag
}

const geom = computed(() => {
  const W = width.value
  const H = props.height
  const idx = barIndexes(props.days.length)
  const bars = idx.map((i) => {
    let up = 0
    let down = 0
    const parts = props.segments.map((s) => {
      const v = props.values[s.id]?.[i] ?? 0
      const from = v >= 0 ? up : down
      if (v >= 0) up += v
      else down += v
      return { ...s, v, y0: from, y1: from + v }
    })
    return { i, x: dayNum(props.days[i].date), date: props.days[i].date, total: props.days[i].total, parts, up, down }
  })

  const xs = [...props.past.map((p) => p.x), props.start.x, ...props.days.map((d) => dayNum(d.date))]
  let x0 = Math.min(...xs)
  let x1 = Math.max(...xs)
  if (x1 - x0 < 2) {
    x0 -= 1
    x1 += 1
  }
  const ys = [0, ...props.past.map((p) => p.y), props.start.y, ...props.days.map((d) => d.total), ...bars.flatMap((b) => [b.up, b.down])]
  let y0 = Math.min(...ys)
  let y1 = Math.max(...ys)
  if (y1 === y0) {
    y0 -= 100
    y1 += 100
  }
  const step = niceStep(y1 - y0, 4)
  y0 = Math.floor(y0 / step) * step
  y1 = Math.ceil(y1 / step) * step

  const plotW = W - pad.l - pad.r
  const sx = (x: number) => pad.l + ((x - x0) / (x1 - x0)) * plotW
  const sy = (y: number) => pad.t + (1 - (y - y0) / (y1 - y0)) * (H - pad.t - pad.b)

  // Bar width: most of the gap between bars, capped.
  const gap = bars.length > 1 ? sx(bars[1].x) - sx(bars[0].x) : plotW / 4
  const bw = Math.max(3, Math.min(26, gap * 0.62))

  const yTicks: number[] = []
  for (let v = y0; v <= y1 + step / 2; v += step) yTicks.push(Math.round(v * 100) / 100)

  const m0 = monthIndex(fromDayNum(Math.ceil(x0)))
  const m1 = monthIndex(fromDayNum(Math.floor(x1)))
  const months: { x: number; label: string }[] = []
  for (let mi = m0; mi <= m1 + 1; mi++) {
    const { y, m } = monthFromIndex(mi)
    const dn = dayNum(ymd(y, m, 1))
    if (dn >= x0 && dn <= x1) months.push({ x: dn, label: monthLabel(mi) })
  }
  const every = Math.ceil(months.length / Math.max(2, Math.floor(plotW / 48)))
  const xTicks = months.filter((_, i) => i % every === 0)

  const path = (pts: { x: number; y: number }[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join('')
  const pastPath = path([...props.past, props.start].filter((p, i, a) => i === a.length - 1 || p.x <= props.start.x))
  const linePath = path([props.start, ...props.days.map((d) => ({ x: dayNum(d.date), y: d.total }))])

  return { W, H, sx, sy, bw, bars, yTicks, xTicks, pastPath, linePath, zeroY: sy(0) }
})

const fmtAxis = (v: number) => {
  const a = Math.abs(v)
  const s = a >= 10_000 ? `$${Math.round(a / 1000)}k` : a >= 1000 ? `$${(a / 1000).toFixed(1).replace(/\.0$/, '')}k` : `$${Math.round(a)}`
  return v < 0 ? `(${s})` : s
}

// ---- tap / hover: nearest bar's breakdown
const active = ref<number | null>(null)
function onPointer(e: PointerEvent) {
  const g = geom.value
  if (!g.bars.length) return
  const rect = (e.currentTarget as SVGElement).getBoundingClientRect()
  const px = e.clientX - rect.left
  let best = 0
  for (let k = 1; k < g.bars.length; k++) if (Math.abs(g.sx(g.bars[k].x) - px) < Math.abs(g.sx(g.bars[best].x) - px)) best = k
  active.value = best
}
const readout = computed(() => {
  const g = geom.value
  if (active.value == null || !g.bars[active.value]) return null
  const b = g.bars[active.value]
  return { b, x: g.sx(b.x), left: g.sx(b.x) > g.W / 2 }
})
</script>

<template>
  <div ref="wrap" class="chart">
    <svg
      :width="geom.W"
      :height="geom.H"
      :viewBox="`0 0 ${geom.W} ${geom.H}`"
      role="img"
      aria-label="Forecast: stacked projections with the total as a line"
      @pointermove="onPointer"
      @pointerdown="onPointer"
      @pointerleave="active = null"
    >
      <g class="grid">
        <g v-for="t in geom.yTicks" :key="'y' + t">
          <line :x1="pad.l" :x2="geom.W - pad.r" :y1="geom.sy(t)" :y2="geom.sy(t)" />
          <text :x="pad.l - 6" :y="geom.sy(t) + 4" text-anchor="end">{{ fmtAxis(t) }}</text>
        </g>
        <text v-for="t in geom.xTicks" :key="'x' + t.x" :x="geom.sx(t.x)" :y="geom.H - 6" text-anchor="middle">
          {{ t.label }}
        </text>
      </g>

      <!-- stacked bars -->
      <g v-for="(b, k) in geom.bars" :key="b.i" :class="{ dim: active != null && active !== k }">
        <template v-for="p in b.parts" :key="p.id">
          <rect
            v-if="Math.abs(p.v) >= 0.005"
            :x="geom.sx(b.x) - geom.bw / 2"
            :width="geom.bw"
            :y="Math.min(geom.sy(p.y0), geom.sy(p.y1))"
            :height="Math.max(1, Math.abs(geom.sy(p.y1) - geom.sy(p.y0)))"
            :style="{ fill: p.color }"
            rx="1.5"
          />
        </template>
      </g>

      <line class="zero" :x1="pad.l" :x2="geom.W - pad.r" :y1="geom.zeroY" :y2="geom.zeroY" />

      <!-- past records, then the forecast total -->
      <path v-if="past.length" :d="geom.pastPath" class="past" />
      <circle v-for="(p, i) in past" :key="'p' + i" :cx="geom.sx(p.x)" :cy="geom.sy(p.y)" r="2.6" class="past-dot" />
      <path :d="geom.linePath" class="total" />
      <circle :cx="geom.sx(start.x)" :cy="geom.sy(start.y)" r="3.2" class="start-dot" />

      <line v-if="readout" class="cross" :x1="readout.x" :x2="readout.x" :y1="pad.t" :y2="geom.H - pad.b" />
    </svg>

    <div v-if="readout" class="readout" :class="{ left: readout.left }">
      <div class="muted">{{ fmtDate(readout.b.date) }}</div>
      <div class="row total-row">
        <span class="sw line"></span>Forecast<b class="money">{{ fmtMoney(readout.b.total) }}</b>
      </div>
      <div v-for="p in readout.b.parts.filter((x) => Math.abs(x.v) >= 0.005)" :key="p.id" class="row">
        <span class="sw" :style="{ background: p.color }"></span>{{ p.label }}
        <b class="money">{{ fmtMoney(p.v, { sign: p.id !== '__start' }) }}</b>
      </div>
    </div>

    <div class="legend small">
      <span><span class="key line"></span>Forecast</span>
      <span v-if="past.length"><span class="key past-key"></span>Records</span>
      <span v-for="s in segments" :key="s.id"><span class="key box" :style="{ background: s.color }"></span>{{ s.label }}</span>
    </div>
  </div>
</template>

<style scoped>
.chart {
  position: relative;
  width: 100%;
  min-width: 0;
}

svg {
  display: block;
  touch-action: pan-y;
  user-select: none;
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
  stroke-width: 1;
}

.dim {
  opacity: 0.45;
}

.past {
  fill: none;
  stroke: var(--pos);
  stroke-width: 2;
  stroke-linejoin: round;
}

.past-dot {
  fill: var(--pos);
}

.total {
  fill: none;
  stroke: var(--ink);
  stroke-width: 2.25;
  stroke-linejoin: round;
  stroke-linecap: round;
}

.start-dot {
  fill: var(--ink);
}

.cross {
  stroke: var(--mute);
  stroke-dasharray: 2 3;
}

.readout {
  position: absolute;
  top: 0;
  right: 0;
  max-width: 70%;
  background: var(--bg-elev);
  border: 1px solid var(--line);
  border-radius: 0.5rem;
  padding: 0.35rem 0.55rem;
  font-size: 0.76rem;
  box-shadow: var(--shadow);
  pointer-events: none;
}

.readout.left {
  right: auto;
  left: 3.6rem;
}

.row {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.row b {
  margin-left: auto;
  padding-left: 0.6rem;
}

.total-row {
  font-weight: 700;
}

.sw {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 2px;
}

.sw.line {
  height: 2px;
  background: var(--ink);
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem 0.9rem;
  color: var(--mute);
  margin-top: 0.35rem;
}

.key {
  display: inline-block;
  vertical-align: middle;
  margin-right: 0.35rem;
}

.key.box {
  width: 10px;
  height: 10px;
  border-radius: 2px;
}

.key.line {
  width: 16px;
  border-top: 2.5px solid var(--ink);
}

.key.past-key {
  width: 16px;
  border-top: 2.5px solid var(--pos);
}
</style>
