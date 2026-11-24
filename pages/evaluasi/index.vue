<script setup lang="ts">
import type { AxiosError } from 'axios'
import type {
  AcademicAdministrationWorkspace,
  AcademicPeriodDefinition,
  AcademicProgramStudy,
} from '~/server/types/academic-administration'

type QuestionType = 'LIKERT_1_5' | 'BOOLEAN' | 'TEXT'
type GroupBy = 'lecturer' | 'course' | 'class' | 'program'

interface Question {
  id: string
  label: string
  type: QuestionType
  required: boolean
  helpText?: string
}

interface EvaluationForm {
  id: string
  name: string
  description?: string
  programStudyId: string
  currentVersion: number
  nextVersion: number
  version: number
  status: 'ACTIVE' | 'ARCHIVED'
  updatedAt: string
}

interface EvaluationPeriod {
  id: string
  name: string
  academicPeriodId: string
  programStudyId: string
  formId: string
  formVersion: number
  opensAt: string
  closesAt: string
  minimumResponses: number
  version: number
}

interface Assignment {
  id: string
  evaluationPeriodId: string
  periodName: string
  closesAt: string
  enrollmentId: string
  lecturerId: string
  lecturerName: string
  courseId: string
  courseCode: string
  courseName: string
  classId: string
  className: string
  programStudyId: string
  completed: boolean
  questions: Question[]
}

interface QuestionStat {
  questionId: string
  label: string
  type: QuestionType
  answeredCount: number
  mean?: number
  median?: number
  favorablePercent?: number
  truePercent?: number
  distribution?: Record<string, number>
}

interface ReportGroup {
  key: string
  label: string
  lecturerName?: string
  courseCode?: string
  courseName?: string
  className?: string
  programStudyId: string
  suppressed: boolean
  responseCount: number | null
  minimumResponses: number
  overallMean?: number
  questions: QuestionStat[]
}

interface EvaluationReport {
  evaluationPeriod: { id: string; name: string; minimumResponses: number }
  groupBy: GroupBy
  generatedAt: string
  groups: ReportGroup[]
  confidentiality: { respondentIdentityIncluded: false; smallCohortsSuppressed: true; freeTextExcluded: true }
}

const { can, user } = useAuth()
const { $api } = useNuxtApp()
const config = useRuntimeConfig()

definePageMeta({ middleware: 'auth', alias: ['/modul/evaluasi-dosen'] })
useHead({ title: 'Evaluasi Dosen' })

const activeRole = computed(() => user.value?.activeRole)
const isStudent = computed(() => activeRole.value === 'student')
const canConfigure = computed(() => can('evaluation.configure'))
const canReport = computed(() => can('evaluation.read') && ['academic_staff', 'leader', 'lecturer', 'advisor'].includes(activeRole.value || ''))
const programStudyId = ref(user.value?.programStudyId || '')
const academicPrograms = ref<AcademicProgramStudy[]>([])
const academicPeriods = ref<AcademicPeriodDefinition[]>([])

const activeTab = ref<'setup' | 'report'>(canConfigure.value ? 'setup' : 'report')
const showPreview = ref(false)
const loading = ref(true)
const pageError = ref('')
const notice = ref<{ tone: 'success' | 'info'; message: string } | null>(null)

const assignments = ref<Assignment[]>([])
const selectedAssignment = ref<Assignment | null>(null)
const studentAnswers = reactive<Record<string, number | boolean | string | undefined>>({})
const submitting = ref(false)
const submitError = ref('')
const submissionKey = ref('')

const forms = ref<EvaluationForm[]>([])
const periods = ref<EvaluationPeriod[]>([])
const savingForm = ref(false)
const savingPeriod = ref(false)
const formError = ref('')
const periodError = ref('')

const editingForm = ref<EvaluationForm | null>(null)
const formDraft = reactive({
  name: config.public.demoMode ? 'Evaluasi Mutu Pembelajaran' : '',
  description: config.public.demoMode ? 'Umpan balik terstruktur untuk peningkatan mutu pembelajaran.' : '',
  questions: (config.public.demoMode
    ? [
        { id: 'clarity', label: 'Dosen menyampaikan materi secara jelas dan terstruktur.', type: 'LIKERT_1_5' as QuestionType, required: true, helpText: '' },
        { id: 'feedback', label: 'Dosen memberikan umpan balik yang membantu proses belajar.', type: 'LIKERT_1_5' as QuestionType, required: true, helpText: '' },
        { id: 'comment', label: 'Saran perbaikan untuk pembelajaran berikutnya.', type: 'TEXT' as QuestionType, required: false, helpText: '' },
      ]
    : [{ id: 'question_1', label: '', type: 'LIKERT_1_5' as QuestionType, required: true, helpText: '' }]) as Question[],
})
const formSaveKey = ref('')

const editingPeriod = ref<EvaluationPeriod | null>(null)
const periodDraft = reactive({
  name: config.public.demoMode ? 'Evaluasi Semester Aktif' : '',
  academicPeriodId: '',
  formId: '',
  opensAt: '',
  closesAt: '',
  minimumResponses: 5,
})
const periodSaveKey = ref('')

const report = ref<EvaluationReport | null>(null)
const selectedPeriodId = ref('')
const groupBy = ref<GroupBy>('lecturer')
const reportLoading = ref(false)
const exporting = ref(false)

const completedAssignments = computed(() => assignments.value.filter(item => item.completed).length)
const pendingAssignments = computed(() => assignments.value.filter(item => !item.completed).length)
const openPeriods = computed(() => periods.value.filter(period => Date.now() >= Date.parse(period.opensAt) && Date.now() < Date.parse(period.closesAt)).length)
const suppressedGroups = computed(() => report.value?.groups.filter(group => group.suppressed).length || 0)

const termLabel = (term: string) => ({ ODD: 'Gasal', EVEN: 'Genap', SHORT: 'Pendek' })[term] || term
const programLabel = (id: string) => academicPrograms.value.find(item => item.id === id)?.name || id
const academicPeriodLabel = (id: string) => {
  const match = academicPeriods.value.find(item => item.id === id)
  return match ? `${match.academicYear} · ${termLabel(match.term)}` : id
}
const formNameById = (id: string) => forms.value.find(item => item.id === id)?.name || 'Formulir'

function requestKey(prefix: string) {
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `${prefix}:${id}`
}

function errorMessage(error: unknown): string {
  const response = (error as AxiosError<{ statusMessage?: string; message?: string }>).response?.data
  return response?.statusMessage || response?.message || (error instanceof Error ? error.message : 'Permintaan tidak dapat diproses.')
}

const formatDate = (value: string) => new Intl.DateTimeFormat('id-ID', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta',
}).format(new Date(value))

