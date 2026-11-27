<script setup lang="ts">
import { computed, ref } from 'vue'
import { type LocalDateTime, atNum, fmtDate, fmtDateTime, fmtMoney, fmtTime } from '../../lib/money'
import type { BalanceRecord } from '../../lib/finance'
import RecordModal from './RecordModal.vue'
import FigureRow, { type Figure } from './FigureRow.vue'
import LineChart, { type ChartSeries, type ChartSpans } from './LineChart.vue'
import { useTracker } from './useTracker'

const { records, deleteRecord } = useTracker()

const figures = computed<Figure[]>(() => {
  const r = records.value
  if (!r.length) return []
  const first = r[0]
  const last = r[r.length - 1]
  const hi = r.reduce((a, b) => (b.left > a.left ? b : a))
  const lo = r.reduce((a, b) => (b.left < a.left ? b : a))
  const change = last.left - first.left
  return [
    { label: 'Records', value: String(r.length), sub: `since ${fmtDate(first.date)}` },
    {
      label: 'Change in net equity',
      value: fmtMoney(change, { sign: true }),
      tone: change < 0 ? 'neg' : 'pos',
      sub: r.length > 1 ? `${fmtDate(first.date, { short: true })} → ${fmtDate(last.date, { short: true })}` : 'one record so far',
    },
    { label: 'Highest', value: fmtMoney(hi.left), sub: fmtDateTime(hi.at, { short: true }), tone: hi.left < 0 ? 'neg' : undefined },
    { label: 'Lowest', value: fmtMoney(lo.left), sub: fmtDateTime(lo.at, { short: true }), tone: lo.left < 0 ? 'neg' : undefined },
  ]
})

// Owned (blue) and net equity (ink) as lines with a dot per record; the red bar
// between them on each record is what's owed, since net equity = owned − owed.
const series = computed<ChartSeries[]>(() => {
  const r = records.value
  return [
    { label: 'Total owned', color: 'var(--assets)', dots: true, width: 1.75, points: r.map((x) => ({ x: atNum(x.at), y: x.assets })) },
    { label: 'Net equity', color: 'var(--ink)', dots: true, width: 2.25, points: r.map((x) => ({ x: atNum(x.at), y: x.left })) },
  ]
})
const owed = computed<ChartSpans>(() => ({
  label: 'Total owed',
  color: 'var(--negative)',
  items: records.value.map((x) => ({ x: atNum(x.at), from: x.left, to: x.assets, value: x.liabilities })),
}))

const newestFirst = computed(() => [...records.value].reverse())

const confirming = ref<LocalDateTime | null>(null)
async function onDelete(at: LocalDateTime) {
  if (confirming.value !== at) {
    confirming.value = at
    setTimeout(() => confirming.value === at && (confirming.value = null), 4000)
    return
  }
  confirming.value = null
  await deleteRecord(at)
}

const editing = ref<BalanceRecord | null>(null)
</script>

<template>
  <div class="history">
    <section v-if="!records.length" class="card">
      <h2>No history yet</h2>
      <p class="muted">Every record you save shows up here, so you can see how your position moves over time.</p>
    </section>

    <template v-else>
      <FigureRow :figures="figures" />

      <section class="card">
        <h2>Over time</h2>
        <LineChart :series="series" :spans="owed" include-zero />
      </section>

      <section class="card table-card">
        <h2>All records</h2>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th class="r">Owned</th>
                <th class="r">Owed</th>
                <th class="r">Net equity</th>
                <th><span class="sr">Delete</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in newestFirst" :key="r.at" class="rec" @click="editing = r">
                <td class="date">
                  <button class="open" :aria-label="`Open the record of ${fmtDateTime(r.at)}`" @click.stop="editing = r">
                    <span>{{ fmtDate(r.date, { short: true }) }} <span class="yr">’{{ r.date.slice(2, 4) }}</span></span>
                    <span class="tm">{{ fmtTime(r.at) }}</span>
                  </button>
                </td>
                <td class="r money">{{ fmtMoney(r.assets, { whole: true }) }}</td>
                <td class="r money">{{ fmtMoney(r.liabilities, { whole: true }) }}</td>
                <td class="r money left" :class="{ neg: r.left < 0 }">{{ fmtMoney(r.left) }}</td>
                <td class="del">
                  <button
                    class="del-btn"
                    :class="{ armed: confirming === r.at }"
                    :aria-label="confirming === r.at ? `Confirm delete ${fmtDateTime(r.at)}` : `Delete ${fmtDateTime(r.at)}`"
                    @click.stop="onDelete(r.at)"
                  >
                    {{ confirming === r.at ? 'Delete?' : '✕' }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="muted small">Tap a record to open it, change it, or delete it. You can save several on the same day.</p>
      </section>
    </template>

    <RecordModal v-if="editing" :editing="editing" @close="editing = null" />
  </div>
</template>

<style scoped>
.history > .card + .card {
  margin-top: 1rem;
}

.table-wrap {
  overflow-x: auto;
  margin: 0 -0.25rem;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}

th {
  text-align: left;
  color: var(--mute);
  font-weight: 600;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0.3rem 0.25rem;
  border-bottom: 1px solid var(--line);
}

td {
  padding: 0.25rem 0.25rem;
  border-bottom: 1px solid color-mix(in srgb, var(--line) 60%, transparent);
}

.r {
  text-align: right;
}

.date {
  white-space: nowrap;
}

.left {
  font-weight: 700;
}

.yr {
  color: var(--mute);
}

.rec {
  cursor: pointer;
}

.rec:hover td {
  background: var(--panel-2);
}

.open {
  display: grid;
  padding: 0.25rem 0;
  border: none;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  white-space: nowrap;
}

.tm {
  color: var(--mute);
  font-size: 0.78em;
}

.del {
  width: 1%;
  text-align: right;
}

.del-btn {
  min-width: 36px;
  min-height: var(--tap);
  background: none;
  border: none;
  color: var(--mute);
  font-weight: 700;
  font-size: 0.85rem;
}

.del-btn.armed {
  color: var(--negative);
}

.sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}

@media (max-width: 26rem) {
  table {
    font-size: 0.8rem;
  }
  th,
  td {
    padding-left: 0.15rem;
    padding-right: 0.15rem;
  }
}
</style>
