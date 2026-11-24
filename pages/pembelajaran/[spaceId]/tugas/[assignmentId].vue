<script setup lang="ts">
import type {
  LearningGrade,
  LearningFileReference,
  LearningOwnAssignmentHistory,
  LearningSubmission,
  LearningSubmissionAttempt,
  SafeRichContent,
  SignedDownloadResult,
} from '~/shared/contracts/lms'

interface ReviewRow { submission: LearningSubmission; attempts: LearningSubmissionAttempt[]; grade?: LearningGrade }

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Detail tugas' })
const route = useRoute()
const spaceId = computed(() => String(route.params.spaceId || ''))
const assignmentId = computed(() => String(route.params.assignmentId || ''))
const { $api } = useNuxtApp()
const { can } = useAuth()
const { detail, loading, error, refresh } = useLearningSpace(spaceId)
const reviewRows = ref<ReviewRow[]>([])
const reviewCursor = ref<string>()
const reviewPending = ref(false)
const ownHistory = ref<LearningOwnAssignmentHistory>()
const historyPending = ref(false)
const busy = ref(false)
const actionError = ref('')
const notice = ref('')
const assignment = computed(() => detail.value?.assignments.find(item => item.id === assignmentId.value))
const ownSubmission = computed(() =>
  ownHistory.value?.submission
  ?? detail.value?.ownSubmissions.find(item => item.assignmentId === assignmentId.value))
const publishedGrade = computed(() =>
  ownHistory.value?.publishedGrade
  ?? detail.value?.ownGrades.find(item => item.assignmentId === assignmentId.value))
const gradedAttempt = computed(() =>
  ownHistory.value?.attempts.find(item => item.id === publishedGrade.value?.attemptId))
const canSubmit = computed(() => can('learning:submit') && !detail.value?.canManage)
const canGrade = computed(() => can('learning:grade') && detail.value?.canManage === true)

async function loadReviews(reset = true) {
  if (!canGrade.value || !assignment.value) return
  reviewPending.value = true
  try {
    const { data } = await $api.get<{ submissions: ReviewRow[]; nextCursor?: string }>(`/learning/assignments/${assignmentId.value}/submissions`, {
      params: { limit: 50, ...(reset || !reviewCursor.value ? {} : { cursor: reviewCursor.value }) },
    })
    reviewRows.value = reset ? data.submissions : [...reviewRows.value, ...data.submissions]
    reviewCursor.value = data.nextCursor
  } catch (cause) { actionError.value = learningErrorMessage(cause) } finally { reviewPending.value = false }
}

async function loadOwnHistory() {
  if (!canSubmit.value || !assignment.value) {
    ownHistory.value = undefined
    return
  }
  historyPending.value = true
  try {
    const { data } = await $api.get<LearningOwnAssignmentHistory>(
      `/learning/assignments/${assignmentId.value}/attempts`,
    )
    ownHistory.value = data
  } catch (cause) {
    actionError.value = learningErrorMessage(cause)
  } finally {
    historyPending.value = false
  }
}

watch(
  [canGrade, canSubmit, () => assignment.value?.id],
  ([mayGrade, maySubmit, currentAssignmentId]) => {
    if (mayGrade && currentAssignmentId) void loadReviews()
    else if (maySubmit && currentAssignmentId) void loadOwnHistory()
    else {
      reviewRows.value = []
      ownHistory.value = undefined
    }
  },
  { immediate: true },
)

async function saveDraft(payload: { content?: SafeRichContent; fileIds: string[]; expectedVersion: number }) {
  busy.value = true; actionError.value = ''
  try {
    await $api.put(`/learning/assignments/${assignmentId.value}/draft`, payload, { headers: { 'Idempotency-Key': learningRequestKey('submission-draft') } })
    await refresh(); await loadOwnHistory(); notice.value = 'Draf tersimpan. Belum dianggap sebagai pengumpulan final.'
  } catch (cause) { actionError.value = learningErrorMessage(cause) } finally { busy.value = false }
}

