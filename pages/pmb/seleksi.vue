<script setup lang="ts">
import type { AdmissionApplicationView, AdmissionListResult, AdmissionProgram, AdmissionWave } from '~/server/types/admissions'
import type {
  AdmissionLetterOfAcceptance,
  AdmissionLetterVerification,
  AdmissionSelectionAssignment,
  AdmissionSelectionSession,
} from '~/server/types/admissions-selection'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Seleksi & Letter of Acceptance PMB' })

const { $api } = useNuxtApp()
const config = useRuntimeConfig()
const { user } = useAuth()
const sessions = ref<AdmissionSelectionSession[]>([])
const assignments = ref<AdmissionSelectionAssignment[]>([])
const letters = ref<AdmissionLetterOfAcceptance[]>([])
const applications = ref<AdmissionApplicationView[]>([])
const loading = ref(true)
const working = ref(false)
const errorMessage = ref('')
const noticeMessage = ref('')
const selectedSessionId = ref('')
const selectedApplicationId = ref('')
const selectedAssignmentId = ref('')
const scoreCommunication = ref(40)
const scoreMotivation = ref(40)
const recommendation = ref<'ACCEPT' | 'REJECT' | 'WAITLIST'>('ACCEPT')
const verificationCode = ref('')
const verification = ref<AdmissionLetterVerification | null>(null)
const sessionReady = ref(false)
const programs = ref<AdmissionProgram[]>([])
const waves = ref<AdmissionWave[]>([])
const sessionDraft = reactive({
  name: '',
  kind: 'INTERVIEW',
  waveId: '',
  programStudyId: user.value?.programStudyId || '',
  location: '',
  startsAt: '',
  endsAt: '',
  capacity: 20,
  examinerIds: '',
})

const canManage = computed(() => user.value?.activeRole === 'admissions_staff')
const readyApplications = computed(() => applications.value.filter(item => item.status === 'DOCUMENTS_VERIFIED' && ['PAID', 'WAIVED'].includes(item.registrationFeeStatus)))
const acceptedApplications = computed(() => applications.value.filter(item => item.status === 'ACCEPTED' && item.applicantUid && ['PAID', 'WAIVED'].includes(item.registrationFeeStatus)))
const selectedAssignment = computed(() => assignments.value.find(item => item.id === selectedAssignmentId.value))

const requestKey = (prefix: string) => `${prefix}:${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`
const readableError = (error: unknown) => {
  const candidate = error as { response?: { data?: { statusMessage?: string; message?: string } }; message?: string }
  return candidate.response?.data?.statusMessage || candidate.response?.data?.message || candidate.message || 'Permintaan tidak dapat diproses.'
}
const formatDate = (value: string) => new Intl.DateTimeFormat('id-ID', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta',
}).format(new Date(value))

async function ensureSession() {
  if (sessionReady.value) return
  try {
    await $api.get('/auth/session')
  } catch (error) {
    if (!config.public.demoMode) throw error
    await $api.post('/auth/demo-login', { profileId: 'admin' })
  }
  sessionReady.value = true
}

async function loadWorkspace() {
  loading.value = true
  errorMessage.value = ''
  try {
    await ensureSession()
    const catalog = await $api.get<{ programs: AdmissionProgram[]; waves: AdmissionWave[] }>('/admissions/catalog')
    programs.value = catalog.data.programs
    waves.value = catalog.data.waves
    if (!sessionDraft.waveId) sessionDraft.waveId = waves.value[0]?.id || ''
    if (!sessionDraft.programStudyId) sessionDraft.programStudyId = programs.value[0]?.id || ''
    const requests = [
      $api.get<{ sessions: AdmissionSelectionSession[] }>('/admissions/selection/sessions'),
      $api.get<{ assignments: AdmissionSelectionAssignment[] }>('/admissions/selection/assignments'),
      $api.get<{ letters: AdmissionLetterOfAcceptance[] }>('/admissions/letters'),
    ] as const
    const [sessionResponse, assignmentResponse, letterResponse] = await Promise.all(requests)
    sessions.value = sessionResponse.data.sessions
    assignments.value = assignmentResponse.data.assignments
    letters.value = letterResponse.data.letters
    if (canManage.value) {
      const { data } = await $api.get<AdmissionListResult>('/admissions/applications', { params: { ...(waves.value[0]?.id ? { waveId: waves.value[0].id } : {}), limit: 100 } })
      applications.value = data.items
    }
    if (!selectedSessionId.value) selectedSessionId.value = sessions.value[0]?.id || ''
    if (!selectedApplicationId.value) selectedApplicationId.value = readyApplications.value[0]?.id || ''
    if (!selectedAssignmentId.value) selectedAssignmentId.value = assignments.value.find(item => item.status !== 'SCORED')?.id || ''
  } catch (error) {
    errorMessage.value = readableError(error)
  } finally {
    loading.value = false
  }
}

