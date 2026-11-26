<script setup lang="ts">
import type { Recurring } from '../../lib/finance'
import { newId } from '../../lib/finance'
import SignedMoneyInput from './SignedMoneyInput.vue'

const items = defineModel<Recurring[]>({ required: true })

function add() {
  items.value = [...items.value, { id: newId(), name: '', amount: 0, day: 1, inRecord: false }]
}
function remove(id: string) {
  items.value = items.value.filter((r) => r.id !== id)
}
function setDay(r: Recurring, v: string) {
  const n = Math.round(Number(v))
  r.day = Number.isFinite(n) ? Math.min(31, Math.max(1, n)) : 1
}
</script>

<template>
  <section class="card">
    <h2>Every month</h2>
    <p class="muted small intro">
      Paychecks, rent, subscriptions: anything that comes in (<b class="pos">+</b>) or goes out
      (<b class="neg">−</b>) on the same day each month. Day 31 means the last day of the month.
    </p>

    <div v-for="r in items" :key="r.id" class="item">
      <input v-model="r.name" class="input name" placeholder="Name (e.g. Paycheck)" aria-label="Name" />
      <SignedMoneyInput v-model="r.amount" class="amount" aria-label="Amount" />
      <label class="day">
        <span class="muted small">day</span>
        <input
          class="input num"
          type="number"
          inputmode="numeric"
          min="1"
          max="31"
          :value="r.day"
          aria-label="Day of month"
          @change="setDay(r, ($event.target as HTMLInputElement).value)"
        />
      </label>
      <label
        class="inrec"
        title="Tick this if the item already shows up as a line in your records until it's paid (like rent as a bill). The projection then skips it this month, so it isn't counted twice."
      >
        <input v-model="r.inRecord" class="checkbox" type="checkbox" />
        <span class="small">in record</span>
      </label>
      <button class="btn ghost rm" :aria-label="`Remove ${r.name || 'item'}`" @click="remove(r.id)">✕</button>
    </div>

    <p v-if="!items.length" class="muted small">Nothing yet.</p>

    <button class="btn" @click="add">+ Add recurring</button>

    <details class="explain small">
      <summary>What does “in record” mean?</summary>
      <p>
        Tick it when this month’s amount already appears as a line in your records, for example rent
        listed as a bill until you pay it. The projection then skips it in the month of your latest
        record (it’s already counted there), and applies it from next month on. Paychecks usually
        stay unticked.
      </p>
    </details>
  </section>
</template>

<style scoped>
.intro {
  margin: -0.3rem 0 0.75rem;
}

.item {
  display: grid;
  grid-template-columns: 1fr 6.2rem;
  grid-template-areas:
    'name name'
    'amount day'
    'inrec rm';
  gap: 0.4rem;
  padding: 0.6rem 0;
  border-top: 1px solid var(--line);
}

.name {
  grid-area: name;
}
.amount {
  grid-area: amount;
}
.day {
  grid-area: day;
  display: flex;
  align-items: center;
  gap: 0.25rem;
}
.day .input {
  padding: 0 0.4rem;
  min-width: 3.2rem;
}
.inrec {
  grid-area: inrec;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  min-height: var(--tap);
}
.rm {
  grid-area: rm;
  justify-self: end;
  color: var(--mute);
}

@media (min-width: 44rem) {
  .item {
    grid-template-columns: 1fr 10rem 6.2rem auto auto;
    grid-template-areas: 'name amount day inrec rm';
    align-items: center;
  }
}

.explain {
  margin-top: 0.75rem;
  color: var(--mute);
}

.explain summary {
  cursor: pointer;
  min-height: var(--tap);
  display: flex;
  align-items: center;
}

.explain p {
  margin: 0;
}

.btn {
  margin-top: 0.5rem;
}
</style>
