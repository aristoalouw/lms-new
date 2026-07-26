<script setup lang="ts">
import type { AxiosError } from 'axios'
import type {
  TracerAccessView,
  TracerAnswer,
  TracerCareerData,
  TracerDistributionPeriod,
  TracerOutcomeReport,
  TracerOwnAssignment,
  TracerQuestionDefinition,
  TracerQuestionnaire,
  TracerRespondentMonitorItem,
  TracerSubmissionReceipt,
} from '~/server/types/tracer-study'

useHead({
  title: 'Tracer Study',
  meta: [
    { name: 'robots', content: 'noindex,nofollow,noarchive' },
    { name: 'referrer', content: 'no-referrer' },
  ],
})

const route = useRoute()
const { user } = useAuth()
const { $api } = useNuxtApp()

const activeRole = computed(() => user.value?.activeRole || '')
const isStudent = computed(() => activeRole.value === 'student')
const canManage = computed(() => ['student_affairs_staff', 'administrator'].includes(activeRole.value))
const canReport = computed(() => ['student_affairs_staff', 'leader', 'administrator'].includes(activeRole.value))
const publicToken = ref('')
const publicView = ref<TracerAccessView | null>(null)
const loading = ref(true)
const busy = ref(false)
const errorMessage = ref('')
const notice = ref('')
const activeTab = ref<'dashboard' | 'respondents' | 'setup'>('dashboard')

const assignments = ref<TracerOwnAssignment[]>([])
const selectedAssignment = ref<TracerOwnAssignment | null>(null)
const periods = ref<TracerDistributionPeriod[]>([])
const questionnaires = ref<TracerQuestionnaire[]>([])
const respondents = ref<TracerRespondentMonitorItem[]>([])
const report = ref<TracerOutcomeReport | null>(null)
const selectedPeriodId = ref('')
const groupBy = ref<'program' | 'graduation_year'>('program')

const answerValues = reactive<Record<string, string | number | boolean | string[] | undefined>>({})
const consentAccepted = ref(false)
const career = reactive<TracerCareerData>({ employmentStatus: 'EMPLOYED', waitMonths: 0, fieldAlignment: 4, incomeRange: '3M_TO_6M' })
const submissionReceipt = ref<TracerSubmissionReceipt | null>(null)
const withdrawalToken = ref('')

const questionnaireDraft = reactive({
  name: 'Tracer Study Outcome Lulusan',
  description: 'Kuesioner terstruktur untuk outcome pekerjaan, karier, kewirausahaan, dan studi lanjut.',
  programStudyId: user.value?.programStudyId || 'management-s1',
  questions: [
    { id: 'competency_fit', label: 'Seberapa sesuai kompetensi kuliah dengan kegiatan Anda saat ini?', type: 'SINGLE_CHOICE', required: true, options: [
      { value: 'LOW', label: 'Rendah' }, { value: 'MEDIUM', label: 'Sedang' }, { value: 'HIGH', label: 'Tinggi' },
    ] },
    { id: 'career_note', label: 'Catatan untuk peningkatan layanan karier kampus', type: 'TEXT', required: false },
  ] as TracerQuestionDefinition[],
})

const now = new Date()
const periodDraft = reactive({
  name: 'Tracer Study Alumni', questionnaireId: '', programStudyIds: [user.value?.programStudyId || 'management-s1'],
  graduationYearFrom: now.getFullYear() - 2, graduationYearTo: now.getFullYear() - 1,
  opensAt: '', closesAt: '', accessTokenTtlHours: 168, minimumCellSize: 3,
  consentVersion: `TRACER-CONSENT-${now.getFullYear()}-01`,
  consentNotice: 'Saya bersedia memberikan data outcome karier untuk statistik agregat kampus. Saya dapat menarik persetujuan dan data saya tidak lagi disertakan dalam pelaporan.',
})

const activeAccess = computed<TracerAccessView | TracerOwnAssignment | null>(() => publicView.value || selectedAssignment.value)
const activeQuestions = computed(() => activeAccess.value?.questionnaire.questions || [])
const selectedPeriod = computed(() => periods.value.find(period => period.id === selectedPeriodId.value))
const responseTotals = computed(() => respondents.value.reduce((totals, item) => {
  totals.total++
  if (item.status === 'RESPONDED') totals.responded++
  if (item.status === 'WITHDRAWN') totals.withdrawn++
  if (item.status === 'DELIVERY_FAILED') totals.failed++
  return totals
}, { total: 0, responded: 0, withdrawn: 0, failed: 0 }))

function requestKey(prefix: string) {
  return `${prefix}:${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`
}

function getError(error: unknown): string {
  const data = (error as AxiosError<{ statusMessage?: string; message?: string }>).response?.data
  return data?.statusMessage || data?.message || (error instanceof Error ? error.message : 'Permintaan tidak dapat diproses.')
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(value))
}

