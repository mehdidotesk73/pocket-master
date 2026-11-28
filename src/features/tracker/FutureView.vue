<script setup lang="ts">
// Future tab. A forecast (one file in projections/) starts from the latest
// record and adds up its projections (the items) over the days ahead.
//
// Two editors, both docked panels that leave the chart visible and drive it live:
//   - Edit / New forecast  → ForecastPanel (name, starting lines, days ahead)
//   - a projection row / + Add → ProjectionPanel (type carousel + fields)
// New things are drafts until saved: Cancel leaves nothing behind.
import { computed, nextTick, ref } from 'vue'
import { Pencil, Plus } from '@lucide/vue'
import { HORIZON_PRESETS, type ProjectionFile, type ProjectionItem, defaultProjection, newId, startValueCents } from '../../lib/finance'
import { atNum, dayNum, fmtDate, fmtDateTime, fmtMoney, today } from '../../lib/money'
import ForecastChart, { type Segment } from './ForecastChart.vue'
import ForecastPanel from './ForecastPanel.vue'
import ProjectionPanel from './ProjectionPanel.vue'
import { UI_INFO, colorFor, summarize, uiTypeOf } from './projectionText'
import { useTracker } from './useTracker'

const { projections, selected, selectedId, records, latest, projectFor, saveProjection, createProjection, deleteProjection, selectProjection } =
  useTracker()

/** How far back the chart shows past records. */
const CHART_PAST_DAYS = 120

// ---- editing state
const forecastEdit = ref<{ draft: ProjectionFile; isNew: boolean } | null>(null)
const itemEdit = ref<{ draft: ProjectionItem; isNew: boolean } | null>(null)

/** What's on screen: the saved forecast, or the one being edited (with any item draft applied). */
const shown = computed<ProjectionFile | null>(() => {
  if (forecastEdit.value) return forecastEdit.value.draft
  const f = selected.value
  if (!f) return null
  const e = itemEdit.value
  if (!e) return f
  const exists = f.items.some((i) => i.id === e.draft.id)
  return { ...f, items: exists ? f.items.map((i) => (i.id === e.draft.id ? e.draft : i)) : [...f.items, e.draft] }
})
const future = computed(() => (shown.value ? projectFor(shown.value) : null))

// ---- heading
const subject = computed(() => (shown.value?.start.mode === 'all' ? 'Net equity' : (shown.value?.name ?? '')))
const heading = computed(() => {
  const f = future.value
  if (!f) return ''
  if (f.min.value < 0) return `${subject.value} dips to ${fmtMoney(f.min.value, { whole: true })} around ${fmtDate(f.min.date)}`
  return `${subject.value} reaches ${fmtMoney(f.end.value, { whole: true })} by ${fmtDate(f.end.date)}`
})
const startText = computed(() => {
  const p = shown.value
  if (!p) return ''
  if (p.start.mode === 'all') return 'all lines'
  const n = p.start.names.length
  return n <= 3 ? p.start.names.join(', ') : `${p.start.names.slice(0, 2).join(', ')} and ${n - 2} more`
})

// ---- chart
const colorOf = computed(() => Object.fromEntries((shown.value?.items ?? []).map((it, i) => [it.id, colorFor(i)])))
const chart = computed(() => {
  const f = future.value
  const l = latest.value
  const p = shown.value
  if (!f || !p) return null
  // No records yet: the forecast starts at zero today, with no past to show.
  const from = l ? dayNum(l.date) - CHART_PAST_DAYS : Infinity
  const past = records.value.filter((r) => dayNum(r.date) >= from).map((r) => ({ x: atNum(r.at), y: startValueCents(r, p.start) / 100 }))
  // Bars: what each projection adds or takes away per period (the line carries the starting balance).
  const segments: Segment[] = p.items.map((it) => ({ id: it.id, label: it.name || UI_INFO[uiTypeOf(it)].label, color: colorOf.value[it.id] }))
  const values: Record<string, number[]> = f.contributions
  return {
    past,
    start: { x: l ? atNum(l.at) : dayNum(f.start.date), y: f.start.value },
    days: f.series.map((s) => ({ date: s.date, total: s.value })),
    segments,
    values,
  }
})

