<script setup lang="ts">
// Edit one projection (an item of the forecast). The carousel picks its type;
// every change flows straight into the chart above (v-model), and nothing is
// stored until Save. Switching type and back keeps what was typed for each.
import { computed, reactive, ref, watch } from 'vue'
import { type ProjectionFile, type ProjectionItem, type RecordRange, LEFT_SOURCE } from '../../lib/finance'
import { addDays, isISODate, today } from '../../lib/money'
import DockPanel from './DockPanel.vue'
import LensCarousel from './LensCarousel.vue'
import SignedMoneyInput from './SignedMoneyInput.vue'
import { UI_INFO, UI_TYPES, type UiType, describeResult, uiTypeOf } from './projectionText'
import { useTracker } from './useTracker'

const item = defineModel<ProjectionItem>({ required: true })
const props = defineProps<{ forecast: ProjectionFile; isNew: boolean }>()
const emit = defineEmits<{ (e: 'save'): void; (e: 'remove'): void; (e: 'cancel'): void }>()

const { knownLines, resultsFor } = useTracker()

// ---- type
const type = ref<UiType>(uiTypeOf(item.value))
const remembered = reactive<Partial<Record<UiType, ProjectionItem>>>({ [type.value]: item.value })

function convert(to: UiType, from: ProjectionItem): ProjectionItem {
  const base = { id: from.id, name: from.name }
  const amount = 'amount' in from ? from.amount : 0
  const source = 'source' in from ? from.source : (knownLines.value[0] ?? LEFT_SOURCE)
  switch (to) {
    case 'recurring':
      return { ...base, kind: 'recurring', amount, day: 'day' in from ? from.day : 1, inRecord: false }
    case 'oneTime':
      return { ...base, kind: 'oneTime', amount, date: addDays(today(), 7) }
    case 'cyclical':
      return { ...base, kind: 'extrapolate', source: source === LEFT_SOURCE ? (knownLines.value[0] ?? LEFT_SOURCE) : source }
    case 'cumulative':
      return {
        ...base,
        kind: 'averaged',
        mode: 'rate',
        source: from.kind === 'averaged' ? from.source : LEFT_SOURCE,
        range: from.kind === 'averaged' ? from.range : { mode: 'last', days: 90 },
        day: 1,
      }
  }
}

watch(type, (to, from) => {
  remembered[from] = item.value
  const kept = remembered[to]
  item.value = kept ? { ...kept, name: item.value.name } : convert(to, item.value)
})
watch(item, (v) => (remembered[type.value] = v))

const options = UI_TYPES.map((id) => ({ id, label: UI_INFO[id].label }))

// ---- recurring: fixed amount, or a line's average from records
const recurringFrom = computed({
  get: () => (item.value.kind === 'averaged' && item.value.mode === 'amount' ? 'average' : 'fixed'),
  set: (v: 'fixed' | 'average') => {
    const cur = item.value
    const day = 'day' in cur ? cur.day : 1
    item.value =
      v === 'average'
        ? { kind: 'averaged', id: cur.id, name: cur.name, mode: 'amount', source: knownLines.value[0] ?? LEFT_SOURCE, range: { mode: 'last', days: 90 }, day }
        : { kind: 'recurring', id: cur.id, name: cur.name, amount: 0, day, inRecord: false }
  },
})

// ---- shared field helpers (all edits replace item.value so the chart updates)
function patch(p: Partial<ProjectionItem>) {
  item.value = { ...item.value, ...p } as ProjectionItem
}
function setDay(v: string) {
  const n = Math.round(Number(v))
  patch({ day: Number.isFinite(n) ? Math.min(31, Math.max(1, n)) : 1 } as Partial<ProjectionItem>)
}
const rangeMode = computed({
  get: () => (item.value.kind === 'averaged' ? item.value.range.mode : 'all'),
  set: (m: RecordRange['mode']) =>
    patch({ range: m === 'last' ? { mode: 'last', days: 90 } : m === 'between' ? { mode: 'between' } : { mode: 'all' } } as Partial<ProjectionItem>),
})
function setRange(r: RecordRange) {
  patch({ range: r } as Partial<ProjectionItem>)
}
function setBetween(key: 'from' | 'to', v: string) {
  const it = item.value
  if (it.kind !== 'averaged' || it.range.mode !== 'between') return
  const r: RecordRange = { ...it.range }
  if (isISODate(v)) r[key] = v
  else delete r[key]
  setRange(r)
}

