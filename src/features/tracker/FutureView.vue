<script setup lang="ts">
// Future tab: pick a projection (each is its own file in projections/), see where
// it's heading, and edit its items. Items are a compact list; "+ Add" opens a
// menu of the four kinds, each with its own sheet. Edits save straight away.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ChevronDown, Plus, Settings2 } from '@lucide/vue'
import { HORIZON_PRESETS, type ItemKind, type ProjectionItem, describeSource, startValueCents } from '../../lib/finance'
import { atNum, dayNum, fmtDate, fmtDateTime, fmtMoney } from '../../lib/money'
import ItemModal from './ItemModal.vue'
import LineChart, { type ChartMarker, type ChartSeries } from './LineChart.vue'
import ProjectionModal from './ProjectionModal.vue'
import { KIND_INFO, KIND_ORDER, summarize } from './projectionText'
import { useTracker } from './useTracker'

const { projections, selected, selectedId, records, latest, currentProjection, resultsFor, saveProjection, selectProjection } =
  useTracker()

/** How far back the chart shows past records. */
const CHART_PAST_DAYS = 120

const p = computed(() => selected.value)
const future = computed(() => currentProjection.value)
const results = computed(() => (p.value ? resultsFor(p.value) : {}))

// ---- heading
const subject = computed(() => {
  if (!p.value) return ''
  return p.value.start.mode === 'all' ? 'Left so far' : p.value.name
})
const heading = computed(() => {
  const f = future.value
  if (!f) return ''
  if (f.min.value < 0) return `${subject.value} dips to ${fmtMoney(f.min.value, { whole: true })} around ${fmtDate(f.min.date)}`
  return `${subject.value} reaches ${fmtMoney(f.end.value, { whole: true })} by ${fmtDate(f.end.date)}`
})
const startText = computed(() => {
  const proj = p.value
  if (!proj) return ''
  if (proj.start.mode === 'all') return 'all lines'
  const n = proj.start.names.length
  return n <= 3 ? proj.start.names.join(', ') : `${proj.start.names.slice(0, 2).join(', ')} and ${n - 2} more`
})

// ---- chart: the same starting total in past records, then the projection
const chart = computed(() => {
  const f = future.value
  const l = latest.value
  const proj = p.value
  if (!f || !l || !proj) return null
  const from = dayNum(l.date) - CHART_PAST_DAYS
  const past = records.value
    .filter((r) => dayNum(r.date) >= from)
    .map((r) => ({ x: atNum(r.at), y: startValueCents(r, proj.start) / 100 }))
  const series: ChartSeries[] = [
    { label: 'Records', color: 'var(--pos)', points: past, dots: true, width: 2.5 },
    {
      label: 'Projection',
      color: 'var(--projection)',
      dashed: true,
      points: [{ x: atNum(l.at), y: f.start.value }, ...f.series.map((pt) => ({ x: dayNum(pt.date), y: pt.value }))],
    },
  ]
  const markers: ChartMarker[] =
    f.min.value < f.start.value
      ? [
          {
            x: dayNum(f.min.date),
            y: f.min.value,
            color: f.min.value < 0 ? 'var(--negative)' : 'var(--projection)',
            label: `${fmtMoney(f.min.value, { whole: true })} · ${fmtDate(f.min.date, { short: true })}`,
          },
        ]
      : []
  return { series, markers }
})

// ---- days ahead (stored in the projection file)
async function setHorizon(h: number) {
  if (p.value && p.value.horizonDays !== h) await saveProjection({ ...p.value, horizonDays: h })
}

// ---- items
const showAddMenu = ref(false)
const addWrap = ref<HTMLElement>()
const editing = ref<{ kind: ItemKind; item?: ProjectionItem } | null>(null)
const showSetup = ref<'new' | 'edit' | null>(null)

function startAdd(kind: ItemKind) {
  showAddMenu.value = false
  editing.value = { kind }
}
function onDocClick(e: MouseEvent) {
  if (showAddMenu.value && addWrap.value && !addWrap.value.contains(e.target as Node)) showAddMenu.value = false
}
onMounted(() => document.addEventListener('click', onDocClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))

