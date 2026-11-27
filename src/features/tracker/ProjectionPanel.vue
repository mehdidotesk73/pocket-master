<script setup lang="ts">
// Edit one projection (an item of the forecast): Recurring or One-time.
// A recurring projection has three independent parts:
//   value   — an amount you type, or the average / rate of change of a line
//   window  — which records the average or rate is worked out from
//   repeats — every N days / weeks / months / years from a start date
// Every change flows straight into the chart above (v-model); nothing is
// stored until Save. Switching type and back keeps what was typed for each.
import { computed, reactive, ref, watch } from 'vue'
import {
  type EveryUnit,
  type ProjectionFile,
  type ProjectionItem,
  type RecordWindow,
  type Recurring,
  type RecurringValue,
  LEFT_SOURCE,
} from '../../lib/finance'
import { addDays, isISODate, today } from '../../lib/money'
import DockPanel from './DockPanel.vue'
import LensCarousel from './LensCarousel.vue'
import SignedMoneyInput from './SignedMoneyInput.vue'
import { UI_INFO, UI_TYPES, type UiType, VALUE_MODES, WINDOW_MODES, describeEvery, describeResult, uiTypeOf } from './projectionText'
import { useTracker } from './useTracker'

const item = defineModel<ProjectionItem>({ required: true })
const props = defineProps<{ forecast: ProjectionFile; isNew: boolean }>()
const emit = defineEmits<{ (e: 'save'): void; (e: 'remove'): void; (e: 'cancel'): void }>()

const { knownLines, resultsFor } = useTracker()

// ---- type
const type = ref<UiType>(uiTypeOf(item.value))
const remembered = reactive<Partial<Record<UiType, ProjectionItem>>>({ [type.value]: item.value })
const typeOptions = UI_TYPES.map((id) => ({ id, label: UI_INFO[id].label }))

watch(type, (to, from) => {
  remembered[from] = item.value
  const cur = item.value
  const kept = remembered[to]
  if (kept) item.value = { ...kept, name: cur.name }
  else if (to === 'oneTime') {
    const amount = cur.kind === 'recurring' && cur.value.mode === 'fixed' ? cur.value.amount : 0
    item.value = { kind: 'oneTime', id: cur.id, name: cur.name, amount, date: addDays(today(), 7) }
  } else {
    const amount = cur.kind === 'oneTime' ? cur.amount : 0
    item.value = { kind: 'recurring', id: cur.id, name: cur.name, value: { mode: 'fixed', amount }, every: { n: 1, unit: 'month' }, start: today(), inRecord: false }
  }
})
watch(item, (v) => (remembered[type.value] = v))

function patch(p: Partial<Recurring> | Partial<ProjectionItem>) {
  item.value = { ...item.value, ...p } as ProjectionItem
}
const rec = computed(() => (item.value.kind === 'recurring' ? item.value : null))

// ---- value
const valueMode = computed({
  get: () => rec.value?.value.mode ?? 'fixed',
  set: (m: RecurringValue['mode']) => {
    const r = rec.value
    if (!r || r.value.mode === m) return
    const prevSource = r.value.mode === 'fixed' ? (knownLines.value[0] ?? LEFT_SOURCE) : r.value.source
    const prevWindow: RecordWindow = r.value.mode === 'fixed' ? { mode: 'last', days: 90 } : r.value.window
    const value: RecurringValue = m === 'fixed' ? { mode: 'fixed', amount: 0 } : { mode: m, source: prevSource, window: prevWindow }
    patch({ value, inRecord: false })
  },
})
function setValue(p: Partial<{ amount: number; source: string; window: RecordWindow }>) {
  const r = rec.value
  if (r) patch({ value: { ...r.value, ...p } as RecurringValue })
}
const startLabel = computed(() => (props.forecast.start.mode === 'all' ? 'Net equity' : 'Starting total'))
const sources = computed(() => {
  const r = rec.value
  const names = [...knownLines.value]
  if (r && r.value.mode !== 'fixed') {
    const s = r.value.source
    if (s !== LEFT_SOURCE && !names.some((n) => n.toLowerCase() === s.toLowerCase())) names.unshift(s)
  }
  return names
})

// ---- window
const win = computed(() => (rec.value && rec.value.value.mode !== 'fixed' ? rec.value.value.window : null))
const windowMode = computed({
  get: () => win.value?.mode ?? 'all',
  set: (m: RecordWindow['mode']) =>
    setValue({
      window: m === 'last' ? { mode: 'last', days: 90 } : m === 'lastRecords' ? { mode: 'lastRecords', count: 6 } : m === 'between' ? { mode: 'between' } : { mode: 'all' },
    }),
})
const int = (v: string, d: number) => Math.max(1, Math.round(Number(v)) || d)
function setBetween(key: 'from' | 'to', v: string) {
  const w = win.value
  if (!w || w.mode !== 'between') return
  const next: RecordWindow = { ...w }
  if (isISODate(v)) next[key] = v
  else delete next[key]
  setValue({ window: next })
}