// ---- forecast: edit / new / duplicate / delete
const top = ref<HTMLElement>()
async function showChart() {
  await nextTick()
  top.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
function editForecast() {
  if (!selected.value) return
  itemEdit.value = null
  forecastEdit.value = { draft: JSON.parse(JSON.stringify(selected.value)), isNew: false }
  showChart()
}
function newForecast() {
  itemEdit.value = null
  forecastEdit.value = { draft: { ...defaultProjection(newId()), name: 'New forecast' }, isNew: true }
  showChart()
}
async function saveForecast() {
  const e = forecastEdit.value
  if (!e) return
  await saveProjection({ ...e.draft, name: e.draft.name.trim() })
  selectProjection(e.draft.id)
  forecastEdit.value = null
}
async function duplicateForecast() {
  const e = forecastEdit.value
  if (!e) return
  await createProjection(`${e.draft.name.trim() || 'Forecast'} copy`, e.draft)
  forecastEdit.value = null
}
async function deleteForecast() {
  const e = forecastEdit.value
  if (!e) return
  await deleteProjection(e.draft.id)
  forecastEdit.value = null
}

// ---- projections: add / edit / remove
function addProjection() {
  forecastEdit.value = null
  itemEdit.value = {
    draft: { kind: 'recurring', id: newId(), name: '', amount: 0, every: { n: 1, unit: 'month' }, start: today() },
    isNew: true,
  }
  showChart()
}
function editProjection(item: ProjectionItem) {
  forecastEdit.value = null
  itemEdit.value = { draft: JSON.parse(JSON.stringify(item)), isNew: false }
  showChart()
}
async function saveItem() {
  const e = itemEdit.value
  const f = selected.value
  if (!e || !f) return
  const exists = f.items.some((i) => i.id === e.draft.id)
  await saveProjection({ ...f, items: exists ? f.items.map((i) => (i.id === e.draft.id ? e.draft : i)) : [...f.items, e.draft] })
  itemEdit.value = null
}
async function removeItem() {
  const e = itemEdit.value
  const f = selected.value
  if (!e || !f) return
  await saveProjection({ ...f, items: f.items.filter((i) => i.id !== e.draft.id) })
  itemEdit.value = null
}

async function setHorizon(h: number) {
  const f = selected.value
  if (f && f.horizonDays !== h && !forecastEdit.value) await saveProjection({ ...f, horizonDays: h })
  else if (forecastEdit.value) forecastEdit.value.draft = { ...forecastEdit.value.draft, horizonDays: h }
}

const rows = computed(() =>
  (shown.value?.items ?? []).map((item) => ({
    item,
    s: summarize(item),
    type: UI_INFO[uiTypeOf(item)].label,
    editing: itemEdit.value?.draft.id === item.id,
  })),
)
</script>

<template>
  <div ref="top" class="future">
    <!-- forecast -->
    <div class="forecast-bar">
      <label class="pick">
        <span class="label">Forecast</span>
        <select
          class="select"
          :value="selectedId"
          :disabled="!!forecastEdit"
          @change="selectProjection(($event.target as HTMLSelectElement).value)"
        >
          <option v-for="x in projections" :key="x.id" :value="x.id">{{ x.name }}</option>
          <option v-if="forecastEdit?.isNew" :value="forecastEdit.draft.id">{{ forecastEdit.draft.name || 'New forecast' }}</option>
        </select>
      </label>
      <button class="btn small-btn" @click="editForecast"><Pencil class="ic" aria-hidden="true" />Edit</button>
      <button class="btn small-btn" @click="newForecast"><Plus class="ic" aria-hidden="true" />New</button>
    </div>

    <section v-if="shown" class="card" :class="{ previewing: forecastEdit || itemEdit }">
      <template v-if="future && chart">
        <h2 class="finding" :class="{ neg: future.min.value < 0 }">{{ heading }}</h2>
        <p class="muted small from">
          <template v-if="latest">
            From <b class="money">{{ fmtMoney(future.start.value) }}</b> ({{ startText }},
            {{ fmtDateTime(latest.at, { short: true }) }}) over {{ shown.horizonDays }} days
          </template>
          <template v-else>
            No records yet, so this starts from <b class="money">$0.00</b> today over {{ shown.horizonDays }} days. Save a
            record on Present to start from your real balances.
          </template>
          <span v-if="forecastEdit || itemEdit" class="draft-tag">preview</span>
        </p>
        <ForecastChart
          :past="chart.past"
          :start="chart.start"
          :days="chart.days"
          :segments="chart.segments"
          :values="chart.values"
        />
        <div class="horizon" role="radiogroup" aria-label="Days ahead">
          <button
            v-for="h in HORIZON_PRESETS"
            :key="h"
            role="radio"
            :aria-checked="shown.horizonDays === h"
            :class="{ on: shown.horizonDays === h }"
            @click="setHorizon(h)"
          >
            {{ h }}d
          </button>
        </div>
        <p class="muted small fine">A guide, not a promise.</p>
      </template>
      <template v-else>
        <h2>No forecast yet</h2>
        <p class="muted">
          Save your first record on the Present tab. A forecast starts from your latest record and adds up the
          projections below.
        </p>
      </template>
    </section>

    <!-- projections -->
    <section v-if="shown" class="card items">
      <div class="items-head">
        <h2>Projections</h2>
        <button class="btn small-btn" :disabled="!!forecastEdit" @click="addProjection"><Plus class="ic" aria-hidden="true" />Add</button>
      </div>
      <ul v-if="rows.length" class="list">
        <li v-for="r in rows" :key="r.item.id">
          <button class="row" :class="{ editing: r.editing }" :disabled="!!forecastEdit" @click="editProjection(r.item)">
            <span class="sw" :style="{ background: colorOf[r.item.id] }" aria-hidden="true"></span>
            <span class="kind">{{ r.type }}</span>
            <span class="name">{{ r.item.name || 'New projection' }}</span>
            <span class="amount money" :class="r.s.tone">{{ r.s.amount }}</span>
            <span class="detail muted small">{{ r.s.detail }}</span>
          </button>
        </li>
      </ul>
      <p v-else class="muted small">No projections yet. Tap <b>Add</b> for pay, rent, card spending and the like. The Past tab shows what past months looked like.</p>
    </section>

    <ForecastPanel
      v-if="forecastEdit"
      v-model="forecastEdit.draft"
      :is-new="forecastEdit.isNew"
      :can-delete="projections.length > 1"
      @save="saveForecast"
      @cancel="forecastEdit = null"
      @duplicate="duplicateForecast"
      @remove="deleteForecast"
    />
    <ProjectionPanel
      v-if="itemEdit && selected"
      v-model="itemEdit.draft"
      :result="future"
      :is-new="itemEdit.isNew"
      @save="saveItem"
      @remove="removeItem"
      @cancel="itemEdit = null"
    />
  </div>
</template>

<style scoped>
.future > * + * {
  margin-top: 1rem;
}

.forecast-bar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: end;
  gap: 0.4rem;
}

