<script setup lang="ts">
import { computed, ref } from 'vue'
import { dayNum, fmtDate, fmtMoney } from '../../lib/money'
import FigureRow, { type Figure } from './FigureRow.vue'
import LineChart, { type ChartSeries } from './LineChart.vue'
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
      label: 'Change in left so far',
      value: fmtMoney(change, { sign: true }),
      tone: change < 0 ? 'neg' : 'pos',
      sub: r.length > 1 ? `${fmtDate(first.date, { short: true })} → ${fmtDate(last.date, { short: true })}` : 'one record so far',
    },
    { label: 'Highest', value: fmtMoney(hi.left), sub: fmtDate(hi.date), tone: hi.left < 0 ? 'neg' : undefined },
    { label: 'Lowest', value: fmtMoney(lo.left), sub: fmtDate(lo.date), tone: lo.left < 0 ? 'neg' : undefined },
  ]
})

const series = computed<ChartSeries[]>(() => {
  const r = records.value
  return [
    { label: 'Left so far', color: 'var(--pos)', dots: true, width: 2.5, points: r.map((x) => ({ x: dayNum(x.date), y: x.left })) },
    { label: 'Assets', color: 'var(--assets)', width: 1.25, points: r.map((x) => ({ x: dayNum(x.date), y: x.assets })) },
    { label: 'Liabilities', color: 'var(--negative)', width: 1.25, points: r.map((x) => ({ x: dayNum(x.date), y: x.liabilities })) },
  ]
})

const newestFirst = computed(() => [...records.value].reverse())

const confirming = ref<string | null>(null)
async function onDelete(date: string) {
  if (confirming.value !== date) {
    confirming.value = date
    setTimeout(() => confirming.value === date && (confirming.value = null), 4000)
    return
  }
  confirming.value = null
  await deleteRecord(date)
}
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
        <LineChart :series="series" include-zero />
      </section>

      <section class="card table-card">
        <h2>All records</h2>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th class="r">Assets</th>
                <th class="r">Liabilities</th>
                <th class="r">Left</th>
                <th><span class="sr">Delete</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in newestFirst" :key="r.date">
                <td class="date">{{ fmtDate(r.date, { short: true }) }} <span class="yr">’{{ r.date.slice(2, 4) }}</span></td>
                <td class="r money">{{ fmtMoney(r.assets, { whole: true }) }}</td>
                <td class="r money">{{ fmtMoney(r.liabilities, { whole: true }) }}</td>
                <td class="r money left" :class="{ neg: r.left < 0 }">{{ fmtMoney(r.left) }}</td>
                <td class="del">
                  <button
                    class="del-btn"
                    :class="{ armed: confirming === r.date }"
                    :aria-label="confirming === r.date ? `Confirm delete ${r.date}` : `Delete ${r.date}`"
                    @click="onDelete(r.date)"
                  >
                    {{ confirming === r.date ? 'Delete?' : '✕' }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="muted small">To fix a record, open New record on the Present tab, pick its date, and save.</p>
      </section>
    </template>
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
