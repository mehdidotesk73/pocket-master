<script setup lang="ts">
import InfoTip from '../../components/InfoTip.vue'
import { computed, ref } from 'vue'
import { fmtDate, fmtDateTime, fmtMoney, fmtTime } from '../../lib/money'
import { storeState } from '../../lib/storage/store'
import BalanceSheet from './BalanceSheet.vue'
import FigureRow, { type Figure } from './FigureRow.vue'
import RecordModal from './RecordModal.vue'
import { useTracker } from './useTracker'

const emit = defineEmits<{ (e: 'backup'): void }>()
const { records, latest, previous, selected, currentProjection } = useTracker()

const showModal = ref(false)
const editLatest = ref(false)

function openNew() {
  editLatest.value = false
  showModal.value = true
}
function openEdit() {
  editLatest.value = true
  showModal.value = true
}
/** "Nov 26, 2:05 PM", or just "2:05 PM" when it's the same day as `ref`. */
const when = (at: string, ref?: string) => (ref && ref.slice(0, 10) === at.slice(0, 10) ? fmtTime(at) : fmtDateTime(at, { short: true }))

const figures = computed<Figure[]>(() => {
  const l = latest.value
  if (!l) return []
  const prev = previous.value
  const change = prev ? l.left - prev.left : null
  const out: Figure[] = [
    {
      label: 'Net equity',
      value: fmtMoney(l.left),
      tone: l.left < 0 ? 'neg' : 'pos',
      sub:
        `as of ${when(l.at)}` + (change != null ? ` · ${fmtMoney(change, { sign: true })} since ${when(prev!.at, l.at)}` : ''),
    },
    { label: 'Total owned', value: fmtMoney(l.assets) },
    { label: 'Total owed', value: fmtMoney(l.liabilities) },
  ]
  const p = currentProjection.value
  if (p) {
    out.push({
      label: `${selected.value.name} in ${selected.value.horizonDays} days`,
      value: fmtMoney(p.end.value),
      tone: p.end.value < 0 ? 'neg' : 'proj',
      sub:
        p.min.value < p.end.value
          ? `low ${fmtMoney(p.min.value)} on ${fmtDate(p.min.date, { short: true })}`
          : `on ${fmtDate(p.end.date, { short: true })}`,
    })
  }
  return out
})

const exportNudge = computed(() => {
  if (records.value.length < 2 || storeState.backend !== 'opfs') return null
  if (!storeState.lastExport) return 'You haven’t backed up yet.'
  const days = Math.floor((Date.now() - Date.parse(storeState.lastExport)) / 86_400_000)
  return days >= 14 ? `Last backup was ${days} days ago.` : null
})
</script>

<template>
  <div class="today">
    <div v-if="exportNudge" class="nudge small">
      {{ exportNudge }} Your data lives only on this device.
      <button class="link" @click="emit('backup')">Back up now →</button>
    </div>

    <template v-if="latest">
      <FigureRow :figures="figures" />
      <div class="actions">
        <button class="btn" @click="openEdit">Edit latest</button>
        <button class="btn primary" @click="openNew">+ New record</button>
      </div>
      <BalanceSheet :record="latest" />
    </template>

    <section v-else class="card empty">
      <div class="head-row">
        <h2>Start with your first record</h2>
        <InfoTip label="What is a record?">
          A record is a snapshot of your money on one day: a list of what you have (positive amounts, like
          bank balances) and what you owe (negative amounts, like card balances and bills due). The app adds
          them up: <b>total owned</b>, <b>total owed</b>, and the difference, your <b>net equity</b>.
          <br /><br />
          Save a new record whenever you check your accounts. The latest one is your live position, the
          earlier ones are your past, and Future looks ahead from the latest one.
        </InfoTip>
      </div>
      <button class="btn primary" @click="openNew">+ New record</button>
      <p class="muted small hint">Have a backup? Open the menu (☰, top left) → Records → Import.</p>
    </section>

    <RecordModal v-if="showModal" :editing="editLatest && latest ? latest : undefined" @close="showModal = false" />
  </div>
</template>

<style scoped>
.head-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0 0.4rem;
  margin-bottom: 0.8rem;
}

.head-row h2 {
  margin: 0;
}

.head-row :deep(.info-text) {
  padding: 0.4rem 0 0.2rem;
}

.hint {
  margin: 0.75rem 0 0;
}

.actions {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
  margin-bottom: 1rem;
}

.empty p {
  margin: 0 0 0.75rem;
}

.nudge {
  margin-bottom: 1rem;
  padding: 0.6rem 0.75rem;
  border: 1px solid var(--projection);
  border-radius: 0.6rem;
  background: color-mix(in srgb, var(--projection) 8%, transparent);
}

.link {
  background: none;
  border: none;
  color: var(--accent);
  font-weight: 700;
  padding: 0.25rem 0;
  font-size: inherit;
}
</style>