const startLabel = computed(() => (props.forecast.start.mode === 'all' ? 'Left so far' : 'Starting total'))
const sources = computed(() => {
  const it = item.value
  const names = [...knownLines.value]
  if ('source' in it && it.source !== LEFT_SOURCE && !names.some((n) => n.toLowerCase() === it.source.toLowerCase())) names.unshift(it.source)
  return names
})

const preview = computed(() => {
  const it = item.value
  if (it.kind !== 'averaged' && it.kind !== 'extrapolate') return null
  const items = [...props.forecast.items.filter((i) => i.id !== it.id), it]
  const res = resultsFor({ ...props.forecast, items })[it.id]
  return res ? describeResult(it, res, props.forecast) : null
})

const confirmRemove = ref(false)
function remove() {
  if (!confirmRemove.value) {
    confirmRemove.value = true
    return
  }
  emit('remove')
}

const error = ref('')
function save() {
  const it = item.value
  error.value = ''
  if (it.kind === 'oneTime' && !isISODate(it.date)) return void (error.value = 'Pick a date.')
  if ((it.kind === 'recurring' || it.kind === 'oneTime') && !it.amount) return void (error.value = 'Enter an amount.')
  if (!it.name.trim()) {
    const label = UI_INFO[type.value].label
    const src = 'source' in it ? (it.source === LEFT_SOURCE ? 'Everyday spending' : it.source) : ''
    patch({ name: type.value === 'cumulative' && src ? src : type.value === 'cyclical' && src ? `${src} to month end` : label })
  }
  emit('save')
}

</script>

