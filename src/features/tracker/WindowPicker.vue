<script setup lang="ts">
// Which records to look at: all, the past N days, the past N records, or between two dates.
import { computed } from 'vue'
import type { RecordWindow } from '../../lib/finance'
import { isISODate } from '../../lib/money'

const win = defineModel<RecordWindow>({ required: true })

const MODES = [
  { id: 'all', label: 'All' },
  { id: 'last', label: 'Past days' },
  { id: 'lastRecords', label: 'Past records' },
  { id: 'between', label: 'Between' },
] as const

const mode = computed({
  get: () => win.value.mode,
  set: (m: RecordWindow['mode']) => {
    win.value = m === 'last' ? { mode: 'last', days: 90 } : m === 'lastRecords' ? { mode: 'lastRecords', count: 6 } : m === 'between' ? { mode: 'between' } : { mode: 'all' }
  },
})
const int = (v: string, d: number) => Math.max(1, Math.round(Number(v)) || d)
function setBetween(key: 'from' | 'to', v: string) {
  if (win.value.mode !== 'between') return
  const next: RecordWindow = { ...win.value }
  if (isISODate(v)) next[key] = v
  else delete next[key]
  win.value = next
}
</script>

<template>
  <div class="window-picker">
    <div class="seg" role="radiogroup" aria-label="Records">
      <button v-for="m in MODES" :key="m.id" role="radio" :aria-checked="mode === m.id" :class="{ on: mode === m.id }" @click="mode = m.id">
        {{ m.label }}
      </button>
    </div>
    <label v-if="win.mode === 'last'" class="inline">
      Past
      <input class="input num n" type="number" inputmode="numeric" min="1" :value="win.days" @change="win = { mode: 'last', days: int(($event.target as HTMLInputElement).value, 90) }" />
      days
    </label>
    <label v-else-if="win.mode === 'lastRecords'" class="inline">
      Last
      <input class="input num n" type="number" inputmode="numeric" min="1" :value="win.count" @change="win = { mode: 'lastRecords', count: int(($event.target as HTMLInputElement).value, 6) }" />
      records
    </label>
    <div v-else-if="win.mode === 'between'" class="two">
      <input class="input" type="date" aria-label="From" :value="win.from ?? ''" @change="setBetween('from', ($event.target as HTMLInputElement).value)" />
      <input class="input" type="date" aria-label="To" :value="win.to ?? ''" @change="setBetween('to', ($event.target as HTMLInputElement).value)" />
    </div>
  </div>
</template>

<style scoped>
.window-picker {
  display: grid;
  gap: 0.4rem;
}

.seg {
  display: grid;
  grid-template-columns: 0.6fr 1fr 1.1fr 1fr;
  border: 1px solid var(--btn-border);
  border-radius: var(--btn-radius);
  overflow: hidden;
}

.seg button {
  min-height: 34px;
  border: none;
  background: var(--btn-bg);
  color: var(--btn-text);
  font-weight: 550;
  font-size: 0.82rem;
  padding: 0 0.2rem;
}

.seg button + button {
  border-left: 1px solid var(--btn-border);
}

.seg button.on {
  background: var(--btn-primary-bg);
  color: var(--btn-primary-text);
}

.inline {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.92rem;
}

.n {
  width: 4.5rem;
  min-height: 38px;
}

.two {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.45rem;
}

.two .input {
  min-height: 38px;
}
</style>
