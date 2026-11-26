<script setup lang="ts">
// Add or edit one projection item, of any of the four kinds. Works on a copy;
// nothing is stored until Save. Shows what the item works out to live.
import { computed, ref } from 'vue'
import {
  type ItemKind,
  type ProjectionFile,
  type ProjectionItem,
  type RecordRange,
  LEFT_SOURCE,
  newId,
} from '../../lib/finance'
import { addDays, fmtDate, fmtMoney, isISODate, today } from '../../lib/money'
import SheetModal from './SheetModal.vue'
import SignedMoneyInput from './SignedMoneyInput.vue'
import { KIND_INFO, describeResult } from './projectionText'
import { useTracker } from './useTracker'

const props = defineProps<{ kind: ItemKind; item?: ProjectionItem; projection: ProjectionFile }>()
const emit = defineEmits<{
  (e: 'save', item: ProjectionItem): void
  (e: 'remove', id: string): void
  (e: 'close'): void
}>()

const { knownLines, resultsFor } = useTracker()

function blank(kind: ItemKind): ProjectionItem {
  const id = newId()
  switch (kind) {
    case 'recurring':
      return { kind, id, name: '', amount: 0, day: 1, inRecord: false }
    case 'oneTime':
      return { kind, id, name: '', amount: 0, date: addDays(today(), 7) }
    case 'averaged':
      return { kind, id, name: '', source: LEFT_SOURCE, mode: 'rate', range: { mode: 'last', days: 90 }, day: 1 }
    case 'extrapolate':
      return { kind, id, name: '', source: knownLines.value[0] ?? LEFT_SOURCE }
  }
}

const draft = ref<ProjectionItem>(props.item ? JSON.parse(JSON.stringify(props.item)) : blank(props.kind))
const isNew = !props.item
const info = KIND_INFO[props.kind]

const startLabel = computed(() => (props.projection.start.mode === 'all' ? 'Left so far' : 'Starting total'))
const sources = computed(() => {
  const d = draft.value
  const names = [...knownLines.value]
  if ('source' in d && d.source !== LEFT_SOURCE && !names.some((n) => n.toLowerCase() === d.source.toLowerCase())) names.unshift(d.source)
  return names
})

// ---- range (averaged)
const rangeMode = computed({
  get: () => (draft.value.kind === 'averaged' ? draft.value.range.mode : 'all'),
  set: (m: RecordRange['mode']) => {
    if (draft.value.kind !== 'averaged') return
    draft.value.range = m === 'last' ? { mode: 'last', days: 90 } : m === 'between' ? { mode: 'between' } : { mode: 'all' }
  },
})
function setDays(v: string) {
  if (draft.value.kind === 'averaged' && draft.value.range.mode === 'last') {
    const n = Math.round(Number(v))
    draft.value.range.days = Number.isFinite(n) ? Math.min(3650, Math.max(1, n)) : 90
  }
}
function setBetween(key: 'from' | 'to', v: string) {
  if (draft.value.kind === 'averaged' && draft.value.range.mode === 'between') {
    if (isISODate(v)) draft.value.range[key] = v
    else delete draft.value.range[key]
  }
}
function setDay(v: string) {
  const d = draft.value
  if (d.kind === 'recurring' || d.kind === 'averaged') {
    const n = Math.round(Number(v))
    d.day = Number.isFinite(n) ? Math.min(31, Math.max(1, n)) : 1
  }
}
function setSource(v: string) {
  const d = draft.value
  if (d.kind === 'averaged' || d.kind === 'extrapolate') {
    d.source = v
    if (d.kind === 'averaged' && v === LEFT_SOURCE) d.mode = 'rate'
  }
}

// ---- live result
const preview = computed(() => {
  const d = draft.value
  if (d.kind !== 'averaged' && d.kind !== 'extrapolate') return null
  const items = [...props.projection.items.filter((i) => i.id !== d.id), d]
  const res = resultsFor({ ...props.projection, items })[d.id]
  return res ? describeResult(d, res, props.projection) : null
})

