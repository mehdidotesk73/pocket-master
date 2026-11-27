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
  type Projection,
  type ProjectionFile,
  type ProjectionItem,
  type RateStart,
  type RecordWindow,
  type Recurring,
  type RecurringValue,
  LEFT_SOURCE,
  MIN_RATE_DAYS,
  NET_ONLY,
  periodDays,
  targetOf,
} from '../../lib/finance'
import { addDays, isISODate, today } from '../../lib/money'
import DockPanel from './DockPanel.vue'
import WheelPicker from './WheelPicker.vue'
import { ChevronDown } from '@lucide/vue'
import SignedMoneyInput from './SignedMoneyInput.vue'
import { UI_INFO, UI_TYPES, type UiType, VALUE_MODES, WINDOW_MODES, describeEvery, readBack, uiTypeOf } from './projectionText'
import { useTracker } from './useTracker'

const item = defineModel<ProjectionItem>({ required: true })
/** `result` is the forecast worked out with this draft in it (drives the readback). */
const props = defineProps<{ forecast: ProjectionFile; result: Projection | null; isNew: boolean }>()
const emit = defineEmits<{ (e: 'save'): void; (e: 'remove'): void; (e: 'cancel'): void }>()

const { knownLines } = useTracker()

// ---- type
const type = ref<UiType>(uiTypeOf(item.value))
const remembered = reactive<Partial<Record<UiType, ProjectionItem>>>({ [type.value]: item.value })
const typeOptions = UI_TYPES.map((id) => ({ id, label: UI_INFO[id].label }))

