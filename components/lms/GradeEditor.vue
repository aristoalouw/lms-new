<script setup lang="ts">
import type { LearningGrade, LearningSubmissionAttempt } from '~/shared/contracts/lms'

const props = defineProps<{ attempt: LearningSubmissionAttempt; grade?: LearningGrade; maximumPoints: number; busy?: boolean }>()
const emit = defineEmits<{ save: [payload: { attemptId: string; expectedVersion: number; score: number; feedback: { format: 'PLAIN_TEXT'; text: string }; status: 'DRAFT' | 'PUBLISHED' }] }>()
const score = ref(0)
const feedback = ref('')
const status = ref<'DRAFT' | 'PUBLISHED'>('DRAFT')

watch(() => props.grade, value => {
  score.value = value?.score || 0
  feedback.value = value?.feedback ? (value.feedback.format === 'PLAIN_TEXT' ? value.feedback.text : value.feedback.ops.map(item => item.insert).join('')) : ''
  status.value = value?.status || 'DRAFT'
}, { immediate: true })
</script>

<template>
  <form class="grade-editor" @submit.prevent="emit('save', { attemptId: attempt.id, expectedVersion: grade?.version || 0, score, feedback: { format: 'PLAIN_TEXT', text: feedback }, status })">
    <label><span>Nilai</span><input v-model.number="score" class="form-control" type="number" min="0" :max="maximumPoints" required></label>
    <label><span>Feedback</span><textarea v-model="feedback" class="form-control" rows="2" maxlength="10000" required /></label>
    <label><span>Status</span><select v-model="status" class="form-select"><option value="DRAFT">Draf</option><option value="PUBLISHED">Terbitkan</option></select></label>
    <button class="btn btn-sm btn-primary" :disabled="busy">Simpan</button>
  </form>
</template>

<style scoped>
.grade-editor{display:grid;grid-template-columns:100px minmax(180px,1fr) 130px auto;gap:.55rem;align-items:end}.grade-editor label>span{display:block;margin-bottom:.2rem;color:#708179;font-size:.57rem;font-weight:700}@media(max-width:767.98px){.grade-editor{grid-template-columns:1fr}.grade-editor button{justify-self:start}}
</style>