function localInput(value: Date) {
  return new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

function resetWindow() {
  const open = new Date()
  const close = new Date(open.getTime() + 30 * 86_400_000)
  periodDraft.opensAt = localInput(open)
  periodDraft.closesAt = localInput(close)
}

function periodStatus(period: TracerDistributionPeriod) {
  if (period.status === 'CLOSED' || Date.now() >= Date.parse(period.closesAt)) return 'Ditutup'
  if (period.status === 'DRAFT') return 'Draf'
  if (Date.now() < Date.parse(period.opensAt)) return 'Terjadwal'
  return 'Aktif'
}

function clearAnswers() {
  Object.keys(answerValues).forEach(key => delete answerValues[key])
  consentAccepted.value = false
  submissionReceipt.value = null
}

function answerText(questionId: string): string {
  const value = answerValues[questionId]
  return typeof value === 'string' ? value : ''
}

function answerNumber(questionId: string): number | undefined {
  const value = answerValues[questionId]
  return typeof value === 'number' ? value : undefined
}

function setText(questionId: string, event: Event) {
  answerValues[questionId] = (event.target as HTMLInputElement | HTMLTextAreaElement).value
}

function setNumber(questionId: string, event: Event) {
  const value = (event.target as HTMLInputElement).value
  answerValues[questionId] = value === '' ? undefined : Number(value)
}

function toggleMulti(questionId: string, value: string, checked: boolean) {
  const current = Array.isArray(answerValues[questionId]) ? answerValues[questionId] as string[] : []
  answerValues[questionId] = checked ? [...new Set([...current, value])] : current.filter(item => item !== value)
}

function selectAssignment(item: TracerOwnAssignment) {
  if (item.submitted) return
  selectedAssignment.value = item
  publicView.value = null
  clearAnswers()
}

async function resolvePublicAccess() {
  const queryToken = typeof route.query.access_token === 'string' ? route.query.access_token : ''
  const fragmentToken = import.meta.client
    ? new URLSearchParams(window.location.hash.replace(/^#/, '')).get('access_token') || ''
    : ''
  const token = fragmentToken || queryToken
  if (!token) return false
  publicToken.value = token
  if (import.meta.client) window.history.replaceState(window.history.state, '', route.path)
  const { data } = await $api.post<TracerAccessView>('/tracer-study/access/resolve', { accessToken: token })
  publicView.value = data
  return true
}

async function loadManagement() {
  const requests: Promise<unknown>[] = []
  requests.push($api.get<{ periods: TracerDistributionPeriod[] }>('/tracer-study/periods').then(({ data }) => {
    periods.value = data.periods
    if (!periods.value.some(period => period.id === selectedPeriodId.value)) selectedPeriodId.value = periods.value[0]?.id || ''
  }))
  if (canManage.value) requests.push($api.get<{ questionnaires: TracerQuestionnaire[] }>('/tracer-study/questionnaires').then(({ data }) => {
    questionnaires.value = data.questionnaires
    if (!questionnaires.value.some(item => item.id === periodDraft.questionnaireId)) periodDraft.questionnaireId = questionnaires.value[0]?.id || ''
  }))
  await Promise.all(requests)
  await refreshPeriodData()
}

async function refreshPeriodData() {
  if (!selectedPeriodId.value) { report.value = null; respondents.value = []; return }
  const tasks: Promise<unknown>[] = []
  if (canReport.value) tasks.push($api.get<TracerOutcomeReport>('/tracer-study/reports', { params: { periodId: selectedPeriodId.value, groupBy: groupBy.value } }).then(({ data }) => { report.value = data }))
  if (canManage.value) tasks.push($api.get<{ respondents: TracerRespondentMonitorItem[] }>('/tracer-study/respondents', { params: { periodId: selectedPeriodId.value } }).then(({ data }) => { respondents.value = data.respondents }))
  await Promise.all(tasks)
}

async function initialize() {
  loading.value = true
  errorMessage.value = ''
  try {
    if (await resolvePublicAccess()) return
    if (isStudent.value) {
      const { data } = await $api.get<{ assignments: TracerOwnAssignment[] }>('/tracer-study/assignments')
      assignments.value = data.assignments
    } else if (canReport.value) await loadManagement()
  } catch (error) {
    errorMessage.value = getError(error)
  } finally {
    loading.value = false
  }
}

async function submitResponse() {
  const access = activeAccess.value
  if (!access || busy.value) return
  const answers: TracerAnswer[] = activeQuestions.value.flatMap((question) => {
    const value = answerValues[question.id]
    return value === undefined || value === '' || (Array.isArray(value) && !value.length) ? [] : [{ questionId: question.id, value }]
  })
  busy.value = true
  errorMessage.value = ''
  try {
    const payload = {
      ...(publicToken.value ? { accessToken: publicToken.value } : { recipientId: selectedAssignment.value?.recipientId }),
      consentAccepted: consentAccepted.value, consentVersion: access.period.consentVersion,
      career: { ...career }, answers,
    }
    const { data } = await $api.post<TracerSubmissionReceipt>('/tracer-study/responses', payload, { headers: { 'Idempotency-Key': requestKey('tracer-submit') } })
    submissionReceipt.value = data
    withdrawalToken.value = data.withdrawalToken || ''
    if (withdrawalToken.value && import.meta.client) sessionStorage.setItem(`tracer-withdrawal:${data.receiptId}`, withdrawalToken.value)
    publicToken.value = ''
    notice.value = 'Respons tersimpan. Data hanya digunakan untuk statistik deskriptif agregat.'
    if (isStudent.value) {
      const refreshed = await $api.get<{ assignments: TracerOwnAssignment[] }>('/tracer-study/assignments')
      assignments.value = refreshed.data.assignments
    }
  } catch (error) {
    errorMessage.value = getError(error)
  } finally {
    busy.value = false
  }
}

async function withdrawSubmission() {
  if (!submissionReceipt.value || !withdrawalToken.value || busy.value) return
  busy.value = true
  try {
    await $api.post('/tracer-study/responses/withdraw', { withdrawalToken: withdrawalToken.value, expectedConsentVersion: 1 }, { headers: { 'Idempotency-Key': requestKey('tracer-withdraw') } })
    notice.value = 'Persetujuan ditarik. Isi respons telah dikeluarkan dari pelaporan dan dibersihkan.'
    withdrawalToken.value = ''
  } catch (error) {
    errorMessage.value = getError(error)
  } finally { busy.value = false }
}

async function saveQuestionnaire() {
  if (busy.value) return
  busy.value = true
  try {
    await $api.post('/tracer-study/questionnaires', questionnaireDraft, { headers: { 'Idempotency-Key': requestKey('tracer-questionnaire') } })
    notice.value = 'Versi pertama kuesioner dibuat dan siap dipakai pada periode.'
    await loadManagement()
  } catch (error) { errorMessage.value = getError(error) } finally { busy.value = false }
}

function addQuestion() {
  const sequence = questionnaireDraft.questions.length + 1
  questionnaireDraft.questions.push({ id: `question_${sequence}`, label: 'Pertanyaan baru', type: 'TEXT', required: false })
}

async function savePeriod() {
  const questionnaire = questionnaires.value.find(item => item.id === periodDraft.questionnaireId)
  if (!questionnaire || busy.value) return
  busy.value = true
  try {
    await $api.post('/tracer-study/periods', {
      ...periodDraft, questionnaireVersion: questionnaire.currentVersion,
      opensAt: new Date(periodDraft.opensAt).toISOString(), closesAt: new Date(periodDraft.closesAt).toISOString(),
    }, { headers: { 'Idempotency-Key': requestKey('tracer-period') } })
    notice.value = 'Periode disimpan sebagai draf. Aktifkan setelah konfigurasi ditinjau.'
    await loadManagement()
  } catch (error) { errorMessage.value = getError(error) } finally { busy.value = false }
}

async function transitionPeriod(period: TracerDistributionPeriod, status: TracerDistributionPeriod['status']) {
  if (busy.value) return
  busy.value = true
  try {
    const { data } = await $api.put<{ period: TracerDistributionPeriod }>(`/tracer-study/periods/${period.id}`, {
      expectedVersion: period.version, name: period.name, programStudyIds: period.programStudyIds,
      graduationYearFrom: period.graduationYearFrom, graduationYearTo: period.graduationYearTo,
      opensAt: period.opensAt, closesAt: period.closesAt, accessTokenTtlHours: period.accessTokenTtlHours,
      minimumCellSize: period.minimumCellSize, consentVersion: period.consentVersion, consentNotice: period.consentNotice, status,
    })
    periods.value = periods.value.map(item => item.id === period.id ? data.period : item)
    notice.value = `Status periode berubah menjadi ${status}.`
  } catch (error) { errorMessage.value = getError(error) } finally { busy.value = false }
}

async function sendCampaign(kind: 'INITIAL' | 'REMINDER') {
  if (!selectedPeriodId.value || busy.value) return
  busy.value = true
  try {
    const reminderSequence = kind === 'REMINDER' ? 1 : undefined
    await $api.post('/tracer-study/campaigns', { periodId: selectedPeriodId.value, kind, reminderSequence }, { headers: { 'Idempotency-Key': requestKey(`tracer-${kind.toLowerCase()}`) } })
    notice.value = kind === 'INITIAL' ? 'Undangan diproses untuk alumni yang memenuhi syarat.' : 'Reminder diproses tanpa menghubungi alumni yang sudah merespons.'
    await refreshPeriodData()
  } catch (error) { errorMessage.value = getError(error) } finally { busy.value = false }
}

function downloadReport() {
  if (!selectedPeriodId.value || !import.meta.client) return
  const params = new URLSearchParams({ periodId: selectedPeriodId.value, groupBy: groupBy.value })
  window.location.assign(`/api/tracer-study/reports/export?${params}`)
}

watch([selectedPeriodId, groupBy], () => {
  if (!loading.value && canReport.value) refreshPeriodData().catch(error => { errorMessage.value = getError(error) })
})

resetWindow()
onMounted(initialize)
</script>

<template>
  <div class="tracer-page">
    <AppPageHeader eyebrow="Alumni & outcome" title="Tracer Study" description="Kelola distribusi aman, persetujuan alumni, outcome karier, dan statistik deskriptif yang menjaga privasi.">
      <template #actions>
        <button v-if="canManage && !publicView" class="btn btn-outline-secondary" type="button" @click="activeTab = 'setup'"><i class="uil uil-setting me-2" />Konfigurasi</button>
        <button v-if="canReport && !publicView" class="btn btn-primary" type="button" @click="downloadReport"><i class="uil uil-file-download me-2" />Ekspor agregat</button>
      </template>
    </AppPageHeader>

    <div v-if="errorMessage" class="alert alert-danger" role="alert">{{ errorMessage }}</div>
    <div v-if="notice" class="alert alert-success" role="status">{{ notice }}</div>
    <div v-if="loading" class="tracer-loading"><span class="spinner-border spinner-border-sm" />Memuat data tracer study…</div>

    <template v-else-if="activeAccess && !submissionReceipt">
      <section class="respondent-hero">
        <div class="respondent-hero__icon"><i class="uil uil-briefcase-alt" /></div>
        <div><span>Kuesioner alumni</span><h2>{{ activeAccess.period.name }}</h2><p>Isi sampai {{ formatDate(activeAccess.period.closesAt) }}. Tautan dan respons hanya berlaku untuk satu alumni.</p></div>
        <strong>{{ activeQuestions.length }} pertanyaan</strong>
      </section>

      <section v-if="activeAccess.skpiReferences.length" class="skpi-strip">
        <i class="uil uil-award" /><div><strong>SKPI sudah diterbitkan</strong><span v-for="reference in activeAccess.skpiReferences" :key="reference.documentId">
          <a v-if="reference.href" :href="reference.href">{{ reference.documentNumber }}</a><template v-else>{{ reference.documentNumber }}</template> · {{ formatDate(reference.issuedAt) }}
        </span></div>
      </section>

      <form class="response-grid" @submit.prevent="submitResponse">
        <section class="response-card career-card">
          <header><span>01</span><div><h3>Outcome pekerjaan & karier</h3><p>Kolom terstruktur dipakai untuk statistik deskriptif.</p></div></header>
          <div class="career-fields">
            <label><span>Status saat ini *</span><select v-model="career.employmentStatus" class="form-select" required><option value="EMPLOYED">Bekerja</option><option value="ENTREPRENEUR">Berwirausaha</option><option value="FURTHER_STUDY">Studi lanjut</option><option value="SEEKING_WORK">Mencari kerja</option><option value="NOT_WORKING">Belum bekerja</option></select></label>
            <label v-if="['EMPLOYED','ENTREPRENEUR'].includes(career.employmentStatus)"><span>Masa tunggu (bulan) *</span><input v-model.number="career.waitMonths" class="form-control" type="number" min="0" max="120" required></label>
            <label><span>Kesesuaian bidang (1–5)</span><input v-model.number="career.fieldAlignment" class="form-control" type="number" min="1" max="5"></label>
            <label><span>Rentang pendapatan</span><select v-model="career.incomeRange" class="form-select"><option value="UNDISCLOSED">Tidak menyebutkan</option><option value="BELOW_3M">Di bawah Rp3 juta</option><option value="3M_TO_6M">Rp3–6 juta</option><option value="6M_TO_10M">Rp6–10 juta</option><option value="ABOVE_10M">Di atas Rp10 juta</option></select></label>
            <label><span>Sektor organisasi</span><input v-model="career.employerSector" class="form-control" maxlength="200" placeholder="Swasta, pemerintah, nirlaba…"></label>
            <label><span>Lokasi kegiatan</span><input v-model="career.workLocation" class="form-control" maxlength="200" placeholder="Kota / negara"></label>
          </div>
        </section>

        <section class="response-card questions-card">
          <header><span>02</span><div><h3>{{ activeAccess.questionnaire.name }}</h3><p>{{ activeAccess.questionnaire.description }}</p></div></header>
          <ol class="question-list">
            <li v-for="(question,index) in activeQuestions" :key="question.id">
              <div class="question-copy"><span>{{ index + 1 }}</span><div><strong>{{ question.label }} <em v-if="question.required">wajib</em></strong><small v-if="question.helpText">{{ question.helpText }}</small></div></div>
              <textarea v-if="question.type === 'TEXT'" class="form-control" rows="3" maxlength="2000" :required="question.required" :value="answerText(question.id)" @input="setText(question.id, $event)" />
              <input v-else-if="question.type === 'NUMBER'" class="form-control" type="number" :min="question.minimum" :max="question.maximum" :required="question.required" :value="answerNumber(question.id)" @input="setNumber(question.id, $event)">
              <div v-else-if="question.type === 'BOOLEAN'" class="choice-row"><label><input v-model="answerValues[question.id]" type="radio" :name="question.id" :value="true" :required="question.required"><span>Ya</span></label><label><input v-model="answerValues[question.id]" type="radio" :name="question.id" :value="false"><span>Tidak</span></label></div>
              <div v-else-if="question.type === 'SINGLE_CHOICE'" class="choice-row"><label v-for="option in question.options" :key="option.value"><input v-model="answerValues[question.id]" type="radio" :name="question.id" :value="option.value" :required="question.required"><span>{{ option.label }}</span></label></div>
              <div v-else class="choice-row"><label v-for="option in question.options" :key="option.value"><input type="checkbox" :checked="Array.isArray(answerValues[question.id]) && (answerValues[question.id] as string[]).includes(option.value)" @change="toggleMulti(question.id, option.value, ($event.target as HTMLInputElement).checked)"><span>{{ option.label }}</span></label></div>
            </li>
          </ol>
        </section>

        <section class="consent-card">
          <i class="uil uil-shield-check" /><div><strong>Persetujuan penggunaan data</strong><p>{{ activeAccess.period.consentNotice }}</p><small>Versi {{ activeAccess.period.consentVersion }}</small></div>
          <label class="form-check"><input v-model="consentAccepted" class="form-check-input" type="checkbox" required><span class="form-check-label">Saya memahami dan memberikan persetujuan secara sukarela.</span></label>
        </section>
        <div class="response-actions"><button v-if="selectedAssignment" class="btn btn-outline-secondary" type="button" @click="selectedAssignment = null">Kembali</button><button class="btn btn-primary" type="submit" :disabled="busy || !consentAccepted"><span v-if="busy" class="spinner-border spinner-border-sm me-2" />Kirim respons</button></div>
      </form>
    </template>

    <section v-else-if="submissionReceipt" class="receipt-card">
      <span class="receipt-card__icon"><i class="uil uil-check" /></span><h2>Respons berhasil diterima</h2><p>Terima kasih. Kampus hanya menampilkan outcome dalam kelompok agregat yang memenuhi batas minimum.</p><code>{{ submissionReceipt.receiptId }}</code>
      <div class="receipt-card__actions"><button class="btn btn-outline-danger" type="button" :disabled="busy || !withdrawalToken" @click="withdrawSubmission">Tarik persetujuan</button><button class="btn btn-primary" type="button" @click="submissionReceipt = null; publicView = null; selectedAssignment = null">Selesai</button></div>
    </section>

    <template v-else-if="isStudent">
      <section class="privacy-banner"><i class="uil uil-user-check" /><div><strong>Akses alumni milik Anda</strong><p>Respons, status persetujuan, dan referensi SKPI hanya ditampilkan kepada pemilik akun.</p></div></section>
      <section class="assignment-grid">
        <article v-for="item in assignments" :key="item.recipientId"><div class="assignment-icon"><i class="uil uil-clipboard-alt" /></div><div><span>{{ item.recipientStatus }}</span><h3>{{ item.period.name }}</h3><p>Batas {{ formatDate(item.period.closesAt) }}</p><div v-if="item.skpiReferences.length" class="skpi-mini"><i class="uil uil-award" />{{ item.skpiReferences.length }} SKPI terbit</div></div><button class="btn btn-sm" :class="item.submitted ? 'btn-outline-secondary' : 'btn-primary'" :disabled="item.submitted" @click="selectAssignment(item)">{{ item.submitted ? 'Sudah selesai' : 'Isi sekarang' }}</button></article>
        <div v-if="!assignments.length" class="empty-state"><i class="uil uil-inbox" /><strong>Belum ada tracer study</strong><p>Undangan yang memenuhi kelayakan akan muncul di sini.</p></div>
      </section>
    </template>

    <template v-else-if="canReport">
      <nav class="tracer-tabs"><button :class="{ active: activeTab === 'dashboard' }" @click="activeTab = 'dashboard'"><i class="uil uil-chart-pie" />Outcome</button><button v-if="canManage" :class="{ active: activeTab === 'respondents' }" @click="activeTab = 'respondents'"><i class="uil uil-users-alt" />Responden</button><button v-if="canManage" :class="{ active: activeTab === 'setup' }" @click="activeTab = 'setup'"><i class="uil uil-setting" />Konfigurasi</button></nav>
      <div class="management-toolbar"><label><span>Periode</span><select v-model="selectedPeriodId" class="form-select"><option v-for="period in periods" :key="period.id" :value="period.id">{{ period.name }}</option></select></label><label v-if="activeTab === 'dashboard'"><span>Kelompok</span><select v-model="groupBy" class="form-select"><option value="program">Program studi</option><option value="graduation_year">Tahun lulus</option></select></label><div v-if="canManage && selectedPeriod"><button class="btn btn-outline-secondary" :disabled="busy || selectedPeriod.status !== 'ACTIVE'" @click="sendCampaign('REMINDER')"><i class="uil uil-bell me-2" />Reminder</button><button class="btn btn-primary" :disabled="busy || selectedPeriod.status !== 'ACTIVE'" @click="sendCampaign('INITIAL')"><i class="uil uil-envelope-send me-2" />Kirim undangan</button></div></div>

      <template v-if="activeTab === 'dashboard'">
        <section class="metric-grid"><article><i class="uil uil-users-alt" /><span>Terpantau</span><strong>{{ responseTotals.total }}</strong><small>identitas hanya untuk staf</small></article><article><i class="uil uil-check-circle" /><span>Merespons</span><strong>{{ responseTotals.responded }}</strong><small>persetujuan aktif</small></article><article><i class="uil uil-shield-slash" /><span>Ditarik</span><strong>{{ responseTotals.withdrawn }}</strong><small>dikeluarkan dari agregat</small></article><article><i class="uil uil-layer-group" /><span>Batas sel</span><strong>{{ report?.confidentiality.minimumCellSize || selectedPeriod?.minimumCellSize || 3 }}</strong><small>kelompok kecil disamarkan</small></article></section>
        <section class="outcome-panel"><header><div><span class="section-kicker">Statistik deskriptif</span><h2>Outcome lulusan</h2><p>Tanpa prediksi, klasifikasi, AI, atau isi jawaban bebas.</p></div><span class="method-chip">DESCRIPTIVE ONLY</span></header><div class="outcome-groups"><article v-for="group in report?.groups" :key="group.key" :class="{ suppressed: group.suppressed }"><header><div><small>{{ report?.groupBy === 'program' ? 'Program studi' : 'Tahun lulus' }}</small><h3>{{ group.label }}</h3></div><strong>{{ group.responseCount ?? '—' }}</strong></header><div v-if="group.suppressed" class="suppression"><i class="uil uil-lock" /><p>Sel disamarkan karena belum memenuhi batas minimum.</p></div><div v-else class="outcome-detail"><div><span>Rata-rata masa tunggu</span><strong>{{ group.averageWaitMonths ?? '—' }} bulan</strong></div><div><span>Kesesuaian bidang</span><strong>{{ group.averageFieldAlignment ?? '—' }} / 5</strong></div><ul><li v-for="(value,key) in group.employmentStatus" :key="key"><span>{{ key }}</span><strong>{{ value?.percent }}%</strong></li></ul></div></article><div v-if="!report?.groups.length" class="empty-state"><i class="uil uil-chart" /><strong>Belum ada sel agregat</strong><p>Outcome muncul setelah respons memenuhi batas minimum.</p></div></div></section>
      </template>

      <section v-else-if="activeTab === 'respondents'" class="respondent-panel"><header><div><span class="section-kicker">Status operasional</span><h2>Monitoring responden</h2><p>Tidak ada jawaban atau data karier individual pada tabel ini.</p></div></header><div class="table-responsive"><table><thead><tr><th>Alumni</th><th>Program / lulus</th><th>Status</th><th>Kontak terakhir</th><th>Persetujuan</th><th>SKPI</th></tr></thead><tbody><tr v-for="item in respondents" :key="item.recipientId"><td><strong>{{ item.displayName }}</strong><small>{{ item.studentNumber }} · {{ item.maskedEmail }}</small></td><td>{{ item.programStudyName }}<small>{{ item.graduationYear }}</small></td><td><span class="status-pill">{{ item.status }}</span></td><td>{{ item.lastContactAt ? formatDate(item.lastContactAt) : 'Belum dihubungi' }}</td><td>{{ item.consentStatus }}</td><td>{{ item.skpiReferences.length ? `${item.skpiReferences.length} terbit` : '—' }}</td></tr></tbody></table></div></section>

      <div v-else class="setup-layout">
        <section class="setup-card"><header><span class="section-kicker">Versi kuesioner</span><h2>Buat kuesioner</h2><p>Setiap perubahan menghasilkan definisi versi baru yang tidak mengubah periode lama.</p></header><div class="setup-body"><label><span>Nama</span><input v-model="questionnaireDraft.name" class="form-control"></label><label><span>Deskripsi</span><textarea v-model="questionnaireDraft.description" class="form-control" rows="2" /></label><div class="question-builder"><article v-for="(question,index) in questionnaireDraft.questions" :key="question.id"><span>{{ index + 1 }}</span><div><input v-model="question.label" class="form-control"><select v-model="question.type" class="form-select"><option value="TEXT">Teks</option><option value="NUMBER">Angka</option><option value="BOOLEAN">Ya/tidak</option><option value="SINGLE_CHOICE">Pilihan tunggal</option><option value="MULTI_CHOICE">Pilihan jamak</option></select><label class="form-check"><input v-model="question.required" class="form-check-input" type="checkbox">Wajib</label></div></article><button class="btn btn-sm btn-outline-secondary" type="button" @click="addQuestion">Tambah pertanyaan</button></div></div><footer><span>{{ questionnaireDraft.questions.length }} pertanyaan</span><button class="btn btn-primary" :disabled="busy" @click="saveQuestionnaire">Simpan versi</button></footer></section>
        <section class="setup-card"><header><span class="section-kicker">Distribusi & privasi</span><h2>Buat periode</h2><p>Target alumni diverifikasi kembali di server sebelum email dikirim.</p></header><div class="setup-body period-fields"><label><span>Nama periode</span><input v-model="periodDraft.name" class="form-control"></label><label><span>Kuesioner</span><select v-model="periodDraft.questionnaireId" class="form-select"><option v-for="item in questionnaires" :key="item.id" :value="item.id">{{ item.name }} · v{{ item.currentVersion }}</option></select></label><label><span>Dibuka</span><input v-model="periodDraft.opensAt" class="form-control" type="datetime-local"></label><label><span>Ditutup</span><input v-model="periodDraft.closesAt" class="form-control" type="datetime-local"></label><label><span>Tahun lulus awal</span><input v-model.number="periodDraft.graduationYearFrom" class="form-control" type="number"></label><label><span>Tahun lulus akhir</span><input v-model.number="periodDraft.graduationYearTo" class="form-control" type="number"></label><label><span>TTL tautan (jam)</span><input v-model.number="periodDraft.accessTokenTtlHours" class="form-control" type="number" min="1" max="720"></label><label><span>Batas minimum sel</span><input v-model.number="periodDraft.minimumCellSize" class="form-control" type="number" min="3" max="50"></label><label class="full"><span>Pemberitahuan persetujuan</span><textarea v-model="periodDraft.consentNotice" class="form-control" rows="4" /></label></div><footer><span>Token mentah tidak disimpan</span><button class="btn btn-primary" :disabled="busy || !periodDraft.questionnaireId" @click="savePeriod">Simpan draf</button></footer></section>
        <section class="setup-card period-list"><header><span class="section-kicker">Periode tersimpan</span><h2>Aktivasi & penutupan</h2></header><div class="period-rows"><article v-for="period in periods" :key="period.id"><div><span>{{ periodStatus(period) }}</span><strong>{{ period.name }}</strong><small>{{ formatDate(period.opensAt) }} – {{ formatDate(period.closesAt) }} · v{{ period.version }}</small></div><button v-if="period.status === 'DRAFT'" class="btn btn-sm btn-outline-success" :disabled="busy" @click="transitionPeriod(period, 'ACTIVE')">Aktifkan</button><button v-else-if="period.status === 'ACTIVE'" class="btn btn-sm btn-outline-secondary" :disabled="busy" @click="transitionPeriod(period, 'CLOSED')">Tutup</button></article></div></section>
      </div>
    </template>

    <section v-else class="empty-state"><i class="uil uil-lock" /><strong>Akses tidak tersedia</strong><p>Masuk sebagai alumni, staf kemahasiswaan, pimpinan, atau administrator.</p></section>
  </div>
</template>

<style scoped>
.tracer-page { display: grid; gap: 1.25rem; }.tracer-loading { display: flex; gap: .65rem; align-items: center; justify-content: center; min-height: 280px; color: #6d7e77; }.respondent-hero { display: grid; grid-template-columns: auto 1fr auto; gap: 1rem; align-items: center; padding: 1.3rem; border-radius: 1rem; color: white; background: linear-gradient(120deg,#123e32,#2f735b); }.respondent-hero__icon { display: grid; place-items: center; width: 3.2rem; height: 3.2rem; border-radius: .85rem; background: rgba(255,255,255,.12); font-size: 1.35rem; }.respondent-hero span,.respondent-hero p { color: rgba(255,255,255,.68); font-size: .68rem; }.respondent-hero h2 { margin: .16rem 0; font-size: 1.05rem; }.respondent-hero p { margin: 0; }.respondent-hero > strong { padding: .45rem .65rem; border-radius: .55rem; background: rgba(255,255,255,.1); font-size: .72rem; }.skpi-strip,.privacy-banner { display: flex; gap: .8rem; align-items: flex-start; padding: .9rem 1rem; border: 1px solid #d7e6dc; border-radius: .85rem; color: #426557; background: #f2f8f4; }.skpi-strip > i,.privacy-banner > i { font-size: 1.2rem; }.skpi-strip strong,.skpi-strip span,.privacy-banner strong,.privacy-banner p { display: block; }.skpi-strip strong,.privacy-banner strong { font-size: .74rem; }.skpi-strip span,.privacy-banner p { margin: .15rem 0 0; color: #71847b; font-size: .65rem; }.skpi-strip a { color: #326d56; font-weight: 750; }.response-grid { display: grid; gap: 1rem; }.response-card,.consent-card,.receipt-card,.outcome-panel,.respondent-panel,.setup-card { overflow: hidden; border: 1px solid #e0e8e3; border-radius: 1rem; background: #fff; }.response-card > header { display: flex; gap: .75rem; padding: 1rem 1.1rem; border-bottom: 1px solid #edf1ee; }.response-card > header > span { display: grid; place-items: center; width: 2rem; height: 2rem; border-radius: .6rem; color: #376854; background: #edf5ef; font-size: .62rem; font-weight: 800; }.response-card h3 { margin: 0; color: #2e4b41; font-size: .84rem; }.response-card p { margin: .2rem 0 0; color: #84918c; font-size: .64rem; }.career-fields { display: grid; grid-template-columns: repeat(2,1fr); gap: .8rem; padding: 1rem 1.1rem; }.career-fields label > span,.setup-body label > span { display: block; margin-bottom: .3rem; color: #6d7e77; font-size: .62rem; font-weight: 750; }.career-fields .form-control,.career-fields .form-select,.setup-body .form-control,.setup-body .form-select { border-color: #dbe4df; font-size: .68rem; }.question-list { display: grid; gap: .75rem; margin: 0; padding: 1rem 1.1rem; list-style: none; }.question-list li { padding: .85rem; border: 1px solid #e3eae6; border-radius: .75rem; }.question-copy { display: flex; gap: .6rem; margin-bottom: .7rem; }.question-copy > span { display: grid; place-items: center; flex: 0 0 auto; width: 1.6rem; height: 1.6rem; border-radius: .45rem; color: #41715d; background: #edf4f0; font-size: .56rem; font-weight: 800; }.question-copy strong { color: #39554b; font-size: .67rem; }.question-copy em { margin-left: .3rem; color: #9a622d; font-size: .49rem; font-style: normal; text-transform: uppercase; }.question-copy small { display: block; margin-top: .15rem; color: #899690; font-size: .58rem; }.question-list .form-control { border-color: #dbe4df; font-size: .66rem; }.choice-row { display: flex; flex-wrap: wrap; gap: .45rem; }.choice-row label input { position: absolute; opacity: 0; }.choice-row label span { display: block; padding: .45rem .65rem; border: 1px solid #dce5e0; border-radius: .55rem; color: #61756d; font-size: .62rem; cursor: pointer; }.choice-row label:has(input:checked) span { border-color: #477b65; color: #2e614b; background: #edf6f0; }.consent-card { display: grid; grid-template-columns: auto 1fr; gap: .8rem; padding: 1rem 1.1rem; color: #3c6654; background: #f4f9f5; }.consent-card > i { font-size: 1.25rem; }.consent-card strong { font-size: .72rem; }.consent-card p { margin: .2rem 0; color: #6e8178; font-size: .64rem; line-height: 1.55; }.consent-card small { color: #8a9892; font-size: .55rem; }.consent-card .form-check { grid-column: 2; font-size: .64rem; }.response-actions { display: flex; gap: .6rem; justify-content: flex-end; }.receipt-card { display: grid; justify-items: center; padding: 2.5rem 1rem; text-align: center; }.receipt-card__icon { display: grid; place-items: center; width: 4rem; height: 4rem; border-radius: 50%; color: white; background: #3f7d62; font-size: 1.8rem; }.receipt-card h2 { margin: 1rem 0 .4rem; color: #2e4c41; font-size: 1.05rem; }.receipt-card p { max-width: 550px; color: #7c8c85; font-size: .7rem; }.receipt-card code { padding: .4rem .65rem; border-radius: .5rem; color: #416355; background: #eef3f0; font-size: .6rem; }.receipt-card__actions { display: flex; gap: .6rem; margin-top: 1.2rem; }.assignment-grid { display: grid; gap: .75rem; }.assignment-grid article { display: grid; grid-template-columns: auto 1fr auto; gap: .8rem; align-items: center; padding: 1rem; border: 1px solid #e1e8e4; border-radius: .85rem; background: white; }.assignment-icon { display: grid; place-items: center; width: 2.7rem; height: 2.7rem; border-radius: .7rem; color: #3f745e; background: #edf5ef; }.assignment-grid span { color: #668177; font-size: .53rem; font-weight: 800; text-transform: uppercase; }.assignment-grid h3 { margin: .12rem 0; color: #324f45; font-size: .78rem; }.assignment-grid p,.skpi-mini { margin: 0; color: #84938d; font-size: .6rem; }.skpi-mini { margin-top: .25rem; color: #6e5d2f; }.empty-state { display: grid; justify-items: center; grid-column: 1/-1; padding: 2rem; color: #81908a; text-align: center; }.empty-state i { font-size: 1.7rem; }.empty-state strong { margin-top: .4rem; color: #50665d; font-size: .75rem; }.empty-state p { margin: .2rem 0 0; font-size: .64rem; }.tracer-tabs { display: flex; gap: .3rem; padding: .35rem; border: 1px solid #e1e8e4; border-radius: .8rem; background: #f5f8f6; }.tracer-tabs button { display: flex; gap: .4rem; align-items: center; padding: .55rem .8rem; border: 0; border-radius: .55rem; color: #71827b; background: transparent; font-size: .67rem; font-weight: 750; }.tracer-tabs button.active { color: #28503f; background: white; box-shadow: 0 2px 8px rgba(25,60,48,.08); }.management-toolbar { display: flex; gap: .8rem; align-items: flex-end; padding: 1rem; border: 1px solid #e1e8e4; border-radius: .9rem; background: white; }.management-toolbar label span { display: block; margin-bottom: .25rem; color: #778780; font-size: .6rem; font-weight: 750; }.management-toolbar .form-select { min-width: 190px; border-color: #dbe4df; font-size: .66rem; }.management-toolbar > div { display: flex; gap: .5rem; margin-left: auto; }.metric-grid { display: grid; grid-template-columns: repeat(4,1fr); gap: .75rem; }.metric-grid article { padding: .9rem; border: 1px solid #e1e8e4; border-radius: .8rem; background: white; }.metric-grid i { color: #4e7b68; }.metric-grid span,.metric-grid strong,.metric-grid small { display: block; }.metric-grid span { margin-top: .5rem; color: #7c8c85; font-size: .58rem; text-transform: uppercase; }.metric-grid strong { color: #2f5144; font-size: 1.25rem; }.metric-grid small { color: #8c9994; font-size: .54rem; }.outcome-panel > header,.respondent-panel > header,.setup-card > header { display: flex; justify-content: space-between; gap: 1rem; padding: 1rem 1.1rem; border-bottom: 1px solid #edf1ee; }.section-kicker { display: block; color: #608175; font-size: .56rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }.outcome-panel h2,.respondent-panel h2,.setup-card h2 { margin: .15rem 0 0; color: #2e4c41; font-size: .84rem; }.outcome-panel header p,.respondent-panel header p,.setup-card header p { margin: .2rem 0 0; color: #83918c; font-size: .62rem; }.method-chip { align-self: flex-start; padding: .35rem .5rem; border-radius: .45rem; color: #3f6d59; background: #edf5ef; font-size: .52rem; font-weight: 800; }.outcome-groups { display: grid; grid-template-columns: repeat(2,1fr); gap: .75rem; padding: 1rem; }.outcome-groups > article { border: 1px solid #e2e9e5; border-radius: .75rem; }.outcome-groups > article > header { display: flex; justify-content: space-between; padding: .75rem; border-bottom: 1px solid #edf1ee; }.outcome-groups small { color: #87958f; font-size: .53rem; }.outcome-groups h3 { margin: .12rem 0 0; color: #38564b; font-size: .72rem; }.outcome-groups header > strong { color: #36614f; font-size: 1rem; }.suppression { display: flex; gap: .6rem; padding: .8rem; color: #876b35; background: #fffaf1; }.suppression p { margin: 0; font-size: .6rem; }.outcome-detail { display: grid; grid-template-columns: 1fr 1fr; gap: .6rem; padding: .75rem; }.outcome-detail > div { padding: .55rem; border-radius: .55rem; background: #f6f9f7; }.outcome-detail span,.outcome-detail strong { display: block; }.outcome-detail span { color: #82908a; font-size: .54rem; }.outcome-detail strong { margin-top: .15rem; color: #35574a; font-size: .66rem; }.outcome-detail ul { grid-column: 1/-1; display: grid; gap: .35rem; margin: 0; padding: 0; list-style: none; }.outcome-detail li { display: flex; justify-content: space-between; color: #667a72; font-size: .58rem; }.respondent-panel table { width: 100%; min-width: 820px; border-collapse: collapse; }.respondent-panel th { padding: .65rem .8rem; color: #7c8b85; background: #f7faf8; font-size: .53rem; text-align: left; text-transform: uppercase; }.respondent-panel td { padding: .7rem .8rem; border-top: 1px solid #edf1ee; color: #5e746a; font-size: .6rem; }.respondent-panel td strong,.respondent-panel td small { display: block; }.respondent-panel td strong { color: #38554a; }.respondent-panel td small { margin-top: .12rem; color: #899690; font-size: .53rem; }.status-pill { padding: .25rem .4rem; border-radius: 999px; color: #3d6b58; background: #edf5ef; font-size: .51rem; font-weight: 800; }.setup-layout { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }.setup-body { display: grid; gap: .7rem; padding: 1rem; }.question-builder { display: grid; gap: .55rem; }.question-builder article { display: grid; grid-template-columns: auto 1fr; gap: .55rem; padding: .65rem; border: 1px solid #e3eae6; border-radius: .65rem; }.question-builder article > span { display: grid; place-items: center; width: 1.6rem; height: 1.6rem; border-radius: .45rem; color: #3f705c; background: #edf5ef; font-size: .55rem; }.question-builder article > div { display: grid; grid-template-columns: 1fr 130px auto; gap: .45rem; }.question-builder .form-check { align-self: center; color: #6e7f78; font-size: .6rem; }.period-fields { grid-template-columns: 1fr 1fr; }.period-fields .full { grid-column: 1/-1; }.setup-card footer { display: flex; justify-content: space-between; align-items: center; padding: .8rem 1rem; border-top: 1px solid #edf1ee; }.setup-card footer > span { color: #82918b; font-size: .57rem; }.period-list { grid-column: 1/-1; }.period-rows { display: grid; }.period-rows article { display: flex; gap: .8rem; align-items: center; justify-content: space-between; padding: .75rem 1rem; border-top: 1px solid #edf1ee; }.period-rows article:first-child { border-top: 0; }.period-rows span,.period-rows strong,.period-rows small { display: block; }.period-rows span { color: #4e7866; font-size: .51rem; font-weight: 800; text-transform: uppercase; }.period-rows strong { color: #38564b; font-size: .67rem; }.period-rows small { color: #87958f; font-size: .54rem; }
@media (max-width: 991.98px) { .metric-grid { grid-template-columns: repeat(2,1fr); }.setup-layout { grid-template-columns: 1fr; }.period-list { grid-column: auto; }.outcome-groups { grid-template-columns: 1fr; } }
@media (max-width: 767.98px) { .respondent-hero { grid-template-columns: auto 1fr; }.respondent-hero > strong { grid-column: 2; justify-self: start; }.career-fields,.period-fields { grid-template-columns: 1fr; }.period-fields .full { grid-column: auto; }.assignment-grid article { grid-template-columns: auto 1fr; }.assignment-grid article button { grid-column: 2; justify-self: start; }.management-toolbar { align-items: stretch; flex-direction: column; }.management-toolbar .form-select { width: 100%; }.management-toolbar > div { margin-left: 0; }.question-builder article > div { grid-template-columns: 1fr; } }
@media (max-width: 480px) { .metric-grid { grid-template-columns: 1fr; }.tracer-tabs { overflow-x: auto; }.tracer-tabs button { white-space: nowrap; }.consent-card { grid-template-columns: auto 1fr; }.response-actions,.receipt-card__actions,.management-toolbar > div { display: grid; grid-template-columns: 1fr; }.outcome-detail { grid-template-columns: 1fr; }.outcome-detail ul { grid-column: auto; } }
</style>
