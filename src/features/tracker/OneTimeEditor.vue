<script setup lang="ts">
import type { OneTime } from '../../lib/finance'
import { newId } from '../../lib/finance'
import { addDays, today } from '../../lib/money'
import SignedMoneyInput from './SignedMoneyInput.vue'

const items = defineModel<OneTime[]>({ required: true })

function add() {
  items.value = [...items.value, { id: newId(), name: '', amount: 0, date: addDays(today(), 7) }]
}
function remove(id: string) {
  items.value = items.value.filter((r) => r.id !== id)
}
</script>

<template>
  <section class="card">
    <h2>One-time</h2>
    <p class="muted small intro">A single change on a known date: a tax refund (<b class="pos">+</b>) or a trip (<b class="neg">−</b>).</p>

    <div v-for="o in items" :key="o.id" class="item">
      <input v-model="o.name" class="input name" placeholder="Name (e.g. Tax refund)" aria-label="Name" />
      <SignedMoneyInput v-model="o.amount" class="amount" aria-label="Amount" />
      <input v-model="o.date" class="input date" type="date" aria-label="Date" />
      <button class="btn ghost rm" :aria-label="`Remove ${o.name || 'item'}`" @click="remove(o.id)">✕</button>
    </div>

    <p v-if="!items.length" class="muted small">Nothing yet.</p>

    <button class="btn" @click="add">+ Add one-time</button>
  </section>
</template>

<style scoped>
.intro {
  margin: -0.3rem 0 0.75rem;
}

.item {
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-areas:
    'name name'
    'amount amount'
    'date rm';
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
.date {
  grid-area: date;
}
.rm {
  grid-area: rm;
  justify-self: end;
  color: var(--mute);
}

@media (min-width: 30rem) {
  .item {
    grid-template-columns: 1fr 1fr auto;
    grid-template-areas:
      'name name name'
      'amount date rm';
  }
}

@media (min-width: 44rem) {
  .item {
    grid-template-columns: 1fr 10rem 10rem auto;
    grid-template-areas: 'name amount date rm';
    align-items: center;
  }
}

.btn {
  margin-top: 0.5rem;
}
</style>