<template>
  <DockPanel :title="isNew ? 'New projection' : 'Edit projection'" draft-key="projection-edit" @close="emit('cancel')">
    <LensCarousel v-model="type" :options="options" label="Projection type" />
    <p class="muted small help">{{ UI_INFO[type].help }}</p>

    <label class="field">
      <span>Name</span>
      <input class="input" :value="item.name" placeholder="e.g. Paycheck, Rent, Everyday spending" @input="patch({ name: ($event.target as HTMLInputElement).value })" />
    </label>

    <!-- Recurring -->
    <template v-if="type === 'recurring'">
      <div class="seg two" role="radiogroup" aria-label="Amount">
        <button role="radio" :aria-checked="recurringFrom === 'fixed'" :class="{ on: recurringFrom === 'fixed' }" @click="recurringFrom = 'fixed'">
          Fixed amount
        </button>
        <button role="radio" :aria-checked="recurringFrom === 'average'" :class="{ on: recurringFrom === 'average' }" @click="recurringFrom = 'average'">
          Average of a line
        </button>
      </div>
      <div v-if="item.kind === 'recurring'" class="row2">
        <label class="field">
          <span>Amount</span>
          <SignedMoneyInput :model-value="item.amount" aria-label="Amount" @update:model-value="(v: number) => patch({ amount: v })" />
        </label>
        <label class="field">
          <span>Day of month</span>
          <input class="input num" type="number" inputmode="numeric" min="1" max="31" :value="item.day" @change="setDay(($event.target as HTMLInputElement).value)" />
        </label>
      </div>
      <label v-if="item.kind === 'recurring'" class="check">
        <input class="checkbox" type="checkbox" :checked="item.inRecord" @change="patch({ inRecord: ($event.target as HTMLInputElement).checked })" />
        <span class="small">Already in my records until paid (skip it this month)</span>
      </label>
      <template v-if="item.kind === 'averaged'">
        <div class="row2">
          <label class="field">
            <span>Line</span>
            <select class="select" :value="item.source" @change="patch({ source: ($event.target as HTMLSelectElement).value })">
              <option v-for="n in sources" :key="n" :value="n">{{ n }}</option>
            </select>
          </label>
          <label class="field">
            <span>Day of month</span>
            <input class="input num" type="number" inputmode="numeric" min="1" max="31" :value="item.day" @change="setDay(($event.target as HTMLInputElement).value)" />
          </label>
        </div>
      </template>
    </template>

    <!-- One-time -->
    <div v-else-if="type === 'oneTime' && item.kind === 'oneTime'" class="row2">
      <label class="field">
        <span>Amount</span>
        <SignedMoneyInput :model-value="item.amount" aria-label="Amount" @update:model-value="(v: number) => patch({ amount: v })" />
      </label>
      <label class="field">
        <span>Date</span>
        <input class="input" type="date" :value="item.date" @change="patch({ date: ($event.target as HTMLInputElement).value })" />
      </label>
    </div>

    <!-- Cyclical -->
    <label v-else-if="type === 'cyclical' && item.kind === 'extrapolate'" class="field">
      <span>Value from the latest record</span>
      <select class="select" :value="item.source" @change="patch({ source: ($event.target as HTMLSelectElement).value })">
        <option :value="LEFT_SOURCE">{{ startLabel }}</option>
        <option v-for="n in sources" :key="n" :value="n">{{ n }}</option>
      </select>
    </label>

    <!-- Cumulative -->
    <template v-else-if="type === 'cumulative' && item.kind === 'averaged'">
      <label class="field">
        <span>Trend of</span>
        <select class="select" :value="item.source" @change="patch({ source: ($event.target as HTMLSelectElement).value })">
          <option :value="LEFT_SOURCE">{{ startLabel }} (everyday spending)</option>
          <option v-for="n in sources" :key="n" :value="n">{{ n }}</option>
        </select>
      </label>
    </template>

    <!-- Records to use (both kinds worked out from records) -->
    <template v-if="item.kind === 'averaged'">
      <div class="field">
        <span>Records to use</span>
        <div class="seg three" role="radiogroup" aria-label="Records to use">
          <button v-for="m in [{ id: 'all', label: 'All' }, { id: 'last', label: 'Past N days' }, { id: 'between', label: 'Between' }] as const"
            :key="m.id" role="radio" :aria-checked="rangeMode === m.id" :class="{ on: rangeMode === m.id }" @click="rangeMode = m.id">
            {{ m.label }}
          </button>
        </div>
      </div>
      <label v-if="item.range.mode === 'last'" class="inline">
        Past
        <input class="input num days" type="number" inputmode="numeric" min="1" :value="item.range.days"
          @change="setRange({ mode: 'last', days: Math.max(1, Math.round(Number(($event.target as HTMLInputElement).value)) || 90) })" />
        days of records
      </label>
      <div v-else-if="item.range.mode === 'between'" class="row2">
        <label class="field">
          <span>From</span>
          <input class="input" type="date" :value="item.range.from ?? ''"
            @change="setBetween('from', ($event.target as HTMLInputElement).value)" />
        </label>
        <label class="field">
          <span>To</span>
          <input class="input" type="date" :value="item.range.to ?? ''"
            @change="setBetween('to', ($event.target as HTMLInputElement).value)" />
        </label>
      </div>
    </template>

    <p v-if="preview" class="preview" :class="preview.tone">
      <span v-if="preview.tag" class="tag">{{ preview.tag }}</span>{{ preview.text }}
    </p>
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
  min-height: 2.5em;
}

.field {
  display: grid;
  gap: 0.2rem;
  margin-bottom: 0.55rem;
  min-width: 0;
}

.field > span {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--mute);
}

.row2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
}

.check {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 40px;
  margin-bottom: 0.3rem;
}

.inline {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.55rem;
  font-size: 0.9rem;
}

.inline .days {
  width: 5rem;
}

.seg {
  display: grid;
  border: 1px solid var(--btn-border);
  border-radius: var(--btn-radius);
  overflow: hidden;
  margin-bottom: 0.55rem;
}

.seg.two {
  grid-template-columns: 1fr 1fr;
}

.seg.three {
  grid-template-columns: 0.7fr 1fr 1fr;
  margin-bottom: 0;
}

.seg button {
  min-height: 38px;
  border: none;
  background: var(--btn-bg);
  color: var(--btn-text);
  font-weight: 550;
  font-size: 0.86rem;
}

.seg button + button {
  border-left: 1px solid var(--btn-border);
}

.seg button.on {
  background: var(--btn-primary-bg);
  color: var(--btn-primary-text);
}

.preview {
  margin: 0.3rem 0;
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

.tag {
  display: inline-block;
  margin-right: 0.35rem;
  padding: 0 0.4rem;
  border-radius: 999px;
  background: var(--projection);
  color: var(--btn-primary-text);
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
}

.remove {
  margin-right: auto;
}

.err {
  color: var(--negative);
}
</style>
