<script setup lang="ts">
// New / update record sheet: a compact, editable list of line items.
// Each row is a name and a signed amount. Positive rows are assets, negative
// rows liabilities: no kinds to choose. Rows can be added and removed, and the
// current rows can be saved as the template every new record starts from.
//
// The sign is a ± toggle because the iPhone decimal keypad has no minus key.
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { type BalanceRecord, type RecordLine, type TemplateLine, newId, sheet } from '../../lib/finance'
import { fmtDate, fmtMoney, isISODate, parseMoney, today } from '../../lib/money'
import { markUnsaved } from '../../lib/storage/store'
import { useTracker } from './useTracker'

const emit = defineEmits<{ (e: 'close'): void; (e: 'saved', date: string): void }>()

const { template, records, latest, recordDates, saveRecord, saveTemplate } = useTracker()

interface Row {
  id: string
  name: string
  negative: boolean
  text: string // magnitude as typed
}

const date = ref(today())
const rows = reactive<Row[]>([])
const touched = ref(false)
const saving = ref(false)
const error = ref('')
const templateNote = ref('')

const toText = (n: number | undefined) => (n == null ? '' : Math.abs(n).toFixed(2))

/** Rows come from the template; amounts from `from` (by row id), else the template's own amount. */
function fill(from: BalanceRecord | null, useRecordRows = false) {
  const byId = new Map((from?.lines ?? []).map((l) => [l.id, l]))
  const source: TemplateLine[] = useRecordRows && from
    ? from.lines.map((l) => ({ id: l.id, name: l.name, amount: l.amount, negative: l.amount < 0 }))
    : template.value.rows
  rows.splice(
    0,
    rows.length,
    ...source.map((t) => {
      const prev = byId.get(t.id)
      const amount = prev?.amount ?? t.amount
      return {
        id: t.id,
        name: t.name,
        negative: amount != null && amount !== 0 ? amount < 0 : t.negative,
        text: toText(amount),
      }
    }),
  )
}
fill(latest.value)

// Picking the date of an existing record (before typing anything) loads that record as it was saved.
watch(date, (d) => {
  if (touched.value) return
  const existing = records.value.find((r) => r.date === d)
  if (existing) fill(existing, true)
  else fill(latest.value)
})

function onBodyInput(e: Event) {
  if ((e.target as HTMLInputElement).type !== 'date') touched.value = true
}

const isUpdate = computed(() => recordDates.value.has(date.value))

const magnitude = (r: Row) => Math.abs(parseMoney(r.text) ?? 0)
const signed = (r: Row) => (r.negative ? -1 : 1) * magnitude(r)
const invalid = (r: Row) => r.text.trim() !== '' && parseMoney(r.text) == null

// Typing a minus (desktop keyboards) flips the row negative and keeps the number positive.
function onAmount(r: Row, e: Event) {
  const v = (e.target as HTMLInputElement).value
  if (/^\s*[-−]/.test(v)) {
    r.negative = true
    r.text = v.replace(/^\s*[-−]\s*/, '')
  } else {
    r.text = v
  }
}

function toggleSign(r: Row) {
  r.negative = !r.negative
  touched.value = true
}

const list = ref<HTMLElement>()
async function addRow() {
  rows.push({ id: newId(), name: '', negative: true, text: '' })
  touched.value = true
  await nextTick()
  const inputs = list.value?.querySelectorAll<HTMLInputElement>('input.name')
  inputs?.[inputs.length - 1]?.focus()
}

function removeRow(id: string) {
  const i = rows.findIndex((r) => r.id === id)
  if (i >= 0) rows.splice(i, 1)
  touched.value = true
}

const draftLines = computed<RecordLine[]>(() =>
  rows.map((r) => ({ id: r.id, name: r.name.trim() || 'Unnamed', amount: signed(r) })),
)
const live = computed(() => sheet(draftLines.value))
const hasInvalid = computed(() => rows.some(invalid))

async function saveAsTemplate() {
  templateNote.value = ''
  try {
    await saveTemplate(
      rows.map((r) => ({ id: r.id, name: r.name.trim() || 'Unnamed', negative: r.negative })),
    )
    templateNote.value = `Template saved: new records will start with these ${rows.length} rows.`
  } catch (e) {
    templateNote.value = `Couldn’t save the template: ${(e as Error).message}`
  }
}

