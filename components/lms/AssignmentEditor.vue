<script setup lang="ts">
import type { LearningAssignment, LearningModule, SafeRichContent } from '~/shared/contracts/lms'

const props = defineProps<{ modules: LearningModule[]; assignment?: LearningAssignment; busy?: boolean }>()
const emit = defineEmits<{ save: [payload: {
  moduleId?: string
  title: string
  instructions: SafeRichContent
  opensAt: string
  dueAt: string
  closesAt: string
  maximumPoints: number
  maximumAttempts: number
  maximumFiles: number
  status: LearningAssignment['status']
  expectedVersion?: number
}] }>()

const draft = reactive({
  moduleId: '', title: '', instructions: '', opensAt: '', dueAt: '', closesAt: '',
  maximumPoints: 100, maximumAttempts: 1, maximumFiles: 1,
  status: 'DRAFT' as LearningAssignment['status'],
})

function localDate(value: Date) {
  return new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

function reset() {
  const opens = new Date()
  Object.assign(draft, {
    moduleId: props.assignment?.moduleId || '',
    title: props.assignment?.title || '',
    instructions: props.assignment ? learningPlainText(props.assignment.instructions) : '',
    opensAt: props.assignment ? localDate(new Date(props.assignment.opensAt)) : localDate(opens),
    dueAt: props.assignment ? localDate(new Date(props.assignment.dueAt)) : localDate(new Date(opens.getTime() + 7 * 86_400_000)),
    closesAt: props.assignment ? localDate(new Date(props.assignment.closesAt)) : localDate(new Date(opens.getTime() + 10 * 86_400_000)),
    maximumPoints: props.assignment?.maximumPoints || 100,
    maximumAttempts: props.assignment?.maximumAttempts || 1,
    maximumFiles: props.assignment?.maximumFiles ?? 1,
    status: props.assignment?.status || 'DRAFT',
  })
}

watch(() => props.assignment, reset, { immediate: true })

function submit() {
  emit('save', {
    ...(draft.moduleId ? { moduleId: draft.moduleId } : {}),
    title: draft.title,
    instructions: { format: 'PLAIN_TEXT', text: draft.instructions },
    opensAt: new Date(draft.opensAt).toISOString(), dueAt: new Date(draft.dueAt).toISOString(), closesAt: new Date(draft.closesAt).toISOString(),
    maximumPoints: draft.maximumPoints, maximumAttempts: draft.maximumAttempts, maximumFiles: draft.maximumFiles,
    status: draft.status,
    ...(props.assignment ? { expectedVersion: props.assignment.version } : {}),
  })
}
</script>

<template>
  <form class="assignment-editor" @submit.prevent="submit">
    <label><span>Judul tugas</span><input v-model="draft.title" class="form-control" maxlength="180" required></label>
    <label><span>Instruksi</span><textarea v-model="draft.instructions" class="form-control" rows="5" maxlength="20000" required /></label>
    <label><span>Modul</span><select v-model="draft.moduleId" class="form-select"><option value="">Tanpa modul</option><option v-for="item in modules" :key="item.id" :value="item.id">{{ item.title }}</option></select></label>
    <div class="dates"><label><span>Dibuka</span><input v-model="draft.opensAt" class="form-control" type="datetime-local" required></label><label><span>Tenggat</span><input v-model="draft.dueAt" class="form-control" type="datetime-local" required></label><label><span>Ditutup</span><input v-model="draft.closesAt" class="form-control" type="datetime-local" required></label></div>
    <div class="limits"><label><span>Poin maksimum</span><input v-model.number="draft.maximumPoints" class="form-control" type="number" min="1" max="1000" required></label><label><span>Attempt maksimum</span><input v-model.number="draft.maximumAttempts" class="form-control" type="number" min="1" max="10" required></label><label><span>File maksimum</span><input v-model.number="draft.maximumFiles" class="form-control" type="number" min="0" max="10" required></label></div>
    <label><span>Status</span><select v-model="draft.status" class="form-select"><option value="DRAFT">Draf</option><option value="PUBLISHED">Terbit</option><option v-if="assignment" value="CLOSED">Tutup</option></select></label>
    <button class="btn btn-primary" :disabled="busy">{{ assignment ? 'Simpan perubahan' : 'Buat tugas' }}</button>
  </form>
</template>

<style scoped>
.assignment-editor{display:grid;gap:.75rem}.assignment-editor label>span{display:block;margin-bottom:.25rem;color:#6c8077;font-size:.58rem;font-weight:750}.dates,.limits{display:grid;grid-template-columns:repeat(3,1fr);gap:.6rem}.assignment-editor>button{justify-self:start}@media(max-width:767.98px){.dates,.limits{grid-template-columns:1fr}}
</style>