const error = ref('')
function save() {
  const d = draft.value
  error.value = ''
  if (d.kind === 'oneTime' && !isISODate(d.date)) {
    error.value = 'Pick a date.'
    return
  }
  if ((d.kind === 'recurring' || d.kind === 'oneTime') && !d.amount) {
    error.value = 'Enter an amount.'
    return
  }
  if (!d.name.trim()) d.name = defaultName(d)
  emit('save', { ...d, name: d.name.trim() })
}

function defaultName(d: ProjectionItem): string {
  if (d.kind === 'averaged') return d.source === LEFT_SOURCE ? 'Everyday spending' : `${d.source} (${d.mode === 'rate' ? 'trend' : 'average'})`
  if (d.kind === 'extrapolate') return `${d.source === LEFT_SOURCE ? 'Total' : d.source} to month end`
  return info.label
}
</script>

<template>
  <SheetModal :title="`${isNew ? 'Add' : 'Edit'}: ${info.label}`" draft-key="projection-item" @close="emit('close')">
    <p class="muted small intro">{{ info.help }}</p>

    <label class="field">
      <span>Name</span>
      <input v-model="draft.name" class="input" :placeholder="info.placeholder" />
    </label>

    <!-- every month -->
    <template v-if="draft.kind === 'recurring'">
      <div class="row2">
        <label class="field">
          <span>Amount</span>
          <SignedMoneyInput v-model="draft.amount" aria-label="Amount" />
        </label>
        <label class="field day">
          <span>Day of month</span>
          <input
            class="input num"
            type="number"
            inputmode="numeric"
            min="1"
            max="31"
            :value="draft.day"
            @change="setDay(($event.target as HTMLInputElement).value)"
          />
        </label>
      </div>
      <p class="muted small">Tap <b class="pos">+</b>/<b class="neg">−</b> for coming in or going out. Day 31 means the last day of the month.</p>
      <label class="check">
        <input v-model="draft.inRecord" class="checkbox" type="checkbox" />
        <span>Already in my records until paid</span>
      </label>
      <p class="muted small">
        Tick this for things like rent that you list in each record until it's paid. The projection then skips it in
        the latest record's month, since that record already counts it, and applies it from next month.
      </p>
    </template>

    <!-- one time -->
    <template v-else-if="draft.kind === 'oneTime'">
      <div class="row2">
        <label class="field">
          <span>Amount</span>
          <SignedMoneyInput v-model="draft.amount" aria-label="Amount" />
        </label>
        <label class="field">
          <span>Date</span>
          <input v-model="draft.date" class="input" type="date" />
        </label>
      </div>
      <p class="muted small">Tap <b class="pos">+</b>/<b class="neg">−</b> for coming in or going out.</p>
    </template>

    <!-- average from records -->
    <template v-else-if="draft.kind === 'averaged'">
      <div class="row2">
        <label class="field">
          <span>Average</span>
          <select class="select" :value="draft.source" @change="setSource(($event.target as HTMLSelectElement).value)">
            <option :value="LEFT_SOURCE">{{ startLabel }}</option>
            <option v-for="n in sources" :key="n" :value="n">{{ n }}</option>
          </select>
        </label>
        <label class="field">
          <span>As</span>
          <select v-model="draft.mode" class="select">
            <option value="rate">Rate of change</option>
            <option value="amount" :disabled="draft.source === LEFT_SOURCE">Average amount</option>
          </select>
        </label>
      </div>
      <p class="muted small">
        <template v-if="draft.mode === 'rate'">
          How fast it moved per month, carried on a little each day.
          <template v-if="draft.source === LEFT_SOURCE">
            This projection's other items are taken out first, so what's left is everyday spending.
          </template>
        </template>
        <template v-else>Its typical value, applied once a month.</template>
      </p>

      <div class="field">
        <span>Records to use</span>
        <div class="seg" role="radiogroup" aria-label="Records to use">
          <button
            v-for="m in [
              { id: 'all', label: 'All' },
              { id: 'last', label: 'Past N days' },
              { id: 'between', label: 'Between dates' },
            ] as const"
            :key="m.id"
            role="radio"
            :aria-checked="rangeMode === m.id"
            :class="{ on: rangeMode === m.id }"
            @click="rangeMode = m.id"
          >
            {{ m.label }}
          </button>
        </div>
      </div>
      <label v-if="draft.range.mode === 'last'" class="field inline">
        <span>Past</span>
        <input
          class="input num days"
          type="number"
          inputmode="numeric"
          min="1"
          :value="draft.range.days"
          @change="setDays(($event.target as HTMLInputElement).value)"
        />
        <span>days, counting back from the latest record</span>
      </label>
      <div v-else-if="draft.range.mode === 'between'" class="row2">
        <label class="field">
          <span>From</span>
          <input
            class="input"
            type="date"
            :value="draft.range.from ?? ''"
            @change="setBetween('from', ($event.target as HTMLInputElement).value)"
          />
        </label>
        <label class="field">
          <span>To</span>
          <input
            class="input"
            type="date"
            :value="draft.range.to ?? ''"
            @change="setBetween('to', ($event.target as HTMLInputElement).value)"
          />
        </label>
      </div>
      <label v-if="draft.mode === 'amount'" class="field inline">
        <span>Apply on day</span>
        <input
          class="input num days"
          type="number"
          inputmode="numeric"
          min="1"
          max="31"
          :value="draft.day"
          @change="setDay(($event.target as HTMLInputElement).value)"
        />
        <span>of each month</span>
      </label>
    </template>

    <!-- extrapolate -->
    <template v-else-if="draft.kind === 'extrapolate'">
      <label class="field">
        <span>Value from the latest record</span>
        <select class="select" :value="draft.source" @change="setSource(($event.target as HTMLSelectElement).value)">
          <option :value="LEFT_SOURCE">{{ startLabel }}</option>
          <option v-for="n in sources" :key="n" :value="n">{{ n }}</option>
        </select>
      </label>
    </template>

    <p v-if="preview" class="preview" :class="preview.tone">
      <span v-if="preview.tag" class="tag">{{ preview.tag }}</span>
      {{ preview.text }}
    </p>
    <p v-if="draft.kind === 'oneTime' && isISODate(draft.date)" class="muted small">
      On {{ fmtDate(draft.date) }}: {{ fmtMoney(draft.amount, { sign: true }) }}
    </p>
    <p v-if="error" class="err small" role="alert">{{ error }}</p>

    <template #footer>
      <button v-if="!isNew" class="btn danger remove" @click="emit('remove', draft.id)">Remove</button>
      <button class="btn ghost" @click="emit('close')">Cancel</button>
      <button class="btn primary" @click="save">{{ isNew ? 'Add' : 'Save' }}</button>
    </template>
  </SheetModal>
