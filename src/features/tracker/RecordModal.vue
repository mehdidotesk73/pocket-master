<script setup lang="ts">
// New / update record sheet. Full-screen on phones, a centered dialog on wide
// screens. Prefills from the latest record; closing discards the draft.
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { type BalanceRecord, type LineDef, type LineKind, type RecordLine, lineValue, sheet } from '../../lib/finance'
import { fmtDate, fmtMoney, isISODate, parseMoney, today } from '../../lib/money'
import { markUnsaved } from '../../lib/storage/store'
import { useTracker } from './useTracker'

const emit = defineEmits<{ (e: 'close'): void; (e: 'saved', date: string): void }>()

const { settings, records, latest, recordDates, saveRecord } = useTracker()

interface DraftRow {
  def: LineDef
  amount: string
  total: string
  share: string
}

const date = ref(today())
const rows = reactive<DraftRow[]>([])
const touched = ref(false)
const saving = ref(false)
const error = ref('')

const toInput = (n: number | undefined) => (n == null ? '' : n.toFixed(2))

function fill(from: BalanceRecord | null) {
  const byId = new Map((from?.lines ?? []).map((l) => [l.id, l]))
  rows.splice(
    0,
    rows.length,
    ...settings.value.lines.map((def) => {
      const prev = byId.get(def.id)
      return {
        def,
        amount: def.kind === 'card' ? '' : toInput(prev?.amount),
        total: def.kind === 'card' ? toInput(prev?.total) : '',
        share: String(prev?.share ?? def.share ?? 100),
      }
    }),
  )
}
fill(latest.value)

// Picking the date of an existing record (before typing anything) loads that record.
watch(date, (d) => {
  if (touched.value) return
  fill(records.value.find((r) => r.date === d) ?? latest.value)
})

function onBodyInput(e: Event) {
  if ((e.target as HTMLInputElement).type !== 'date') touched.value = true
}

const isUpdate = computed(() => recordDates.value.has(date.value))

function toLine(r: DraftRow): RecordLine {
  const base = { id: r.def.id, name: r.def.name, kind: r.def.kind }
  if (r.def.kind === 'card') {
    const share = parseMoney(r.share)
    return { ...base, total: parseMoney(r.total) ?? 0, share: share == null ? 100 : Math.min(100, Math.max(0, share)) }
  }
  return { ...base, amount: parseMoney(r.amount) ?? 0 }
}

const draftLines = computed(() => rows.map(toLine))
const live = computed(() => sheet(draftLines.value))

const groups: { title: string; kinds: LineKind[] }[] = [
  { title: 'Bank accounts', kinds: ['account'] },
  { title: 'Credit cards', kinds: ['card'] },
  { title: 'Bills due and money going out', kinds: ['bill', 'paying'] },
  { title: 'Money coming in', kinds: ['receiving'] },
]
const grouped = computed(() =>
  groups.map((g) => ({ ...g, rows: rows.filter((r) => g.kinds.includes(r.def.kind)) })).filter((g) => g.rows.length),
)

function invalid(v: string) {
  return v.trim() !== '' && parseMoney(v) == null
}
const hasInvalid = computed(() =>
  rows.some((r) => invalid(r.amount) || invalid(r.total) || (r.def.kind === 'card' && invalid(r.share))),
)

async function save() {
  error.value = ''
  if (!isISODate(date.value)) {
    error.value = 'Pick a valid date.'
    return
  }
  if (hasInvalid.value) {
    error.value = 'Some amounts aren’t numbers — check the fields outlined in red.'
    return
  }
  saving.value = true
  try {
    await saveRecord(date.value, draftLines.value)
    markUnsaved('record-modal', false)
    emit('saved', date.value)
    emit('close')
  } catch (e) {
    error.value = `Couldn’t save: ${(e as Error).message}`
  } finally {
    saving.value = false
  }
}

function close() {
  markUnsaved('record-modal', false)
  emit('close')
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
}

onMounted(() => {
  markUnsaved('record-modal', true)
  document.addEventListener('keydown', onKey)
  document.body.style.overflow = 'hidden'
})
onBeforeUnmount(() => {
  markUnsaved('record-modal', false)
  document.removeEventListener('keydown', onKey)
  document.body.style.overflow = ''
})
</script>

