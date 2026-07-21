<script setup lang="ts">
import type { LearningGrade, LearningSubmission, LearningSubmissionAttempt, SafeRichContent } from '~/shared/contracts/lms'

interface ReviewRow { submission: LearningSubmission; attempts: LearningSubmissionAttempt[]; grade?: LearningGrade }

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Detail tugas' })
const route = useRoute()
const spaceId = computed(() => String(route.params.spaceId || ''))
const assignmentId = computed(() => String(route.params.assignmentId || ''))
const { $api } = useNuxtApp()
const { detail, loading, error, refresh } = useLearningSpace(spaceId)
const reviewRows = ref<ReviewRow[]>([])
const reviewCursor = ref<string>()
const reviewPending = ref(false)
const busy = ref(false)
const actionError = ref('')
const notice = ref('')
const assignment = computed(() => detail.value?.assignments.find(item => item.id === assignmentId.value))
const ownSubmission = computed(() => detail.value?.ownSubmissions.find(item => item.assignmentId === assignmentId.value))
const publishedGrade = computed(() => detail.value?.ownGrades.find(item => item.assignmentId === assignmentId.value))

async function loadReviews(reset = true) {
  if (!detail.value?.canManage || !assignment.value) return
  reviewPending.value = true
  try {
    const { data } = await $api.get<{ submissions: ReviewRow[]; nextCursor?: string }>(`/learning/assignments/${assignmentId.value}/submissions`, {
      params: { limit: 50, ...(reset || !reviewCursor.value ? {} : { cursor: reviewCursor.value }) },
    })
    reviewRows.value = reset ? data.submissions : [...reviewRows.value, ...data.submissions]
    reviewCursor.value = data.nextCursor
  } catch (cause) { actionError.value = learningErrorMessage(cause) } finally { reviewPending.value = false }
}

watch(() => detail.value?.canManage, loadReviews)

async function saveDraft(payload: { content?: SafeRichContent; fileIds: string[]; expectedVersion: number }) {
  busy.value = true; actionError.value = ''
  try {
    await $api.put(`/learning/assignments/${assignmentId.value}/draft`, payload, { headers: { 'Idempotency-Key': learningRequestKey('submission-draft') } })
    await refresh(); notice.value = 'Draf tersimpan. Belum dianggap sebagai pengumpulan final.'
  } catch (cause) { actionError.value = learningErrorMessage(cause) } finally { busy.value = false }
}

async function submitFinal(expectedVersion: number) {
  if (!confirm('Kirim sebagai attempt final? Isi attempt tidak dapat diubah setelah dikirim.')) return
  busy.value = true; actionError.value = ''
  try {
    await $api.post(`/learning/assignments/${assignmentId.value}/submit`, { expectedVersion }, { headers: { 'Idempotency-Key': learningRequestKey('submission-final') } })
    await refresh(); notice.value = 'Attempt final berhasil dikirim.'
  } catch (cause) { actionError.value = learningErrorMessage(cause) } finally { busy.value = false }
}

async function saveGrade(payload: { attemptId: string; expectedVersion: number; score: number; feedback: { format: 'PLAIN_TEXT'; text: string }; status: 'DRAFT' | 'PUBLISHED' }) {
  busy.value = true; actionError.value = ''
  try {
    await $api.put(`/learning/attempts/${payload.attemptId}/grade`, payload)
    await loadReviews(); notice.value = payload.status === 'PUBLISHED' ? 'Nilai dan feedback diterbitkan.' : 'Draf nilai disimpan.'
  } catch (cause) { actionError.value = learningErrorMessage(cause) } finally { busy.value = false }
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('id-ID', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(value))
}
</script>