async function submitFinal(expectedVersion: number) {
  if (!confirm('Kirim sebagai attempt final? Isi attempt tidak dapat diubah setelah dikirim.')) return
  busy.value = true; actionError.value = ''
  try {
    await $api.post(`/learning/assignments/${assignmentId.value}/submit`, { expectedVersion }, { headers: { 'Idempotency-Key': learningRequestKey('submission-final') } })
    await refresh(); await loadOwnHistory(); notice.value = 'Attempt final berhasil dikirim.'
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

function formatBytes(value: number) {
  return new Intl.NumberFormat('id-ID', { style: 'unit', unit: 'kilobyte', maximumFractionDigits: 1 }).format(value / 1024)
}

async function downloadAttemptFile(file: LearningFileReference) {
  actionError.value = ''
  try {
    const { data } = await $api.post<SignedDownloadResult>(
      `/files/${encodeURIComponent(file.fileId)}/download`,
      { version: file.fileVersion },
    )
    if (import.meta.client) window.location.assign(data.url)
  } catch (cause) {
    actionError.value = learningErrorMessage(cause)
  }
}
</script>

<template>
  <div class="page-stack">
    <div v-if="error || actionError" class="alert alert-danger" role="alert">{{ error || actionError }}</div>
    <div v-if="notice" class="alert alert-success" role="status">{{ notice }}</div>
    <div v-if="loading" class="loading-state"><span class="spinner-border spinner-border-sm" />Memuat tugas…</div>
    <LearningSpaceFrame v-else-if="detail" :detail="detail">
      <section v-if="assignment" class="assignment-detail">
        <header><div><small>{{ assignment.status }} · versi {{ assignment.currentVersion }}</small><h2>{{ assignment.title }}</h2><p>{{ learningPlainText(assignment.instructions) }}</p></div><strong>{{ assignment.maximumPoints }} poin</strong></header>
        <dl><div><dt>Dibuka</dt><dd>{{ formatDate(assignment.opensAt) }}</dd></div><div><dt>Tenggat</dt><dd>{{ formatDate(assignment.dueAt) }}</dd></div><div><dt>Ditutup</dt><dd>{{ formatDate(assignment.closesAt) }}</dd></div><div><dt>Batas</dt><dd>{{ assignment.maximumAttempts }} attempt · {{ assignment.maximumFiles }} file</dd></div></dl>
      </section>
      <section v-else class="alert alert-warning">Tugas tidak ditemukan atau belum dapat dilihat.</section>

      <section v-if="assignment && canSubmit" class="surface">
        <header>
          <h2>Jawaban Anda</h2>
          <p>Nilai terbit dan feedback hanya dapat dilihat oleh pemilik submission.</p>
        </header>
        <div class="surface-body">
          <SubmissionEditor
            :assignment="assignment"
            :submission="ownSubmission"
            :space-id="spaceId"
            :busy="busy"
            @save="saveDraft"
            @submit="submitFinal"
          />
          <article v-if="publishedGrade" class="published-grade">
            <small>Nilai terbit{{ gradedAttempt ? ` untuk attempt ${gradedAttempt.attemptNumber}` : '' }}</small>
            <strong>{{ publishedGrade.score }} / {{ assignment.maximumPoints }}</strong>
            <p>{{ learningPlainText(publishedGrade.feedback) }}</p>
          </article>
          <section class="attempt-history" aria-labelledby="attempt-history-title">
            <header>
              <h3 id="attempt-history-title">Riwayat attempt final</h3>
              <p>Setiap pengumpulan tersimpan sebagai arsip tetap.</p>
            </header>
            <div v-if="historyPending" class="history-state" role="status">
              <span class="spinner-border spinner-border-sm" aria-hidden="true" />
              Memuat riwayat…
            </div>
            <template v-else>
              <article
                v-for="attempt in ownHistory?.attempts"
                :key="attempt.id"
                class="attempt-row"
              >
                <div class="attempt-meta">
                  <div>
                    <strong>Attempt {{ attempt.attemptNumber }}</strong>
                    <span
                      class="badge"
                      :class="attempt.timeliness === 'ON_TIME' ? 'text-bg-success' : 'text-bg-warning'"
                    >
                      {{ attempt.timeliness === 'ON_TIME' ? 'Tepat waktu' : 'Terlambat' }}
                    </span>
                    <span v-if="publishedGrade?.attemptId === attempt.id" class="badge text-bg-primary">Dinilai</span>
                  </div>
                  <small>{{ formatDate(attempt.submittedAt) }} · versi tugas {{ attempt.assignmentVersion }}</small>
                </div>
                <p v-if="attempt.content">{{ learningPlainText(attempt.content) }}</p>
                <p v-else class="attempt-empty">Tidak ada jawaban teks.</p>
                <ul v-if="attempt.files.length" class="attempt-files">
                  <li v-for="file in attempt.files" :key="`${file.fileId}:${file.fileVersion}`">
                    {{ file.fileName }} · versi {{ file.fileVersion }}
                  </li>
                </ul>
              </article>
              <p v-if="!ownHistory?.attempts.length" class="history-state">
                Belum ada attempt final.
              </p>
            </template>
          </section>
        </div>
      </section>

      <section v-if="assignment && canGrade" class="surface">
        <header>
          <h2>Pengumpulan dan penilaian</h2>
          <p>Jawaban dan lampiran di bawah adalah snapshot attempt final yang sedang dinilai.</p>
        </header>
        <article v-for="row in reviewRows" :key="row.submission.id" class="review-row">
          <div class="review-identity">
            <strong>{{ row.submission.studentId }}</strong>
            <small>{{ row.attempts.length }} attempt · {{ row.attempts.at(-1)?.timeliness || 'belum final' }}</small>
          </div>
          <div v-if="row.attempts.at(-1)" class="review-content">
            <div class="review-attempt-meta">
              <strong>Attempt {{ row.attempts.at(-1)!.attemptNumber }}</strong>
              <small>{{ formatDate(row.attempts.at(-1)!.submittedAt) }} · versi tugas {{ row.attempts.at(-1)!.assignmentVersion }}</small>
            </div>
            <section class="review-answer" :aria-label="`Jawaban ${row.submission.studentId}`">
              <h3>Jawaban final</h3>
              <SafeRichContent
                v-if="row.attempts.at(-1)!.content"
                :content="row.attempts.at(-1)!.content"
              />
              <p v-else class="attempt-empty">Tidak ada jawaban teks.</p>
            </section>
            <section class="review-files" :aria-label="`Lampiran ${row.submission.studentId}`">
              <h3>Lampiran</h3>
              <ul v-if="row.attempts.at(-1)!.files.length">
                <li v-for="file in row.attempts.at(-1)!.files" :key="`${file.fileId}:${file.fileVersion}`">
                  <span>
                    <strong>{{ file.fileName }}</strong>
                    <small>{{ file.mimeType }} · {{ formatBytes(file.sizeBytes) }} · versi {{ file.fileVersion }}</small>
                  </span>
                  <button
                    class="btn btn-sm btn-outline-primary"
                    type="button"
                    :aria-label="`Unduh ${file.fileName}, versi ${file.fileVersion}`"
                    @click="downloadAttemptFile(file)"
                  >
                    <i class="uil uil-download-alt" aria-hidden="true" />
                    Unduh
                  </button>
                </li>
              </ul>
              <p v-else class="attempt-empty">Tidak ada lampiran.</p>
            </section>
            <GradeEditor
              :attempt="row.attempts.at(-1)!"
              :grade="row.grade"
              :maximum-points="assignment.maximumPoints"
              :busy="busy"
              @save="saveGrade"
            />
          </div>
        </article>
        <p v-if="!reviewRows.length && !reviewPending" class="empty">Belum ada pengumpulan final.</p>
        <div v-if="reviewCursor" class="review-more">
          <button class="btn btn-sm btn-outline-primary" type="button" :disabled="reviewPending" @click="loadReviews(false)">{{ reviewPending ? 'Memuat…' : 'Muat pengumpulan berikutnya' }}</button>
        </div>
      </section>
      <section v-if="assignment && !canSubmit && !canGrade" class="surface support-readonly" aria-labelledby="support-readonly-title">
        <header>
          <h2 id="support-readonly-title">Tampilan dukungan baca-saja</h2>
          <p>Administrator dapat memeriksa detail tugas, tetapi tidak dapat mengirim submission atau memberikan nilai.</p>
        </header>
      </section>
    </LearningSpaceFrame>
  </div>
</template>

<style scoped src="~/pages/_workflow.css"></style>
<style scoped>
.loading-state{display:flex;gap:.5rem;justify-content:center;padding:4rem}.assignment-detail,.surface{overflow:hidden;border:1px solid #e0e8e3;border-radius:.9rem;background:#fff}.assignment-detail>header{display:flex;justify-content:space-between;gap:1rem;padding:1.1rem}.assignment-detail header small{color:#557a6b;font-size:.55rem;font-weight:800}.assignment-detail h2{margin:.2rem 0;color:#2e5142;font-size:1rem}.assignment-detail header p{margin:0;color:#6f8179;font-size:.63rem;white-space:pre-wrap}.assignment-detail header>strong{color:#2e654e;white-space:nowrap}.assignment-detail dl{display:grid;grid-template-columns:repeat(4,1fr);margin:0;border-top:1px solid #edf1ee}.assignment-detail dl>div{padding:.8rem 1rem;border-left:1px solid #edf1ee}.assignment-detail dl>div:first-child{border-left:0}.assignment-detail dt{color:#7c8c85;font-size:.52rem}.assignment-detail dd{margin:.15rem 0 0;color:#3c594d;font-size:.59rem}.surface>header{padding:.9rem 1rem;border-bottom:1px solid #edf1ee}.surface h2{margin:0;color:#315145;font-size:.82rem}.surface header p{margin:.18rem 0 0;color:#788a82;font-size:.58rem}.surface-body{display:grid;gap:1rem;padding:1rem}.published-grade{padding:1rem;border-radius:.75rem;color:#355b49;background:#edf7f1}.published-grade small,.published-grade strong{display:block}.published-grade strong{font-size:1rem}.published-grade p{margin:.25rem 0 0;font-size:.62rem}.review-row{display:grid;grid-template-columns:180px minmax(0,1fr);gap:1rem;padding:1rem;border-top:1px solid #edf1ee}.review-row strong,.review-row small{display:block;color:#3b584d;font-size:.63rem}.review-row small{margin-top:.15rem;color:#84928c;font-size:.53rem}.review-content{display:grid;gap:.8rem;min-width:0}.review-attempt-meta{display:flex;justify-content:space-between;gap:1rem}.review-answer,.review-files{padding:.8rem;border:1px solid #e4ebe7;border-radius:.65rem;background:#fbfcfb}.review-answer h3,.review-files h3{margin:0 0 .35rem;color:#47665a;font-size:.63rem}.review-files ul{display:grid;gap:.45rem;margin:0;padding:0;list-style:none}.review-files li{display:flex;align-items:center;justify-content:space-between;gap:.75rem;padding:.55rem;border-radius:.5rem;background:#f3f7f5}.review-files li span{min-width:0}.review-files li strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.review-more{display:flex;justify-content:center;padding:1rem;border-top:1px solid #edf1ee}.empty{padding:1rem;color:#82918b;font-size:.6rem;text-align:center}.support-readonly{background:#fbfcfb}@media(max-width:991.98px){.assignment-detail dl{grid-template-columns:repeat(2,1fr)}.review-row{grid-template-columns:1fr}}@media(max-width:575.98px){.assignment-detail>header{display:block}.assignment-detail header>strong{display:block;margin-top:.7rem}.assignment-detail dl{grid-template-columns:1fr}.assignment-detail dl>div{border-left:0;border-top:1px solid #edf1ee}.review-attempt-meta,.review-files li{align-items:flex-start;flex-direction:column}}
.attempt-history{overflow:hidden;border:1px solid #e1e9e4;border-radius:.75rem}.attempt-history>header{padding:.8rem .9rem;background:#f7faf8}.attempt-history h3{margin:0;color:#355b49;font-size:.72rem}.attempt-history header p{margin:.15rem 0 0;color:#778a81;font-size:.56rem}.attempt-row{padding:.9rem;border-top:1px solid #e8eeea}.attempt-meta{display:flex;align-items:flex-start;justify-content:space-between;gap:.75rem}.attempt-meta>div{display:flex;align-items:center;gap:.35rem;flex-wrap:wrap}.attempt-meta strong{color:#34584a;font-size:.64rem}.attempt-meta small{color:#7a8b84;font-size:.54rem}.attempt-row>p{margin:.55rem 0 0;color:#50675d;font-size:.6rem;white-space:pre-wrap}.attempt-row>.attempt-empty{color:#87958f;font-style:italic}.attempt-files{margin:.55rem 0 0;padding-left:1rem;color:#50675d;font-size:.56rem}.history-state{display:flex;align-items:center;justify-content:center;gap:.45rem;margin:0;padding:1rem;color:#7b8b84;font-size:.6rem}@media(max-width:575.98px){.attempt-meta{display:block}.attempt-meta small{display:block;margin-top:.35rem}}
</style>
