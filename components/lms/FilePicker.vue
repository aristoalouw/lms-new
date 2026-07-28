<script setup lang="ts">
import type { AxiosError } from 'axios'
import type { PrivateFileRecord } from '~/shared/contracts/lms'

const props = defineProps<{ modelValue?: string; spaceId: string; label?: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const { $api } = useNuxtApp()
const config = useRuntimeConfig()
const { upload, progress, stage, pending } = usePrivateUpload()
const files = ref<PrivateFileRecord[]>([])
const loading = ref(false)
const errorMessage = ref('')
const fileInput = ref<HTMLInputElement>()
const uploadsEnabled = ref(Boolean(config.public.fileUploadsEnabled))
const disabledReason = ref('Unggahan file belum tersedia pada paket awal; gunakan rich text atau tautan HTTPS.')

const errorText = (error: unknown) => {
  const data = (error as AxiosError<{ statusMessage?: string; message?: string }>).response?.data
  return data?.statusMessage || data?.message || (error instanceof Error ? error.message : 'File belum dapat diproses.')
}

async function loadFiles() {
  loading.value = true
  errorMessage.value = ''
  try {
    const { data } = await $api.get<{ items: PrivateFileRecord[] }>('/files', { params: { scope: 'owned', status: 'CLEAN', limit: 50 } })
    files.value = data.items.filter(file => file.access.learningSpaceIds?.includes(props.spaceId))
  } catch (error) { errorMessage.value = errorText(error) } finally { loading.value = false }
}

async function loadPolicy() {
  const { data } = await $api.get<{ uploadsEnabled: boolean; disabledReason?: string }>('/files/policy')
  uploadsEnabled.value = data.uploadsEnabled
  if (data.disabledReason) disabledReason.value = data.disabledReason
}

async function onFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  errorMessage.value = ''
  try {
    const record = await upload(file, props.spaceId)
    if (record.status !== 'CLEAN') {
      errorMessage.value = 'File masih dikarantina dan belum dapat dilampirkan.'
      return
    }
    await loadFiles()
    emit('update:modelValue', record.id)
  } catch (error) { errorMessage.value = errorText(error) } finally { if (fileInput.value) fileInput.value.value = '' }
}

onMounted(async () => {
  await Promise.all([loadPolicy(), loadFiles()])
})
</script>

<template>
  <div class="file-picker">
    <label :for="`file-picker-${spaceId}`" class="form-label">{{ label || 'File pembelajaran' }}</label>
    <div class="file-picker__controls">
      <select :id="`file-picker-${spaceId}`" class="form-select" :value="modelValue || ''" :disabled="loading || pending" @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value)">
        <option value="">Pilih file CLEAN…</option>
        <option v-for="file in files" :key="file.id" :value="file.id">{{ file.name }}</option>
      </select>
      <label v-if="uploadsEnabled" class="btn btn-outline-secondary mb-0"><i class="uil uil-upload me-1" />Unggah<input ref="fileInput" class="visually-hidden" type="file" accept=".pdf,.jpg,.jpeg,.png" :disabled="pending" @change="onFile"></label>
    </div>
    <div v-if="!uploadsEnabled" class="alert alert-info py-2 mt-2 mb-0 small" role="status">{{ disabledReason }}</div>
    <div v-if="pending" class="progress mt-2" role="progressbar" :aria-valuenow="progress" aria-valuemin="0" aria-valuemax="100"><div class="progress-bar" :style="{ width: `${progress}%` }" /></div>
    <small v-if="pending || stage" class="form-text">{{ stage }}</small>
    <div v-if="errorMessage" class="text-danger small mt-1" role="alert">{{ errorMessage }}</div>
  </div>
</template>

<style scoped>
.file-picker__controls{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:.5rem}.form-text{display:block;color:#6f8179}@media(max-width:575.98px){.file-picker__controls{grid-template-columns:1fr}}
</style>