// ---- repeats
const UNITS: { id: EveryUnit; one: string; many: string }[] = [
  { id: 'day', one: 'day', many: 'days' },
  { id: 'week', one: 'week', many: 'weeks' },
  { id: 'month', one: 'month', many: 'months' },
  { id: 'year', one: 'year', many: 'years' },
]
function setEvery(p: Partial<{ n: number; unit: EveryUnit }>) {
  const r = rec.value
  if (!r) return
  const every = { ...r.every, ...p }
  patch({ every, inRecord: r.inRecord && every.unit === 'month' })
}

// ---- preview
const preview = computed(() => {
  const r = rec.value
  if (!r || r.value.mode === 'fixed') return null
  const items = [...props.forecast.items.filter((i) => i.id !== r.id), r]
  const res = resultsFor({ ...props.forecast, items })[r.id]
  return res ? describeResult(r, res) : null
})
const whenText = computed(() => (rec.value ? describeEvery(rec.value.every, rec.value.start) : ''))

// ---- save / remove
const confirmRemove = ref(false)
function remove() {
  if (!confirmRemove.value) return void (confirmRemove.value = true)
  emit('remove')
}
const error = ref('')
function save() {
  const it = item.value
  error.value = ''
  if (it.kind === 'oneTime') {
    if (!isISODate(it.date)) return void (error.value = 'Pick a date.')
    if (!it.amount) return void (error.value = 'Enter an amount.')
  } else {
    if (!isISODate(it.start)) return void (error.value = 'Pick a start date.')
    if (it.value.mode === 'fixed' && !it.value.amount) return void (error.value = 'Enter an amount.')
  }
  if (!it.name.trim()) {
    const v = it.kind === 'recurring' ? it.value : null
    patch({
      name: v && v.mode !== 'fixed' ? (v.source === LEFT_SOURCE ? 'Everyday spending' : `${v.source} (${v.mode === 'rate' ? 'trend' : 'average'})`) : UI_INFO[type.value].label,
    })
  }
  emit('save')
}
</script>

