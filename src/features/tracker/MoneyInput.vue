<script setup lang="ts">
// A money field that keeps what you type (so "12." doesn't jump to "12") and
// emits a number rounded to cents. inputmode=decimal brings up the number pad.
// With `negative`, the value reads as (12.00) while the field isn't focused.
import { nextTick, ref, watch } from 'vue'
import { parseMoney } from '../../lib/money'

const props = defineProps<{ modelValue: number; ariaLabel?: string; placeholder?: string; negative?: boolean }>()
const focused = ref(false)
const emit = defineEmits<{ (e: 'update:modelValue', v: number): void }>()

const fmt = (n: number) => (n ? n.toFixed(2) : '')
const text = ref(fmt(props.modelValue))
const bad = ref(false)

watch(
  () => props.modelValue,
  (v) => {
    if (parseMoney(text.value) !== v && !(v === 0 && text.value.trim() === '')) text.value = fmt(v)
  },
)

function onFocus(e: FocusEvent) {
  focused.value = true
  const el = e.target as HTMLInputElement
  nextTick(() => document.activeElement === el && el.select())
}

function onInput(e: Event) {
  text.value = (e.target as HTMLInputElement).value.replace(/^\s*\(|\)\s*$/g, '')
  const v = parseMoney(text.value)
  bad.value = text.value.trim() !== '' && (v == null || /\.\d{3,}/.test(text.value))
  if (!bad.value) emit('update:modelValue', Math.abs(v ?? 0))
}
</script>

<template>
  <input
    class="input num"
    :class="{ bad }"
    :value="!focused && negative && text && !bad ? `(${text})` : text"
    inputmode="decimal"
    :placeholder="placeholder ?? '0.00'"
    :aria-label="ariaLabel"
    @input="onInput"
    @focus="onFocus"
    @blur="focused = false; !bad && (text = fmt(modelValue))"
  />
</template>

<style scoped>
.bad {
  border-color: var(--negative) !important;
}
</style>
