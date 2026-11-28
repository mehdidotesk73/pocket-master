<script setup lang="ts">
// "Project this" from the Past tab: turn what the chart shows into a Recurring
// projection whose amount is locked to it and worked out again whenever records
// change. What was picked on the chart is shown fixed here:
//   Averages → the lines left in (their Total) and the records window
//   Rates    → the line and which days count; the window is picked here
// Then the repeat, start, name and forecast. In Future only the name, repeat
// and start can change; to measure something else, remove it and make another.
import { computed, ref } from 'vue'
import { type EveryUnit, type PastLink, type RateDirection, type RecordWindow, type Recurring, newId } from '../../lib/finance'
import { linkedAmount, measurePast } from '../../lib/analysis'
import { fmtMoney, isISODate, today } from '../../lib/money'
import DockPanel from './DockPanel.vue'
import WheelPicker from './WheelPicker.vue'
import WindowPicker from './WindowPicker.vue'
import { describeMeasure, describeWindow, linesLabel } from './projectionText'
import { useTracker } from './useTracker'

const props = defineProps<{ measure: PastLink['measure']; lines: string[]; window: RecordWindow; direction?: RateDirection }>()
const emit = defineEmits<{ (e: 'added', forecast: string): void; (e: 'cancel'): void }>()

const { records, projections, selected, saveProjection, selectProjection } = useTracker()

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

const error = ref('')
async function add() {
  error.value = ''
  const f = projections.value.find((p) => p.id === forecastId.value)
  if (!f) return void (error.value = 'Pick a forecast.')
  if (!isISODate(start.value)) return void (error.value = 'Pick a start date.')
  const item: Recurring = {
    kind: 'recurring',
    id: newId(),
    name: (nameTouched.value ? name.value.trim() : '') || autoName,
    amount: amount.value,
    every: { ...every.value },
    start: start.value,
    link: JSON.parse(JSON.stringify(link.value)),
  }
  await saveProjection({ ...f, items: [...f.items, item] })
  selectProjection(f.id)
  emit('added', f.name)
}
</script>

<template>
  <DockPanel title="Project this" draft-key="project-from-past" @close="emit('cancel')">
    <!-- what the chart showed: fixed -->
    <dl class="fixed">
      <dt>{{ lines.length > 1 ? 'Lines (their total)' : 'Line' }}</dt>
      <dd>{{ linesLabel(lines) }}</dd>
      <dt>Measure</dt>
      <dd>{{ what }}</dd>
      <template v-if="measure === 'average'">
        <dt>Records</dt>
        <dd>{{ describeWindow(win) }}</dd>
      </template>
    </dl>

    <div v-if="measure === 'rate'" class="field">
      <span>Measured over</span>
      <WindowPicker v-model="win" />
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

    <div class="row2">
      <label class="field">
        <span>Name</span>
        <input class="input" :value="nameTouched ? name : autoName" @input="((nameTouched = true), (name = ($event.target as HTMLInputElement).value))" />
      </label>
      <label class="field">
        <span>Add to</span>
        <select v-model="forecastId" class="select">
          <option v-for="p in projections" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
      </label>
    </div>

    <p v-if="error" class="err small" role="alert">{{ error }}</p>

    <template #summary>
      <div class="now">
        <span class="small">Each time: <b class="money" :class="{ neg: amount < 0, pos: amount > 0 }">{{ fmtMoney(amount, { sign: true }) }}</b></span>
        <span class="small muted">{{ how }} It's worked out again whenever your records change.</span>
      </div>
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

.fixed {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 0.3rem 0.8rem;
  margin: 0 0 0.7rem;
  padding: 0.5rem 0.7rem;
  border: 1px solid var(--line);
  border-radius: var(--btn-radius);
  background: var(--panel-2);
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

.row2,
.row3 {
  display: grid;
  gap: 0.45rem;
  align-items: start;
}

.row2 {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.row3 {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.row2 :deep(.input),
.row2 :deep(.select),
.row3 :deep(.input),
.row3 :deep(.select) {
  width: 100%;
  min-width: 0;
}

.row3 :deep(.input) {
  padding-left: 0.45rem;
  padding-right: 0.45rem;
}

.now {
  display: grid;
  gap: 0.15rem;
  padding-left: 0.6rem;
  border-left: 3px solid var(--line);
}
</style>