const toLocalDateTime = (value: string) => {
  const date = new Date(value)
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function defaultPeriodWindow() {
  const open = new Date()
  open.setMinutes(0, 0, 0)
  const close = new Date(open.getTime() + 14 * 24 * 60 * 60 * 1000)
  periodDraft.opensAt = toLocalDateTime(open.toISOString())
  periodDraft.closesAt = toLocalDateTime(close.toISOString())
}

function periodState(period: EvaluationPeriod) {
  const now = Date.now()
  if (now < Date.parse(period.opensAt)) return { badge: 'scheduled', label: 'Terjadwal' }
  if (now >= Date.parse(period.closesAt)) return { badge: 'draft', label: 'Ditutup' }
  return { badge: 'active', label: 'Sedang dibuka' }
}

async function loadStudentAssignments() {
  const { data } = await $api.get<{ assignments: Assignment[] }>('/evaluations/assignments')
  assignments.value = data.assignments
}

async function loadAcademicCatalog() {
  const { data } = await $api.get<AcademicAdministrationWorkspace>('/academic/administration')
  academicPrograms.value = data.programs.filter(program => program.active)
  academicPeriods.value = data.periods.filter(period => period.active)
  if (!academicPrograms.value.some(program => program.id === programStudyId.value)) {
    const scopedProgram = user.value?.programStudyId
    programStudyId.value = academicPrograms.value.find(program => program.id === scopedProgram)?.id
      || (academicPrograms.value.length === 1 ? academicPrograms.value[0]!.id : '')
  }
  if (!academicPeriods.value.some(period => period.id === periodDraft.academicPeriodId)) {
    periodDraft.academicPeriodId = academicPeriods.value[0]?.id || ''
  }
}

async function loadManagementData() {
  const params = programStudyId.value ? { programStudyId: programStudyId.value } : {}
  const requests: Promise<unknown>[] = []
  if (canConfigure.value) {
    requests.push($api.get<{ forms: EvaluationForm[] }>('/evaluations/forms', { params: { programStudyId: programStudyId.value } })
      .then(({ data }) => { forms.value = data.forms }))
  }
  requests.push($api.get<{ periods: EvaluationPeriod[] }>('/evaluations/periods', { params })
    .then(({ data }) => { periods.value = data.periods }))
  await Promise.all(requests)
  if (!forms.value.some(form => form.id === periodDraft.formId)) periodDraft.formId = forms.value[0]?.id || ''
  if (!periods.value.some(period => period.id === selectedPeriodId.value)) selectedPeriodId.value = periods.value[0]?.id || ''
}

async function initialize() {
  loading.value = true
  pageError.value = ''
  try {
    if (isStudent.value) await loadStudentAssignments()
    else {
      await loadAcademicCatalog()
      await loadManagementData()
    }
  } catch (error) {
    pageError.value = errorMessage(error)
  } finally {
    loading.value = false
  }
}

function openAssignment(assignment: Assignment) {
  if (assignment.completed) return
  selectedAssignment.value = assignment
  submitError.value = ''
  submissionKey.value = requestKey('evaluation-submit')
  Object.keys(studentAnswers).forEach(key => delete studentAnswers[key])
}

function closeAssignment() {
  if (submitting.value) return
  selectedAssignment.value = null
  Object.keys(studentAnswers).forEach(key => delete studentAnswers[key])
}

function setTextAnswer(questionId: string, event: Event) {
  studentAnswers[questionId] = (event.target as HTMLTextAreaElement).value.trimStart()
}

function textAnswer(questionId: string): string {
  const value = studentAnswers[questionId]
  return typeof value === 'string' ? value : ''
}

async function submitAssignment() {
  const assignment = selectedAssignment.value
  if (!assignment || submitting.value) return
  const answers = assignment.questions.flatMap((question) => {
    const value = studentAnswers[question.id]
    return value === undefined || value === '' ? [] : [{ questionId: question.id, value }]
  })
  submitting.value = true
  submitError.value = ''
  try {
    await $api.post('/evaluations/submissions', {
      evaluationPeriodId: assignment.evaluationPeriodId,
      enrollmentId: assignment.enrollmentId,
      answers,
    }, { headers: { 'Idempotency-Key': submissionKey.value } })
    assignment.completed = true
    notice.value = { tone: 'success', message: `Evaluasi ${assignment.courseCode} tersimpan. Identitas Anda dipisahkan dari jawaban dan tidak muncul pada laporan.` }
    closeAssignment()
  } catch (error) {
    submitError.value = errorMessage(error)
  } finally {
    submitting.value = false
  }
}

function addQuestion() {
  formDraft.questions.push({
    id: `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
    label: '',
    type: 'LIKERT_1_5',
    required: true,
    helpText: '',
  })
}

function moveQuestion(index: number, delta: -1 | 1) {
  const target = index + delta
  if (target < 0 || target >= formDraft.questions.length) return
  const copy = [...formDraft.questions]
  const [item] = copy.splice(index, 1)
  copy.splice(target, 0, item!)
  formDraft.questions = copy
}

function duplicateQuestion(index: number) {
  const source = formDraft.questions[index]
  if (!source) return
  formDraft.questions.splice(index + 1, 0, {
    ...source,
    id: `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
  })
}

function applyStandardTemplate() {
  if (!formDraft.name.trim()) formDraft.name = 'Evaluasi Mutu Pembelajaran Semester'
  if (!formDraft.description.trim()) formDraft.description = 'Instrumen umpan balik mahasiswa terhadap mutu pengajaran dosen.'
  formDraft.questions = [
    { id: 'mastery', label: 'Dosen menguasai materi perkuliahan dan menyajikannya secara sistematis.', type: 'LIKERT_1_5', required: true, helpText: '1 = Sangat kurang, 5 = Sangat baik' },
    { id: 'clarity', label: 'Penjelasan dosen mudah dipahami dan relevan dengan tujuan mata kuliah.', type: 'LIKERT_1_5', required: true, helpText: '' },
    { id: 'punctuality', label: 'Dosen memulai dan mengakhiri perkuliahan sesuai jadwal yang ditetapkan.', type: 'LIKERT_1_5', required: true, helpText: '' },
    { id: 'guidance', label: 'Dosen responsif dalam berdiskusi serta memberi umpan balik atas tugas mahasiswa.', type: 'LIKERT_1_5', required: true, helpText: '' },
    { id: 'feedback_text', label: 'Saran konstruktif untuk peningkatan mutu perkuliahan berikutnya.', type: 'TEXT', required: false, helpText: 'Hindari mencantumkan nama atau NIM Anda.' },
  ]
}

function resetFormDraft() {
  editingForm.value = null
  showPreview.value = false
  formDraft.name = config.public.demoMode ? 'Evaluasi Mutu Pembelajaran' : ''
  formDraft.description = config.public.demoMode ? 'Umpan balik terstruktur untuk peningkatan mutu pembelajaran.' : ''
  formDraft.questions = config.public.demoMode
    ? [
        { id: 'clarity', label: 'Dosen menyampaikan materi secara jelas dan terstruktur.', type: 'LIKERT_1_5', required: true, helpText: '' },
        { id: 'feedback', label: 'Dosen memberikan umpan balik yang membantu proses belajar.', type: 'LIKERT_1_5', required: true, helpText: '' },
        { id: 'comment', label: 'Saran perbaikan untuk pembelajaran berikutnya.', type: 'TEXT', required: false, helpText: '' },
      ]
    : [{ id: 'question_1', label: '', type: 'LIKERT_1_5', required: true, helpText: '' }]
  formSaveKey.value = requestKey('evaluation-form')
}

async function editForm(form: EvaluationForm) {
  formError.value = ''
  try {
    const { data } = await $api.get<{ form: EvaluationForm; versions: Array<{ version: number; questions: Question[] }> }>(`/evaluations/forms/${form.id}`)
    const current = data.versions.find(item => item.version === data.form.currentVersion)
    editingForm.value = data.form
    formDraft.name = data.form.name
    formDraft.description = data.form.description || ''
    formDraft.questions = current?.questions.map(question => ({ ...question, helpText: question.helpText || '' })) || []
    showPreview.value = false
    window.scrollTo({ top: 0, behavior: 'smooth' })
  } catch (error) {
    formError.value = errorMessage(error)
  }
}

async function saveForm() {
  if (savingForm.value) return
  if (!programStudyId.value || !formDraft.name.trim() || formDraft.questions.some(question => !question.label.trim())) {
    formError.value = 'Pilih program studi serta lengkapi nama dan seluruh teks pertanyaan.'
    return
  }
  savingForm.value = true
  formError.value = ''
  try {
    const payload = {
      name: formDraft.name.trim(),
      description: formDraft.description.trim(),
      programStudyId: programStudyId.value,
      questions: formDraft.questions.map(q => ({
        id: q.id,
        label: q.label.trim(),
        type: q.type,
        required: q.required,
        ...(q.helpText?.trim() ? { helpText: q.helpText.trim() } : {}),
      })),
    }
    if (editingForm.value) {
      await $api.put(`/evaluations/forms/${editingForm.value.id}`, {
        ...payload,
        expectedVersion: editingForm.value.version,
      })
      notice.value = { tone: 'success', message: 'Perubahan formulir disimpan sebagai versi baru. Periode lama tetap menjaga struktur sebelumnya.' }
    } else {
      if (!formSaveKey.value) formSaveKey.value = requestKey('evaluation-form')
      await $api.post('/evaluations/forms', payload, { headers: { 'Idempotency-Key': formSaveKey.value } })
      notice.value = { tone: 'success', message: 'Formulir evaluasi berhasil dibuat dan siap dijadwalkan.' }
    }
    await loadManagementData()
    resetFormDraft()
  } catch (error) {
    formError.value = errorMessage(error)
  } finally {
    savingForm.value = false
  }
}

function editPeriod(period: EvaluationPeriod) {
  editingPeriod.value = period
  periodDraft.name = period.name
  periodDraft.academicPeriodId = period.academicPeriodId
  periodDraft.formId = period.formId
  periodDraft.opensAt = toLocalDateTime(period.opensAt)
  periodDraft.closesAt = toLocalDateTime(period.closesAt)
  periodDraft.minimumResponses = period.minimumResponses
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

function resetPeriodDraft() {
  editingPeriod.value = null
  periodDraft.name = config.public.demoMode ? 'Evaluasi Semester Aktif' : ''
  periodDraft.academicPeriodId = academicPeriods.value[0]?.id || ''
  periodDraft.formId = forms.value[0]?.id || ''
  periodDraft.minimumResponses = 5
  defaultPeriodWindow()
  periodSaveKey.value = requestKey('evaluation-period')
}

async function savePeriod() {
  if (savingPeriod.value) return
  if (!programStudyId.value || !periodDraft.academicPeriodId || !periodDraft.name.trim()) {
    periodError.value = 'Pilih program studi dan semester akademik serta isi nama periode.'
    return
  }
  const form = forms.value.find(item => item.id === periodDraft.formId)
  if (!form) {
    periodError.value = 'Pilih formulir yang akan digunakan.'
    return
  }
  savingPeriod.value = true
  periodError.value = ''
  try {
    const payload = {
      name: periodDraft.name.trim(),
      academicPeriodId: periodDraft.academicPeriodId,
      programStudyId: programStudyId.value,
      formId: form.id,
      formVersion: form.currentVersion,
      opensAt: new Date(periodDraft.opensAt).toISOString(),
      closesAt: new Date(periodDraft.closesAt).toISOString(),
      minimumResponses: Number(periodDraft.minimumResponses),
    }
    if (editingPeriod.value) {
      await $api.put(`/evaluations/periods/${editingPeriod.value.id}`, {
        expectedVersion: editingPeriod.value.version,
        name: payload.name,
        opensAt: payload.opensAt,
        closesAt: payload.closesAt,
        minimumResponses: payload.minimumResponses,
      })
      notice.value = { tone: 'success', message: 'Jadwal periode evaluasi berhasil diperbarui.' }
    } else {
      if (!periodSaveKey.value) periodSaveKey.value = requestKey('evaluation-period')
      await $api.post('/evaluations/periods', payload, { headers: { 'Idempotency-Key': periodSaveKey.value } })
      notice.value = { tone: 'success', message: 'Periode evaluasi berhasil dijadwalkan.' }
    }
    await loadManagementData()
    resetPeriodDraft()
  } catch (error) {
    periodError.value = errorMessage(error)
  } finally {
    savingPeriod.value = false
  }
}

async function loadReport() {
  if (!selectedPeriodId.value) return
  reportLoading.value = true
  pageError.value = ''
  try {
    const { data } = await $api.get<EvaluationReport>('/evaluations/reports', {
      params: { evaluationPeriodId: selectedPeriodId.value, groupBy: groupBy.value },
    })
    report.value = data
  } catch (error) {
    pageError.value = errorMessage(error)
    report.value = null
  } finally {
    reportLoading.value = false
  }
}

async function exportReport() {
  if (!selectedPeriodId.value || exporting.value) return
  exporting.value = true
  try {
    const response = await $api.get<Blob>('/evaluations/reports/export', {
      params: { evaluationPeriodId: selectedPeriodId.value, groupBy: groupBy.value },
      responseType: 'blob',
    })
    const disposition = String(response.headers['content-disposition'] || '')
    const fileName = disposition.match(/filename="([^"]+)"/)?.[1] || 'laporan-evaluasi.csv'
    const url = URL.createObjectURL(response.data)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = fileName
    anchor.click()
    URL.revokeObjectURL(url)
  } catch (error) {
    pageError.value = errorMessage(error)
  } finally {
    exporting.value = false
  }
}

watch(activeRole, () => {
  activeTab.value = canConfigure.value ? 'setup' : 'report'
  initialize()
})

onMounted(() => {
  resetFormDraft()
  resetPeriodDraft()
  initialize()
})
</script>

<template>
  <div class="evaluation-page">
    <AppPageHeader
      eyebrow="Mutu pembelajaran"
      title="Evaluasi Dosen"
      :description="isStudent ? 'Berikan umpan balik rahasia untuk kelas yang Anda ikuti.' : 'Susun instrumen pertanyaan, jadwalkan periode pengisian, dan pantau hasil rekapitulasi secara anonim.'"
    >
      <template v-if="canReport && !isStudent" #actions>
        <button class="btn btn-outline-secondary" type="button" :disabled="!selectedPeriodId || exporting" @click="exportReport">
          <span v-if="exporting" class="spinner-border spinner-border-sm me-2" /><i v-else class="uil uil-file-download me-2" />Ekspor CSV
        </button>
      </template>
    </AppPageHeader>

    <div v-if="notice" class="evaluation-notice" :class="`evaluation-notice--${notice.tone}`" role="status">
      <i :class="notice.tone === 'success' ? 'uil uil-check-circle' : 'uil uil-info-circle'" /><span>{{ notice.message }}</span><button type="button" aria-label="Tutup" @click="notice = null"><i class="uil uil-times" /></button>
    </div>
    <div v-if="pageError" class="evaluation-error" role="alert"><i class="uil uil-exclamation-octagon" /><span>{{ pageError }}</span><button type="button" @click="pageError = ''; initialize()">Coba lagi</button></div>

    <template v-if="isStudent">
      <section class="privacy-banner">
        <span><i class="uil uil-user-check" /></span>
        <div><strong>Identitas dipisahkan dari jawaban</strong><p>Sistem hanya mencatat bahwa evaluasi telah diisi. Jawaban disimpan secara anonim dan kelompok dengan responden sedikit tidak ditampilkan.</p></div>
        <small><i class="uil uil-shield-check me-1" />Kerahasiaan aktif</small>
      </section>

      <section class="student-summary">
        <article><span><i class="uil uil-clipboard-notes" /></span><div><small>Perlu diisi</small><strong>{{ pendingAssignments }}</strong><p>Evaluasi pada periode terbuka</p></div></article>
        <article><span class="plum"><i class="uil uil-check-circle" /></span><div><small>Sudah terkirim</small><strong>{{ completedAssignments }}</strong><p>Setiap kelas diisi satu kali</p></div></article>
        <article><span class="slate"><i class="uil uil-lock-access" /></span><div><small>Pelaporan</small><strong>Anonim</strong><p>Tanpa identitas responden</p></div></article>
      </section>

      <section class="student-surface">
        <header><div><span class="section-kicker">Kelas semester ini</span><h2>Evaluasi yang tersedia</h2><p>Pilih kelas, jawab seluruh pertanyaan wajib, lalu kirim satu kali.</p></div><span class="record-pill">{{ assignments.length }} kelas</span></header>
        <div v-if="loading" class="loading-state"><span class="spinner-border spinner-border-sm" />Memuat daftar evaluasi…</div>
        <EmptyState v-else-if="assignments.length === 0" title="Tidak ada evaluasi terbuka" description="Evaluasi akan muncul saat periode dibuka untuk kelas yang Anda ikuti." icon="uil-clipboard-check" />
        <div v-else class="assignment-list">
          <article v-for="assignment in assignments" :key="assignment.id" :class="{ completed: assignment.completed }">
            <span class="assignment-icon"><i :class="assignment.completed ? 'uil uil-check' : 'uil uil-notebooks'" /></span>
            <div class="assignment-main"><small>{{ assignment.courseCode }} · {{ assignment.className }}</small><h3>{{ assignment.courseName }}</h3><p><i class="uil uil-user-square" />{{ assignment.lecturerName }}</p></div>
            <div class="assignment-deadline"><small>{{ assignment.completed ? 'Status' : 'Batas pengisian' }}</small><strong>{{ assignment.completed ? 'Sudah terkirim' : formatDate(assignment.closesAt) }}</strong></div>
            <StatusBadge v-if="assignment.completed" status="success" label="Selesai" />
            <button v-else class="btn btn-sm btn-primary" type="button" @click="openAssignment(assignment)">Isi evaluasi <i class="uil uil-arrow-right ms-1" /></button>
          </article>
        </div>
      </section>
    </template>

    <template v-else>
      <section class="management-summary">
        <article><span class="plum"><i class="uil uil-file-edit-alt" /></span><div><small>Formulir aktif</small><strong>{{ forms.length }}</strong><p>Instrumen pertanyaan evaluasi</p></div></article>
        <article><span class="slate"><i class="uil uil-calendar-alt" /></span><div><small>Periode terbuka</small><strong>{{ openPeriods }}</strong><p>Dari {{ periods.length }} periode terjadwal</p></div></article>
        <article><span class="amber"><i class="uil uil-shield-exclamation" /></span><div><small>Kelompok disembunyikan</small><strong>{{ suppressedGroups }}</strong><p>Belum memenuhi batas responden</p></div></article>
        <article><span class="plum"><i class="uil uil-chart" /></span><div><small>Jenis laporan</small><strong>Rekapitulasi</strong><p>Tanpa identitas responden</p></div></article>
      </section>

      <nav class="evaluation-tabs" aria-label="Area evaluasi">
        <button v-if="canConfigure" type="button" :class="{ active: activeTab === 'setup' }" @click="activeTab = 'setup'"><i class="uil uil-setting" />Instrumen &amp; periode</button>
        <button v-if="canReport" type="button" :class="{ active: activeTab === 'report' }" @click="activeTab = 'report'"><i class="uil uil-chart-bar" />Laporan hasil</button>
      </nav>

      <div v-if="loading" class="loading-state management-loading"><span class="spinner-border spinner-border-sm" />Memuat konfigurasi evaluasi…</div>

      <section v-else-if="activeTab === 'setup' && canConfigure" class="setup-grid">
        <article class="config-surface form-builder">
          <header>
            <div>
              <span class="section-kicker">{{ editingForm ? `Mode sunting · v${editingForm.currentVersion + 1}` : 'Instrumen baru' }}</span>
              <h2>{{ editingForm ? `Sunting: ${editingForm.name}` : 'Susun formulir evaluasi dosen' }}</h2>
              <p>Periode evaluasi yang sudah berjalan tetap menggunakan versi pertanyaan saat periode dibuat.</p>
            </div>
            <div class="header-actions">
              <button class="btn btn-sm btn-outline-secondary" type="button" @click="showPreview = !showPreview">
                <i class="uil me-1" :class="showPreview ? 'uil-pen' : 'uil-eye'" />{{ showPreview ? 'Kembali menyunting' : 'Pratinjau' }}
              </button>
              <button v-if="editingForm" class="btn btn-sm btn-outline-secondary" type="button" @click="resetFormDraft">+ Buat baru</button>
            </div>
          </header>

          <div v-if="showPreview" class="config-body">
            <div class="preview-box">
              <h3>{{ formDraft.name || 'Judul formulir belum diisi' }}</h3>
              <p v-if="formDraft.description">{{ formDraft.description }}</p>
              <ol class="student-questions preview-list">
                <li v-for="(question, index) in formDraft.questions" :key="question.id">
                  <header><span>{{ index + 1 }}</span><div><strong>{{ question.label || '(Pertanyaan belum diisi)' }} <em v-if="question.required">Wajib</em></strong><small v-if="question.helpText">{{ question.helpText }}</small></div></header>
                  <div v-if="question.type === 'LIKERT_1_5'" class="likert"><small>Sangat tidak setuju</small><div><label v-for="score in 5" :key="score"><span>{{ score }}</span></label></div><small>Sangat setuju</small></div>
                  <div v-else-if="question.type === 'BOOLEAN'" class="boolean-answer"><label><i class="uil uil-check" />Ya</label><label><i class="uil uil-times" />Tidak</label></div>
                  <textarea v-else class="form-control" rows="2" disabled placeholder="Area jawaban teks mahasiswa..." />
                </li>
              </ol>
            </div>
          </div>

          <div v-else class="config-body">
            <div class="row g-3">
              <label class="col-12 col-md-7"><span>Nama formulir</span><input v-model="formDraft.name" class="form-control form-control-sm" maxlength="160" placeholder="Contoh: Evaluasi Mutu Pembelajaran Semester Gasal"></label>
              <label class="col-12 col-md-5"><span>Program studi</span><select v-model="programStudyId" class="form-select form-select-sm" required :disabled="Boolean(editingForm)" @change="loadManagementData"><option value="" disabled>Pilih program studi</option><option v-for="program in academicPrograms" :key="program.id" :value="program.id">{{ program.code }} · {{ program.name }}</option></select></label>
              <label class="col-12"><span>Deskripsi singkat</span><textarea v-model="formDraft.description" class="form-control form-control-sm" rows="2" maxlength="1000" placeholder="Penjelasan singkat tujuan evaluasi untuk mahasiswa." /></label>
            </div>

            <div class="question-builder-header">
              <div><span class="section-kicker">Daftar pertanyaan</span><strong>{{ formDraft.questions.length }} butir</strong></div>
              <div class="question-builder-actions">
                <button v-if="!editingForm" class="btn btn-sm btn-outline-primary" type="button" @click="applyStandardTemplate"><i class="uil uil-file-copy-alt me-1" />Muat templat standar</button>
                <button class="btn btn-sm btn-outline-secondary" type="button" @click="addQuestion"><i class="uil uil-plus me-1" />Tambah butir</button>
              </div>
            </div>

            <ol class="question-builder">
              <li v-for="(question, index) in formDraft.questions" :key="question.id">
                <span class="question-number">{{ index + 1 }}</span>
                <div class="question-fields">
                  <input v-model="question.label" class="form-control form-control-sm" maxlength="300" placeholder="Tulis pernyataan atau pertanyaan evaluasi..." :aria-label="`Pertanyaan ${index + 1}`">
                  <input v-model="question.helpText" class="form-control form-control-sm help-input" maxlength="200" placeholder="Petunjuk pengisian (opsional)" :aria-label="`Petunjuk pertanyaan ${index + 1}`">
                  <div class="question-meta-row">
                    <select v-model="question.type" class="form-select form-select-sm">
                      <option value="LIKERT_1_5">Skala 1–5</option>
                      <option value="BOOLEAN">Ya / Tidak</option>
                      <option value="TEXT">Teks bebas</option>
                    </select>
                    <label class="form-check"><input v-model="question.required" class="form-check-input" type="checkbox"><span>Wajib diisi</span></label>
                    <div class="question-tools">
                      <button type="button" title="Naikkan urutan" :disabled="index === 0" @click="moveQuestion(index, -1)"><i class="uil uil-arrow-up" /></button>
                      <button type="button" title="Turunkan urutan" :disabled="index === formDraft.questions.length - 1" @click="moveQuestion(index, 1)"><i class="uil uil-arrow-down" /></button>
                      <button type="button" title="Duplikat pertanyaan" @click="duplicateQuestion(index)"><i class="uil uil-copy" /></button>
                      <button type="button" class="danger" title="Hapus pertanyaan" :disabled="formDraft.questions.length === 1" @click="formDraft.questions.splice(index, 1)"><i class="uil uil-trash-alt" /></button>
                    </div>
                  </div>
                </div>
              </li>
            </ol>
            <p v-if="formError" class="form-error" role="alert"><i class="uil uil-exclamation-triangle" />{{ formError }}</p>
          </div>
          <footer>
            <span><i class="uil uil-shield-check me-1" />Setiap pembaruan tercatat rapi tanpa mengganggu periode lama.</span>
            <button class="btn btn-sm btn-primary" type="button" :disabled="savingForm || !programStudyId || !formDraft.name.trim() || !formDraft.questions.length || formDraft.questions.some(question => !question.label.trim())" @click="saveForm">
              <span v-if="savingForm" class="spinner-border spinner-border-sm me-2" />{{ editingForm ? 'Simpan perubahan formulir' : 'Simpan formulir baru' }}
            </button>
          </footer>
        </article>

        <aside class="setup-aside">
          <article class="config-surface">
            <header>
              <div><span class="section-kicker">Jadwal pengisian</span><h2>{{ editingPeriod ? 'Sunting periode evaluasi' : 'Jadwalkan periode baru' }}</h2></div>
              <button v-if="editingPeriod" class="btn btn-sm btn-outline-secondary" type="button" @click="resetPeriodDraft">Batal</button>
            </header>
            <div class="config-body period-form">
              <label><span>Nama periode evaluasi</span><input v-model="periodDraft.name" class="form-control form-control-sm" placeholder="Contoh: Evaluasi Dosen Gasal 2026/2027"></label>
              <label><span>Semester akademik</span><select v-model="periodDraft.academicPeriodId" class="form-select form-select-sm" required :disabled="Boolean(editingPeriod)"><option value="" disabled>Pilih semester aktif</option><option v-for="period in academicPeriods" :key="period.id" :value="period.id">{{ period.academicYear }} · {{ termLabel(period.term) }}</option></select></label>
              <label><span>Formulir yang dipakai</span><select v-model="periodDraft.formId" class="form-select form-select-sm" :disabled="Boolean(editingPeriod)"><option v-for="form in forms" :key="form.id" :value="form.id">{{ form.name }} (v{{ form.currentVersion }})</option></select></label>
              <div class="row g-2">
                <label class="col-6"><span>Dibuka</span><input v-model="periodDraft.opensAt" class="form-control form-control-sm" type="datetime-local"></label>
                <label class="col-6"><span>Ditutup</span><input v-model="periodDraft.closesAt" class="form-control form-control-sm" type="datetime-local"></label>
              </div>
              <label>
                <span>Batas minimum responden</span>
                <div class="threshold-control"><input v-model.number="periodDraft.minimumResponses" type="range" min="3" max="20"><strong>{{ periodDraft.minimumResponses }} responden</strong></div>
                <small>Hasil kelas dengan responden di bawah batas ini disembunyikan demi menjaga anonimitas mahasiswa.</small>
              </label>
              <p v-if="periodError" class="form-error" role="alert"><i class="uil uil-exclamation-triangle" />{{ periodError }}</p>
              <button class="btn btn-sm btn-primary w-100" type="button" :disabled="savingPeriod || !programStudyId || !periodDraft.academicPeriodId || !periodDraft.name.trim() || !forms.length" @click="savePeriod">
                <span v-if="savingPeriod" class="spinner-border spinner-border-sm me-2" />{{ editingPeriod ? 'Simpan perubahan periode' : 'Jadwalkan periode' }}
              </button>
            </div>
          </article>

          <article class="config-surface compact-list">
            <header><div><span class="section-kicker">Daftar instrumen</span><h2>Formulir tersimpan</h2></div><span class="record-pill">{{ forms.length }}</span></header>
            <ul>
              <li v-for="form in forms" :key="form.id" :class="{ active: editingForm?.id === form.id }">
                <span><strong>{{ form.name }}</strong><small>{{ programLabel(form.programStudyId) }} · v{{ form.currentVersion }}</small></span>
                <button class="btn btn-sm btn-outline-primary" type="button" @click="editForm(form)">Sunting</button>
              </li>
              <li v-if="!forms.length" class="empty-list">Belum ada formulir untuk program studi ini.</li>
            </ul>
          </article>
        </aside>

        <article class="config-surface period-list">
          <header><div><span class="section-kicker">Kalender evaluasi</span><h2>Periode evaluasi terjadwal</h2><p>Mahasiswa dapat mengisi evaluasi selama berada dalam rentang waktu buka dan tutup di bawah ini.</p></div><span class="record-pill">{{ periods.length }}</span></header>
          <div class="period-table">
            <table>
              <thead><tr><th>Periode</th><th>Semester</th><th>Formulir</th><th>Jadwal pengisian</th><th>Batas anonim</th><th>Status</th><th class="text-end">Aksi</th></tr></thead>
              <tbody>
                <tr v-for="period in periods" :key="period.id" :class="{ active: editingPeriod?.id === period.id }">
                  <td><strong>{{ period.name }}</strong></td>
                  <td>{{ academicPeriodLabel(period.academicPeriodId) }}</td>
                  <td>{{ formNameById(period.formId) }} <small>(v{{ period.formVersion }})</small></td>
                  <td><small>{{ formatDate(period.opensAt) }}</small><span>s.d.</span><small>{{ formatDate(period.closesAt) }}</small></td>
                  <td>{{ period.minimumResponses }} responden</td>
                  <td><StatusBadge :status="periodState(period).badge" :label="periodState(period).label" /></td>
                  <td class="text-end"><button class="btn btn-sm btn-outline-primary" type="button" @click="editPeriod(period)">Sunting</button></td>
                </tr>
              </tbody>
            </table>
            <EmptyState v-if="!periods.length" title="Belum ada periode evaluasi" description="Buat formulir terlebih dahulu, lalu jadwalkan periode pengisiannya." icon="uil-calendar-slash" />
          </div>
        </article>
      </section>

      <section v-else-if="activeTab === 'report' && canReport" class="report-surface">
        <header class="report-toolbar">
          <div><span class="section-kicker">Rekapitulasi nilai</span><h2>Laporan hasil evaluasi</h2><p>Identitas mahasiswa dan komentar teks bebas tidak pernah ditampilkan dalam laporan.</p></div>
          <div class="report-filters">
            <label><span>Periode</span><select v-model="selectedPeriodId" class="form-select form-select-sm"><option v-for="period in periods" :key="period.id" :value="period.id">{{ period.name }}</option></select></label>
            <label><span>Kelompokkan</span><select v-model="groupBy" class="form-select form-select-sm"><option value="lecturer">Dosen</option><option value="course">Mata kuliah</option><option value="class">Kelas</option><option value="program">Program studi</option></select></label>
            <button class="btn btn-sm btn-primary" type="button" :disabled="!selectedPeriodId || reportLoading" @click="loadReport"><span v-if="reportLoading" class="spinner-border spinner-border-sm me-1" />Tampilkan</button>
          </div>
        </header>
        <div class="confidentiality-row"><span><i class="uil uil-user-arrows" />Identitas terpisah</span><span><i class="uil uil-filter" />Kelompok kecil disembunyikan</span><span><i class="uil uil-comment-slash" />Komentar bebas dikecualikan</span></div>
        <div v-if="reportLoading" class="loading-state">Menghitung rekapitulasi evaluasi…</div>
        <EmptyState v-else-if="!report || !report.groups.length" title="Belum ada hasil yang dapat ditampilkan" description="Pilih periode lalu klik Tampilkan. Kelompok tanpa responden belum muncul." icon="uil-chart-line" />
        <div v-else class="report-groups">
          <article v-for="group in report.groups" :key="group.key" :class="{ suppressed: group.suppressed }">
            <header><div><small>{{ groupBy === 'lecturer' ? 'Dosen' : groupBy === 'course' ? 'Mata kuliah' : groupBy === 'class' ? 'Kelas' : 'Program studi' }}</small><h3>{{ group.label }}</h3><p>{{ group.courseCode }}<template v-if="group.className"> · {{ group.className }}</template><template v-if="group.lecturerName"> · {{ group.lecturerName }}</template></p></div><div v-if="!group.suppressed" class="score"><strong>{{ group.overallMean?.toFixed(2) || '-' }}</strong><small>rata-rata · {{ group.responseCount }} responden</small></div><StatusBadge v-else status="review" label="Disembunyikan" /></header>
            <div v-if="group.suppressed" class="suppression-note"><i class="uil uil-shield-exclamation" /><div><strong>Batas kerahasiaan belum tercapai</strong><p>Nilai tidak ditampilkan sampai tersedia sedikitnya {{ group.minimumResponses }} responden.</p></div></div>
            <div v-else class="question-stats"><div v-for="stat in group.questions" :key="stat.questionId"><span><strong>{{ stat.label }}</strong><small>{{ stat.type === 'TEXT' ? 'Teks bebas tidak diekspor' : `${stat.answeredCount} jawaban` }}</small></span><template v-if="stat.type === 'LIKERT_1_5'"><div class="mini-scale"><i v-for="score in 5" :key="score" :class="{ active: score <= Math.round(stat.mean || 0) }" /></div><strong>{{ stat.mean?.toFixed(2) }}</strong></template><strong v-else-if="stat.type === 'BOOLEAN'">{{ stat.truePercent?.toFixed(1) }}% ya</strong><span v-else class="excluded-chip"><i class="uil uil-eye-slash" />Dikecualikan</span></div></div>
          </article>
        </div>
      </section>
    </template>

    <div v-if="selectedAssignment" class="evaluation-modal" @click.self="closeAssignment">
      <section role="dialog" aria-modal="true" aria-labelledby="evaluation-form-title">
        <header><div><span>{{ selectedAssignment.courseCode }} · {{ selectedAssignment.className }}</span><h2 id="evaluation-form-title">{{ selectedAssignment.courseName }}</h2><p>{{ selectedAssignment.lecturerName }}</p></div><button type="button" aria-label="Tutup" :disabled="submitting" @click="closeAssignment"><i class="uil uil-times" /></button></header>
        <div class="modal-privacy"><i class="uil uil-shield-check" /><p><strong>Jawaban Anda bersifat rahasia</strong><span>Jangan mencantumkan nama, NIM, atau data pribadi pada jawaban teks.</span></p></div>
        <ol class="student-questions">
          <li v-for="(question, index) in selectedAssignment.questions" :key="question.id"><header><span>{{ index + 1 }}</span><div><strong>{{ question.label }} <em v-if="question.required">Wajib</em></strong><small v-if="question.helpText">{{ question.helpText }}</small></div></header><div v-if="question.type === 'LIKERT_1_5'" class="likert"><small>Sangat tidak setuju</small><div><label v-for="score in 5" :key="score" :class="{ selected: studentAnswers[question.id] === score }"><input v-model="studentAnswers[question.id]" type="radio" :name="question.id" :value="score"><span>{{ score }}</span></label></div><small>Sangat setuju</small></div><div v-else-if="question.type === 'BOOLEAN'" class="boolean-answer"><label :class="{ selected: studentAnswers[question.id] === true }"><input type="radio" :name="question.id" value="true" :checked="studentAnswers[question.id] === true" @change="studentAnswers[question.id] = true"><i class="uil uil-check" />Ya</label><label :class="{ selected: studentAnswers[question.id] === false }"><input type="radio" :name="question.id" value="false" :checked="studentAnswers[question.id] === false" @change="studentAnswers[question.id] = false"><i class="uil uil-times" />Tidak</label></div><textarea v-else :value="textAnswer(question.id)" class="form-control" rows="4" maxlength="1000" placeholder="Tulis saran tanpa data pribadi…" @input="setTextAnswer(question.id, $event)" /></li>
        </ol>
        <p v-if="submitError" class="form-error mx-3" role="alert"><i class="uil uil-exclamation-triangle" />{{ submitError }}</p>
        <footer><span><i class="uil uil-lock" />Satu pengiriman per dosen, mata kuliah, kelas, dan periode.</span><div><button class="btn btn-outline-secondary" type="button" :disabled="submitting" @click="closeAssignment">Batal</button><button class="btn btn-primary" type="button" :disabled="submitting" @click="submitAssignment"><span v-if="submitting" class="spinner-border spinner-border-sm me-2" />Kirim evaluasi</button></div></footer>
      </section>
    </div>
  </div>
</template>

<style scoped>
.evaluation-page { display: grid; gap: 1.2rem; }
.evaluation-notice,.evaluation-error { display: grid; grid-template-columns: auto 1fr auto; gap: .65rem; align-items: center; padding: .75rem .9rem; border: 1px solid #d7c7de; border-radius: .8rem; color: #3e2344; background: #f5eff7; font-size: .74rem; }
.evaluation-notice--info { border-color: #d9d0c5; color: #4e5462; background: #faf6ef; }
.evaluation-notice button,.evaluation-error button { border: 0; color: inherit; background: transparent; font-weight: 800; }
.evaluation-error { border-color: #edcec6; color: #8c4335; background: #fff6f4; }
.privacy-banner { display: grid; grid-template-columns: auto 1fr auto; gap: .8rem; align-items: center; padding: .9rem 1rem; border: 1px solid #dfd3e4; border-radius: .9rem; background: #f9f5fb; }
.privacy-banner > span { display: grid; place-items: center; width: 2.7rem; height: 2.7rem; border-radius: .8rem; color: #fff; background: #593660; font-size: 1.15rem; }
.privacy-banner strong { display: block; color: #1e1e1e; font-size: .78rem; }
.privacy-banner p { margin: .18rem 0 0; color: #4e5462; font-size: .7rem; line-height: 1.45; }
.privacy-banner > small { padding: .35rem .65rem; border-radius: 999px; color: #593660; background: #fff; font-size: .64rem; font-weight: 800; }
.student-summary,.management-summary { display: grid; grid-template-columns: repeat(3,1fr); gap: .8rem; }
.management-summary { grid-template-columns: repeat(4,1fr); }
.student-summary article,.management-summary article { display: flex; gap: .7rem; align-items: center; padding: .9rem; border: 1px solid #e6dfd6; border-radius: .9rem; background: #fff; box-shadow: 0 4px 16px rgba(30,30,30,.04); }
.student-summary article > span,.management-summary article > span { display: grid; place-items: center; flex: 0 0 auto; width: 2.4rem; height: 2.4rem; border-radius: .7rem; color: #8a661f; background: #fbf0de; }
.student-summary .plum,.management-summary .plum { color: #593660; background: #f5eff7; }
.student-summary .slate,.management-summary .slate { color: #4e5462; background: #f0eee9; }
.management-summary .amber { color: #8a661f; background: #fbf0de; }
.student-summary small,.student-summary strong,.student-summary p,.management-summary small,.management-summary strong,.management-summary p { display: block; }
.student-summary small,.management-summary small { color: #6c6865; font-size: .64rem; font-weight: 700; }
.student-summary strong,.management-summary strong { margin-top: .08rem; color: #1e1e1e; font-size: 1.05rem; }
.student-summary p,.management-summary p { overflow: hidden; margin: .1rem 0 0; color: #6c6865; font-size: .62rem; text-overflow: ellipsis; white-space: nowrap; }
.student-surface,.config-surface,.report-surface { overflow: hidden; border: 1px solid #e6dfd6; border-radius: 1rem; background: #fff; box-shadow: 0 6px 20px rgba(30,30,30,.04); }
.student-surface > header,.config-surface > header { display: flex; gap: 1rem; align-items: flex-start; justify-content: space-between; padding: 1rem 1.15rem; border-bottom: 1px solid #ece6dd; }
.header-actions { display: flex; gap: .45rem; flex-wrap: wrap; }
.section-kicker { display: block; color: #775a83; font-size: .64rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
.student-surface h2,.config-surface h2,.report-surface h2 { margin: .18rem 0 0; color: #1e1e1e; font-size: .96rem; }
.student-surface header p,.config-surface header p,.report-surface header p { margin: .2rem 0 0; color: #6c6865; font-size: .68rem; }
.record-pill { padding: .28rem .6rem; border-radius: 999px; color: #593660; background: #f5eff7; font-size: .64rem; font-weight: 800; }
.loading-state { display: flex; gap: .5rem; align-items: center; justify-content: center; min-height: 11rem; color: #6c6865; font-size: .74rem; }
.assignment-list { display: grid; }
.assignment-list article { display: grid; grid-template-columns: auto minmax(180px,1fr) auto auto; gap: .8rem; align-items: center; padding: .9rem 1.15rem; border-top: 1px solid #ece6dd; }
.assignment-list article:first-child { border-top: 0; }
.assignment-list article.completed { background: #fdfbf8; }
.assignment-icon { display: grid; place-items: center; width: 2.35rem; height: 2.35rem; border-radius: .7rem; color: #593660; background: #f5eff7; }
.assignment-main small { color: #775a83; font-size: .64rem; font-weight: 800; }
.assignment-main h3 { margin: .12rem 0 0; color: #1e1e1e; font-size: .82rem; }
.assignment-main p { margin: .2rem 0 0; color: #6c6865; font-size: .68rem; }
.assignment-main p i { margin-right: .25rem; }
.assignment-deadline small,.assignment-deadline strong { display: block; }
.assignment-deadline small { color: #6c6865; font-size: .6rem; }
.assignment-deadline strong { margin-top: .12rem; color: #1e1e1e; font-size: .7rem; }
.evaluation-tabs { display: flex; gap: .35rem; padding: .35rem; border: 1px solid #e6dfd6; border-radius: .85rem; background: #fff; width: fit-content; }
.evaluation-tabs button { display: flex; gap: .4rem; align-items: center; padding: .5rem .85rem; border: 0; border-radius: .6rem; color: #4e5462; background: transparent; font-size: .74rem; font-weight: 700; }
.evaluation-tabs button.active { color: #fff; background: #593660; }
.management-loading { border: 1px solid #e6dfd6; border-radius: 1rem; background: #fff; }
.setup-grid { display: grid; grid-template-columns: minmax(0,1.55fr) minmax(300px,.85fr); gap: 1rem; align-items: start; }
.setup-aside { display: grid; gap: 1rem; }
.period-list { grid-column: 1 / -1; }
.config-body { display: grid; gap: 1rem; padding: 1rem 1.15rem; }
.config-body label > span,.period-form label > span { display: block; margin-bottom: .3rem; color: #4e5462; font-size: .7rem; font-weight: 700; }
.config-body .form-control,.config-body .form-select { border-color: #d9d0c5; border-radius: .55rem; font-size: .76rem; }
.preview-box { padding: 1rem; border: 1px dashed #c8b6d0; border-radius: .85rem; background: #fdfbf8; }
.preview-box h3 { margin: 0 0 .25rem; color: #1e1e1e; font-size: 1rem; }
.preview-box > p { margin: 0 0 .85rem; color: #6c6865; font-size: .74rem; }
.preview-list { max-height: none !important; padding: 0 !important; }
.question-builder-header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: .5rem; padding-top: .2rem; }
.question-builder-header strong { display: block; margin-top: .12rem; color: #1e1e1e; font-size: .8rem; }
.question-builder-actions { display: flex; gap: .45rem; flex-wrap: wrap; }
.question-builder { display: grid; gap: .65rem; margin: 0; padding: 0; list-style: none; }
.question-builder li { display: grid; grid-template-columns: auto 1fr; gap: .6rem; align-items: start; padding: .8rem; border: 1px solid #e6dfd6; border-radius: .75rem; background: #faf6ef; }
.question-number { display: grid; place-items: center; width: 1.8rem; height: 1.8rem; border-radius: .5rem; color: #593660; background: #efe7f2; font-size: .68rem; font-weight: 800; }
.question-fields { display: grid; gap: .45rem; }
.help-input { font-size: .7rem !important; background: #fff; }
.question-meta-row { display: flex; gap: .65rem; align-items: center; flex-wrap: wrap; }
.question-meta-row select { max-width: 155px; }
.question-meta-row .form-check { display: flex; gap: .35rem; align-items: center; margin: 0; font-size: .72rem; }
.question-meta-row .form-check-input { margin: 0; }
.question-meta-row .form-check span { margin: 0; }
.question-tools { display: flex; gap: .3rem; margin-left: auto; }
.question-tools button { display: grid; place-items: center; width: 1.85rem; height: 1.85rem; border: 1px solid #d9d0c5; border-radius: .48rem; color: #4e5462; background: #fff; }
.question-tools button.danger { border-color: #eadbd6; color: #9a4538; }
.question-tools button:disabled { opacity: .35; }
.form-error { display: flex; gap: .4rem; margin: 0; padding: .65rem; border: 1px solid #edd0c8; border-radius: .6rem; color: #8f493b; background: #fff7f5; font-size: .72rem; line-height: 1.45; }
.config-surface > footer { display: flex; gap: .8rem; align-items: center; justify-content: space-between; padding: .85rem 1.15rem; border-top: 1px solid #ece6dd; }
.config-surface > footer > span { color: #6c6865; font-size: .68rem; }
.period-form { gap: .8rem; }
.period-form label small { display: block; margin-top: .25rem; color: #6c6865; font-size: .64rem; line-height: 1.4; }
.threshold-control { display: flex; gap: .6rem; align-items: center; }
.threshold-control input { min-width: 0; flex: 1; accent-color: #593660; }
.threshold-control strong { color: #593660; font-size: .74rem; white-space: nowrap; }
.compact-list ul { display: grid; margin: 0; padding: .45rem .9rem .9rem; list-style: none; }
.compact-list li { display: flex; gap: .5rem; align-items: center; justify-content: space-between; padding: .7rem .55rem; border-top: 1px solid #ece6dd; border-radius: .5rem; }
.compact-list li:first-child { border-top: 0; }
.compact-list li.active { background: #f5eff7; }
.compact-list li strong,.compact-list li small { display: block; }
.compact-list li strong { color: #1e1e1e; font-size: .76rem; }
.compact-list li small { margin-top: .14rem; color: #6c6865; font-size: .64rem; }
.compact-list .empty-list { justify-content: center; color: #6c6865; font-size: .72rem; }
.period-table { overflow-x: auto; }
.period-table table { width: 100%; min-width: 820px; border-collapse: collapse; }
.period-table th { padding: .7rem .85rem; color: #6c6865; background: #faf6ef; font-size: .64rem; letter-spacing: .04em; text-align: left; text-transform: uppercase; }
.period-table td { padding: .75rem .85rem; border-top: 1px solid #ece6dd; color: #4e5462; font-size: .74rem; }
.period-table tr.active td { background: #f5eff7; }
.period-table td strong,.period-table td small,.period-table td span { display: block; }
.period-table td strong { color: #1e1e1e; font-size: .78rem; }
.period-table td small { color: #6c6865; font-size: .66rem; }
.period-table td span { color: #8c8783; font-size: .6rem; }
.report-toolbar { display: flex; gap: 1rem; align-items: flex-end; justify-content: space-between; padding: 1rem 1.15rem; border-bottom: 1px solid #ece6dd; }
.report-filters { display: flex; gap: .55rem; align-items: flex-end; }
.report-filters label > span { display: block; margin-bottom: .25rem; color: #6c6865; font-size: .64rem; font-weight: 700; }
.report-filters .form-select { min-width: 170px; border-color: #d9d0c5; font-size: .72rem; }
.confidentiality-row { display: flex; gap: .5rem; padding: .65rem 1.15rem; border-bottom: 1px solid #ece6dd; background: #faf6ef; }
.confidentiality-row span { padding: .28rem .55rem; border-radius: 999px; color: #593660; background: #fff; font-size: .64rem; font-weight: 700; }
.confidentiality-row i { margin-right: .25rem; color: #593660; }
.report-groups { display: grid; gap: .8rem; padding: 1rem; }
.report-groups > article { overflow: hidden; border: 1px solid #e6dfd6; border-radius: .85rem; }
.report-groups > article.suppressed { border-color: #eadcb8; background: #fffcf5; }
.report-groups > article > header { display: flex; gap: .8rem; align-items: center; padding: .85rem .95rem; border-bottom: 1px solid #ece6dd; }
.report-groups > article > header > div:first-child { flex: 1; }
.report-groups header small { color: #775a83; font-size: .62rem; font-weight: 800; text-transform: uppercase; }
.report-groups header h3 { margin: .1rem 0 0; color: #1e1e1e; font-size: .86rem; }
.report-groups header p { margin: .15rem 0 0; color: #6c6865; font-size: .66rem; }
.score { text-align: right; }
.score strong,.score small { display: block; }
.score strong { color: #593660; font-size: 1.3rem; }
.score small { margin-top: .08rem; color: #6c6865; font-size: .62rem; }
.suppression-note { display: flex; gap: .6rem; align-items: center; padding: .85rem .95rem; color: #7e6022; }
.suppression-note > i { font-size: 1.1rem; }
.suppression-note strong { display: block; font-size: .74rem; }
.suppression-note p { margin: .14rem 0 0; font-size: .66rem; }
.question-stats { display: grid; }
.question-stats > div { display: grid; grid-template-columns: minmax(200px,1fr) auto auto; gap: .8rem; align-items: center; padding: .7rem .95rem; border-top: 1px solid #ece6dd; }
.question-stats > div:first-child { border-top: 0; }
.question-stats span strong,.question-stats span small { display: block; }
.question-stats span strong { color: #1e1e1e; font-size: .72rem; }
.question-stats span small { margin-top: .1rem; color: #6c6865; font-size: .62rem; }
.question-stats > div > strong { color: #593660; font-size: .78rem; }
.mini-scale { display: flex; gap: .18rem; }
.mini-scale i { width: .72rem; height: .32rem; border-radius: 999px; background: #ece4d8; }
.mini-scale i.active { background: #593660; }
.excluded-chip { padding: .25rem .5rem; border-radius: .4rem; color: #6c6865; background: #f4efe8; font-size: .62rem; }
.excluded-chip i { margin-right: .2rem; }
.evaluation-modal { position: fixed; z-index: 1060; inset: 0; display: grid; place-items: center; padding: 1rem; background: rgba(30,20,34,.52); backdrop-filter: blur(2px); }
.evaluation-modal > section { overflow: hidden; width: min(760px,100%); max-height: calc(100vh - 2rem); border-radius: 1rem; background: #fff; box-shadow: 0 24px 70px rgba(30,20,34,.26); }
.evaluation-modal > section > header { display: flex; justify-content: space-between; padding: 1rem 1.15rem; border-bottom: 1px solid #ece6dd; }
.evaluation-modal header span { color: #775a83; font-size: .66rem; font-weight: 800; }
.evaluation-modal header h2 { margin: .15rem 0 0; color: #1e1e1e; font-size: 1rem; }
.evaluation-modal header p { margin: .15rem 0 0; color: #6c6865; font-size: .7rem; }
.evaluation-modal header button { display: grid; place-items: center; width: 2rem; height: 2rem; border: 1px solid #d9d0c5; border-radius: .55rem; color: #4e5462; background: #fff; }
.modal-privacy { display: flex; gap: .6rem; padding: .75rem 1.1rem; color: #3e2344; background: #f5eff7; }
.modal-privacy p { margin: 0; }
.modal-privacy strong,.modal-privacy span { display: block; }
.modal-privacy strong { font-size: .72rem; }
.modal-privacy span { margin-top: .1rem; color: #4e5462; font-size: .64rem; }
.student-questions { display: grid; gap: .8rem; overflow-y: auto; max-height: 58vh; margin: 0; padding: 1rem; list-style: none; }
.student-questions li { padding: .85rem; border: 1px solid #e6dfd6; border-radius: .8rem; background: #fff; }
.student-questions li > header { display: flex; gap: .6rem; }
.student-questions li > header > span { display: grid; place-items: center; flex: 0 0 auto; width: 1.75rem; height: 1.75rem; border-radius: .5rem; color: #593660; background: #f5eff7; font-size: .64rem; font-weight: 800; }
.student-questions li > header strong { color: #1e1e1e; font-size: .76rem; line-height: 1.45; }
.student-questions li > header em { margin-left: .25rem; color: #9a5b13; font-size: .56rem; font-style: normal; text-transform: uppercase; }
.student-questions li > header small { display: block; margin-top: .12rem; color: #6c6865; font-size: .64rem; }
.likert { display: grid; grid-template-columns: 95px 1fr 95px; gap: .6rem; align-items: center; margin-top: .8rem; }
.likert > small { color: #6c6865; font-size: .6rem; }
.likert > small:last-child { text-align: right; }
.likert > div { display: flex; justify-content: center; gap: .45rem; }
.likert label input,.boolean-answer label input { position: absolute; opacity: 0; }
.likert label span { display: grid; place-items: center; width: 2.1rem; height: 2.1rem; border: 1px solid #d9d0c5; border-radius: .55rem; color: #4e5462; background: #fff; font-size: .72rem; font-weight: 800; cursor: pointer; }
.likert label.selected span { border-color: #593660; color: #fff; background: #593660; }
.boolean-answer { display: flex; gap: .55rem; margin-top: .8rem; }
.boolean-answer label { display: flex; gap: .35rem; align-items: center; padding: .45rem .85rem; border: 1px solid #d9d0c5; border-radius: .55rem; color: #4e5462; font-size: .72rem; cursor: pointer; }
.boolean-answer label.selected { border-color: #593660; color: #593660; background: #f5eff7; }
.student-questions textarea { margin-top: .7rem; border-color: #d9d0c5; font-size: .74rem; }
.evaluation-modal > section > footer { display: flex; gap: .8rem; align-items: center; justify-content: space-between; padding: .85rem 1.1rem; border-top: 1px solid #ece6dd; }
.evaluation-modal footer > span { color: #6c6865; font-size: .64rem; }
.evaluation-modal footer > div { display: flex; gap: .5rem; }
@media (max-width:1199.98px) { .management-summary { grid-template-columns: repeat(2,1fr); }.setup-grid { grid-template-columns: 1fr; }.period-list { grid-column: auto; }.setup-aside { grid-template-columns: repeat(2,1fr); } }
@media (max-width:767.98px) { .evaluation-page { gap: 1rem; }.privacy-banner { grid-template-columns: auto 1fr; }.privacy-banner > small { grid-column: 2; justify-self: start; }.student-summary,.management-summary { grid-template-columns: 1fr; }.assignment-list article { grid-template-columns: auto 1fr; }.assignment-deadline { grid-column: 2; }.assignment-list article > .status-badge,.assignment-list article > .btn { grid-column: 2; justify-self: start; }.setup-aside { grid-template-columns: 1fr; }.report-toolbar { align-items: stretch; flex-direction: column; }.report-filters { display: grid; grid-template-columns: 1fr 1fr; }.report-filters .form-select { min-width: 0; }.report-filters button { grid-column: 1 / -1; }.confidentiality-row { overflow-x: auto; }.confidentiality-row span { white-space: nowrap; }.question-stats > div { grid-template-columns: 1fr auto; }.question-stats .mini-scale { grid-row: 2; }.evaluation-modal { padding: 0; }.evaluation-modal > section { width: 100%; max-height: 100vh; border-radius: 0; }.student-questions { max-height: calc(100vh - 245px); }.likert { grid-template-columns: 1fr; }.likert > small:first-child { text-align: left; }.likert > small:last-child { text-align: right; }.evaluation-modal > section > footer { align-items: stretch; flex-direction: column; }.evaluation-modal footer > div { display: grid; grid-template-columns: 1fr 1fr; }.evaluation-modal footer .btn { width: 100%; } }
@media (max-width:480px) { .report-filters { grid-template-columns: 1fr; }.report-filters button { grid-column: auto; }.question-meta-row { align-items: stretch; flex-direction: column; }.question-meta-row select { max-width: none; }.question-tools { margin-left: 0; }.likert > div { gap: .25rem; }.likert label span { width: 1.85rem; height: 1.85rem; }.config-surface > footer { align-items: stretch; flex-direction: column; }.config-surface > footer .btn { width: 100%; } }
</style>
