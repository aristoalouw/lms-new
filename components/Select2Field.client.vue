<template>
  <select ref="selectElement" class="form-select" :multiple="multiple" :aria-label="ariaLabel">
    <option v-for="option in options" :key="option.value" :value="option.value">{{ option.label }}</option>
  </select>
</template>

<script setup lang="ts">
import type { SelectOption } from '~/types/domain'

const props = defineProps<{ modelValue: string | string[]; options: SelectOption[]; multiple?: boolean; ariaLabel?: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string | string[]] }>()
const selectElement = ref<HTMLSelectElement>()
let jqueryElement: any

onMounted(async () => {
  if (!selectElement.value) return
  const jq = (await import('jquery')).default
  ;(window as any).$ = jq
  ;(window as any).jQuery = jq
  await import('select2')
  jqueryElement = jq(selectElement.value)
  jqueryElement.select2({ width: '100%', placeholder: 'Pilih data' })
  jqueryElement.val(props.modelValue).trigger('change.select2')
  jqueryElement.on('change.campus', () => emit('update:modelValue', jqueryElement.val()))
})

watch(() => props.modelValue, value => jqueryElement?.val(value).trigger('change.select2'))
onBeforeUnmount(() => {
  jqueryElement?.off('.campus')
  if (jqueryElement?.data('select2')) jqueryElement.select2('destroy')
  jqueryElement = null
})
</script>