<template>
  <DockPanel :title="isNew ? 'New projection' : 'Edit projection'" draft-key="projection-edit" @close="emit('cancel')">
    <LensCarousel v-model="type" :options="typeOptions" label="Projection type" />
    <p class="muted small help">{{ UI_INFO[type].help }}</p>

    <label class="field">
      <span>Name</span>
      <input class="input" :value="item.name" placeholder="e.g. Paycheck, Rent, Everyday spending" @input="patch({ name: ($event.target as HTMLInputElement).value })" />
    </label>

    <!-- One-time: an amount on a date -->
    <div v-if="item.kind === 'oneTime'" class="row2">
      <label class="field">
        <span>Amount</span>
        <SignedMoneyInput :model-value="item.amount" aria-label="Amount" @update:model-value="(v: number) => patch({ amount: v })" />
      </label>
      <label class="field">
        <span>Date</span>
        <input class="input" type="date" :value="item.date" @change="patch({ date: ($event.target as HTMLInputElement).value })" />
      </label>
    </div>

    <!-- Recurring -->
    <template v-else-if="rec">
      <div class="group">
        <span class="group-label">Value</span>
        <div class="seg three" role="radiogroup" aria-label="Value">
          <button v-for="m in VALUE_MODES" :key="m.id" role="radio" :aria-checked="valueMode === m.id" :class="{ on: valueMode === m.id }" @click="valueMode = m.id">
            {{ m.label }}
          </button>
        </div>

        <label v-if="rec.value.mode === 'fixed'" class="field">
          <span>Amount each time</span>
          <SignedMoneyInput :model-value="rec.value.amount" aria-label="Amount" @update:model-value="(v: number) => setValue({ amount: v })" />
        </label>

        <template v-else>
          <label class="field">
            <span>Line</span>
            <select class="select" :value="rec.value.source" @change="setValue({ source: ($event.target as HTMLSelectElement).value })">
              <option :value="LEFT_SOURCE">{{ startLabel }}{{ rec.value.mode === 'rate' ? ' (everyday spending)' : '' }}</option>
              <option v-for="n in sources" :key="n" :value="n">{{ n }}</option>
            </select>
          </label>

          <div class="field">
            <span>Records</span>
            <div class="seg four" role="radiogroup" aria-label="Records window">
              <button v-for="m in WINDOW_MODES" :key="m.id" role="radio" :aria-checked="windowMode === m.id" :class="{ on: windowMode === m.id }" @click="windowMode = m.id">
                {{ m.label }}
              </button>
            </div>
          </div>
          <label v-if="win?.mode === 'last'" class="inline">
            Past
            <input class="input num n" type="number" inputmode="numeric" min="1" :value="win.days" @change="setValue({ window: { mode: 'last', days: int(($event.target as HTMLInputElement).value, 90) } })" />
            days of records
          </label>
          <label v-else-if="win?.mode === 'lastRecords'" class="inline">
            Last
            <input class="input num n" type="number" inputmode="numeric" min="1" :value="win.count" @change="setValue({ window: { mode: 'lastRecords', count: int(($event.target as HTMLInputElement).value, 6) } })" />
            records
          </label>
          <div v-else-if="win?.mode === 'between'" class="row2">
            <label class="field">
              <span>From</span>
              <input class="input" type="date" :value="win.from ?? ''" @change="setBetween('from', ($event.target as HTMLInputElement).value)" />
            </label>
            <label class="field">
              <span>To</span>
              <input class="input" type="date" :value="win.to ?? ''" @change="setBetween('to', ($event.target as HTMLInputElement).value)" />
            </label>
          </div>
          <p class="muted small note">
            <template v-if="rec.value.mode === 'average'">The line's average value across these records is added each time.</template>
            <template v-else>
              How fast the line changed across these records, times the time between repeats.
              <template v-if="rec.value.source === LEFT_SOURCE">The forecast's fixed and one-time projections are taken out first, so what's left is everyday spending.</template>
            </template>
          </p>
        </template>
      </div>

      <div class="group">
        <span class="group-label">Repeats</span>
        <div class="every">
          <span>Every</span>
          <input class="input num n" type="number" inputmode="numeric" min="1" :value="rec.every.n" aria-label="How many" @change="setEvery({ n: int(($event.target as HTMLInputElement).value, 1) })" />
          <select class="select" :value="rec.every.unit" aria-label="Unit" @change="setEvery({ unit: ($event.target as HTMLSelectElement).value as EveryUnit })">
            <option v-for="u in UNITS" :key="u.id" :value="u.id">{{ rec.every.n === 1 ? u.one : u.many }}</option>
          </select>
        </div>
        <label class="field">
          <span>Starting</span>
          <input class="input" type="date" :value="rec.start" @change="isISODate(($event.target as HTMLInputElement).value) && patch({ start: ($event.target as HTMLInputElement).value })" />
        </label>
        <p class="muted small note">Happens {{ whenText }}. Days past a month's end land on its last day.</p>
        <label v-if="rec.value.mode === 'fixed' && rec.every.unit === 'month'" class="check">
          <input class="checkbox" type="checkbox" :checked="rec.inRecord" @change="patch({ inRecord: ($event.target as HTMLInputElement).checked })" />
          <span class="small">Already in my records until paid (skip it this month)</span>
        </label>
      </div>

      <p v-if="preview" class="preview" :class="preview.tone">{{ preview.text }}</p>
    </template>

    <p v-if="error" class="err small" role="alert">{{ error }}</p>

    <template #footer>
      <button v-if="!isNew" class="btn danger remove" @click="remove">{{ confirmRemove ? 'Tap again' : 'Remove' }}</button>
      <button class="btn ghost" @click="emit('cancel')">Cancel</button>
      <button class="btn primary" @click="save">{{ isNew ? 'Add' : 'Save' }}</button>
    </template>
  </DockPanel>
</template>

<style scoped>
.help {
  margin: -0.2rem 0 0.6rem;
}

.field {
  display: grid;
  gap: 0.2rem;
  margin-bottom: 0.55rem;
  min-width: 0;
}

.field > span,
.group-label {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--mute);
}

.group {
  display: grid;
  gap: 0.45rem;
  padding: 0.6rem 0 0.2rem;
  border-top: 1px solid var(--line);
}

.group .field {
  margin-bottom: 0;
}

.row2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
}

.every {
  display: grid;
  grid-template-columns: auto 4.5rem 1fr;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.95rem;
}

.inline {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.92rem;
}

.n {
  width: 4.5rem;
}

.note {
  margin: 0;
}

.check {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 40px;
}

.seg {
  display: grid;
  border: 1px solid var(--btn-border);
  border-radius: var(--btn-radius);
  overflow: hidden;
}

.seg.three {
  grid-template-columns: 0.9fr 0.9fr 1.3fr;
}

.seg.four {
  grid-template-columns: 0.6fr 1fr 1.1fr 1fr;
}

.seg button {
  min-height: 38px;
  border: none;
  background: var(--btn-bg);
  color: var(--btn-text);
  font-weight: 550;
  font-size: 0.84rem;
  padding: 0 0.2rem;
}

.seg button + button {
  border-left: 1px solid var(--btn-border);
}

.seg button.on {
  background: var(--btn-primary-bg);
  color: var(--btn-primary-text);
}

.preview {
  margin: 0.5rem 0 0.2rem;
  padding: 0.5rem 0.65rem;
  border-radius: 0.5rem;
  background: var(--panel-2);
  border: 1px solid var(--line);
  font-size: 0.88rem;
}

.preview.pos {
  border-color: var(--pos);
}
.preview.neg {
  border-color: var(--negative);
}
.preview.warn {
  border-color: var(--projection);
}

.remove {
  margin-right: auto;
}

.err {
  color: var(--negative);
}
</style>
