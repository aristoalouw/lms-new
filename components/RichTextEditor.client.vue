<template>
  <div class="rich-text-field">
    <div ref="editorElement" />
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{ modelValue: string; placeholder?: string; ariaLabel?: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const editorElement = ref<HTMLElement>()
let quill: { root: HTMLElement; on: (event: string, callback: () => void) => void; off: (event: string) => void; clipboard: { dangerouslyPasteHTML: (html: string) => void } } | null = null

onMounted(async () => {
  if (!editorElement.value) return
  const Quill = (await import('quill')).default
  quill = new Quill(editorElement.value, {
    theme: 'snow',
    placeholder: props.placeholder || 'Tulis konten…',
    formats: ['bold', 'italic', 'underline', 'list', 'link'],
    modules: { toolbar: [['bold', 'italic', 'underline'], [{ list: 'ordered' }, { list: 'bullet' }], ['link'], ['clean']] },
  })
  quill.root.setAttribute('aria-label', props.ariaLabel || 'Editor teks berformat')
  quill.clipboard.dangerouslyPasteHTML(props.modelValue || '')
  quill.on('text-change', () => emit('update:modelValue', quill?.root.innerHTML || ''))
})

watch(() => props.modelValue, value => {
  if (quill && value !== quill.root.innerHTML) quill.clipboard.dangerouslyPasteHTML(value || '')
})

onBeforeUnmount(() => {
  quill?.off('text-change')
  quill = null
})
</script>
