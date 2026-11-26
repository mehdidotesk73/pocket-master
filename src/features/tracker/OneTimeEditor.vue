<script setup lang="ts">
import type { OneTime } from '../../lib/finance'
import { newId } from '../../lib/finance'
import { addDays, today } from '../../lib/money'
import MoneyInput from './MoneyInput.vue'

const items = defineModel<OneTime[]>({ required: true })

function add() {
  items.value = [...items.value, { id: newId(), name: '', dir: 'out', amount: 0, date: addDays(today(), 7) }]
}
function remove(id: string) {
  items.value = items.value.filter((r) => r.id !== id)
}
</script>

<template>
  <section class="card">
    <h2>One-time</h2>
    <p class="muted small intro">A single payment or deposit on a known date, like a tax refund or a trip.</p>

    <div v-for="o in items" :key="o.id" class="item">
      <input v-model="o.name" class="input name" placeholder="Name (e.g. Tax refund)" aria-label="Name" />
      <select v-model="o.dir" class="select dir" aria-label="In or out">
        <option value="in">In</option>
        <option value="out">Out</option>
      </select>
      <MoneyInput v-model="o.amount" class="amount" aria-label="Amount" />
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
  grid-template-columns: 4.6rem 1fr;
  grid-template-areas:
    'name name'
    'dir amount'
    'date date'
    'rm rm';
  gap: 0.4rem;
  padding: 0.6rem 0;
  border-top: 1px solid var(--line);
}

.name {
  grid-area: name;
}
.dir {
  grid-area: dir;
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
    grid-template-columns: 4.6rem 1fr 1fr auto;
    grid-template-areas:
      'name name name name'
      'dir amount date rm';
  }
}

@media (min-width: 44rem) {
  .item {
    grid-template-columns: 1fr 4.6rem 8rem 10rem auto;
    grid-template-areas: 'name dir amount date rm';
    align-items: center;
  }
}

.btn {
  margin-top: 0.5rem;
}
</style>