async function runAction(action: () => Promise<void>, success: string) {
  working.value = true
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    await action()
    noticeMessage.value = success
    await loadWorkspace()
  } catch (error) {
    errorMessage.value = readableError(error)
  } finally {
    working.value = false
  }
}

const createSession = () => runAction(async () => {
  await $api.post('/admissions/selection/sessions', {
    name: sessionDraft.name,
    kind: sessionDraft.kind,
    waveId: sessionDraft.waveId,
    programStudyId: sessionDraft.programStudyId,
    location: sessionDraft.location,
    startsAt: new Date(sessionDraft.startsAt).toISOString(),
    endsAt: new Date(sessionDraft.endsAt).toISOString(),
    capacity: Number(sessionDraft.capacity),
    examinerIds: sessionDraft.examinerIds.split(',').map(value => value.trim()).filter(Boolean),
  }, { headers: { 'Idempotency-Key': requestKey('admission-session') } })
}, 'Sesi seleksi berhasil dijadwalkan.')

const assignApplicant = () => runAction(async () => {
  await $api.post(`/admissions/selection/sessions/${selectedSessionId.value}/assignments`, {
    applicationId: selectedApplicationId.value,
  }, { headers: { 'Idempotency-Key': requestKey('admission-assignment') } })
}, 'Pendaftar berhasil ditempatkan tanpa bentrok jadwal.')

const finalizeScore = () => runAction(async () => {
  await $api.post(`/admissions/selection/assignments/${selectedAssignmentId.value}/score`, {
    components: [
      { key: 'communication', label: 'Komunikasi', score: Number(scoreCommunication.value), maximumScore: 50 },
      { key: 'motivation', label: 'Motivasi studi', score: Number(scoreMotivation.value), maximumScore: 50 },
    ],
    recommendation: recommendation.value,
  }, { headers: { 'Idempotency-Key': requestKey('admission-score') } })
}, 'Nilai seleksi difinalkan sebagai snapshot immutable.')

const issueLetter = (application: AdmissionApplicationView) => runAction(async () => {
  await $api.post('/admissions/letters', {
    applicationId: application.id,
    expectedVersion: application.version,
  }, { headers: { 'Idempotency-Key': requestKey('admission-loa') } })
}, `Letter of Acceptance ${application.registrationNumber} berhasil diterbitkan.`)

async function verifyLetter() {
  working.value = true
  errorMessage.value = ''
  try {
    const { data } = await $api.get<AdmissionLetterVerification>('/admissions/letters/verify', { params: { code: verificationCode.value.trim().toUpperCase() } })
    verification.value = data
  } catch (error) {
    errorMessage.value = readableError(error)
  } finally {
    working.value = false
  }
}

onMounted(loadWorkspace)
</script>

