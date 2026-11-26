<script setup lang="ts">
// Create or edit a projection's setup: its name, which lines of the latest
// record it starts from, and how many days ahead it runs. Also duplicate /
// delete. Items are edited in the Future tab itself.
import { computed, ref } from 'vue'
import { HORIZON_PRESETS, MAX_HORIZON_DAYS, type ProjectionFile, defaultProjection, startValueCents } from '../../lib/finance'
import { fmtCents, fmtDate } from '../../lib/money'
import SheetModal from './SheetModal.vue'
import { useTracker } from './useTracker'

const props = defineProps<{ projection?: ProjectionFile }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const { latest, knownLines, projections, saveProjection, createProjection, deleteProjection } = useTracker()

const isNew = !props.projection
const draft = ref<ProjectionFile>(
  props.projection ? JSON.parse(JSON.stringify(props.projection)) : { ...defaultProjection('new'), name: '', items: [] },
)

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
  set: (on: boolean) => {
    draft.value.start = on ? { mode: 'lines', names: lineOptions.value.filter((l) => l.inLatest).map((l) => l.name) } : { mode: 'all' }
  },
})
function isPicked(name: string) {
  const s = draft.value.start
  return s.mode === 'all' || s.names.some((n) => n.toLowerCase() === name.toLowerCase())
}
function toggle(name: string) {
  const s = draft.value.start
  if (s.mode !== 'lines') return
  s.names = isPicked(name) ? s.names.filter((n) => n.toLowerCase() !== name.toLowerCase()) : [...s.names, name]
}
const startTotal = computed(() => (latest.value ? fmtCents(startValueCents(latest.value, draft.value.start)) : null))

function setDays(v: string | number) {
  const n = Math.round(Number(v))
  draft.value.horizonDays = Number.isFinite(n) ? Math.min(MAX_HORIZON_DAYS, Math.max(1, n)) : 90
}

const busy = ref(false)
const error = ref('')
const confirmDelete = ref(false)

async function save() {
  error.value = ''
  const name = draft.value.name.trim()
  if (!name) {
    error.value = 'Give it a name.'
    return
  }
  if (draft.value.start.mode === 'lines' && !draft.value.start.names.length) {
    error.value = 'Pick at least one line to start from.'
    return
  }
  busy.value = true
  try {
    if (isNew) {
      const created = await createProjection(name)
      await saveProjection({ ...draft.value, id: created.id, name })
    } else {
      await saveProjection({ ...draft.value, name })
    }
    emit('close')
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}

async function duplicate() {
  busy.value = true
  try {
    await createProjection(`${draft.value.name.trim() || 'Projection'} copy`, draft.value)
    emit('close')
  } finally {
    busy.value = false
  }
}

async function remove() {
  if (!confirmDelete.value) {
    confirmDelete.value = true
    return
  }
  try {
    await deleteProjection(draft.value.id)
    emit('close')
  } catch (e) {
    error.value = (e as Error).message
  }
}
</script>

<template>
  <SheetModal :title="isNew ? 'New projection' : 'Projection setup'" draft-key="projection-setup" @close="emit('close')">
    <label class="field">
      <span>Name</span>
      <input v-model="draft.name" class="input" placeholder="e.g. Checking account" />
    </label>

    <div class="field">
      <span>Starts from the latest record{{ latest ? ` (${fmtDate(latest.date)})` : '' }}</span>
      <div class="seg" role="radiogroup" aria-label="Starting lines">
        <button role="radio" :aria-checked="!pickLines" :class="{ on: !pickLines }" @click="pickLines = false">
          All lines (left so far)
        </button>
        <button role="radio" :aria-checked="pickLines" :class="{ on: pickLines }" @click="pickLines = true">
          Pick lines
        </button>
      </div>
    </div>

    <ul v-if="pickLines" class="lines">
      <li v-for="l in lineOptions" :key="l.name">
        <label class="line">
          <input class="checkbox" type="checkbox" :checked="isPicked(l.name)" @change="toggle(l.name)" />
          <span class="name">{{ l.name }}</span>
          <span v-if="l.inLatest" class="money small" :class="{ neg: l.value < 0, pos: l.value > 0 }">{{
            fmtCents(Math.round(l.value * 100), { sign: true })
          }}</span>
          <span v-else class="muted small">not in latest</span>
        </label>
      </li>
      <li v-if="!lineOptions.length" class="muted small">No records yet. Lines appear here once you save one.</li>
    </ul>
    <p v-if="startTotal != null" class="muted small total">
      Starting total: <b class="money">{{ startTotal }}</b>
    </p>

    <div class="field">
      <span>Days ahead</span>
      <div class="days">
        <button
          v-for="h in HORIZON_PRESETS"
          :key="h"
          class="chip"
          :class="{ on: draft.horizonDays === h }"
          @click="setDays(h)"
        >
          {{ h }}
        </button>
        <input
          class="input num"
          type="number"
          inputmode="numeric"
          min="1"
          :max="MAX_HORIZON_DAYS"
          :value="draft.horizonDays"
          aria-label="Days ahead"
          @change="setDays(($event.target as HTMLInputElement).value)"
        />
      </div>
    </div>

    <div v-if="!isNew" class="more">
      <button class="btn" :disabled="busy" @click="duplicate">Duplicate</button>
      <button class="btn danger" :disabled="busy || projections.length <= 1" @click="remove">
        {{ confirmDelete ? 'Tap again to delete' : 'Delete projection' }}
      </button>
    </div>
    <p v-if="!isNew && projections.length <= 1" class="muted small">This is your only projection, so it can't be deleted.</p>
    <p v-if="error" class="err small" role="alert">{{ error }}</p>

    <template #footer>
      <button class="btn ghost" @click="emit('close')">Cancel</button>
      <button class="btn primary" :disabled="busy" @click="save">{{ isNew ? 'Create' : 'Save' }}</button>
    </template>
  </SheetModal>
</template>

<style scoped>
.field {
  display: grid;
  gap: 0.3rem;
  margin-bottom: 0.75rem;
}

.field > span {
  font-size: 0.85rem;
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
  min-height: 40px;
  border: none;
  background: var(--btn-bg);
  color: var(--btn-text);
  font-weight: 550;
  font-size: 0.88rem;
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
  margin: -0.25rem 0 0.25rem;
  padding: 0;
  border-top: 1px solid var(--line);
}

.line {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 0.6rem;
  min-height: var(--tap);
  border-bottom: 1px solid var(--line);
}

.name {
  min-width: 0;
  overflow-wrap: anywhere;
}

.total {
  margin: 0.4rem 0 0.75rem;
}

.days {
  display: grid;
  grid-template-columns: repeat(4, 1fr) 5.5rem;
  gap: 0.3rem;
}

.chip {
  min-height: 40px;
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
  margin-top: 0.5rem;
}

.err {
  color: var(--negative);
}
</style>
