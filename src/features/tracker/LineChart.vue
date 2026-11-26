<script setup lang="ts">
// Hand-rolled SVG line chart. Sized by a ResizeObserver so it always fills its
// container at 1:1 pixels; x is a day number, y is dollars.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { fmtDate, fmtMoney, fromDayNum, monthIndex, monthLabel, ymd, monthFromIndex, dayNum } from '../../lib/money'

export interface ChartSeries {
  label: string
  color: string
  points: { x: number; y: number }[]
  dashed?: boolean
  dots?: boolean
  width?: number
}

export interface ChartMarker {
  x: number
  y: number
  color: string
  label: string
}

const props = withDefaults(
  defineProps<{
    series: ChartSeries[]
    markers?: ChartMarker[]
    height?: number
    includeZero?: boolean
  }>(),
  { markers: () => [], height: 230, includeZero: false },
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

const pad = { l: 56, r: 12, t: 14, b: 26 }

function niceStep(range: number, target: number) {
  const raw = range / Math.max(1, target)
  const mag = 10 ** Math.floor(Math.log10(raw || 1))
  const n = raw / mag
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag
}

const geom = computed(() => {
  const pts = props.series.flatMap((s) => s.points)
  if (!pts.length) return null
  let x0 = Math.min(...pts.map((p) => p.x))
  let x1 = Math.max(...pts.map((p) => p.x))
  if (x1 === x0) {
    x0 -= 1
    x1 += 1
  }
  let y0 = Math.min(...pts.map((p) => p.y))
  let y1 = Math.max(...pts.map((p) => p.y))
  if (props.includeZero) {
    y0 = Math.min(y0, 0)
    y1 = Math.max(y1, 0)
  }
  if (y1 === y0) {
    y0 -= 100
    y1 += 100
  }
  const step = niceStep(y1 - y0, 4)
  y0 = Math.floor(y0 / step) * step
  y1 = Math.ceil(y1 / step) * step

  const W = width.value
  const H = props.height
  const sx = (x: number) => pad.l + ((x - x0) / (x1 - x0)) * (W - pad.l - pad.r)
  const sy = (y: number) => pad.t + (1 - (y - y0) / (y1 - y0)) * (H - pad.t - pad.b)

  const yTicks: number[] = []
  for (let v = y0; v <= y1 + step / 2; v += step) yTicks.push(Math.round(v * 100) / 100)

  // month ticks on the 1st of each month in range
  const m0 = monthIndex(fromDayNum(Math.ceil(x0)))
  const m1 = monthIndex(fromDayNum(Math.floor(x1)))
  const months: { x: number; label: string }[] = []
  for (let mi = m0; mi <= m1 + 1; mi++) {
    const { y, m } = monthFromIndex(mi)
    const dn = dayNum(ymd(y, m, 1))
    if (dn >= x0 && dn <= x1) months.push({ x: dn, label: monthLabel(mi) })
  }
  const maxTicks = Math.max(2, Math.floor((W - pad.l - pad.r) / 48))
  const every = Math.ceil(months.length / maxTicks)
  const xTicks = months.filter((_, i) => i % every === 0)

  const paths = props.series.map((s) => ({
    ...s,
    d: s.points.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(''),
    dotsAt: s.dots ? s.points.map((p) => ({ cx: sx(p.x), cy: sy(p.y) })) : [],
  }))

  return { W, H, sx, sy, x0, x1, yTicks, xTicks, paths, zeroY: y0 < 0 && y1 > 0 ? sy(0) : null }
})

const fmtAxis = (v: number) => {
  const a = Math.abs(v)
  const s = a >= 10_000 ? `$${Math.round(a / 1000)}k` : a >= 1000 ? `$${(a / 1000).toFixed(1).replace(/\.0$/, '')}k` : `$${Math.round(a)}`
  return v < 0 ? `−${s}` : s
}

// ---- tap / hover readout
const hoverX = ref<number | null>(null)
function onMove(e: PointerEvent) {
  const g = geom.value
  if (!g) return
  const rect = (e.currentTarget as SVGElement).getBoundingClientRect()
  const px = e.clientX - rect.left
  const x = g.x0 + ((px - pad.l) / (g.W - pad.l - pad.r)) * (g.x1 - g.x0)
  hoverX.value = Math.round(Math.min(g.x1, Math.max(g.x0, x)))
}
const readout = computed(() => {
  const g = geom.value
  if (!g || hoverX.value == null) return null
  const rows = props.series
    .map((s) => {
      if (!s.points.length) return null
      let best = s.points[0]
      for (const p of s.points) if (Math.abs(p.x - hoverX.value!) < Math.abs(best.x - hoverX.value!)) best = p
      return Math.abs(best.x - hoverX.value!) <= 3 ? { label: s.label, color: s.color, p: best } : null
    })
    .filter((r): r is NonNullable<typeof r> => !!r)
  if (!rows.length) return null
  const x = g.sx(rows[0].p.x)
  return { x, rows, date: fmtDate(fromDayNum(rows[0].p.x)), left: x > g.W / 2 }
})
</script>

<template>
  <div ref="wrap" class="chart">
    <svg
      v-if="geom"
      :width="geom.W"
      :height="geom.H"
      :viewBox="`0 0 ${geom.W} ${geom.H}`"
      role="img"
      @pointermove="onMove"
      @pointerdown="onMove"
      @pointerleave="hoverX = null"
    >
      <g class="grid">
        <g v-for="t in geom.yTicks" :key="'y' + t">
          <line :x1="pad.l" :x2="geom.W - pad.r" :y1="geom.sy(t)" :y2="geom.sy(t)" />
          <text :x="pad.l - 6" :y="geom.sy(t) + 4" text-anchor="end">{{ fmtAxis(t) }}</text>
        </g>
        <g v-for="t in geom.xTicks" :key="'x' + t.x">
          <line class="tick" :x1="geom.sx(t.x)" :x2="geom.sx(t.x)" :y1="geom.H - pad.b" :y2="geom.H - pad.b + 4" />
          <text :x="geom.sx(t.x)" :y="geom.H - 6" text-anchor="middle">{{ t.label }}</text>
        </g>
        <line
          v-if="geom.zeroY != null"
          class="zero"
          :x1="pad.l"
          :x2="geom.W - pad.r"
          :y1="geom.zeroY"
          :y2="geom.zeroY"
        />
      </g>

      <g v-for="s in geom.paths" :key="s.label">
        <path
          :d="s.d"
          fill="none"
          :style="{ stroke: s.color, strokeWidth: s.width ?? 2 }"
          :stroke-dasharray="s.dashed ? '6 5' : undefined"
          stroke-linejoin="round"
          stroke-linecap="round"
        />
        <circle v-for="(d, i) in s.dotsAt" :key="i" :cx="d.cx" :cy="d.cy" r="3" :style="{ fill: s.color }" />
      </g>

      <g v-for="m in markers" :key="'m' + m.x">
        <circle :cx="geom.sx(m.x)" :cy="geom.sy(m.y)" r="8" fill="none" stroke-width="2" :style="{ stroke: m.color }" />
        <text
          class="marker-label"
          :x="geom.sx(m.x)"
          :y="geom.sy(m.y) + (geom.sy(m.y) > geom.H - 50 ? -14 : 22)"
          :text-anchor="geom.sx(m.x) > geom.W - 70 ? 'end' : geom.sx(m.x) < pad.l + 60 ? 'start' : 'middle'"
          :style="{ fill: m.color }"
        >
          {{ m.label }}
        </text>
      </g>

      <g v-if="readout">
        <line class="cross" :x1="readout.x" :x2="readout.x" :y1="pad.t" :y2="geom.H - pad.b" />
      </g>
    </svg>
    <div v-else class="empty muted small">Nothing to chart yet.</div>

    <div v-if="readout" class="readout" :class="{ left: readout.left }">
      <div class="muted">{{ readout.date }}</div>
      <div v-for="r in readout.rows" :key="r.label" class="row">
        <span class="sw" :style="{ background: r.color }"></span>{{ r.label }}
        <b class="money">{{ fmtMoney(r.p.y) }}</b>
      </div>
    </div>

    <div class="legend small">
      <span v-for="s in series" :key="s.label">
        <span class="sw" :class="{ dashed: s.dashed }" :style="{ borderColor: s.color }"></span>{{ s.label }}
      </span>
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
  stroke-width: 1;
}

.grid line.zero {
  stroke: var(--mute);
  stroke-width: 1.25;
}

.grid text {
  fill: var(--mute);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.marker-label {
  font-size: 12px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  paint-order: stroke;
  stroke: var(--panel);
  stroke-width: 4px;
}

.cross {
  stroke: var(--mute);
  stroke-dasharray: 2 3;
}

.empty {
  padding: 2rem 0;
  text-align: center;
}

.readout {
  position: absolute;
  top: 0;
  right: 0;
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 0.5rem;
  padding: 0.35rem 0.55rem;
  font-size: 0.78rem;
  pointer-events: none;
}

.readout.left {
  right: auto;
  left: 3.6rem;
}

.readout .row {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.readout b {
  margin-left: auto;
  padding-left: 0.6rem;
}

.readout .sw {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem 1rem;
  color: var(--mute);
  margin-top: 0.3rem;
}

.legend .sw {
  display: inline-block;
  width: 18px;
  height: 0;
  border-top: 2.5px solid;
  vertical-align: middle;
  margin-right: 0.35rem;
}

.legend .sw.dashed {
  border-top-style: dashed;
}
</style>
