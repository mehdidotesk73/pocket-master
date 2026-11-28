<script setup lang="ts">
// "Project this" from the Past tab: turn a measure of past records into a
// Recurring projection whose amount is locked to that measure (a line's average,
// or its average daily change) and worked out again whenever records change.
// Everything about the measure is chosen here, once: in Future only the name,
// repeat and start can change. To measure something else, remove it and make another.
import { computed, ref, watch } from 'vue'
import { type EveryUnit, LEFT_SOURCE, type PastLink, type RateDirection, type RecordWindow, type Recurring, newId } from '../../lib/finance'
import { linkedAmount, measurePast } from '../../lib/analysis'
import { fmtMoney, isISODate, today } from '../../lib/money'
import DockPanel from './DockPanel.vue'
import WheelPicker from './WheelPicker.vue'
import WindowPicker from './WindowPicker.vue'
import { describeLink, describeMeasure, lineLabel } from './projectionText'
import { useTracker } from './useTracker'

const props = defineProps<{ measure: PastLink['measure']; line: string; window: RecordWindow; direction?: RateDirection }>()
const emit = defineEmits<{ (e: 'added', forecast: string): void; (e: 'cancel'): void }>()

const { records, knownLines, projections, selected, saveProjection, selectProjection } = useTracker()

const measure = ref(props.measure)
const line = ref(props.line)
const win = ref<RecordWindow>(props.window)
const direction = ref<RateDirection>(props.direction ?? 'both')
const every = ref<{ n: number; unit: EveryUnit }>({ n: 1, unit: props.measure === 'rate' ? 'day' : 'month' })
const start = ref(today())
const forecastId = ref(selected.value?.id ?? projections.value[0]?.id ?? '')

// A rate is naturally daily, an average naturally monthly: follow the measure until the repeat is changed by hand.
const everyTouched = ref(false)
watch(measure, (m) => {
  if (!everyTouched.value) every.value = { n: 1, unit: m === 'rate' ? 'day' : 'month' }
})
function setEvery(p: Partial<{ n: number; unit: EveryUnit }>) {
  everyTouched.value = true
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

const link = computed<PastLink>(() =>
  measure.value === 'average'
    ? { measure: 'average', line: line.value, window: win.value }
    : { measure: 'rate', line: line.value, window: win.value, direction: direction.value },
)
const amount = computed(() => linkedAmount({ every: every.value, link: link.value }, records.value))
const how = computed(() => describeMeasure(link.value, measurePast(records.value, link.value), every.value))

// The name follows the choices until it's typed in.
const autoName = computed(() => {
  const l = lineLabel(line.value)
  if (measure.value === 'average') return `${l} average`
  return direction.value === 'falling' ? `${l} falling` : direction.value === 'rising' ? `${l} rising` : `${l} change`
})
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
    name: (nameTouched.value ? name.value.trim() : '') || autoName.value,
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
    <div class="seg two" role="radiogroup" aria-label="Measure">
      <button role="radio" :aria-checked="measure === 'average'" :class="{ on: measure === 'average' }" @click="measure = 'average'">Average</button>
      <button role="radio" :aria-checked="measure === 'rate'" :class="{ on: measure === 'rate' }" @click="measure = 'rate'">Daily change</button>
    </div>

    <label class="field">
      <span>Line</span>
      <select v-model="line" class="select">
        <option :value="LEFT_SOURCE">Net equity</option>
        <option v-for="n in knownLines" :key="n" :value="n">{{ n }}</option>
      </select>
    </label>

    <div v-if="measure === 'rate'" class="field">
      <span>Count</span>
      <div class="seg three" role="radiogroup" aria-label="Which days count">
        <button v-for="d in (['both', 'rising', 'falling'] as const)" :key="d" role="radio" :aria-checked="direction === d" :class="{ on: direction === d }" @click="direction = d">
          {{ d === 'both' ? 'Every day' : d === 'rising' ? 'Rising days' : 'Falling days' }}
        </button>
      </div>
    </div>

    <div class="field">
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
        <span class="small"
          >Each time: <b class="money" :class="{ neg: amount < 0, pos: amount > 0 }">{{ fmtMoney(amount, { sign: true }) }}</b> —
          {{ describeLink(link) }}.</span
        >
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

.seg {
  display: grid;
  border: 1px solid var(--btn-border);
  border-radius: var(--btn-radius);
  overflow: hidden;
}

.seg.two {
  grid-template-columns: 1fr 1fr;
  margin-bottom: 0.55rem;
}

.seg.three {
  grid-template-columns: repeat(3, 1fr);
}

.seg button {
  min-height: 34px;
  border: none;
  background: var(--btn-bg);
  color: var(--btn-text);
  font-weight: 550;
  font-size: 0.82rem;
  padding: 0 0.2rem;
}

.seg button + button {
  border-left: 1px solid var(--btn-border);
}

.seg button.on {
  background: var(--btn-primary-bg);
  color: var(--btn-primary-text);
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