watch(type, (to, from) => {
  remembered[from] = item.value
  const cur = item.value
  // carry the line it changes across the switch
  const t = targetOf(cur)
  const target = t ? { target: t } : {}
  const kept = remembered[to]
  if (kept) item.value = { ...kept, name: cur.name }
  else if (to === 'oneTime') {
    const amount = cur.kind === 'recurring' && cur.value.mode === 'fixed' ? cur.value.amount : 0
    item.value = { kind: 'oneTime', id: cur.id, name: cur.name, ...target, amount, date: addDays(today(), 7) }
  } else {
    const amount = cur.kind === 'oneTime' ? cur.amount : 0
    item.value = { kind: 'recurring', id: cur.id, name: cur.name, ...target, value: { mode: 'fixed', amount }, every: { n: 1, unit: 'month' }, start: today(), inRecord: false }
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
    let source = r.value.mode === 'fixed' ? (knownLines.value[0] ?? LEFT_SOURCE) : r.value.source
    // An average of net equity means nothing as an amount: start from a line instead.
    if (m === 'average' && source === LEFT_SOURCE) source = knownLines.value[0] ?? LEFT_SOURCE
    const prevWindow: RecordWindow = r.value.mode === 'fixed' ? { mode: 'last', days: 90 } : r.value.window
    const value: RecurringValue = m === 'fixed' ? { mode: 'fixed', amount: 0 } : { mode: m, source, window: prevWindow }
    // An average is a typical amount per cycle: repeat it monthly unless it already repeats that slowly.
    const every = m === 'average' && periodDays(r.every) < MIN_RATE_DAYS ? { n: 1, unit: 'month' as const } : r.every
    // Keep the line it changes: switching to Amount would otherwise drop the default (the value's line).
    const keep = r.target == null && r.value.mode !== 'fixed' ? { target: targetOf(r) } : {}
    patch({ value, every, inRecord: false, ...keep })
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

// ---- target: which line this changes. Picking the default (see targetOf) clears
// the field, so it keeps following the value's line when that changes.
const target = computed(() => targetOf(item.value))
const targets = computed(() => {
  const names = [...knownLines.value]
  const t = target.value
  if (t && !names.some((n) => n.toLowerCase() === t.toLowerCase())) names.unshift(t)
  return names
})
function setTarget(t: string) {
  const { target: _old, ...rest } = item.value
  void _old
  const fallback = targetOf(rest as ProjectionItem)
  item.value = (t === fallback ? rest : { ...rest, target: t }) as ProjectionItem
}

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

// ---- start point (rates only): a known value to measure from
const from = computed(() => (rec.value?.value.mode === 'rate' ? (rec.value.value.from ?? null) : null))
function setFrom(f: RateStart | null) {
  const r = rec.value
  if (!r || r.value.mode !== 'rate') return
  const { from: _old, ...rest } = r.value
  void _old
  patch({ value: f ? { ...rest, from: f } : rest })
}
function setFromKind(kind: string) {
  const f = from.value
  if (!f) return
  setFrom(kind === 'date' ? { amount: f.amount, date: `${today().slice(0, 8)}01` } : { amount: f.amount, day: 1 })
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

// ---- readback: the settings as a sentence, plus what they come to
const said = computed(() => (props.result ? readBack(item.value, props.result, props.forecast) : null))
const showMore = ref(false)
const valueOptions = VALUE_MODES.map((m) => ({ id: m.id as RecurringValue['mode'], label: m.id === 'rate' ? 'Rate' : m.label }))
const unitOptions = computed(() => UNITS.map((u) => ({ id: u.id, label: rec.value?.every.n === 1 ? u.one : u.many })))

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
    <!-- name · type -->
    <div class="top">
      <input class="input" :value="item.name" aria-label="Name" placeholder="Name, e.g. Paycheck" @input="patch({ name: ($event.target as HTMLInputElement).value })" />
      <WheelPicker v-model="type" :options="typeOptions" label="Projection type" :rows="1" />
    </div>

    <!-- One-time: changes · amount · date -->
    <div v-if="item.kind === 'oneTime'" class="row3">
      <label class="field">
        <span>Changes</span>
        <select class="select" :value="target" aria-label="Line it changes" @change="setTarget(($event.target as HTMLSelectElement).value)">
          <option :value="NET_ONLY">Net equity only</option>
          <option v-for="n in targets" :key="n" :value="n">{{ n }}</option>
        </select>
      </label>
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
      <!-- every · unit · starting -->
      <div class="row3 repeats">
        <label class="field">
          <span>Every</span>
          <input class="input num" type="number" inputmode="numeric" min="1" :value="rec.every.n" aria-label="How many" @change="setEvery({ n: int(($event.target as HTMLInputElement).value, 1) })" />
        </label>
        <div class="field">
          <span>Unit</span>
          <WheelPicker :model-value="rec.every.unit"   :options="unitOptions" label="Unit" :rows="1" @update:model-value="(u: EveryUnit) => setEvery({ unit: u })" />
        </div>
        <label class="field">
          <span>Starting</span>
          <input class="input" type="date" :value="rec.start" @change="isISODate(($event.target as HTMLInputElement).value) && patch({ start: ($event.target as HTMLInputElement).value })" />
        </label>
      </div>
      <!-- changes · value · line (or amount) -->
      <div class="row3">
        <label class="field">
          <span>Changes</span>
          <select class="select" :value="target" aria-label="Line it changes" @change="setTarget(($event.target as HTMLSelectElement).value)">
            <option :value="NET_ONLY">Net equity only</option>
            <option v-for="n in targets" :key="n" :value="n">{{ n }}</option>
          </select>
        </label>
        <div class="field">
          <span>Value</span>
          <WheelPicker v-model="valueMode" :options="valueOptions" label="Value" :rows="1" />
        </div>
        <label v-if="rec.value.mode === 'fixed'" class="field">
          <span>Amount</span>
          <SignedMoneyInput :model-value="rec.value.amount" aria-label="Amount each time" @update:model-value="(v: number) => setValue({ amount: v })" />
        </label>
        <label v-else class="field">
          <span>Of line</span>
          <select class="select" :value="rec.value.source" aria-label="Line it's worked out from" @change="setValue({ source: ($event.target as HTMLSelectElement).value })">
            <option v-if="rec.value.mode === 'rate' || rec.value.source === LEFT_SOURCE" :value="LEFT_SOURCE">{{ startLabel }}</option>
            <option v-for="n in sources" :key="n" :value="n">{{ n }}</option>
          </select>
        </label>
      </div>

      <label v-if="rec.value.mode === 'fixed' && rec.every.unit === 'month'" class="check">
        <input class="checkbox" type="checkbox" :checked="rec.inRecord" @change="patch({ inRecord: ($event.target as HTMLInputElement).checked })" />
        <span class="small">Already in my records until paid (skip it this month)</span>
      </label>
      <!-- which records (average / rate) -->
      <div v-if="rec.value.mode !== 'fixed'" class="records">
        <div class="seg four" role="radiogroup" aria-label="Records window">
          <button v-for="m in WINDOW_MODES" :key="m.id" role="radio" :aria-checked="windowMode === m.id" :class="{ on: windowMode === m.id }" @click="windowMode = m.id">
            {{ m.label }}
          </button>
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
          <input class="input" type="date" aria-label="From" :value="win.from ?? ''" @change="setBetween('from', ($event.target as HTMLInputElement).value)" />
          <input class="input" type="date" aria-label="To" :value="win.to ?? ''" @change="setBetween('to', ($event.target as HTMLInputElement).value)" />
        </div>

        <template v-if="rec.value.mode === 'rate'">
          <label class="check">
            <input class="checkbox" type="checkbox" :checked="!!from" @change="setFrom(($event.target as HTMLInputElement).checked ? { amount: 0, day: 1 } : null)" />
            <span class="small">Start from a known value (e.g. a card at $0 on the 1st)</span>
          </label>
          <div v-if="from" class="row3">
            <label class="field">
              <span>Value then</span>
              <SignedMoneyInput :model-value="from.amount" aria-label="Value at the start point" @update:model-value="(v: number) => setFrom({ ...from!, amount: v })" />
            </label>
            <label class="field">
              <span>On</span>
              <select class="select" :value="'day' in from ? 'day' : 'date'" aria-label="Start point kind" @change="setFromKind(($event.target as HTMLSelectElement).value)">
                <option value="day">day of month</option>
                <option value="date">a date</option>
              </select>
            </label>
            <label v-if="'day' in from" class="field">
              <span>Day</span>
              <input class="input num" type="number" inputmode="numeric" min="1" max="31" :value="from.day" aria-label="Day of the month" @change="setFrom({ amount: from!.amount, day: Math.min(31, int(($event.target as HTMLInputElement).value, 1)) })" />
            </label>
            <label v-else class="field">
              <span>Date</span>
              <input class="input" type="date" :value="from.date" @change="isISODate(($event.target as HTMLInputElement).value) && setFrom({ amount: from!.amount, date: ($event.target as HTMLInputElement).value })" />
            </label>
          </div>
        </template>
      </div>

    </template>

    <p v-if="error" class="err small" role="alert">{{ error }}</p>

    <!-- The readback: one sentence, tap for the rest. Warnings show as a count until opened. -->
    <template v-if="said" #summary>
      <button type="button" class="readback" :class="[said.tone, { open: showMore }]" :aria-expanded="showMore" @click="showMore = !showMore">
        <span class="sentence">{{ said.sentence }}</span>
        <span class="more">
          <span v-if="said.warnings.length && !showMore" class="warn-pill">{{ said.warnings.length }} to check</span>
          <ChevronDown class="chev" aria-hidden="true" />
        </span>
        <span v-if="showMore" class="details">
          <span class="small">{{ said.total }} {{ said.line }}</span>
          <span v-for="w in said.warnings" :key="w" class="small warn-line">{{ w }}</span>
          <span v-if="said.basis" class="small muted">{{ said.basis }}</span>
        </span>
      </button>
    </template>

    <template #footer>
      <button v-if="!isNew" class="btn danger remove" @click="remove">{{ confirmRemove ? 'Tap again' : 'Remove' }}</button>
      <button class="btn ghost" @click="emit('cancel')">Cancel</button>
      <button class="btn primary" @click="save">{{ isNew ? 'Add' : 'Save' }}</button>
    </template>
  </DockPanel>
</template>

<style scoped>
/* compact controls inside this panel (still 16px text, so iOS doesn't zoom) */
:deep(.input),
:deep(.select) {
  min-height: 38px;
}

.top {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 7.2rem;
  gap: 0.45rem;
  margin-bottom: 0.55rem;
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

/* three columns that stay three columns on a phone */
.row3 {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.45rem;
  align-items: start;
}

.row3 .field {
  margin-bottom: 0.45rem;
}

.row3 :deep(.select),
.row3 :deep(.input) {
  width: 100%;
  min-width: 0;
  padding-left: 0.45rem;
  padding-right: 0.45rem;
}

.row2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.45rem;
}

.records {
  display: grid;
  gap: 0.4rem;
  padding: 0.5rem 0 0.4rem;
  margin-bottom: 0.45rem;
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
}

.repeats {
  padding-top: 0.1rem;
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

.check {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 36px;
}

.seg {
  display: grid;
  border: 1px solid var(--btn-border);
  border-radius: var(--btn-radius);
  overflow: hidden;
}

.seg.four {
  grid-template-columns: 0.6fr 1fr 1.1fr 1fr;
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

.remove {
  margin-right: auto;
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
