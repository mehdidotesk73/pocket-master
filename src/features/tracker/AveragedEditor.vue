<script setup lang="ts">
// Projection items worked out from past records. Each picks a source (left so
// far, or a line by name), a mode (rate of change, or average amount once a
// month) and an optional date range; the figure can be overridden by hand.
import { computed } from 'vue'
import { type Averaged, type AveragedResult, LEFT_SOURCE, MIN_RATE_DAYS, newId } from '../../lib/finance'
import { fmtDate, fmtMoney } from '../../lib/money'
import SignedMoneyInput from './SignedMoneyInput.vue'

const items = defineModel<Averaged[]>({ required: true })
const props = defineProps<{ results: Record<string, AveragedResult>; lines: string[] }>()

function sourcesFor(a: Averaged) {
  const names = [...props.lines]
  if (a.source !== LEFT_SOURCE && !names.some((n) => n.toLowerCase() === a.source.toLowerCase())) names.unshift(a.source)
  return names
}

function add() {
  items.value = [
    ...items.value,
    { id: newId(), name: '', source: props.lines[0] ?? LEFT_SOURCE, mode: 'rate', day: 1 },
  ]
}
function remove(id: string) {
  items.value = items.value.filter((a) => a.id !== id)
}
function setSource(a: Averaged, v: string) {
  a.source = v
  if (v === LEFT_SOURCE) a.mode = 'rate'
}
function setManual(a: Averaged, on: boolean) {
  if (on) a.manual = props.results[a.id]?.computed ?? 0
  else delete a.manual
}
function setDay(a: Averaged, v: string) {
  const n = Math.round(Number(v))
  a.day = Number.isFinite(n) ? Math.min(31, Math.max(1, n)) : 1
}
function setDate(a: Averaged, key: 'from' | 'to', v: string) {
  if (v) a[key] = v
  else delete a[key]
}

const describe = computed(() => (a: Averaged) => {
  const r = props.results[a.id]
  if (!r) return ''
  const range =
    a.from || a.to
      ? ` between ${a.from ? fmtDate(a.from, { short: true }) : 'the first record'} and ${a.to ? fmtDate(a.to, { short: true }) : 'the latest'}`
      : ''
  if (r.computed == null) return r.reason ?? ''
  const what = a.mode === 'rate' ? `${fmtMoney(r.computed, { sign: true })} a month` : `${fmtMoney(r.computed, { sign: true })} each month`
  return `${what} (from ${r.count} record${r.count === 1 ? '' : 's'} over ${r.days} days${range})`
})
</script>

<template>
  <section class="card">
    <h2>From your records</h2>
    <p class="muted small intro">
      Averages worked out from past records. <b>Rate of change</b> takes how fast a value moved per month and
      continues it, a little each day. For <b>left so far</b> your monthly and one-time items are taken out
      first, so what's left is everyday spending. <b>Average amount</b> applies a line's typical value once a
      month.
    </p>

    <div v-for="a in items" :key="a.id" class="item">
      <div class="top">
        <input v-model="a.name" class="input name" placeholder="Name (e.g. Everyday spending)" aria-label="Name" />
        <button class="btn ghost rm" :aria-label="`Remove ${a.name || 'item'}`" @click="remove(a.id)">✕</button>
      </div>

      <div class="grid">
        <label>
          <span class="muted small">Average</span>
          <select
            class="select"
            :value="a.source"
            aria-label="Source"
            @change="setSource(a, ($event.target as HTMLSelectElement).value)"
          >
            <option :value="LEFT_SOURCE">Left so far</option>
            <option v-for="n in sourcesFor(a)" :key="n" :value="n">{{ n }}</option>
          </select>
        </label>
        <label>
          <span class="muted small">As</span>
          <select v-model="a.mode" class="select" aria-label="Mode">
            <option value="rate">Rate of change</option>
            <option value="amount" :disabled="a.source === LEFT_SOURCE">Average amount</option>
          </select>
        </label>
        <label>
          <span class="muted small">From</span>
          <input
            class="input"
            type="date"
            :value="a.from ?? ''"
            aria-label="Range start (empty = first record)"
            @change="setDate(a, 'from', ($event.target as HTMLInputElement).value)"
          />
        </label>
        <label>
          <span class="muted small">To</span>
          <input
            class="input"
            type="date"
            :value="a.to ?? ''"
            aria-label="Range end (empty = latest record)"
            @change="setDate(a, 'to', ($event.target as HTMLInputElement).value)"
          />
        </label>
        <label v-if="a.mode === 'amount'">
          <span class="muted small">On day</span>
          <input
            class="input num"
            type="number"
            inputmode="numeric"
            min="1"
            max="31"
            :value="a.day"
            aria-label="Day of month"
            @change="setDay(a, ($event.target as HTMLInputElement).value)"
          />
        </label>
      </div>
      <p class="muted small range-hint" v-if="!a.from && !a.to">Leave the dates empty to use every record.</p>

      <p class="result small" :class="{ none: results[a.id]?.computed == null }">{{ describe(a) }}</p>

      <div class="manual">
        <label class="check">
          <input
            class="checkbox"
            type="checkbox"
            :checked="a.manual != null"
            @change="setManual(a, ($event.target as HTMLInputElement).checked)"
          />
          <span class="small">Set it myself</span>
        </label>
        <SignedMoneyInput v-if="a.manual != null" v-model="a.manual" aria-label="Monthly amount" />
      </div>
      <p class="muted small used">
        Projection uses <b class="money">{{ fmtMoney(results[a.id]?.used ?? 0, { sign: true }) }}</b> a month{{
          a.mode === 'rate' ? ', spread daily' : `, on day ${a.day}`
        }}.
      </p>
    </div>

    <p v-if="!items.length" class="muted small">Nothing yet.</p>
    <button class="btn" @click="add">+ Add from records</button>
    <p class="muted small fine">Rates need records spanning {{ Math.ceil(MIN_RATE_DAYS / 7) }}+ weeks.</p>
  </section>
</template>

<style scoped>
.intro {
  margin: -0.3rem 0 0.75rem;
}

.item {
  padding: 0.75rem 0;
  border-top: 1px solid var(--line);
}

.top {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 0.4rem;
}

.rm {
  color: var(--mute);
}

.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.4rem;
  margin-top: 0.4rem;
}

.grid label {
  display: grid;
  gap: 0.15rem;
  min-width: 0;
}

@media (min-width: 44rem) {
  .grid {
    grid-template-columns: repeat(5, 1fr);
  }
}

.range-hint {
  margin: 0.3rem 0 0;
}

.result {
  margin: 0.5rem 0 0;
  color: var(--pos);
}

.result.none {
  color: var(--projection);
}

.manual {
  display: grid;
  grid-template-columns: auto minmax(0, 11rem);
  align-items: center;
  gap: 0.6rem;
  margin-top: 0.4rem;
}

.check {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  min-height: var(--tap);
}

.used {
  margin: 0.3rem 0 0;
}

.fine {
  margin: 0.5rem 0 0;
}

.btn {
  margin-top: 0.5rem;
}
</style>