</template>

<style scoped>
.intro {
  margin: 0 0 0.75rem;
}

.field {
  display: grid;
  gap: 0.25rem;
  margin-bottom: 0.6rem;
  min-width: 0;
}

.field > span {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--mute);
}

.field.inline {
  grid-template-columns: auto 5rem 1fr;
  align-items: center;
  gap: 0.5rem;
}

.field.inline > span {
  font-weight: 400;
  color: var(--ink);
  font-size: 0.9rem;
}

.row2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
}

.day .input {
  max-width: 6rem;
}

.check {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-height: var(--tap);
}

.seg {
  display: grid;
  grid-template-columns: 0.7fr 1fr 1.1fr;
  border: 1px solid var(--btn-border);
  border-radius: var(--btn-radius);
  overflow: hidden;
}

.seg button {
  min-height: 40px;
  border: none;
  background: var(--btn-bg);
  color: var(--btn-text);
  font-weight: 550;
  font-size: 0.88rem;
  padding: 0 0.3rem;
}

.seg button + button {
  border-left: 1px solid var(--btn-border);
}

.seg button.on {
  background: var(--btn-primary-bg);
  color: var(--btn-primary-text);
}

.preview {
  margin: 0.4rem 0 0.4rem;
  padding: 0.55rem 0.7rem;
  border-radius: 0.5rem;
  background: var(--panel-2);
  border: 1px solid var(--line);
  font-size: 0.92rem;
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
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.remove {
  margin-right: auto;
}

.err {
  color: var(--negative);
}
</style>