<template>
  <div class="page-stack">
    <AppPageHeader
      eyebrow="Penerimaan mahasiswa baru"
      title="Seleksi & Letter of Acceptance"
      description="Jadwalkan ruang dan penguji, cegah bentrok peserta, finalkan nilai immutable, lalu terbitkan LoA bernomor unik."
    >
      <template #actions>
        <NuxtLink class="btn btn-outline-secondary" to="/pmb/kelola">Kembali ke verifikasi</NuxtLink>
      </template>
    </AppPageHeader>

    <div v-if="errorMessage" class="alert alert-danger" role="alert">{{ errorMessage }}</div>
    <div v-if="noticeMessage" class="alert alert-success" role="status">{{ noticeMessage }}</div>
    <div v-if="loading" class="alert alert-info" role="status">Memuat workflow seleksi terbaru...</div>

    <section class="row g-4">
      <div class="col-12 col-xl-8">
        <article class="workflow-surface h-100">
          <header class="workflow-surface__header"><div><span class="section-kicker">Jadwal terkontrol</span><h2>Sesi seleksi</h2><p>Kapasitas dan jadwal peserta dikunci dalam transaksi yang sama.</p></div></header>
          <div class="table-responsive">
            <table class="table table-sm align-middle mb-0">
              <thead><tr><th>Sesi</th><th>Waktu</th><th>Lokasi</th><th>Peserta</th><th>Status</th></tr></thead>
              <tbody>
                <tr v-for="session in sessions" :key="session.id"><td><strong>{{ session.name }}</strong><small class="d-block text-muted">{{ session.kind }}</small></td><td>{{ formatDate(session.startsAt) }}</td><td>{{ session.location }}</td><td>{{ session.assignedCount }} / {{ session.capacity }}</td><td><StatusBadge status="active" :label="session.status" /></td></tr>
                <tr v-if="!sessions.length"><td colspan="5" class="text-center text-muted py-4">Belum ada sesi seleksi.</td></tr>
              </tbody>
            </table>
          </div>
        </article>
      </div>
      <div v-if="canManage" class="col-12 col-xl-4">
        <article class="workflow-surface h-100">
          <header class="workflow-surface__header"><div><span class="section-kicker">Panitia PMB</span><h2>Buat sesi</h2></div></header>
          <form class="workflow-surface__body d-grid gap-2" @submit.prevent="createSession">
            <label class="form-label">Nama<input v-model="sessionDraft.name" class="form-control" required maxlength="160"></label>
            <div class="row g-2"><label class="col form-label">Gelombang<select v-model="sessionDraft.waveId" class="form-select" required><option value="" disabled>Pilih gelombang</option><option v-for="wave in waves" :key="wave.id" :value="wave.id">{{ wave.label }} · {{ wave.academicYear }}</option></select></label><label class="col form-label">Program studi<select v-model="sessionDraft.programStudyId" class="form-select" required><option value="" disabled>Pilih program studi</option><option v-for="program in programs" :key="program.id" :value="program.id">{{ program.name }}</option></select></label></div>
            <div class="row g-2"><label class="col form-label">Mulai<input v-model="sessionDraft.startsAt" class="form-control" type="datetime-local" required></label><label class="col form-label">Selesai<input v-model="sessionDraft.endsAt" class="form-control" type="datetime-local" required></label></div>
            <label class="form-label">Lokasi<input v-model="sessionDraft.location" class="form-control" required maxlength="200"></label>
            <div class="row g-2"><label class="col form-label">Kapasitas<input v-model.number="sessionDraft.capacity" class="form-control" type="number" min="1" max="1000" required></label><label class="col form-label">Jenis<select v-model="sessionDraft.kind" class="form-select"><option>INTERVIEW</option><option>WRITTEN_EXAM</option><option>PORTFOLIO_REVIEW</option></select></label></div>
            <label class="form-label">UID penguji, pisahkan koma<input v-model="sessionDraft.examinerIds" class="form-control" required></label>
            <button class="btn btn-primary" type="submit" :disabled="working">Jadwalkan sesi</button>
          </form>
        </article>
      </div>
    </section>

    <section v-if="canManage" class="row g-4">
      <div class="col-12 col-lg-6">
        <article class="workflow-surface h-100"><header class="workflow-surface__header"><div><span class="section-kicker">Penempatan atomik</span><h2>Tempatkan peserta</h2></div></header><form class="workflow-surface__body d-grid gap-3" @submit.prevent="assignApplicant"><label class="form-label">Sesi<select v-model="selectedSessionId" class="form-select" required><option v-for="session in sessions" :key="session.id" :value="session.id">{{ session.name }} ({{ session.assignedCount }}/{{ session.capacity }})</option></select></label><label class="form-label">Pendaftar siap seleksi<select v-model="selectedApplicationId" class="form-select" required><option v-for="application in readyApplications" :key="application.id" :value="application.id">{{ application.registrationNumber }} - {{ application.fullName }}</option></select></label><button class="btn btn-primary" type="submit" :disabled="working || !selectedSessionId || !selectedApplicationId">Tempatkan peserta</button></form></article>
      </div>
      <div class="col-12 col-lg-6">
        <article class="workflow-surface h-100"><header class="workflow-surface__header"><div><span class="section-kicker">Snapshot penilaian</span><h2>Finalisasi nilai</h2></div></header><form class="workflow-surface__body d-grid gap-3" @submit.prevent="finalizeScore"><label class="form-label">Peserta<select v-model="selectedAssignmentId" class="form-select" required><option v-for="assignment in assignments.filter(item => item.status !== 'SCORED')" :key="assignment.id" :value="assignment.id">{{ assignment.registrationNumber }} - {{ assignment.applicantName }}</option></select></label><div class="row g-2"><label class="col form-label">Komunikasi /50<input v-model.number="scoreCommunication" class="form-control" type="number" min="0" max="50"></label><label class="col form-label">Motivasi /50<input v-model.number="scoreMotivation" class="form-control" type="number" min="0" max="50"></label></div><label class="form-label">Rekomendasi<select v-model="recommendation" class="form-select"><option>ACCEPT</option><option>WAITLIST</option><option>REJECT</option></select></label><button class="btn btn-primary" type="submit" :disabled="working || !selectedAssignment">Finalkan nilai</button></form></article>
      </div>
    </section>

    <section class="workflow-surface">
      <header class="workflow-surface__header"><div><span class="section-kicker">Dokumen penerimaan</span><h2>Letter of Acceptance</h2><p>Nomor dialokasikan atomik dan payload penerbitan memiliki hash immutable.</p></div></header>
      <div v-if="canManage && acceptedApplications.length" class="workflow-surface__body border-bottom"><div class="d-flex flex-wrap gap-2"><button v-for="application in acceptedApplications" :key="application.id" class="btn btn-sm btn-outline-primary" type="button" :disabled="working || letters.some(letter => letter.applicationId === application.id)" @click="issueLetter(application)">Terbitkan {{ application.registrationNumber }}</button></div></div>
      <div class="table-responsive"><table class="table table-sm align-middle mb-0"><thead><tr><th>Nomor</th><th>Pendaftar</th><th>Program</th><th>Terbit</th><th>Hash</th></tr></thead><tbody><tr v-for="letter in letters" :key="letter.id"><td><strong>{{ letter.documentNumber }}</strong></td><td>{{ letter.applicantName }}</td><td>{{ letter.programStudyName }}</td><td>{{ formatDate(letter.issuedAt) }}</td><td><code>{{ letter.contentHash.slice(0, 12) }}...</code></td></tr><tr v-if="!letters.length"><td colspan="5" class="text-center text-muted py-4">Belum ada LoA yang dapat ditampilkan.</td></tr></tbody></table></div>
      <form class="workflow-surface__body border-top" @submit.prevent="verifyLetter"><label class="form-label">Verifikasi kode LoA<div class="input-group"><input v-model="verificationCode" class="form-control" minlength="32" maxlength="32" placeholder="32 karakter heksadesimal"><button class="btn btn-outline-primary" type="submit" :disabled="working">Verifikasi</button></div></label><div v-if="verification" class="alert mt-3 mb-0" :class="verification.valid ? 'alert-success' : 'alert-warning'">{{ verification.valid ? `${verification.documentNumber} valid untuk ${verification.applicantName}.` : 'Kode tidak ditemukan atau dokumen tidak berlaku.' }}</div></form>
    </section>
  </div>
</template>

<style scoped src="~/pages/_workflow.css"></style>
<style scoped>
.workflow-surface .form-label { margin: 0; color: #50665d; font-size: .72rem; }
.workflow-surface .form-control,
.workflow-surface .form-select { margin-top: .3rem; }
.table th { color: #708078; font-size: .64rem; text-transform: uppercase; letter-spacing: .04em; }
.table td { color: #355048; font-size: .7rem; }
</style>
