<script setup lang="ts">
// Edit a forecast's setup: its name, which lines of the latest record it starts
// from, and how many days ahead it runs. Changes show on the chart above as you
// make them (v-model); nothing is stored until Save. Also duplicate / delete.
import { computed, ref } from 'vue'
import { HORIZON_PRESETS, MAX_HORIZON_DAYS, type ProjectionFile, startValueCents } from '../../lib/finance'
import { fmtCents, fmtDateTime } from '../../lib/money'
import DockPanel from './DockPanel.vue'
import { useTracker } from './useTracker'

const draft = defineModel<ProjectionFile>({ required: true })
defineProps<{ isNew: boolean; canDelete: boolean }>()
const emit = defineEmits<{ (e: 'save'): void; (e: 'cancel'): void; (e: 'duplicate'): void; (e: 'remove'): void }>()

const { latest, knownLines } = useTracker()

function patch(p: Partial<ProjectionFile>) {
  draft.value = { ...draft.value, ...p }
}

// Lines offered: the latest record's first (with their values), then any others seen before.
const lineOptions = computed(() => {
  const inLatest = latest.value?.lines.map((l) => l.name.trim()).filter(Boolean) ?? []
  const seen = new Set(inLatest.map((n) => n.toLowerCase()))
  const older = knownLines.value.filter((n) => !seen.has(n.toLowerCase()))
  return [
    ...inLatest.map((name) => ({ name, value: latest.value!.lines.find((l) => l.name.trim() === name)!.amount, inLatest: true })),
    ...older.map((name) => ({ name, value: 0, inLatest: false })),
  ]
})

const pickLines = computed({
  get: () => draft.value.start.mode === 'lines',
  set: (on: boolean) =>
    patch({ start: on ? { mode: 'lines', names: lineOptions.value.filter((l) => l.inLatest).map((l) => l.name) } : { mode: 'all' } }),
})
function isPicked(name: string) {
  const s = draft.value.start
  return s.mode === 'all' || s.names.some((n) => n.toLowerCase() === name.toLowerCase())
}
function toggle(name: string) {
  const s = draft.value.start
  if (s.mode !== 'lines') return
  patch({ start: { mode: 'lines', names: isPicked(name) ? s.names.filter((n) => n.toLowerCase() !== name.toLowerCase()) : [...s.names, name] } })
}
const startTotal = computed(() => (latest.value ? fmtCents(startValueCents(latest.value, draft.value.start)) : null))

function setDays(v: string | number) {
  const n = Math.round(Number(v))
  patch({ horizonDays: Number.isFinite(n) ? Math.min(MAX_HORIZON_DAYS, Math.max(1, n)) : 90 })
}

const error = ref('')
const confirmDelete = ref(false)
function save() {
  error.value = ''
  if (!draft.value.name.trim()) return void (error.value = 'Give it a name.')
  if (draft.value.start.mode === 'lines' && !draft.value.start.names.length) return void (error.value = 'Pick at least one line to start from.')
  emit('save')
}
function remove() {
  if (!confirmDelete.value) return void (confirmDelete.value = true)
  emit('remove')
}
</script>

<template>
  <DockPanel :title="isNew ? 'New forecast' : 'Edit forecast'" draft-key="forecast-edit" @close="emit('cancel')">
    <p class="muted small help">
      A forecast starts from your latest record and adds up its projections over the days ahead. Keep several, like
      one for everything and one for just checking and cards.
    </p>
    <label class="field">
      <span>Name</span>
      <input class="input" :value="draft.name" placeholder="e.g. Checking account" @input="patch({ name: ($event.target as HTMLInputElement).value })" />
    </label>

    <div class="field">
      <span>Starts from the latest record{{ latest ? ` (${fmtDateTime(latest.at, { short: true })})` : '' }}</span>
      <div class="seg" role="radiogroup" aria-label="Starting lines">
        <button role="radio" :aria-checked="!pickLines" :class="{ on: !pickLines }" @click="pickLines = false">All lines (left so far)</button>
        <button role="radio" :aria-checked="pickLines" :class="{ on: pickLines }" @click="pickLines = true">Pick lines</button>
      </div>
    </div>
    <ul v-if="pickLines" class="lines">
      <li v-for="l in lineOptions" :key="l.name">
        <label class="line">
          <input class="checkbox" type="checkbox" :checked="isPicked(l.name)" @change="toggle(l.name)" />
          <span class="name">{{ l.name }}</span>
          <span v-if="l.inLatest" class="money small" :class="{ neg: l.value < 0, pos: l.value > 0 }">{{ fmtCents(Math.round(l.value * 100), { sign: true }) }}</span>
          <span v-else class="muted small">not in latest</span>
        </label>
      </li>
      <li v-if="!lineOptions.length" class="muted small">No records yet. Lines appear here once you save one.</li>
    </ul>
    <p v-if="startTotal != null" class="muted small total">Starting total: <b class="money">{{ startTotal }}</b></p>

    <div class="field">
      <span>Days ahead</span>
      <div class="days">
        <button v-for="h in HORIZON_PRESETS" :key="h" class="chip" :class="{ on: draft.horizonDays === h }" @click="setDays(h)">{{ h }}</button>
        <input class="input num" type="number" inputmode="numeric" min="1" :max="MAX_HORIZON_DAYS" :value="draft.horizonDays"
          aria-label="Days ahead" @change="setDays(($event.target as HTMLInputElement).value)" />
      </div>
    </div>

    <div v-if="!isNew" class="more">
      <button class="btn" @click="emit('duplicate')">Duplicate</button>
      <button class="btn danger" :disabled="!canDelete" @click="remove">{{ confirmDelete ? 'Tap again to delete' : 'Delete forecast' }}</button>
    </div>
    <p v-if="!isNew && !canDelete" class="muted small">This is your only forecast, so it can't be deleted.</p>
    <p v-if="error" class="err small" role="alert">{{ error }}</p>

    <template #footer>
      <button class="btn ghost" @click="emit('cancel')">Cancel</button>
      <button class="btn primary" @click="save">{{ isNew ? 'Create' : 'Save' }}</button>
    </template>
  </DockPanel>
</template>

<style scoped>
.help {
  margin: 0 0 0.6rem;
}

.field {
  display: grid;
  gap: 0.25rem;
  margin-bottom: 0.65rem;
}

.field > span {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--mute);
}

.seg {
  display: grid;
  grid-template-columns: 1.3fr 1fr;
  border: 1px solid var(--btn-border);
  border-radius: var(--btn-radius);
  overflow: hidden;
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

.lines {
  list-style: none;
  margin: -0.3rem 0 0.25rem;
  padding: 0;
  border-top: 1px solid var(--line);
}

.line {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 0.6rem;
  min-height: 42px;
  border-bottom: 1px solid var(--line);
}

.name {
  min-width: 0;
  overflow-wrap: anywhere;
}

.total {
  margin: 0.3rem 0 0.65rem;
}

.days {
  display: grid;
  grid-template-columns: repeat(4, 1fr) 5.5rem;
  gap: 0.3rem;
}

.chip {
  min-height: 38px;
  border: 1px solid var(--btn-border);
  border-radius: var(--btn-radius);
  background: var(--btn-bg);
  color: var(--btn-text);
  font-weight: 550;
}

.chip.on {
  background: var(--btn-primary-bg);
  border-color: var(--btn-primary-bg);
  color: var(--btn-primary-text);
}

.more {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.err {
  color: var(--negative);
}
</style>
