<template>
  <select ref="selectElement" class="form-select" :multiple="multiple" :aria-label="ariaLabel">
    <option v-if="placeholder && !multiple" value="">{{ placeholder }}</option>
    <option v-for="option in options" :key="option.value" :value="option.value" :disabled="option.disabled">{{ option.label }}</option>
  </select>
</template>

<script setup lang="ts">
import type { SelectOption } from '~/types/domain'

const props = withDefaults(defineProps<{
  modelValue: string | string[]
  options: SelectOption[]
  placeholder?: string
  multiple?: boolean
  ariaLabel?: string
}>(), { ariaLabel: 'Pilih opsi' })

const emit = defineEmits<{ 'update:modelValue': [value: string | string[]] }>()
const selectElement = ref<HTMLSelectElement>()
let choices: { destroy: () => void; setChoiceByValue: (value: string | string[]) => void } | null = null

onMounted(async () => {
  if (!selectElement.value) return
  const Choices = (await import('choices.js')).default
  choices = new Choices(selectElement.value, {
    searchEnabled: props.options.length > 8,
    removeItemButton: props.multiple,
    shouldSort: false,
    itemSelectText: '',
    placeholderValue: props.placeholder,
    noResultsText: 'Pilihan tidak ditemukan',
    noChoicesText: 'Tidak ada pilihan lain',
  })
  choices.setChoiceByValue(props.modelValue)
  selectElement.value.addEventListener('change', handleChange)
})

const handleChange = () => {
  if (!selectElement.value) return
  emit('update:modelValue', props.multiple
    ? Array.from(selectElement.value.selectedOptions).map(option => option.value)
    : selectElement.value.value)
}

watch(() => props.modelValue, value => choices?.setChoiceByValue(value))
onBeforeUnmount(() => {
  selectElement.value?.removeEventListener('change', handleChange)
  choices?.destroy()
  choices = null
})
</script>
