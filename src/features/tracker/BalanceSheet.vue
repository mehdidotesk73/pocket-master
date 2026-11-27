<script setup lang="ts">
import { computed } from 'vue'
import type { BalanceRecord } from '../../lib/finance'
import { fmtDateTime, fmtMoney } from '../../lib/money'

/**
 * `heading` replaces the record's date-time in the title (e.g. a forecast date).
 * `netOnly` is change no line holds (net-only projections): shown as its own row
 * and included in net equity.
 */
const props = defineProps<{ record: BalanceRecord; heading?: string; netOnly?: number }>()
const net = computed(() => Math.round((props.record.left + (props.netOnly ?? 0)) * 100) / 100)

// Sorted by sign; $0 rows are left out (they don't move anything).
const assets = computed(() => props.record.lines.filter((l) => l.amount > 0))
const liabilities = computed(() => props.record.lines.filter((l) => l.amount < 0))
const zeros = computed(() => props.record.lines.filter((l) => l.amount === 0))
</script>

<template>
  <section class="card sheet">
    <slot name="title">
      <h2>Balance sheet <span class="muted small">· {{ heading ?? fmtDateTime(record.at) }}</span></h2>
    </slot>

    <h3 class="group">Owned</h3>
    <div v-for="l in assets" :key="l.id" class="row">
      <span class="name">{{ l.name }}</span>
      <span class="money">{{ fmtMoney(l.amount) }}</span>
    </div>
    <div v-if="!assets.length" class="row muted small">None</div>
    <div class="row total">
      <span>Total owned</span><span class="money">{{ fmtMoney(record.assets) }}</span>
    </div>

    <h3 class="group">Owed</h3>
    <div v-for="l in liabilities" :key="l.id" class="row">
      <span class="name">{{ l.name }}</span>
      <span class="money">{{ fmtMoney(l.amount) }}</span>
    </div>
    <div v-if="!liabilities.length" class="row muted small">None</div>
    <div class="row total">
      <span>Total owed</span><span class="money">{{ fmtMoney(record.liabilities) }}</span>
    </div>

    <p v-if="zeros.length" class="zeros muted small">At $0: {{ zeros.map((z) => z.name).join(', ') }}</p>

    <div v-if="netOnly" class="row total">
      <span>Not on a line <span class="muted small">(net-only projections)</span></span>
      <span class="money">{{ fmtMoney(netOnly) }}</span>
    </div>

    <div class="left-so-far">
      <span>Net equity</span>
      <span class="big money" :class="{ neg: net < 0 }">{{ fmtMoney(net) }}</span>
    </div>
  </section>
</template>

<style scoped>
.group {
  margin: 1rem 0 0.3rem !important;
  font-size: 0.8rem !important;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--mute);
  font-family: var(--font-text) !important;
  font-weight: 700 !important;
}

.row {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.35rem 0;
  border-bottom: 1px solid color-mix(in srgb, var(--line) 60%, transparent);
}

.name {
  min-width: 0;
  overflow-wrap: anywhere;
}

.row.total {
  font-weight: 700;
  border-bottom: none;
}

.zeros {
  margin: 0.6rem 0 0;
}

.left-so-far {
  margin-top: 1rem;
  padding-top: 0.75rem;
  border-top: 2px solid var(--line);
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
  font-weight: 700;
}

.big {
  font-family: var(--font-display);
  font-weight: 600;
  font-size: clamp(2rem, 9vw, 2.75rem);
  line-height: 1;
}
</style>
