<script setup lang="ts">
// New / update record sheet: a compact, editable list of line items.
// Each row is a name and a signed amount. Positive rows are assets, negative
// rows liabilities: no kinds to choose. Rows can be added and removed, and the
// current rows can be saved as the template every new record starts from.
//
// The sign is a ± toggle because the iPhone decimal keypad has no minus key.
// Negative amounts read as (730.48) until the field is focused; while typing,
// it's just the number. Rows reorder by dragging the grip on the left.
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { GripVertical } from '@lucide/vue'
import { type BalanceRecord, type RecordLine, type TemplateLine, newId, sheet } from '../../lib/finance'
import { fmtDateTime, fmtMoney, isLocalDateTime, nowLocal, parseMoney } from '../../lib/money'
import { markUnsaved } from '../../lib/storage/store'
import { useTracker } from './useTracker'

/** Open on an existing record to change it; otherwise it's a new record taken now. */
const props = defineProps<{ editing?: BalanceRecord }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'saved', at: string): void }>()

const { template, latest, recordTimes, saveRecord, saveTemplate, deleteRecord } = useTracker()

interface Row {
  id: string
  name: string
  negative: boolean
  text: string // magnitude as typed
}

// The record's moment: a date and a time (HH:MM). Seconds are kept from when
// the sheet opened (or from the record) so two quick saves never collide.
const start = props.editing?.at ?? nowLocal()
// One native date-and-time field (datetime-local: a single box and picker on iOS).
const when = ref(start.slice(0, 16)) // 'YYYY-MM-DDTHH:MM'
const seconds = start.slice(17, 19)
const rows = reactive<Row[]>([])
const touched = ref(false)
const saving = ref(false)
const error = ref('')
const templateNote = ref('')

const toText = (n: number | undefined) => (n == null ? '' : Math.abs(n).toFixed(2))

/**
 * Rows come from the template, in the order of `from` (the latest record) so a
 * reorder carries over; template rows it doesn't have go at the end. Amounts
 * come from `from` (by row id), else the template's own amount.
 */