async function saveItem(item: ProjectionItem) {
  const proj = p.value
  if (!proj) return
  const exists = proj.items.some((i) => i.id === item.id)
  const items = exists ? proj.items.map((i) => (i.id === item.id ? item : i)) : [...proj.items, item]
  await saveProjection({ ...proj, items })
  editing.value = null
}
async function removeItem(id: string) {
  const proj = p.value
  if (!proj) return
  await saveProjection({ ...proj, items: proj.items.filter((i) => i.id !== id) })
  editing.value = null
}

const rows = computed(() =>
  (p.value?.items ?? [])
    .map((item) => ({ item, s: summarize(item, results.value[item.id], p.value!) }))
    .sort((a, b) => KIND_ORDER.indexOf(a.item.kind) - KIND_ORDER.indexOf(b.item.kind)),
)
</script>

<template>
  <div class="future">
    <!-- which projection -->
    <div class="picker">
      <label class="pick">
        <span class="sr">Projection</span>
        <select class="select" :value="selectedId" @change="selectProjection(($event.target as HTMLSelectElement).value)">
          <option v-for="x in projections" :key="x.id" :value="x.id">{{ x.name }}</option>
        </select>
      </label>
      <button class="btn icon-btn" title="Projection setup" aria-label="Projection setup" @click="showSetup = 'edit'">
        <Settings2 class="ic" aria-hidden="true" />
      </button>
      <button class="btn" @click="showSetup = 'new'"><Plus class="ic" aria-hidden="true" />New</button>
    </div>

    <section v-if="p" class="card">
      <template v-if="future">
        <h2 class="finding" :class="{ neg: future.min.value < 0 }">{{ heading }}</h2>
        <p class="muted small from">
          Starts at <b class="money">{{ fmtMoney(future.start.value) }}</b> from {{ startText }} on
          {{ latest ? fmtDateTime(latest.at) : fmtDate(future.start.date) }} ·
          <button class="link" @click="showSetup = 'edit'">change</button>
        </p>
        <div class="horizon" role="radiogroup" aria-label="Days ahead">
          <button
            v-for="h in HORIZON_PRESETS"
            :key="h"
            role="radio"
            :aria-checked="p.horizonDays === h"
            :class="{ on: p.horizonDays === h }"
            @click="setHorizon(h)"
          >
            {{ h }} days
          </button>
        </div>
        <p v-if="!HORIZON_PRESETS.includes(p.horizonDays)" class="muted small">Showing {{ p.horizonDays }} days ahead.</p>
        <LineChart v-if="chart" :series="chart.series" :markers="chart.markers" include-zero />
        <p class="muted small fine">A guide, not a promise.</p>
      </template>
      <template v-else>
        <h2>No projection yet</h2>
        <p class="muted">
          Save your first record on the Present tab. Each projection starts from your latest record and looks ahead
          with the items below.
        </p>
      </template>
    </section>

    <!-- items -->
    <section v-if="p" class="card items">
      <div class="items-head">
        <h2>Items</h2>
        <div ref="addWrap" class="add-wrap">
          <button
            class="btn primary"
            aria-haspopup="menu"
            :aria-expanded="showAddMenu"
            @click="showAddMenu = !showAddMenu"
          >
            <Plus class="ic" aria-hidden="true" />Add<ChevronDown class="ic" aria-hidden="true" />
          </button>
          <div v-if="showAddMenu" class="menu" role="menu">
            <button v-for="k in KIND_ORDER" :key="k" role="menuitem" class="menu-item" @click="startAdd(k)">
              <b>{{ KIND_INFO[k].label }}</b>
              <span class="muted small">{{ KIND_INFO[k].help }}</span>
            </button>
          </div>
        </div>
      </div>

      <ul v-if="rows.length" class="list">
        <li v-for="r in rows" :key="r.item.id">
          <button class="row" @click="editing = { kind: r.item.kind, item: r.item }">
            <span class="kind">{{ KIND_INFO[r.item.kind].label }}</span>
            <span class="name">{{ r.item.name }}</span>
            <span class="amount money" :class="r.s.tone">{{ r.s.amount }}</span>
            <span class="detail muted small">
              <span v-if="r.s.tag" class="tag">{{ r.s.tag }}</span>{{ r.s.detail }}
            </span>
          </button>
        </li>
      </ul>
      <p v-else class="muted small">
        Nothing yet. Tap <b>Add</b> for monthly or one-time amounts, averages from your records
        ({{ describeSource('', p.start) }} usually means everyday spending), or a value extrapolated to month end.
      </p>
    </section>

    <ItemModal
      v-if="editing && p"
      :kind="editing.kind"
      :item="editing.item"
      :projection="p"
      @save="saveItem"
      @remove="removeItem"
      @close="editing = null"
    />
    <ProjectionModal
      v-if="showSetup"
      :projection="showSetup === 'edit' ? p : undefined"
      @close="showSetup = null"
    />
  </div>