async function save() {
  error.value = ''
  if (!isISODate(date.value)) {
    error.value = 'Pick a valid date.'
    return
  }
  if (hasInvalid.value) {
    error.value = 'Some amounts aren’t numbers. Check the rows outlined in red.'
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
        <label class="date-row">
          <span>Date</span>
          <input v-model="date" class="input" type="date" required />
        </label>
        <p v-if="isUpdate" class="note small">
          A record for {{ fmtDate(date) }} already exists. Saving replaces it.
        </p>

        <p class="hint small muted">
          Tap <b class="pos">+</b>/<b class="neg">−</b> to switch a row between something you have and something you
          owe.
        </p>

        <ul ref="list" class="rows">
          <li v-for="r in rows" :key="r.id" class="row" :class="{ bad: invalid(r) }">
            <input v-model="r.name" class="name" placeholder="Name" aria-label="Line name" />
            <button
              class="sign"
              :class="r.negative ? 'neg' : 'pos'"
              :aria-label="r.negative ? `${r.name || 'Row'}: owe (tap to switch to have)` : `${r.name || 'Row'}: have (tap to switch to owe)`"
              @click="toggleSign(r)"
            >
              {{ r.negative ? '−' : '+' }}
            </button>
            <input
              class="amount"
              :class="r.negative ? 'neg' : 'pos'"
              :value="r.text"
              inputmode="decimal"
              placeholder="0.00"
              :aria-label="`${r.name || 'Row'} amount`"
              @input="onAmount(r, $event)"
            />
            <button class="rm" :aria-label="`Remove ${r.name || 'row'}`" @click="removeRow(r.id)">✕</button>
          </li>
        </ul>
        <p v-if="!rows.length" class="muted small">No rows. Add one below.</p>

        <div class="row-actions">
          <button class="btn" @click="addRow">+ Add row</button>
          <button class="btn ghost" :disabled="!rows.length" @click="saveAsTemplate">Save as template</button>
        </div>
        <p v-if="templateNote" class="ok small">{{ templateNote }}</p>
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
  background: var(--backdrop);
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
    width: min(34rem, calc(100vw - 2rem));
    height: auto;
    max-height: calc(100dvh - 3rem);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
  }
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: max(0.6rem, env(safe-area-inset-top)) 0.5rem 0.4rem 1rem;
  border-bottom: 1px solid var(--line);
}

@media (min-width: 40rem) {
  .head {
    padding-top: 0.6rem;
  }
}

.head h2 {
  margin: 0;
  font-size: 1.2rem;
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
  padding: 0.6rem 1rem 1rem;
}

.date-row {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 0.75rem;
  font-weight: 600;
}

.note {
  margin: 0.5rem 0 0;
  padding: 0.45rem 0.6rem;
  border-left: 3px solid var(--projection);
  background: color-mix(in srgb, var(--projection) 10%, transparent);
  border-radius: 0.3rem;
}

.hint {
  margin: 0.6rem 0 0.3rem;
}

.rows {
  list-style: none;
  margin: 0;
  padding: 0;
  border-top: 1px solid var(--line);
}

.row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 32px 6rem 30px;
  align-items: center;
  gap: 0.25rem;
  min-height: var(--tap);
  border-bottom: 1px solid var(--line);
}

.row.bad .amount {
  outline: 1.5px solid var(--negative);
}

.name,
.amount {
  min-width: 0;
  height: 40px;
  border: none;
  background: transparent;
  color: var(--ink);
  padding: 0 0.35rem;
  border-radius: 0.35rem;
}

.name:focus,
.amount:focus {
  outline: none;
  background: var(--bg);
  box-shadow: inset 0 0 0 1.5px var(--accent);
}

.amount {
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}

.amount.neg {
  color: var(--negative);
}

/* The have/owe toggle: deliberately quiet — a muted sign, no ring, same tap area. */
.sign {
  width: 30px;
  height: 40px;
  border: none;
  border-radius: var(--btn-radius);
  background: transparent;
  font-size: 0.95rem;
  font-weight: 500;
  line-height: 1;
  padding: 0;
  opacity: 0.6;
  transition:
    opacity 0.12s ease,
    background-color 0.12s ease;
}

.sign:hover,
.sign:focus-visible {
  opacity: 1;
  background: var(--panel-2);
}

.sign.pos {
  color: color-mix(in srgb, var(--pos) 70%, var(--mute));
}

.sign.neg {
  color: color-mix(in srgb, var(--negative) 70%, var(--mute));
}

.rm {
  width: 30px;
  height: 40px;
  border: none;
  background: none;
  color: var(--mute);
  padding: 0;
}

.row-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.75rem;
}

.ok {
  color: var(--pos);
  margin: 0.5rem 0 0;
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
  font-weight: 600;
  font-size: 1.2rem;
  color: var(--pos);
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
