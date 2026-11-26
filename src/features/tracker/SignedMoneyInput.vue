<script setup lang="ts">
// A signed money field: a +/− toggle plus the amount. The toggle exists
// because the iPhone decimal keypad has no minus key. Emits a signed number.
import { ref, watch } from 'vue'
import MoneyInput from './MoneyInput.vue'

const props = withDefaults(defineProps<{ modelValue: number; ariaLabel?: string; defaultNegative?: boolean }>(), {
  defaultNegative: true,
})
const emit = defineEmits<{ (e: 'update:modelValue', v: number): void }>()

// Remember the sign while the amount is 0 (0 itself has no sign).
const negative = ref(props.modelValue !== 0 ? props.modelValue < 0 : props.defaultNegative)
watch(
  () => props.modelValue,
  (v) => {
    if (v !== 0) negative.value = v < 0
  },
)

const mag = () => Math.abs(props.modelValue)
function toggle() {
  negative.value = !negative.value
  emit('update:modelValue', (negative.value ? -1 : 1) * mag())
}
function onMag(v: number) {
  emit('update:modelValue', (negative.value ? -1 : 1) * Math.abs(v))
}
</script>

<template>
  <div class="signed">
    <button
      type="button"
      class="sign"
      :class="negative ? 'neg' : 'pos'"
      :aria-label="negative ? 'Going out (tap for coming in)' : 'Coming in (tap for going out)'"
      @click="toggle"
    >
      {{ negative ? '−' : '+' }}
    </button>
    <MoneyInput :model-value="mag()" :class="negative ? 'neg' : 'pos'" :aria-label="ariaLabel" @update:model-value="onMag" />
  </div>
</template>

<style scoped>
.signed {
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr);
  align-items: center;
  gap: 0.3rem;
  min-width: 0;
}

.sign {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: 1.5px solid currentColor;
  background: transparent;
  font-size: 1.05rem;
  font-weight: 800;
  line-height: 1;
  padding: 0;
}

.sign.pos {
  color: var(--accent);
}

.sign.neg {
  color: var(--negative);
}

.signed :deep(input.neg) {
  color: #ff8a73;
}
</style>
