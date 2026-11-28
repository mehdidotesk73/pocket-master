<script setup lang="ts">
// A small ⓘ button that shows or hides an explanation. It renders as two
// siblings (display: contents): the button sits inline where it's placed, and
// the text takes a full line of its own in a wrapping flex row, so put it at
// the end of a `display: flex; flex-wrap: wrap` row.
import { ref } from 'vue'
import { Info } from '@lucide/vue'

defineProps<{ label: string }>()
const open = ref(false)
</script>

<template>
  <span class="info-tip">
    <button type="button" class="info-btn" :class="{ on: open }" :aria-label="label" :aria-expanded="open" @click="open = !open">
      <Info class="info-ic" aria-hidden="true" />
    </button>
    <span v-if="open" class="info-text small"><slot /></span>
  </span>
</template>

<style scoped>
.info-tip {
  display: contents;
}

.info-btn {
  display: inline-grid;
  place-items: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: none;
  border-radius: 999px;
  background: none;
  color: var(--mute);
}

.info-btn:hover,
.info-btn.on {
  color: var(--ink);
  background: var(--panel-2);
}

.info-ic {
  width: 17px;
  height: 17px;
  stroke-width: 1.75;
}

.info-text {
  flex-basis: 100%;
  color: var(--mute);
  line-height: 1.45;
}
</style>
