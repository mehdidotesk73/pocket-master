<script setup lang="ts">
import type { AutoEveryday, Settings } from '../../lib/finance'
import { MIN_AUTO_DAYS } from '../../lib/finance'
import { fmtMoney } from '../../lib/money'
import MoneyInput from './MoneyInput.vue'

const everyday = defineModel<Settings['everyday']>({ required: true })
defineProps<{ auto: AutoEveryday; used: number }>()
</script>

<template>
  <section class="card">
    <h2>Everyday spending</h2>
    <p class="muted small intro">
      Money that leaves beyond the items below: groceries, gas, eating out. The projection spends it
      evenly, a little each day.
    </p>

    <p v-if="auto.monthly != null" class="auto">
      Your average: <b class="money">{{ fmtMoney(auto.monthly) }}</b> a month
      <span class="muted small">(from {{ auto.count }} records over {{ auto.days }} days)</span>
    </p>
    <p v-else class="auto muted">
      Your average needs records spanning {{ Math.ceil(MIN_AUTO_DAYS / 7) }}+ weeks
      <span class="small">(you have {{ auto.days }} day{{ auto.days === 1 ? '' : 's' }} so far)</span>.
      Until then the amount below is used.
    </p>

    <div class="seg" role="radiogroup" aria-label="Everyday spending source">
      <button
        role="radio"
        :aria-checked="everyday.mode === 'auto'"
        :class="{ on: everyday.mode === 'auto' }"
        @click="everyday = { ...everyday, mode: 'auto' }"
      >
        Use my average
      </button>
      <button
        role="radio"
        :aria-checked="everyday.mode === 'manual'"
        :class="{ on: everyday.mode === 'manual' }"
        @click="everyday = { ...everyday, mode: 'manual' }"
      >
        Set it myself
      </button>
    </div>

    <label class="monthly">
      <span>
        Monthly amount
        <span class="muted small">{{
          everyday.mode === 'auto' ? (auto.monthly == null ? '(used for now)' : '(fallback)') : ''
        }}</span>
      </span>
      <MoneyInput
        :model-value="everyday.monthly"
        aria-label="Monthly everyday spending"
        @update:model-value="(v: number) => (everyday = { ...everyday, monthly: v })"
      />
    </label>

    <p class="muted small used">Projection uses {{ fmtMoney(used) }} a month.</p>
  </section>
</template>

<style scoped>
.intro {
  margin: -0.3rem 0 0.75rem;
}

.auto {
  margin: 0 0 0.75rem;
}

.seg {
  display: grid;
  grid-template-columns: 1fr 1fr;
  border: 1px solid var(--line);
  border-radius: 0.6rem;
  overflow: hidden;
  margin-bottom: 0.75rem;
}

.seg button {
  min-height: var(--tap);
  border: none;
  background: transparent;
  color: var(--mute);
  font-weight: 600;
}

.seg button.on {
  background: var(--accent);
  color: #06232a;
}

.monthly {
  display: grid;
  grid-template-columns: 1fr minmax(7rem, 10rem);
  align-items: center;
  gap: 0.6rem;
}

.used {
  margin: 0.6rem 0 0;
}
</style>
