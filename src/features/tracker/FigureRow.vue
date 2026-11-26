<script setup lang="ts">
export interface Figure {
  label: string
  value: string
  sub?: string
  tone?: 'pos' | 'neg' | 'proj'
}
defineProps<{ figures: Figure[] }>()
</script>

<template>
  <div class="figures">
    <div v-for="f in figures" :key="f.label" class="figure">
      <div class="label">{{ f.label }}</div>
      <div class="value" :class="f.tone">{{ f.value }}</div>
      <div v-if="f.sub" class="sub">{{ f.sub }}</div>
    </div>
  </div>
</template>

<style scoped>
.value.pos {
  color: var(--pos);
}
.value.neg {
  color: var(--negative);
}
.value.proj {
  color: var(--projection);
}
</style>
