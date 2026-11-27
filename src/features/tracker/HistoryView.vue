<script setup lang="ts">
import { computed, ref } from 'vue'
import { type LocalDateTime, atNum, fmtDate, fmtDateTime, fmtMoney, fmtTime } from '../../lib/money'
import { type BalanceRecord, LEFT_SOURCE, type RecordWindow, lineNames } from '../../lib/finance'
import { dailyCandles, lineSeries, windowMix } from '../../lib/analysis'
import DonutChart, { type DonutSlice } from './DonutChart.vue'
import CandleChart from './CandleChart.vue'
import WindowPicker from './WindowPicker.vue'
import { colorFor } from './projectionText'
import RecordModal from './RecordModal.vue'
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
      label: 'Change in net equity',
      value: fmtMoney(change, { sign: true }),
      tone: change < 0 ? 'neg' : 'pos',
      sub: r.length > 1 ? `${fmtDate(first.date, { short: true })} → ${fmtDate(last.date, { short: true })}` : 'one record so far',
    },
    { label: 'Highest', value: fmtMoney(hi.left), sub: fmtDateTime(hi.at, { short: true }), tone: hi.left < 0 ? 'neg' : undefined },
    { label: 'Lowest', value: fmtMoney(lo.left), sub: fmtDateTime(lo.at, { short: true }), tone: lo.left < 0 ? 'neg' : undefined },
  ]
})

const series = computed<ChartSeries[]>(() => {
  const r = records.value
  return [
    // Net equity is the line; owned and owed are a dot per record.
    { label: 'Net equity', color: 'var(--ink)', dots: true, width: 2.25, points: r.map((x) => ({ x: atNum(x.at), y: x.left })) },
    { label: 'Total owned', color: 'var(--assets)', dots: true, line: false, points: r.map((x) => ({ x: atNum(x.at), y: x.assets })) },
    { label: 'Total owed', color: 'var(--negative)', dots: true, line: false, points: r.map((x) => ({ x: atNum(x.at), y: x.liabilities })) },
  ]
})

// ---- analysis charts (one card, a tab per chart)
type View = 'totals' | 'lines' | 'mix' | 'rate'
const VIEWS: { id: View; label: string }[] = [
  { id: 'totals', label: 'Totals' },
  { id: 'lines', label: 'Timeseries' },
  { id: 'mix', label: 'Averages' },
  { id: 'rate', label: 'Rates' },
]
const view = ref<View>('totals')

/** One colour per line, the same in every chart. */
const names = computed(() => lineNames(records.value))
const colorOf = computed(() => Object.fromEntries(names.value.map((n, i) => [n, colorFor(i)])))
const hidden = ref<string[]>([])
const toggle = (n: string) => (hidden.value = hidden.value.includes(n) ? hidden.value.filter((x) => x !== n) : [...hidden.value, n])

const lineChart = computed<ChartSeries[]>(() =>
  lineSeries(records.value)
    .filter((s) => !hidden.value.includes(s.name))
    .map((s) => ({ label: s.name, color: colorOf.value[s.name], dots: true, width: 1.75, points: s.points })),
)

const mixWindow = ref<RecordWindow>({ mode: 'all' })
const mixSide = ref<'all' | 'owned' | 'owed'>('all')
const mix = computed(() => windowMix(records.value, mixWindow.value))
const mixSlices = computed<DonutSlice[]>(() =>
  mix.value.slices
    .filter((s) => (mixSide.value === 'all' ? true : mixSide.value === 'owned' ? s.average > 0 : s.average < 0))
    .filter((s) => !hidden.value.includes(s.name))
    .map((s) => ({ name: s.name, amount: s.average, color: colorOf.value[s.name] })),
)
const mixTotal = computed(() => mixSlices.value.reduce((t, s) => t + (mixSide.value === 'all' ? Math.abs(s.amount) : s.amount), 0))
const mixLabel = computed(() => (mixSide.value === 'all' ? 'Owned + owed' : mixSide.value === 'owned' ? 'Owned' : 'Owed'))
/** Lines that appear in this side of the mix, for its toggle chips. */
const mixNames = computed(() =>
  mix.value.slices.filter((s) => (mixSide.value === 'all' ? true : mixSide.value === 'owned' ? s.average > 0 : s.average < 0)).map((s) => s.name),
)

