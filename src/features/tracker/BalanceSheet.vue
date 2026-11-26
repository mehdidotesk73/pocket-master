<script setup lang="ts">
import { computed } from 'vue'
import type { BalanceRecord } from '../../lib/finance'
import { fmtDate, fmtMoney } from '../../lib/money'

const props = defineProps<{ record: BalanceRecord }>()

// Sorted by sign; $0 rows are left out (they don't move anything).
const assets = computed(() => props.record.lines.filter((l) => l.amount > 0))
const liabilities = computed(() => props.record.lines.filter((l) => l.amount < 0))
const zeros = computed(() => props.record.lines.filter((l) => l.amount === 0))
</script>

<template>
  <section class="card sheet">
    <h2>Balance sheet <span class="muted small">· {{ fmtDate(record.date) }}</span></h2>

    <h3 class="group">Assets</h3>
    <div v-for="l in assets" :key="l.id" class="row">
      <span class="name">{{ l.name }}</span>
      <span class="money">{{ fmtMoney(l.amount) }}</span>
    </div>
    <div v-if="!assets.length" class="row muted small">None</div>
    <div class="row total">
      <span>Total assets</span><span class="money">{{ fmtMoney(record.assets) }}</span>
    </div>

    <h3 class="group">Liabilities</h3>
    <div v-for="l in liabilities" :key="l.id" class="row">
      <span class="name">{{ l.name }}</span>
      <span class="money">{{ fmtMoney(-l.amount) }}</span>
    </div>
    <div v-if="!liabilities.length" class="row muted small">None</div>
    <div class="row total">
      <span>Total liabilities</span><span class="money">{{ fmtMoney(record.liabilities) }}</span>
    </div>

    <p v-if="zeros.length" class="zeros muted small">At $0: {{ zeros.map((z) => z.name).join(', ') }}</p>

    <div class="left-so-far">
      <span>Left so far</span>
      <span class="big money" :class="{ neg: record.left < 0 }">{{ fmtMoney(record.left) }}</span>
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