function fill(from: BalanceRecord | null, useRecordRows = false) {
  const byId = new Map((from?.lines ?? []).map((l) => [l.id, l]))
  const order = new Map((from?.lines ?? []).map((l, i) => [l.id, i]))
  const rank = (id: string) => order.get(id) ?? Number.MAX_SAFE_INTEGER
  const source: TemplateLine[] = useRecordRows && from
    ? from.lines.map((l) => ({ id: l.id, name: l.name, amount: l.amount, negative: l.amount < 0 }))
    : template.value.rows
        .map((t, i) => ({ t, i }))
        .sort((a, b) => rank(a.t.id) - rank(b.t.id) || a.i - b.i)
        .map(({ t }) => t)
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
if (props.editing) fill(props.editing, true)
else fill(latest.value)

function onBodyInput(e: Event) {
  const t = (e.target as HTMLInputElement).type
  if (t !== 'datetime-local') touched.value = true
}

const isUpdate = !!props.editing
const at = computed(() => `${when.value.slice(0, 16)}:${seconds}`)
/** Another record already at this exact moment (saving would replace it). */
const clash = computed(() => at.value !== props.editing?.at && recordTimes.value.has(at.value))

const magnitude = (r: Row) => Math.abs(parseMoney(r.text) ?? 0)
const signed = (r: Row) => (r.negative ? -1 : 1) * magnitude(r)
// More than 2 decimals is a typo (e.g. "300.00650"), not something to round away silently.
const invalid = (r: Row) => r.text.trim() !== '' && (parseMoney(r.text) == null || /\.\d{3,}/.test(r.text))

// Typing a minus or pasting (730.48) flips the row negative and keeps just the number.
function onAmount(r: Row, e: Event) {
  const v = (e.target as HTMLInputElement).value
  if (/^\s*[-−(]/.test(v)) {
    r.negative = true
    r.text = v.replace(/^\s*[-−(]\s*/, '').replace(/\)\s*$/, '')
  } else {
    r.text = v
  }
}

// ---- display: (730.48) for negatives, except in the field being typed in
const editingAmount = ref<string | null>(null)
// Show the bare number while editing, and select it so typing replaces it
// (otherwise "(300.00)" → "300.00" can leave the caret at the end).
function onAmountFocus(r: Row, e: FocusEvent) {
  editingAmount.value = r.id
  const el = e.target as HTMLInputElement
  nextTick(() => {
    if (document.activeElement === el) el.select()
  })
}
function shownAmount(r: Row): string {
  if (editingAmount.value === r.id) return r.text
  const v = parseMoney(r.text)
  if (r.text.trim() === '' || v == null) return r.text
  const mag = Math.abs(v).toFixed(2)
  return r.negative && Math.abs(v) >= 0.005 ? `(${mag})` : mag
}

// ---- drag to reorder (pointer events: works for touch, pen and mouse)
// The dragged row follows the pointer: on one side it leaves a gap, on the
// other it covers part of its neighbour. They swap once the gap is larger than
// the neighbour's still-visible height (i.e. past the neighbour's midpoint).
const drag = reactive({ id: '', pointerId: -1, startY: 0, dy: 0 })
const rowEls = new Map<string, HTMLElement>()
function setRowEl(id: string, el: unknown) {
  if (el instanceof HTMLElement) rowEls.set(id, el)
  else rowEls.delete(id)
}
const heightOf = (id: string) => rowEls.get(id)?.getBoundingClientRect().height ?? 44

function onGripDown(e: PointerEvent, id: string) {
  e.preventDefault()
  ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
  ;(document.activeElement as HTMLElement | null)?.blur?.()
  Object.assign(drag, { id, pointerId: e.pointerId, startY: e.clientY, dy: 0 })
  touched.value = true
}

function onGripMove(e: PointerEvent) {
  if (!drag.id || e.pointerId !== drag.pointerId) return
  drag.dy = e.clientY - drag.startY
  let i = rows.findIndex((r) => r.id === drag.id)
  // Downwards: gap above = dy, covered part of the next row = dy, visible = h − dy.
  while (drag.dy > 0 && i < rows.length - 1) {
    const h = heightOf(rows[i + 1].id)
    if (drag.dy <= h - drag.dy) break
    rows.splice(i + 1, 0, rows.splice(i, 1)[0])
    i++
    drag.startY += h
    drag.dy -= h
  }
  // Upwards, mirrored.
  while (drag.dy < 0 && i > 0) {
    const h = heightOf(rows[i - 1].id)
    if (-drag.dy <= h + drag.dy) break
    rows.splice(i - 1, 0, rows.splice(i, 1)[0])
    i--
    drag.startY -= h
    drag.dy += h
  }
}

function onGripUp(e: PointerEvent) {
  if (e.pointerId !== drag.pointerId) return
  Object.assign(drag, { id: '', pointerId: -1, dy: 0 })
}

// Keyboard: arrow keys on the grip move the row by one.
function onGripKey(e: KeyboardEvent, id: string) {
  const i = rows.findIndex((r) => r.id === id)
  const j = e.key === 'ArrowUp' ? i - 1 : e.key === 'ArrowDown' ? i + 1 : -1
  if (j < 0 || j >= rows.length) return
  e.preventDefault()
  rows.splice(j, 0, rows.splice(i, 1)[0])
  touched.value = true
  nextTick(() => rowEls.get(id)?.querySelector<HTMLElement>('.grip')?.focus())
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
  if (!isLocalDateTime(at.value)) {
    error.value = 'Pick a valid date and time.'
    return
  }
  if (hasInvalid.value) {
    error.value = 'Some amounts aren’t numbers. Check the rows outlined in red.'
    return
  }
  saving.value = true
  try {
    await saveRecord(at.value, draftLines.value, props.editing?.at)
    markUnsaved('record-modal', false)
    emit('saved', at.value)
    emit('close')
  } catch (e) {
    error.value = `Couldn’t save: ${(e as Error).message}`
  } finally {
    saving.value = false
  }
}

const confirmDelete = ref(false)
async function remove() {
  if (!props.editing) return
  if (!confirmDelete.value) {
    confirmDelete.value = true
    return
  }
  await deleteRecord(props.editing.at)
  markUnsaved('record-modal', false)
  emit('close')
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
        <label class="when">
          <span>Date and time</span>
          <input v-model="when" class="input" type="datetime-local" required />
        </label>
        <p v-if="clash" class="note small">
          There's already a record at {{ fmtDateTime(at) }}. Saving replaces it; change the time to keep both.
        </p>

        <p class="hint small muted">
          Tap <b class="pos">+</b>/<b class="neg">−</b> to switch a row between something you have and something you
          owe. Drag <GripVertical class="inline-ic" aria-hidden="true" /> to reorder.
        </p>

        <ul ref="list" class="rows">
          <li
            v-for="r in rows"
            :key="r.id"
            :ref="(el) => setRowEl(r.id, el)"
            class="row"
            :class="{ bad: invalid(r), dragging: drag.id === r.id }"
            :style="drag.id === r.id ? { transform: `translateY(${drag.dy}px)` } : undefined"
          >
            <button
              class="grip"
              :aria-label="`Move ${r.name || 'row'} (drag, or use the arrow keys)`"
              @pointerdown="onGripDown($event, r.id)"
              @pointermove="onGripMove"
              @pointerup="onGripUp"
              @pointercancel="onGripUp"
              @keydown="onGripKey($event, r.id)"
            >
              <GripVertical class="grip-ic" aria-hidden="true" />
            </button>
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
              :value="shownAmount(r)"
              inputmode="decimal"
              placeholder="0.00"
              :aria-label="`${r.name || 'Row'} amount${r.negative ? ' (owed)' : ''}`"
              @focus="onAmountFocus(r, $event)"
              @blur="editingAmount = null"
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
          <button v-if="isUpdate" class="btn danger del" @click="remove">
            {{ confirmDelete ? 'Tap again to delete' : 'Delete' }}
          </button>
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

.when {
  display: grid;
  gap: 0.2rem;
  min-width: 0;
}

/* iOS gives date inputs a minimum width and centred text: let it fill the row instead. */
.when .input {
  width: 100%;
  min-width: 0;
  text-align: left;
}

.when .input::-webkit-date-and-time-value {
  text-align: left;
}

.when > span {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--mute);
}

.del {
  margin-right: auto;
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
  position: relative;
  background: var(--panel);
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) 30px 6rem 30px;
  align-items: center;
  gap: 0.25rem;
  min-height: var(--tap);
  border-bottom: 1px solid var(--line);
}

.row.dragging {
  z-index: 2;
  border-radius: var(--btn-radius);
  background: var(--panel-2);
  box-shadow: var(--shadow);
  outline: 1px solid var(--line);
}

.grip {
  display: grid;
  place-items: center;
  width: 24px;
  height: 40px;
  padding: 0;
  border: none;
  background: none;
  color: var(--mute);
  opacity: 0.6;
  cursor: grab;
  touch-action: none; /* the drag, not the page scroll, gets the touch */
  user-select: none;
  -webkit-user-select: none;
}

.dragging .grip {
  cursor: grabbing;
  opacity: 1;
}

.grip:focus-visible {
  outline: 2px solid var(--accent);
  opacity: 1;
}

.grip-ic {
  width: 1rem;
  height: 1rem;
}

.inline-ic {
  width: 0.9em;
  height: 0.9em;
  vertical-align: -0.1em;
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