const rateLine = ref<string>(LEFT_SOURCE)
const rateShow = ref<'both' | 'up' | 'down'>('both')
const candles = computed(() => dailyCandles(records.value, rateLine.value))

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

      <section class="card charts">
        <div class="tabs-row" role="tablist" aria-label="Chart">
          <button v-for="v in VIEWS" :key="v.id" role="tab" class="chip" :aria-selected="view === v.id" :class="{ on: view === v.id }" @click="view = v.id">
            {{ v.label }}
          </button>
        </div>

        <!-- totals: net equity line, owned and owed dots -->
        <template v-if="view === 'totals'">
          <LineChart :series="series" include-zero />
        </template>

        <!-- each line over time -->
        <template v-else-if="view === 'lines'">
          <div class="toggles" role="group" aria-label="Lines to show">
            <button v-for="n in names" :key="n" class="tog" :class="{ off: hidden.includes(n) }" :aria-pressed="!hidden.includes(n)" @click="toggle(n)">
              <span class="sw" :style="{ background: colorOf[n] }"></span>{{ n }}
            </button>
          </div>
          <LineChart :series="lineChart" include-zero :legend="false" />
          <p class="muted small note">Each line's value at every record. Tap a name to hide or show it.</p>
        </template>

        <!-- average mix over a window -->
        <template v-else-if="view === 'mix'">
          <WindowPicker v-model="mixWindow" />
          <div class="side" role="radiogroup" aria-label="Which side">
            <button v-for="s in (['all', 'owned', 'owed'] as const)" :key="s" role="radio" class="chip" :aria-checked="mixSide === s" :class="{ on: mixSide === s }" @click="mixSide = s">
              {{ s === 'all' ? 'Owned + owed' : s === 'owned' ? 'Owned' : 'Owed' }}
            </button>
          </div>
          <DonutChart v-if="mixSlices.length" :slices="mixSlices" :centre-label="mixLabel" :centre-value="fmtMoney(mixTotal, { whole: true })" />
          <p v-else class="muted small">No {{ mixSide === 'all' ? '' : mixSide + ' ' }}lines in these records.</p>
          <div v-if="mixNames.length" class="toggles" role="group" aria-label="Lines to include">
            <button v-for="n in mixNames" :key="n" class="tog" :class="{ off: hidden.includes(n) }" :aria-pressed="!hidden.includes(n)" @click="toggle(n)">
              <span class="sw" :style="{ background: colorOf[n] }"></span>{{ n }}
            </button>
          </div>
          <p class="muted small note">
            Each line's average value across {{ mix.count }} record{{ mix.count === 1 ? '' : 's' }}<template v-if="mix.from">
              ({{ fmtDate(mix.from, { short: true }) }} – {{ fmtDate(mix.to!, { short: true }) }})</template
            >, and its share of the total. <template v-if="mixSide === 'all'">“Owned + owed” adds what you own and what you owe as sizes.</template>
          </p>
        </template>

        <!-- rate of change between records -->
        <template v-else>
          <div class="rate-controls">
            <select v-model="rateLine" class="select" aria-label="Line">
              <option :value="LEFT_SOURCE">Net equity</option>
              <option v-for="n in names" :key="n" :value="n">{{ n }}</option>
            </select>
            <div class="side" role="radiogroup" aria-label="Show">
              <button v-for="s in (['both', 'up', 'down'] as const)" :key="s" role="radio" class="chip" :aria-checked="rateShow === s" :class="{ on: rateShow === s }" @click="rateShow = s">
                {{ s === 'both' ? 'Both' : s === 'up' ? 'Rising' : 'Falling' }}
              </button>
            </div>
          </div>
          <CandleChart :candles="candles" :show="rateShow" />
          <p class="muted small note">
            One candle per day, from the day's opening value to its closing value: green if it went up, red if it went down. Days between records (lighter) change at the even rate between those two records; record days show the actual jumps. Tap a candle to read it. For a card, going up means you owe less.
          </p>
        </template>
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
.charts {
  display: grid;
  gap: 0.6rem;
}

.tabs-row,
.side,
.toggles {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}

.chip,
.tog {
  min-height: 32px;
  padding: 0 0.7rem;
  border: 1px solid var(--btn-border);
  background: var(--btn-bg);
  color: var(--btn-text);
  border-radius: var(--btn-radius);
  font-weight: 550;
  font-size: 0.8rem;
}

.chip.on {
  background: var(--btn-primary-bg);
  border-color: var(--btn-primary-bg);
  color: var(--btn-primary-text);
}

.tog {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}

.tog.off {
  opacity: 0.45;
  text-decoration: line-through;
}

.tog .sw {
  width: 9px;
  height: 9px;
  border-radius: 2px;
}

.rate-controls {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.45rem;
  align-items: center;
}

.rate-controls .select {
  min-height: 38px;
}

.note {
  margin: 0;
}
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
