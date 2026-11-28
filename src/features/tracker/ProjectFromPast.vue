<script setup lang="ts">
// "Project this" from the Past tab: turn what the chart shows into a Recurring
// projection whose amount is locked to it and worked out again whenever records
// change. What was picked on the chart is shown fixed here:
//   Averages → the lines left in (their Total) and the records window
//   Rates    → the line and which days count; the window is picked here
// Laid out as: the forecast to add to, then the projection as Edit projection
// shows it (name · Linked, every · unit · starting, the locked amount with what
// it's measured from and the Rates window, and the one-line readback).
// In Future only the name, repeat and start can change; to measure something
// else, remove it and make another.
import { computed, ref } from 'vue'
import { ChevronDown, Link2 } from '@lucide/vue'
import InfoTip from '../../components/InfoTip.vue'
import { type EveryUnit, type PastLink, type RateDirection, type RecordWindow, type Recurring, newId } from '../../lib/finance'
import { linkedAmount, measurePast } from '../../lib/analysis'
import { fmtMoney, isISODate, today } from '../../lib/money'
import DockPanel from './DockPanel.vue'
import WheelPicker from './WheelPicker.vue'
import WindowPicker from './WindowPicker.vue'
import { describeMeasure, describeWindow, linesLabel, readBack } from './projectionText'
import { useTracker } from './useTracker'

const props = defineProps<{ measure: PastLink['measure']; lines: string[]; window: RecordWindow; direction?: RateDirection }>()
const emit = defineEmits<{ (e: 'added', forecast: string): void; (e: 'cancel'): void }>()

const { records, projections, selected, projectFor, saveProjection, selectProjection } = useTracker()

// Fixed from the chart.
const measure = props.measure
const lines = [...props.lines]
const direction: RateDirection = props.direction ?? 'both'
// Averages: fixed from the chart too. Rates: picked here.
const win = ref<RecordWindow>({ ...props.window })
// A rate is naturally daily, an average naturally monthly.
const every = ref<{ n: number; unit: EveryUnit }>({ n: 1, unit: measure === 'rate' ? 'day' : 'month' })
const start = ref(today())
const forecastId = ref(selected.value?.id ?? projections.value[0]?.id ?? '')

function setEvery(p: Partial<{ n: number; unit: EveryUnit }>) {
  every.value = { ...every.value, ...p }
}
const int = (v: string, d: number) => Math.max(1, Math.round(Number(v)) || d)
const UNITS: { id: EveryUnit; one: string; many: string }[] = [
  { id: 'day', one: 'day', many: 'days' },
  { id: 'week', one: 'week', many: 'weeks' },
  { id: 'month', one: 'month', many: 'months' },
  { id: 'year', one: 'year', many: 'years' },
]
const unitOptions = computed(() => UNITS.map((u) => ({ id: u.id, label: every.value.n === 1 ? u.one : u.many })))

const link = computed<PastLink>(() => (measure === 'average' ? { measure, lines, window: win.value } : { measure, lines, window: win.value, direction }))
const what = measure === 'average' ? 'Average' : direction === 'falling' ? 'Daily change, falling days only' : direction === 'rising' ? 'Daily change, rising days only' : 'Daily change, every day'
const amount = computed(() => linkedAmount({ every: every.value, link: link.value }, records.value))
const how = computed(() => describeMeasure(link.value, measurePast(records.value, link.value), every.value))

// The name follows the choices until it's typed in.
const autoName = (() => {
  const l = lines.length === 1 ? linesLabel(lines) : lines.length <= 3 ? linesLabel(lines) : 'Total'
  if (measure === 'average') return `${l} average`
  return direction === 'falling' ? `${l} falling` : direction === 'rising' ? `${l} rising` : `${l} change`
})()
const name = ref('')
const nameTouched = ref(false)

/** The projection as it would be added. */
const draft = computed<Recurring>(() => ({
  kind: 'recurring',
  id: 'project-this',
  name: (nameTouched.value ? name.value.trim() : '') || autoName,
  amount: amount.value,
  every: { ...every.value },
  start: start.value,
  link: link.value,
}))
const target = computed(() => projections.value.find((p) => p.id === forecastId.value) ?? null)

// ---- readback, as in Edit projection: worked out in the forecast it goes into
const said = computed(() => {
  const f = target.value
  if (!f || !isISODate(start.value)) return null
  return readBack(draft.value, projectFor({ ...f, items: [...f.items, draft.value] }))
})
const showMore = ref(false)

const error = ref('')
async function add() {
  error.value = ''
  const f = target.value
  if (!f) return void (error.value = 'Pick a forecast.')
  if (!isISODate(start.value)) return void (error.value = 'Pick a start date.')
  const item: Recurring = { ...JSON.parse(JSON.stringify(draft.value)), id: newId() }
  await saveProjection({ ...f, items: [...f.items, item] })
  selectProjection(f.id)
  emit('added', f.name)
}
</script>