</template>

<style scoped>
.future > * + * {
  margin-top: 1rem;
}

.picker {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 0.4rem;
}

.icon-btn {
  padding: 0;
  width: var(--tap);
}

.ic {
  width: 1.1rem;
  height: 1.1rem;
  stroke-width: 1.75;
}

.sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}

.finding {
  font-size: clamp(1.15rem, 5vw, 1.5rem) !important;
  line-height: 1.2;
}

.finding.neg {
  color: var(--negative);
}

.from {
  margin: -0.2rem 0 0.6rem;
}

.link {
  background: none;
  border: none;
  padding: 0.3rem 0;
  color: var(--accent);
  font-size: inherit;
  font-weight: 600;
}

.horizon {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.35rem;
  margin-bottom: 0.75rem;
}

.horizon button {
  min-height: 40px;
  border: 1px solid var(--btn-border);
  background: var(--btn-bg);
  color: var(--btn-text);
  border-radius: var(--btn-radius);
  font-weight: 550;
  font-size: 0.85rem;
  white-space: nowrap;
  padding: 0 0.2rem;
}

.horizon button.on {
  border-color: var(--projection);
  color: var(--projection);
}

.fine {
  margin: 0.5rem 0 0;
}

.items-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.5rem;
}

.items-head h2 {
  margin: 0 !important;
}

.add-wrap {
  position: relative;
}

.menu {
  position: absolute;
  right: 0;
  top: calc(100% + 4px);
  z-index: 40;
  width: min(19rem, calc(100vw - 2.5rem));
  display: grid;
  gap: 0.3rem;
  padding: 0.4rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-elev);
  box-shadow: var(--shadow);
}

.menu-item {
  display: grid;
  gap: 0.1rem;
  text-align: left;
  padding: 0.55rem 0.65rem;
  min-height: var(--tap);
  border: 1px solid var(--btn-border);
  border-radius: var(--btn-radius);
  background: var(--btn-bg);
  color: var(--btn-text);
}

.menu-item:hover {
  background: var(--btn-bg-hover);
}

.list {
  list-style: none;
  margin: 0;
  padding: 0;
  border-top: 1px solid var(--line);
}

.row {
  width: 100%;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-areas:
    'kind kind'
    'name amount'
    'detail detail';
  gap: 0 0.6rem;
  padding: 0.55rem 0.1rem;
  border: none;
  border-bottom: 1px solid var(--line);
  background: none;
  color: var(--ink);
  text-align: left;
}

.row:hover {
  background: var(--panel-2);
}

.kind {
  grid-area: kind;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mute);
}

.name {
  grid-area: name;
  font-weight: 600;
  min-width: 0;
  overflow-wrap: anywhere;
}

.amount {
  grid-area: amount;
  font-weight: 700;
}

.amount.warn {
  color: var(--projection);
}

.detail {
  grid-area: detail;
}

.tag {
  display: inline-block;
  margin-right: 0.35rem;
  padding: 0 0.4rem;
  border-radius: 999px;
  background: var(--projection);
  color: var(--btn-primary-text);
  font-size: 0.68rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
</style>
