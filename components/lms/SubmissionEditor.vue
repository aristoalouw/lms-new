<script setup lang="ts">
import type { LearningAssignment, LearningSubmission, SafeRichContent } from '~/shared/contracts/lms'

const props = defineProps<{ assignment: LearningAssignment; submission?: LearningSubmission; spaceId: string; busy?: boolean }>()
const emit = defineEmits<{
  save: [payload: { content?: SafeRichContent; fileIds: string[]; expectedVersion: number }]
  submit: [expectedVersion: number]
}>()
const answer = ref('')
const selectedFileId = ref('')
const fileIds = ref<string[]>([])

watch(() => props.submission, value => {
  const content = value?.draftContent
  answer.value = content ? (content.format === 'PLAIN_TEXT' ? content.text : content.ops.map(item => item.insert).join('')) : ''
  fileIds.value = value?.draftFiles.map(file => file.fileId) || []
  selectedFileId.value = ''
}, { immediate: true })

const canSubmit = computed(() => props.submission?.status === 'DRAFT' && props.submission.version > 0)

function addFile(fileId: string) {
  selectedFileId.value = ''
  if (!fileId || fileIds.value.includes(fileId) || fileIds.value.length >= props.assignment.maximumFiles) return
  fileIds.value.push(fileId)
}
</script>

<template>
  <section class="submission-editor">
    <label class="form-label" for="submission-answer">Jawaban</label>
    <textarea id="submission-answer" v-model="answer" class="form-control" rows="9" maxlength="20000" placeholder="Tulis jawaban Anda…" />
    <FilePicker v-if="assignment.maximumFiles > 0 && fileIds.length < assignment.maximumFiles" :model-value="selectedFileId" :space-id="spaceId" label="Lampiran (opsional)" @update:model-value="addFile" />
    <ul v-if="fileIds.length" class="selected-files"><li v-for="file in fileIds" :key="file"><code>{{ file }}</code><button class="btn btn-sm btn-link text-danger" type="button" aria-label="Hapus lampiran" @click="fileIds = fileIds.filter(item => item !== file)"><i class="uil uil-times" /></button></li></ul>
    <small class="file-limit">{{ fileIds.length }} / {{ assignment.maximumFiles }} file dipilih</small>
    <div class="submission-note"><i class="uil uil-shield-check" /><span>Menyimpan draf belum mengirim tugas. Setelah dikumpulkan, jawaban terkirim tercatat sebagai versi final.</span></div>
    <div class="submission-actions">
      <button class="btn btn-outline-secondary" type="button" :disabled="busy" @click="emit('save', { content: answer.trim() ? { format: 'PLAIN_TEXT', text: answer } : undefined, fileIds, expectedVersion: submission?.version || 0 })">Simpan draf</button>
      <button class="btn btn-primary" type="button" :disabled="busy || !canSubmit" @click="emit('submit', submission!.version)">Kirim final</button>
    </div>
  </section>
</template>

<style scoped>
.submission-editor{display:grid;gap:.9rem}.submission-note{display:flex;gap:.5rem;padding:.7rem;border-radius:.65rem;color:#725d32;background:#fff8e8;font-size:.62rem}.submission-actions{display:flex;justify-content:flex-end;gap:.5rem}.selected-files{display:flex;gap:.4rem;flex-wrap:wrap;margin:0;padding:0;list-style:none}.selected-files li{display:flex;align-items:center;padding:.2rem .25rem .2rem .5rem;border-radius:.5rem;background:#eef5f1}.selected-files code{font-size:.55rem}.file-limit{color:#71847b;font-size:.56rem}@media(max-width:575.98px){.submission-actions{display:grid;grid-template-columns:1fr 1fr}}
</style>