<template>
  <DockPanel title="Project this" draft-key="project-from-past" blur @close="emit('cancel')">
    <!-- which forecast it goes into -->
    <label class="field forecast">
      <span>Add to forecast</span>
      <select v-model="forecastId" class="select">
        <option v-for="p in projections" :key="p.id" :value="p.id">{{ p.name }}</option>
      </select>
    </label>

    <!-- the projection, as Edit projection shows it -->
    <div class="projection">
      <div class="top">
        <input class="input" :value="nameTouched ? name : autoName" aria-label="Name" @input="((nameTouched = true), (name = ($event.target as HTMLInputElement).value))" />
        <span class="linked-type">Recurring</span>
      </div>

      <div class="row3">
        <label class="field">
          <span>Every</span>
          <input class="input num" type="number" inputmode="numeric" min="1" :value="every.n" aria-label="How many" @change="setEvery({ n: int(($event.target as HTMLInputElement).value, 1) })" />
        </label>
        <div class="field">
          <span>Unit</span>
          <WheelPicker :model-value="every.unit" :options="unitOptions" label="Unit" @update:model-value="(u: EveryUnit) => setEvery({ unit: u })" />
        </div>
        <label class="field">
          <span>Starting</span>
          <input class="input" type="date" :value="start" @change="start = ($event.target as HTMLInputElement).value" />
        </label>
      </div>

      <div class="field">
        <span class="label-row">
          <span class="linked-label"><Link2 class="ic" aria-hidden="true" />Amount each time · linked to Past</span>
          <InfoTip label="About linked amounts">
            Worked out from your records again whenever they change, so you can't type it. In Future you can still change its name, repeat and start; to measure something else, remove it and make a new one here.
          </InfoTip>
        </span>
        <div class="locked">
          <b class="money amt" :class="{ neg: amount < 0, pos: amount > 0 }">{{ fmtMoney(amount, { sign: true }) }}</b>
          <dl class="fixed">
            <dt>{{ lines.length > 1 ? 'Lines (total)' : 'Line' }}</dt>
            <dd>{{ linesLabel(lines) }}</dd>
            <dt>Measure</dt>
            <dd>{{ what }}</dd>
            <template v-if="measure === 'average'">
              <dt>Records</dt>
              <dd>{{ describeWindow(win) }}</dd>
            </template>
          </dl>
          <div v-if="measure === 'rate'" class="over">
            <span>Measured over</span>
            <WindowPicker v-model="win" />
          </div>
          <span class="small muted">{{ how }}</span>
        </div>
      </div>
    </div>

    <p v-if="error" class="err small" role="alert">{{ error }}</p>

    <!-- The readback: one sentence, tap for the rest. -->
    <template v-if="said" #summary>
      <button type="button" class="readback" :class="[said.tone, { open: showMore }]" :aria-expanded="showMore" @click="showMore = !showMore">
        <span class="sentence">{{ said.sentence }}</span>
        <span class="more"><ChevronDown class="chev" aria-hidden="true" /></span>
        <span v-if="showMore" class="details">
          <span class="small">{{ said.total }}</span>
        </span>
      </button>
    </template>

    <template #footer>
      <button class="btn ghost" @click="emit('cancel')">Cancel</button>
      <button class="btn primary" @click="add">Add to forecast</button>
    </template>
  </DockPanel>
</template>

<style scoped>
:deep(.input),
:deep(.select) {
  min-height: 38px;
}

.field {
  display: grid;
  gap: 0.2rem;
  margin-bottom: 0.55rem;
  min-width: 0;
  align-content: start;
}

.field > span {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--mute);
}

.forecast {
  padding-bottom: 0.7rem;
  margin-bottom: 0.7rem;
  border-bottom: 1px solid var(--line);
}

.top {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 7.2rem;
  gap: 0.45rem;
  margin-bottom: 0.55rem;
}

.label-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0 0.2rem;
  margin: -4px 0;
}

.linked-label {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--mute);
}

.linked-label .ic {
  width: 14px;
  height: 14px;
}

.label-row :deep(.info-text) {
  padding-bottom: 0.3rem;
}

.linked-type {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.3rem;
  min-height: 38px;
  border: 1px solid var(--line);
  border-radius: var(--btn-radius);
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--mute);
}

.linked-type .ic {
  width: 15px;
  height: 15px;
}

.row3 {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.45rem;
  align-items: start;
}

.row3 .field {
  margin-bottom: 0.45rem;
}

.row3 :deep(.input),
.row3 :deep(.select) {
  width: 100%;
  min-width: 0;
  padding-left: 0.45rem;
  padding-right: 0.45rem;
}

.locked {
  display: grid;
  gap: 0.45rem;
  padding: 0.5rem 0.6rem;
  border: 1px dashed var(--line);
  border-radius: var(--btn-radius);
  background: var(--panel-2);
}

.locked .amt {
  font-size: 1.05rem;
}

.fixed {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 0.2rem 0.8rem;
  margin: 0;
  font-size: 0.9rem;
}

.fixed dt {
  color: var(--mute);
  font-weight: 600;
  font-size: 0.8rem;
  align-self: center;
}

.fixed dd {
  margin: 0;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.over {
  display: grid;
  gap: 0.25rem;
}

.over > span {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--mute);
}

/* readback: a one-line summary; tap to see the rest */
.readback {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.2rem 0.5rem;
  width: 100%;
  padding: 0.1rem 0 0.1rem 0.6rem;
  border: none;
  border-left: 3px solid var(--line);
  background: none;
  color: var(--ink);
  text-align: left;
  font: inherit;
}

.readback .sentence {
  font-size: 0.88rem;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.readback.open .sentence {
  white-space: normal;
}

.readback .more {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.readback .chev {
  width: 16px;
  height: 16px;
  color: var(--mute);
  transition: transform 0.15s;
}

.readback.open .chev {
  transform: rotate(180deg);
}

.readback .details {
  grid-column: 1 / -1;
  display: grid;
  gap: 0.2rem;
}

.warn-pill {
  font-size: 0.72rem;
  font-weight: 650;
  padding: 0.05rem 0.4rem;
  border-radius: 999px;
  color: var(--projection);
  border: 1px solid var(--projection);
  white-space: nowrap;
}

.readback.pos {
  border-left-color: var(--pos);
}
.readback.neg {
  border-left-color: var(--negative);
}
.readback.warn {
  border-left-color: var(--projection);
}

.warn-line {
  color: var(--projection);
}

.err {
  color: var(--negative);
}

@media (prefers-reduced-motion: reduce) {
  .readback .chev {
    transition: none;
  }
}
</style>
