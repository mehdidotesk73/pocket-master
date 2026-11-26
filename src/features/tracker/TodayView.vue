<script setup lang="ts">
import { computed, ref } from 'vue'
import { lineValueCents } from '../../lib/finance'
import { fmtCents, fmtDate, fmtMoney } from '../../lib/money'
import { storeState } from '../../lib/storage/store'
import BalanceSheet from './BalanceSheet.vue'
import FigureRow, { type Figure } from './FigureRow.vue'
import RecordModal from './RecordModal.vue'
import { useTracker } from './useTracker'

const emit = defineEmits<{ (e: 'go', tab: 'setup' | 'projection'): void }>()
const { settings, records, latest, previous, derived } = useTracker()

const showModal = ref(false)

function openNew() {
  if (!settings.value.lines.length) emit('go', 'setup')
  else showModal.value = true
}

const figures = computed<Figure[]>(() => {
  const l = latest.value
  if (!l) return []
  const prev = previous.value
  const change = prev ? l.left - prev.left : null
  const bank = l.lines.filter((x) => x.kind === 'account').reduce((s, x) => s + lineValueCents(x), 0)
  const cards = l.lines.filter((x) => x.kind === 'card').reduce((s, x) => s + lineValueCents(x), 0)
  const out: Figure[] = [
    {
      label: 'Left so far',
      value: fmtMoney(l.left),
      tone: l.left < 0 ? 'neg' : 'pos',
      sub:
        `as of ${fmtDate(l.date, { short: true })}` +
        (change != null ? ` · ${fmtMoney(change, { sign: true })} since ${fmtDate(prev!.date, { short: true })}` : ''),
    },
    { label: 'Bank balances', value: fmtCents(bank) },
    { label: 'Cards, my share', value: fmtCents(cards) },
  ]
  const p = derived.value.projection
  if (p) {
    out.push({
      label: `Projected in ${settings.value.horizonDays} days`,
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
      <button class="link" @click="emit('go', 'setup')">Back up now →</button>
    </div>

    <template v-if="latest">
      <FigureRow :figures="figures" />
      <div class="actions">
        <button class="btn primary" @click="openNew">+ New record</button>
      </div>
      <BalanceSheet :record="latest" />
    </template>

    <section v-else class="card empty">
      <h2>Start with your first record</h2>
      <p>
        A record is a snapshot of your money on one day: bank balances, credit cards (your share), bills
        due, and money going out or coming in. The app adds them up into one number, <b>left so far</b>.
      </p>
      <p class="muted">
        Save a new record whenever you check your accounts. The latest one is your live position, the
        earlier ones build up your history, and the Projection tab looks ahead from the latest one.
      </p>
      <button class="btn primary" @click="openNew">
        {{ settings.lines.length ? '+ New record' : 'Set up your lines first' }}
      </button>
    </section>

    <RecordModal v-if="showModal" @close="showModal = false" />
  </div>
</template>

<style scoped>
.actions {
  display: flex;
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