<template>
  <div class="page-stack">
    <div v-if="error || actionError" class="alert alert-danger" role="alert">{{ error || actionError }}</div>
    <div v-if="notice" class="alert alert-success" role="status">{{ notice }}</div>
    <div v-if="loading" class="loading-state"><span class="spinner-border spinner-border-sm" />Memuat tugas…</div>
    <LearningSpaceFrame v-else-if="detail" :detail="detail">
      <section v-if="assignment" class="assignment-detail">
        <header><div><small>{{ assignment.status }} · versi {{ assignment.currentVersion }}</small><h1>{{ assignment.title }}</h1><p>{{ learningPlainText(assignment.instructions) }}</p></div><strong>{{ assignment.maximumPoints }} poin</strong></header>
        <dl><div><dt>Dibuka</dt><dd>{{ formatDate(assignment.opensAt) }}</dd></div><div><dt>Tenggat</dt><dd>{{ formatDate(assignment.dueAt) }}</dd></div><div><dt>Ditutup</dt><dd>{{ formatDate(assignment.closesAt) }}</dd></div><div><dt>Batas</dt><dd>{{ assignment.maximumAttempts }} attempt · {{ assignment.maximumFiles }} file</dd></div></dl>
      </section>
      <section v-else class="alert alert-warning">Tugas tidak ditemukan atau belum dapat dilihat.</section>

      <section v-if="assignment && !detail.canManage" class="surface"><header><h2>Jawaban Anda</h2><p>Nilai terbit dan feedback hanya dapat dilihat oleh pemilik submission.</p></header><div class="surface-body"><SubmissionEditor :assignment="assignment" :submission="ownSubmission" :space-id="spaceId" :busy="busy" @save="saveDraft" @submit="submitFinal" /><article v-if="publishedGrade" class="published-grade"><small>Nilai terbit</small><strong>{{ publishedGrade.score }} / {{ assignment?.maximumPoints }}</strong><p>{{ learningPlainText(publishedGrade.feedback) }}</p></article></div></section>

      <section v-if="assignment && detail.canManage" class="surface"><header><h2>Pengumpulan dan penilaian</h2><p>Setiap nilai menunjuk attempt final tertentu; publikasi dilakukan secara eksplisit.</p></header><article v-for="row in reviewRows" :key="row.submission.id" class="review-row"><div><strong>{{ row.submission.studentId }}</strong><small>{{ row.attempts.length }} attempt · {{ row.attempts.at(-1)?.timeliness || 'belum final' }}</small></div><GradeEditor v-if="row.attempts.at(-1)" :attempt="row.attempts.at(-1)!" :grade="row.grade" :maximum-points="assignment.maximumPoints" :busy="busy" @save="saveGrade" /></article><p v-if="!reviewRows.length && !reviewPending" class="empty">Belum ada pengumpulan final.</p><div v-if="reviewCursor" class="review-more"><button class="btn btn-sm btn-outline-primary" type="button" :disabled="reviewPending" @click="loadReviews(false)">{{ reviewPending ? 'Memuat…' : 'Muat pengumpulan berikutnya' }}</button></div></section>
    </LearningSpaceFrame>
  </div>
</template>

<style scoped src="~/pages/_workflow.css"></style>
<style scoped>
.loading-state{display:flex;gap:.5rem;justify-content:center;padding:4rem}.assignment-detail,.surface{overflow:hidden;border:1px solid #e0e8e3;border-radius:.9rem;background:#fff}.assignment-detail>header{display:flex;justify-content:space-between;gap:1rem;padding:1.1rem}.assignment-detail header small{color:#557a6b;font-size:.55rem;font-weight:800}.assignment-detail h1{margin:.2rem 0;color:#2e5142;font-size:1rem}.assignment-detail header p{margin:0;color:#6f8179;font-size:.63rem;white-space:pre-wrap}.assignment-detail header>strong{color:#2e654e;white-space:nowrap}.assignment-detail dl{display:grid;grid-template-columns:repeat(4,1fr);margin:0;border-top:1px solid #edf1ee}.assignment-detail dl>div{padding:.8rem 1rem;border-left:1px solid #edf1ee}.assignment-detail dl>div:first-child{border-left:0}.assignment-detail dt{color:#7c8c85;font-size:.52rem}.assignment-detail dd{margin:.15rem 0 0;color:#3c594d;font-size:.59rem}.surface>header{padding:.9rem 1rem;border-bottom:1px solid #edf1ee}.surface h2{margin:0;color:#315145;font-size:.82rem}.surface header p{margin:.18rem 0 0;color:#788a82;font-size:.58rem}.surface-body{display:grid;gap:1rem;padding:1rem}.published-grade{padding:1rem;border-radius:.75rem;color:#355b49;background:#edf7f1}.published-grade small,.published-grade strong{display:block}.published-grade strong{font-size:1rem}.published-grade p{margin:.25rem 0 0;font-size:.62rem}.review-row{display:grid;grid-template-columns:180px minmax(0,1fr);gap:1rem;padding:1rem;border-top:1px solid #edf1ee}.review-row strong,.review-row small{display:block;color:#3b584d;font-size:.63rem}.review-row small{margin-top:.15rem;color:#84928c;font-size:.53rem}.review-more{display:flex;justify-content:center;padding:1rem;border-top:1px solid #edf1ee}.empty{padding:1rem;color:#82918b;font-size:.6rem;text-align:center}@media(max-width:991.98px){.assignment-detail dl{grid-template-columns:repeat(2,1fr)}.review-row{grid-template-columns:1fr}}@media(max-width:575.98px){.assignment-detail>header{display:block}.assignment-detail header>strong{display:block;margin-top:.7rem}.assignment-detail dl{grid-template-columns:1fr}.assignment-detail dl>div{border-left:0;border-top:1px solid #edf1ee}}
</style>