<template>
  <div class="backdrop">
    <div class="sheet" role="dialog" aria-modal="true" :aria-label="isUpdate ? 'Update record' : 'New record'">
      <header class="head">
        <h2>{{ isUpdate ? 'Update record' : 'New record' }}</h2>
        <button class="x" aria-label="Close" @click="close">✕</button>
      </header>

      <div class="body" @input="onBodyInput">
        <label class="field date">
          <span>Record date</span>
          <input v-model="date" class="input" type="date" required />
        </label>
        <p v-if="isUpdate" class="note small">
          A record for {{ fmtDate(date) }} already exists. Saving replaces it.
        </p>

        <section v-for="g in grouped" :key="g.title" class="group">
          <h3>{{ g.title }}</h3>
          <template v-for="r in g.rows" :key="r.def.id">
            <div v-if="r.def.kind === 'card'" class="card-row">
              <div class="name">{{ r.def.name }}</div>
              <label class="sub">
                <span class="muted small">Total balance</span>
                <input
                  v-model="r.total"
                  class="input num"
                  :class="{ bad: invalid(r.total) }"
                  inputmode="decimal"
                  placeholder="0.00"
                  :aria-label="`${r.def.name} total balance`"
                />
              </label>
              <label class="sub share">
                <span class="muted small">My share %</span>
                <input
                  v-model="r.share"
                  class="input num"
                  :class="{ bad: invalid(r.share) }"
                  inputmode="decimal"
                  :aria-label="`${r.def.name} my share percent`"
                />
              </label>
              <div class="mine small">
                mine <b class="money">{{ fmtMoney(lineValue(toLine(r))) }}</b>
              </div>
            </div>
            <label v-else class="line-row">
              <span class="name">{{ r.def.name }}</span>
              <input
                v-model="r.amount"
                class="input num"
                :class="{ bad: invalid(r.amount) }"
                inputmode="decimal"
                placeholder="0.00"
              />
            </label>
          </template>
        </section>
      </div>

      <footer class="foot">
        <div class="totals">
          <div><span class="muted small">Assets</span><b class="money">{{ fmtMoney(live.assets) }}</b></div>
          <div><span class="muted small">Liabilities</span><b class="money">{{ fmtMoney(live.liabilities) }}</b></div>
          <div class="left">
            <span class="muted small">Left so far</span>
            <b class="money" :class="{ neg: live.left < 0 }">{{ fmtMoney(live.left) }}</b>
          </div>
        </div>
        <p v-if="error" class="err small">{{ error }}</p>
        <div class="actions">
          <button class="btn ghost" @click="close">Cancel</button>
          <button class="btn primary" :disabled="saving" @click="save">
            {{ saving ? 'Saving…' : isUpdate ? 'Update record' : 'Save record' }}
          </button>
        </div>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 90;
  background: rgba(3, 7, 22, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
}

.sheet {
  background: var(--panel);
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

@media (min-width: 40rem) {
  .sheet {
    width: min(36rem, calc(100vw - 2rem));
    height: auto;
    max-height: calc(100dvh - 3rem);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5);
  }
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: max(0.75rem, env(safe-area-inset-top)) 1rem 0.5rem;
  border-bottom: 1px solid var(--line);
}

@media (min-width: 40rem) {
  .head {
    padding-top: 0.75rem;
  }
}

.head h2 {
  margin: 0;
  font-size: 1.25rem;
}

.x {
  width: var(--tap);
  height: var(--tap);
  border: none;
  background: none;
  color: var(--mute);
  font-size: 1.3rem;
}

.body {
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 0.75rem 1rem 1rem;
}

.field {
  display: grid;
  gap: 0.25rem;
}

.field span {
  font-weight: 600;
}

.note {
  margin: 0.5rem 0 0;
  padding: 0.5rem 0.6rem;
  border-left: 3px solid var(--projection);
  background: color-mix(in srgb, var(--projection) 10%, transparent);
  border-radius: 0.3rem;
}

.group h3 {
  margin: 1.25rem 0 0.4rem;
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--mute);
  font-family: var(--font-text);
  font-weight: 700;
}

.line-row {
  display: grid;
  grid-template-columns: 1fr minmax(7rem, 9.5rem);
  align-items: center;
  gap: 0.6rem;
  padding: 0.25rem 0;
}

.card-row {
  display: grid;
  grid-template-columns: 1fr 5.5rem;
  gap: 0.25rem 0.6rem;
  padding: 0.5rem 0;
  border-bottom: 1px solid color-mix(in srgb, var(--line) 60%, transparent);
}

.card-row .name {
  grid-column: 1 / -1;
  font-weight: 600;
}

.card-row .sub {
  display: grid;
  gap: 0.15rem;
}

.card-row .mine {
  grid-column: 1 / -1;
  text-align: right;
  color: var(--mute);
}

.card-row .mine b {
  color: var(--ink);
}

.name {
  min-width: 0;
  overflow-wrap: anywhere;
}

.input.bad {
  border-color: var(--negative);
  outline-color: var(--negative);
}

.foot {
  border-top: 1px solid var(--line);
  background: var(--panel-2);
  padding: 0.6rem 1rem max(0.75rem, env(safe-area-inset-bottom));
}

.totals {
  display: grid;
  grid-template-columns: 1fr 1fr 1.2fr;
  gap: 0.5rem;
  margin-bottom: 0.6rem;
}

.totals div {
  display: grid;
  min-width: 0;
}

.totals b {
  font-size: 0.95rem;
  overflow: hidden;
  text-overflow: ellipsis;
}

.totals .left b {
  font-family: var(--font-display);
  font-weight: 800;
  font-size: 1.2rem;
  color: var(--accent);
}

.totals .left b.neg {
  color: var(--negative);
}

.actions {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
}

.actions .btn {
  flex: 1;
  max-width: 12rem;
}

.err {
  color: var(--negative);
  margin: 0 0 0.5rem;
}
</style>
