<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { AUTO_LOOKBACK_DAYS, HORIZONS, type Horizon, type Settings } from '../../lib/finance'
import { dayNum, fmtDate, fmtMoney } from '../../lib/money'
import { markUnsaved } from '../../lib/storage/store'
import EverydayCard from './EverydayCard.vue'
import LineChart, { type ChartMarker, type ChartSeries } from './LineChart.vue'
import OneTimeEditor from './OneTimeEditor.vue'
import RecurringEditor from './RecurringEditor.vue'
import { useTracker } from './useTracker'

const { settings, records, latest, deriveFor, saveSettings, setHorizon } = useTracker()

type Draft = Pick<Settings, 'recurring' | 'oneTime' | 'everyday'>
const snapshot = (): Draft =>
  JSON.parse(JSON.stringify({ recurring: settings.value.recurring, oneTime: settings.value.oneTime, everyday: settings.value.everyday }))

const draft = ref<Draft>(snapshot())
const dirty = computed(() => JSON.stringify(draft.value) !== JSON.stringify(snapshot()))
watch(dirty, (d) => markUnsaved('projection', d), { immediate: true })
onBeforeUnmount(() => markUnsaved('projection', false))

// If settings change underneath (import), take them unless we're mid-edit.
watch(settings, () => {
  if (!dirty.value) draft.value = snapshot()
})

const saving = ref(false)
async function save() {
  saving.value = true
  try {
    await saveSettings({ ...settings.value, ...draft.value })
    draft.value = snapshot()
  } finally {
    saving.value = false
  }
}
function discard() {
  draft.value = snapshot()
}

const horizon = computed(() => settings.value.horizonDays)
const d = computed(() => deriveFor(draft.value, horizon.value))

const heading = computed(() => {
  const p = d.value.projection
  if (!p) return ''
  if (p.min.value < 0) return `Left so far dips to ${fmtMoney(p.min.value, { whole: true })} around ${fmtDate(p.min.date)}`
  return `Left so far reaches ${fmtMoney(p.end.value, { whole: true })} by ${fmtDate(p.end.date)}`
})

const chart = computed(() => {
  const p = d.value.projection
  const l = latest.value
  if (!p || !l) return null
  const from = dayNum(l.date) - AUTO_LOOKBACK_DAYS
  const past = records.value.filter((r) => dayNum(r.date) >= from).map((r) => ({ x: dayNum(r.date), y: r.left }))
  const series: ChartSeries[] = [
    { label: 'Records', color: 'var(--accent)', points: past, dots: true, width: 2.5 },
    {
      label: 'Projection',
      color: 'var(--projection)',
      dashed: true,
      points: [p.start, ...p.series].map((pt) => ({ x: dayNum(pt.date), y: pt.value })),
    },
  ]
  const markers: ChartMarker[] =
    p.min.value < p.start.value
      ? [
          {
            x: dayNum(p.min.date),
            y: p.min.value,
            color: p.min.value < 0 ? 'var(--negative)' : 'var(--projection)',
            label: `${fmtMoney(p.min.value, { whole: true })} · ${fmtDate(p.min.date, { short: true })}`,
          },
        ]
      : []
  return { series, markers }
})
</script>

<template>
  <div class="projection">
    <section v-if="!latest" class="card">
      <h2>No projection yet</h2>
      <p class="muted">
        Save your first record on the Present tab. The projection starts from your latest record and looks
        ahead using the monthly and one-time items below and your everyday spending.
      </p>
    </section>

    <section v-else class="card">
      <h2 class="finding" :class="{ neg: (d.projection?.min.value ?? 0) < 0 }">{{ heading }}</h2>
      <div class="horizon" role="radiogroup" aria-label="How far ahead">
        <button
          v-for="h in HORIZONS"
          :key="h"
          role="radio"
          :aria-checked="horizon === h"
          :class="{ on: horizon === h }"
          @click="setHorizon(h as Horizon)"
        >
          {{ h }} days
        </button>
      </div>
      <LineChart v-if="chart" :series="chart.series" :markers="chart.markers" include-zero />
      <p class="muted small fine">
        Starts from your record of {{ fmtDate(latest.date) }} ({{ fmtMoney(latest.left) }}). A guide, not a promise.
      </p>
    </section>

    <EverydayCard v-model="draft.everyday" :auto="d.auto" :used="d.monthly" />
    <RecurringEditor v-model="draft.recurring" />
    <OneTimeEditor v-model="draft.oneTime" />

    <div v-if="dirty" class="draft-bar">
      <span class="msg">Unsaved changes. The chart is showing them.</span>
      <button class="btn ghost" @click="discard">Discard</button>
      <button class="btn primary" :disabled="saving" @click="save">{{ saving ? 'Saving…' : 'Save changes' }}</button>
    </div>
  </div>
</template>

<style scoped>
.projection > .card + .card,
.projection > section + section {
  margin-top: 1rem;
}

.finding {
  font-size: clamp(1.15rem, 5vw, 1.5rem) !important;
  line-height: 1.2;
}

.finding.neg {
  color: var(--negative);
}

.horizon {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.35rem;
  margin-bottom: 0.75rem;
}

.horizon button {
  min-height: 40px;
  border: 1px solid var(--line);
  background: transparent;
  color: var(--mute);
  border-radius: 0.5rem;
  font-weight: 600;
  font-size: 0.85rem;
  white-space: nowrap;
  padding: 0 0.2rem;
}

.horizon button.on {
  border-color: var(--projection);
  color: var(--projection);
}

.fine {
  margin: 0.5rem 0 0;
}

@media (max-width: 30rem) {
  .draft-bar .msg {
    display: none;
  }
  .draft-bar .btn {
    flex: 1;
  }
}
</style>
