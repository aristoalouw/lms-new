<script setup lang="ts">
import type { SafeRichContent } from '~/shared/contracts/lms'

const props = defineProps<{ modelValue: SafeRichContent; ariaLabel?: string; placeholder?: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: SafeRichContent] }>()
const editor = ref<HTMLElement>()
let quill: { getContents: () => { ops: Array<{ insert?: unknown; attributes?: unknown }> }; setContents: (delta: unknown) => void; on: (name: string, callback: () => void) => void; off: (name: string) => void; root: HTMLElement } | undefined
let applyingExternalValue = false

function deltaFor(value: SafeRichContent) {
  return value.format === 'QUILL_DELTA' ? { ops: value.ops } : { ops: [{ insert: `${value.text}\n` }] }
}

onMounted(async () => {
  if (!editor.value) return
  const Quill = (await import('quill')).default
  quill = new Quill(editor.value, {
    theme: 'snow',
    placeholder: props.placeholder || 'Tulis materi…',
    modules: { toolbar: [['bold', 'italic', 'underline', 'strike'], [{ header: [1, 2, 3, false] }], [{ list: 'ordered' }, { list: 'bullet' }], ['link'], ['clean']] },
  }) as unknown as typeof quill
  quill!.root.setAttribute('aria-label', props.ariaLabel || 'Editor materi pembelajaran')
  quill!.setContents(deltaFor(props.modelValue))
  quill!.on('text-change', () => {
    if (applyingExternalValue) return
    const ops = quill!.getContents().ops
      .filter(operation => typeof operation.insert === 'string')
      .map(operation => ({ insert: String(operation.insert), ...(operation.attributes ? { attributes: operation.attributes as Record<string, boolean | string | number> } : {}) }))
    emit('update:modelValue', { format: 'QUILL_DELTA', ops })
  })
})

watch(() => props.modelValue, value => {
  if (!quill) return
  applyingExternalValue = true
  quill.setContents(deltaFor(value))
  applyingExternalValue = false
}, { deep: true })

onBeforeUnmount(() => { quill?.off('text-change'); quill = undefined })
</script>

<template><div class="material-editor"><div ref="editor" /></div></template>

<style scoped>
.material-editor{background:#fff}.material-editor :deep(.ql-editor){min-height:180px;font-size:.9rem;line-height:1.65}
</style>