.pick {
  display: grid;
  gap: 0.15rem;
  min-width: 0;
}

.label {
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mute);
}

/* Compact buttons for this tab's toolbar and the projections header. */
.small-btn {
  min-height: 36px;
  padding: 0 0.7rem;
  font-size: 0.88rem;
  gap: 0.3rem;
}

.forecast-bar .small-btn {
  min-height: var(--tap);
}

.ic {
  width: 1rem;
  height: 1rem;
  stroke-width: 1.75;
}

.card.previewing {
  outline: 1px dashed var(--projection);
  outline-offset: -1px;
}

.finding {
  font-size: clamp(1.1rem, 4.8vw, 1.45rem) !important;
  line-height: 1.2;
}

.finding.neg {
  color: var(--negative);
}

.from {
  margin: -0.2rem 0 0.6rem;
}

.draft-tag {
  margin-left: 0.3rem;
  padding: 0 0.4rem;
  border-radius: 999px;
  border: 1px solid var(--projection);
  color: var(--projection);
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
}

.horizon {
  display: flex;
  justify-content: flex-end;
  gap: 0.3rem;
  margin-top: 0.5rem;
}

.horizon button {
  min-width: 3.2rem;
  min-height: 34px;
  border: 1px solid var(--btn-border);
  background: var(--btn-bg);
  color: var(--btn-text);
  border-radius: var(--btn-radius);
  font-weight: 550;
  font-size: 0.8rem;
}

.horizon button.on {
  background: var(--btn-primary-bg);
  border-color: var(--btn-primary-bg);
  color: var(--btn-primary-text);
}

.fine {
  margin: 0.4rem 0 0;
}

.items-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.4rem;
}

.items-head h2 {
  margin: 0 !important;
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
  grid-template-columns: 10px minmax(0, 1fr) auto;
  grid-template-areas:
    'sw kind kind'
    'sw name amount'
    'sw detail detail';
  gap: 0 0.6rem;
  padding: 0.5rem 0.1rem;
  border: none;
  border-bottom: 1px solid var(--line);
  background: none;
  color: var(--ink);
  text-align: left;
}

.row:hover:not(:disabled),
.row.editing {
  background: var(--panel-2);
}

.row:disabled {
  opacity: 0.6;
}

.sw {
  grid-area: sw;
  align-self: stretch;
  width: 4px;
  border-radius: 2px;
}

.kind {
  grid-area: kind;
  font-size: 0.66rem;
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
}
</style>
