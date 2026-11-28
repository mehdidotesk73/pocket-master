<script setup lang="ts">
// Edit one projection: Recurring (an amount every N days / weeks / months /
// years from a start date) or One-time (an amount on a date). Plain amounts
// only: nothing here is worked out from records or tied to a line. Read the
// Past tab, decide, type the number.
// Every change flows straight into the chart above (v-model); nothing is
// stored until Save. Switching type and back keeps what was typed for each.
import { computed, reactive, ref, watch } from 'vue'
import type { EveryUnit, Projection, ProjectionItem, Recurring } from '../../lib/finance'
import { addDays, isISODate, today } from '../../lib/money'
import DockPanel from './DockPanel.vue'
import WheelPicker from './WheelPicker.vue'
import { ChevronDown } from '@lucide/vue'
import SignedMoneyInput from './SignedMoneyInput.vue'
import { UI_INFO, UI_TYPES, type UiType, readBack, uiTypeOf } from './projectionText'

const item = defineModel<ProjectionItem>({ required: true })
/** `result` is the forecast worked out with this draft in it (drives the readback). */
const props = defineProps<{ result: Projection | null; isNew: boolean }>()
const emit = defineEmits<{ (e: 'save'): void; (e: 'remove'): void; (e: 'cancel'): void }>()

// ---- type
const type = ref<UiType>(uiTypeOf(item.value))
const remembered = reactive<Partial<Record<UiType, ProjectionItem>>>({ [type.value]: item.value })
const typeOptions = UI_TYPES.map((id) => ({ id, label: UI_INFO[id].label }))

watch(type, (to, from) => {
  remembered[from] = item.value
  const cur = item.value
  const kept = remembered[to]
  if (kept) item.value = { ...kept, name: cur.name, amount: cur.amount }
  else if (to === 'oneTime') item.value = { kind: 'oneTime', id: cur.id, name: cur.name, amount: cur.amount, date: addDays(today(), 7) }
  else item.value = { kind: 'recurring', id: cur.id, name: cur.name, amount: cur.amount, every: { n: 1, unit: 'month' }, start: today() }
})
watch(item, (v) => (remembered[type.value] = v))

function patch(p: Partial<Recurring> | Partial<ProjectionItem>) {
  item.value = { ...item.value, ...p } as ProjectionItem
}
const rec = computed(() => (item.value.kind === 'recurring' ? item.value : null))

// ---- repeats
const UNITS: { id: EveryUnit; one: string; many: string }[] = [
  { id: 'day', one: 'day', many: 'days' },
  { id: 'week', one: 'week', many: 'weeks' },
  { id: 'month', one: 'month', many: 'months' },
  { id: 'year', one: 'year', many: 'years' },
]
const int = (v: string, d: number) => Math.max(1, Math.round(Number(v)) || d)
function setEvery(p: Partial<{ n: number; unit: EveryUnit }>) {
  const r = rec.value
  if (r) patch({ every: { ...r.every, ...p } })
}
const unitOptions = computed(() => UNITS.map((u) => ({ id: u.id, label: rec.value?.every.n === 1 ? u.one : u.many })))

// ---- readback: the projection as a sentence, plus what it adds up to
const said = computed(() => (props.result ? readBack(item.value, props.result) : null))
const showMore = ref(false)

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
  if (it.kind === 'oneTime' && !isISODate(it.date)) return void (error.value = 'Pick a date.')
  if (it.kind === 'recurring' && !isISODate(it.start)) return void (error.value = 'Pick a start date.')
  if (!it.amount) return void (error.value = 'Enter an amount.')
  if (!it.name.trim()) patch({ name: UI_INFO[type.value].label })
  emit('save')
}
</script>

<template>
  <DockPanel :title="isNew ? 'New projection' : 'Edit projection'" draft-key="projection-edit" @close="emit('cancel')">
    <!-- name · type -->
    <div class="top">
      <input class="input" :value="item.name" aria-label="Name" placeholder="Name, e.g. Paycheck" @input="patch({ name: ($event.target as HTMLInputElement).value })" />
      <WheelPicker v-model="type" :options="typeOptions" label="Projection type" />
    </div>

    <!-- One-time: amount · date -->
    <div v-if="item.kind === 'oneTime'" class="row2">
      <label class="field">
        <span>Amount</span>
        <SignedMoneyInput :model-value="item.amount" aria-label="Amount" @update:model-value="(v: number) => patch({ amount: v })" />
      </label>
      <label class="field">
        <span>Date</span>
        <input class="input" type="date" :value="item.date" @change="isISODate(($event.target as HTMLInputElement).value) && patch({ date: ($event.target as HTMLInputElement).value })" />
      </label>
    </div>

    <!-- Recurring: every · unit · starting, then the amount -->
    <template v-else-if="rec">
      <div class="row3">
        <label class="field">
          <span>Every</span>
          <input class="input num" type="number" inputmode="numeric" min="1" :value="rec.every.n" aria-label="How many" @change="setEvery({ n: int(($event.target as HTMLInputElement).value, 1) })" />
        </label>
        <div class="field">
          <span>Unit</span>
          <WheelPicker :model-value="rec.every.unit" :options="unitOptions" label="Unit" @update:model-value="(u: EveryUnit) => setEvery({ unit: u })" />
        </div>
        <label class="field">
          <span>Starting</span>
          <input class="input" type="date" :value="rec.start" @change="isISODate(($event.target as HTMLInputElement).value) && patch({ start: ($event.target as HTMLInputElement).value })" />
        </label>
      </div>
      <label class="field">
        <span>Amount each time</span>
        <SignedMoneyInput :model-value="rec.amount" aria-label="Amount each time" @update:model-value="(v: number) => patch({ amount: v })" />
      </label>
    </template>

    <p v-if="error" class="err small" role="alert">{{ error }}</p>

    <!-- The readback: one sentence, tap for the rest. -->
    <template v-if="said" #summary>
      <button type="button" class="readback" :class="[said.tone, { open: showMore }]" :aria-expanded="showMore" @click="showMore = !showMore">
        <span class="sentence">{{ said.sentence }}</span>
        <span class="more">
          <span v-if="said.warnings.length && !showMore" class="warn-pill">{{ said.warnings.length }} to check</span>
          <ChevronDown class="chev" aria-hidden="true" />
        </span>
        <span v-if="showMore" class="details">
          <span class="small">{{ said.total }}</span>
          <span v-for="w in said.warnings" :key="w" class="small warn-line">{{ w }}</span>
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

.row2 {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.45rem;
  align-items: start;
}

.row2 :deep(.input) {
  width: 100%;
  min-width: 0;
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
