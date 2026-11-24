<script setup lang="ts">
import type {
  AcademicAdministrationWorkspace,
  AcademicTranscript,
  AdvisingSession,
  LeaveRequest,
  MbkmActivity,
  SemesterResult,
  ThesisRecord,
} from '~/server/types/academic-administration'
import type { SafeRichContent } from '~/server/types/learning'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Administrasi Akademik' })

type TabId = 'overview' | 'leave' | 'advising' | 'rps' | 'thesis' | 'mbkm'
const { user } = useAuth()
const config = useRuntimeConfig()
const { $api } = useNuxtApp()
const workspace = ref<AcademicAdministrationWorkspace | null>(null)
const semester = ref<SemesterResult | null>(null)
const transcript = ref<AcademicTranscript | null>(null)
const tab = ref<TabId>('overview')
const loading = ref(true)
const mutating = ref(false)
const errorMessage = ref('')
const noticeMessage = ref('')
const studentLookup = ref('')

const leaveForm = reactive({ periodId: '', reason: '', supportingFileId: '' })
const advisingForm = reactive({ topic: '', requestedAt: '' })
const rpsForm = reactive({ courseVersionId: '', periodId: '', title: '', description: '', outcome: '', topic: '', status: 'DRAFT' as 'DRAFT' | 'PUBLISHED' })
const thesisForm = reactive({ title: '', abstract: '', proposalFileId: '' })
const guidanceForm = reactive({ occurredAt: '', summary: '', nextAction: '' })
const mbkmForm = reactive({ periodId: '', scheme: 'INTERNSHIP' as MbkmActivity['scheme'], partnerName: '', title: '', startsOn: '', endsOn: '' })
const logForm = reactive({ occurredOn: '', activity: '', hours: 8, evidenceFileId: '' })
const evaluationForm = reactive({ score: 80, note: '', courseCode: '', credits: 3, gradeLetter: 'A' })

const activeRole = computed(() => user.value?.activeRole || user.value?.roles[0] || '')
const isStudent = computed(() => activeRole.value === 'student')
const isStaff = computed(() => activeRole.value === 'academic_staff')
const canGuide = computed(() => ['academic_staff', 'advisor', 'lecturer'].includes(activeRole.value))
const profile = computed(() => workspace.value?.profile)
const activePeriods = computed(() => (workspace.value?.periods || []).filter(item => !item.deletedAt && item.active))
const activePeriod = computed(() => activePeriods.value.find(item => item.id === profile.value?.currentPeriodId) || activePeriods.value[0])
const thesis = computed(() => workspace.value?.theses[0])
const mbkm = computed(() => workspace.value?.mbkmActivities[0])
const tabs = computed(() => [
  { id: 'overview' as const, label: 'Ringkasan', icon: 'uil-estate' },
  { id: 'leave' as const, label: 'Cuti', icon: 'uil-pause-circle', count: workspace.value?.leaveRequests.length },
  { id: 'advising' as const, label: 'Perwalian', icon: 'uil-comments', count: workspace.value?.advisingSessions.length },
  { id: 'rps' as const, label: 'RPS', icon: 'uil-file-alt', count: workspace.value?.rpsVersions.length },
  { id: 'thesis' as const, label: 'Tugas akhir', icon: 'uil-graduation-cap', count: workspace.value?.theses.length },
  { id: 'mbkm' as const, label: 'MBKM', icon: 'uil-briefcase-alt', count: workspace.value?.mbkmActivities.length },
])

const key = (purpose: string) => `${purpose}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`
const errorText = (error: unknown) => {
  const value = error as { response?: { data?: { statusMessage?: string; message?: string } }; message?: string }
  return value.response?.data?.statusMessage || value.response?.data?.message || value.message || 'Permintaan administrasi akademik tidak dapat diproses.'
}
const plain = (content?: SafeRichContent) => content?.format === 'PLAIN_TEXT' ? content.text : content?.ops.map(item => item.insert).join('') || ''
const date = (value?: string, time = false) => value ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', ...(time ? { timeStyle: 'short' as const } : {}), timeZone: 'Asia/Jakarta' }).format(new Date(value)) : '—'
const label = (status: string) => ({
  ACTIVE: 'Aktif', LEAVE: 'Cuti', INACTIVE: 'Tidak aktif', GRADUATED: 'Lulus', TRANSFERRED_OUT: 'Pindah',
  SUBMITTED: 'Diajukan', APPROVED: 'Disetujui', REJECTED: 'Ditolak', CANCELLED: 'Dibatalkan',
  REQUESTED: 'Diminta', SCHEDULED: 'Terjadwal', COMPLETED: 'Selesai', DRAFT: 'Draf', PUBLISHED: 'Terbit',
  PROPOSED: 'Diajukan', IN_PROGRESS: 'Dalam bimbingan', READY_FOR_DEFENSE: 'Siap sidang', PASSED: 'Lulus',
  ODD: 'Gasal', EVEN: 'Genap', SHORT: 'Pendek', REGULAR: 'Reguler', TRANSFER: 'Transfer', DOUBLE_DEGREE: 'Gelar ganda',
  INTERNSHIP: 'Magang', EXCHANGE: 'Pertukaran', TEACHING: 'Mengajar', RESEARCH: 'Riset', ENTREPRENEURSHIP: 'Wirausaha', HUMANITARIAN: 'Kemanusiaan',
})[status] || status.replaceAll('_', ' ')
const tone = (status: string) => ({
  ACTIVE: 'active', APPROVED: 'active', COMPLETED: 'active', PUBLISHED: 'active', PASSED: 'active',
  SUBMITTED: 'pending', REQUESTED: 'pending', PROPOSED: 'pending', SCHEDULED: 'scheduled', IN_PROGRESS: 'scheduled', READY_FOR_DEFENSE: 'scheduled',
  REJECTED: 'blocked', CANCELLED: 'inactive', DRAFT: 'draft', LEAVE: 'review',
})[status] || 'draft'

const defaults = () => {
  const periodId = activePeriod.value?.id || ''
  leaveForm.periodId ||= periodId
  rpsForm.periodId ||= periodId
  mbkmForm.periodId ||= periodId
  rpsForm.courseVersionId ||= (workspace.value?.courses || []).find(item => !item.deletedAt && item.status === 'ACTIVE')?.id || ''
  advisingForm.requestedAt ||= new Date(Date.now() + 86_400_000).toISOString().slice(0, 16)
  guidanceForm.occurredAt ||= new Date().toISOString().slice(0, 16)
}

const load = async () => {
  loading.value = true
  errorMessage.value = ''
  try {
    const requested = studentLookup.value.trim() || (config.public.demoMode && !isStudent.value ? 'student-001' : '')
    const response = await $api.get<AcademicAdministrationWorkspace>('/academic/administration', { params: requested ? { studentId: requested } : {} })
    workspace.value = response.data
    if (response.data.profile) studentLookup.value = response.data.profile.studentId
    defaults()
    if (response.data.profile) {
      const studentId = encodeURIComponent(response.data.profile.studentId)
      const periodId = activePeriod.value?.id || response.data.profile.currentPeriodId
      const [resultResponse, transcriptResponse] = await Promise.all([
        $api.get<SemesterResult>(`/academic/results/${studentId}`, { params: { periodId } }),
        $api.get<AcademicTranscript>(`/academic/transcripts/${studentId}`),
      ])
      semester.value = resultResponse.data
      transcript.value = transcriptResponse.data
    } else {
      semester.value = null
      transcript.value = null
    }
  } catch (error) {
    errorMessage.value = errorText(error)
  } finally {
    loading.value = false
  }
}

const run = async (action: () => Promise<void>, success: string) => {
  mutating.value = true
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    await action()
    noticeMessage.value = success
    await load()
  } catch (error) {
    errorMessage.value = errorText(error)
  } finally {
    mutating.value = false
  }
}

const submitLeave = () => run(async () => {
  await $api.post('/academic/leave', { periodId: leaveForm.periodId, reason: leaveForm.reason, supportingFileId: leaveForm.supportingFileId || undefined }, { headers: { 'Idempotency-Key': key('academic-leave') } })
  leaveForm.reason = ''; leaveForm.supportingFileId = ''
}, 'Pengajuan cuti berhasil dikirim untuk ditinjau.')
const reviewLeave = (item: LeaveRequest, decision: 'APPROVED' | 'REJECTED') => run(async () => {
  await $api.post(`/academic/leave/${encodeURIComponent(item.id)}/review`, { decision, reviewNote: decision === 'APPROVED' ? 'Persyaratan akademik telah diverifikasi.' : 'Pengajuan belum memenuhi persyaratan.', expectedVersion: item.version })
}, `Pengajuan cuti berhasil ${decision === 'APPROVED' ? 'disetujui' : 'ditolak'}.`)

const requestAdvising = () => run(async () => {
  await $api.post('/academic/advising', { topic: advisingForm.topic, requestedAt: new Date(advisingForm.requestedAt).toISOString() }, { headers: { 'Idempotency-Key': key('academic-advising') } })
  advisingForm.topic = ''
}, 'Permintaan perwalian berhasil dikirim.')
const updateAdvising = (item: AdvisingSession, status: 'SCHEDULED' | 'COMPLETED' | 'CANCELLED') => run(async () => {
  const body: Record<string, unknown> = { status, expectedVersion: item.version }
  if (status === 'SCHEDULED') Object.assign(body, { scheduledAt: new Date(Date.now() + 86_400_000).toISOString(), channel: 'VIDEO' })
  if (status === 'COMPLETED') Object.assign(body, { studentSummary: 'Rencana tindak lanjut telah disepakati.', privateAdvisorNote: 'Catatan internal pembimbing; dirahasiakan dari mahasiswa.' })
  await $api.put(`/academic/advising/${encodeURIComponent(item.id)}`, body)
}, `Sesi diperbarui menjadi ${label(status).toLowerCase()}.`)

const createRps = () => run(async () => {
  const course = workspace.value?.courses.find(item => item.id === rpsForm.courseVersionId)
  if (!course) throw new Error('Pilih versi mata kuliah.')
  const versions = workspace.value?.rpsVersions.filter(item => item.courseVersionId === course.id && item.periodId === rpsForm.periodId).map(item => item.version) || []
  await $api.post('/academic/rps', {
    courseVersionId: course.id, programStudyId: course.programStudyId, periodId: rpsForm.periodId,
    lecturerIds: [user.value?.id || 'lecturer-001'], expectedCurrentVersion: Math.max(0, ...versions), title: rpsForm.title,
    description: { format: 'PLAIN_TEXT', text: rpsForm.description }, courseLearningOutcomes: [rpsForm.outcome],
    sections: [{ week: 1, learningOutcome: rpsForm.outcome, topic: rpsForm.topic, method: 'Tatap muka', assessment: 'Partisipasi', references: [] }],
    assessmentWeights: [{ label: 'Penilaian', weight: 100 }], status: rpsForm.status,
  }, { headers: { 'Idempotency-Key': key('academic-rps') } })
}, 'Versi RPS manual berhasil disimpan secara imutabel.')

const createThesis = () => run(async () => {
  await $api.post('/academic/theses', { title: thesisForm.title, abstract: { format: 'PLAIN_TEXT', text: thesisForm.abstract }, proposalFileId: thesisForm.proposalFileId || undefined }, { headers: { 'Idempotency-Key': key('academic-thesis') } })
}, 'Proposal tugas akhir berhasil diajukan.')
const thesisTransitionTargets: Record<ThesisRecord['status'], ThesisRecord['status'][]> = { PROPOSED: ['APPROVED', 'REJECTED'], APPROVED: ['IN_PROGRESS'], IN_PROGRESS: ['READY_FOR_DEFENSE'], READY_FOR_DEFENSE: ['PASSED', 'IN_PROGRESS'], PASSED: [], REJECTED: [] }
const thesisTargets = (item: ThesisRecord): ThesisRecord['status'][] => thesisTransitionTargets[item.status]
const transitionThesis = (item: ThesisRecord, status: ThesisRecord['status']) => run(async () => {
  await $api.post(`/academic/theses/${encodeURIComponent(item.id)}/transition`, { status, expectedVersion: item.version })
}, `Status tugas akhir menjadi ${label(status).toLowerCase()}.`)
const addGuidance = (item: ThesisRecord) => run(async () => {
  await $api.post(`/academic/theses/${encodeURIComponent(item.id)}/guidance`, { occurredAt: new Date(guidanceForm.occurredAt).toISOString(), summary: guidanceForm.summary, nextAction: guidanceForm.nextAction, expectedVersion: item.version }, { headers: { 'Idempotency-Key': key('thesis-guidance') } })
  guidanceForm.summary = ''; guidanceForm.nextAction = ''
}, 'Catatan bimbingan imutabel berhasil ditambahkan.')

const createMbkm = () => run(async () => {
  await $api.post('/academic/mbkm', { ...mbkmForm }, { headers: { 'Idempotency-Key': key('academic-mbkm') } })
}, 'Pengajuan MBKM berhasil dikirim.')
const mbkmTransitionTargets: Record<MbkmActivity['status'], MbkmActivity['status'][]> = { PROPOSED: ['APPROVED', 'REJECTED'], APPROVED: ['ACTIVE', 'REJECTED'], ACTIVE: ['COMPLETED'], COMPLETED: [], REJECTED: [] }
const mbkmTargets = (item: MbkmActivity): MbkmActivity['status'][] => mbkmTransitionTargets[item.status]
const transitionMbkm = (item: MbkmActivity, status: MbkmActivity['status']) => run(async () => {
  await $api.post(`/academic/mbkm/${encodeURIComponent(item.id)}/transition`, { status, expectedVersion: item.version })
}, `Status MBKM menjadi ${label(status).toLowerCase()}.`)
const addLog = (item: MbkmActivity) => run(async () => {
  await $api.post(`/academic/mbkm/${encodeURIComponent(item.id)}/log`, { occurredOn: logForm.occurredOn, activity: logForm.activity, hours: Number(logForm.hours), evidenceFileId: logForm.evidenceFileId || undefined, expectedVersion: item.version }, { headers: { 'Idempotency-Key': key('mbkm-log') } })
  logForm.activity = ''; logForm.evidenceFileId = ''
}, 'Logbook MBKM berhasil ditambahkan.')
const evaluate = (item: MbkmActivity) => run(async () => {
  await $api.post(`/academic/mbkm/${encodeURIComponent(item.id)}/evaluation`, { score: Number(evaluationForm.score), note: evaluationForm.note, conversions: evaluationForm.courseCode ? [{ courseCode: evaluationForm.courseCode.toUpperCase(), credits: Number(evaluationForm.credits), gradeLetter: evaluationForm.gradeLetter.toUpperCase() }] : [], expectedVersion: item.version })
}, 'Evaluasi dan konversi MBKM berhasil disimpan.')

watch(activeRole, () => { load() })
onMounted(load)
</script>

<template>
  <div class="page-stack academic-admin">
    <AppPageHeader eyebrow="Administrasi akademik" title="Pusat akademik mahasiswa" description="Status studi, hasil belajar, perwalian, RPS, tugas akhir, dan aktivitas MBKM dalam satu ruang kerja.">
      <template #actions>
        <NuxtLink v-if="isStaff" class="btn btn-outline-secondary" to="/akademik/master"><i class="uil uil-database me-2" />Master data</NuxtLink>
        <NuxtLink class="btn btn-outline-secondary" to="/akademik/krs"><i class="uil uil-clipboard-alt me-2" />Buka KRS</NuxtLink>
        <NuxtLink class="btn btn-primary" to="/akademik/kelas"><i class="uil uil-presentation-check me-2" />Pelaksanaan kelas</NuxtLink>
      </template>
    </AppPageHeader>

    <div v-if="errorMessage" class="alert alert-danger" role="alert">{{ errorMessage }}</div>
    <div v-if="noticeMessage" class="alert alert-success" role="status">{{ noticeMessage }}</div>
    <div v-if="loading" class="alert alert-info" role="status">Memuat data akademik terbaru...</div>

    <section v-if="!isStudent" class="surface-card lookup-card">
      <label for="studentLookup">Mahasiswa dalam lingkup akses</label>
      <div class="input-group"><input id="studentLookup" v-model="studentLookup" class="form-control" placeholder="ID mahasiswa, contoh: student-001" @keyup.enter="load"><button class="btn btn-outline-primary" type="button" :disabled="loading" @click="load">Tampilkan</button></div>
      <small>Kosongkan untuk ruang kerja tingkat program studi tanpa data pribadi.</small>
    </section>

    <section v-if="profile" class="profile-strip">
      <div class="profile-identity"><span><i class="uil uil-user" /></span><div><strong>{{ profile.studentName }}</strong><small>{{ profile.studentNumber }} · {{ workspace?.programs.find(item => item.id === profile?.programStudyId)?.name || profile.programStudyId }}</small></div></div>
      <div><small>Status</small><StatusBadge :status="tone(profile.status)" :label="label(profile.status)" /></div>
      <div><small>Semester / angkatan</small><strong>Semester {{ profile.currentSemester || 1 }} ({{ (profile.currentSemester || 1) % 2 === 1 ? 'Ganjil' : 'Genap' }}) · {{ profile.cohortYear }}</strong></div>
      <div><small>SKS / IPK</small><strong>{{ profile.totalEarnedCredits }} / {{ profile.cumulativeGpa.toFixed(2) }}</strong></div>
    </section>

    <nav class="academic-tabs" aria-label="Bagian administrasi akademik"><button v-for="item in tabs" :key="item.id" type="button" :class="{ active: tab === item.id }" @click="tab = item.id"><i class="uil" :class="item.icon" /><span>{{ item.label }}</span><em v-if="item.count">{{ item.count }}</em></button></nav>

    <template v-if="workspace && tab === 'overview'">
      <div class="metric-grid">
        <article><span>Periode aktif</span><strong>{{ activePeriod?.academicYear || '—' }}</strong><small>{{ activePeriod ? label(activePeriod.term) : 'Belum ditetapkan' }}</small></article>
        <article><span>IPS periode</span><strong>{{ semester?.semesterGpa.toFixed(2) || '0.00' }}</strong><small>{{ semester?.attemptedCredits || 0 }} SKS ditempuh</small></article>
        <article><span>IPK provisional</span><strong>{{ transcript?.cumulativeGpa.toFixed(2) || '0.00' }}</strong><small>{{ transcript?.totalEarnedCredits || 0 }} SKS lulus</small></article>
        <article><span>Kurikulum</span><strong>v{{ workspace.curricula[0]?.version || '—' }}</strong><small>{{ workspace.curricula[0]?.name || 'Belum tersedia' }}</small></article>
      </div>
      <div class="content-grid">
        <section class="surface-card"><header class="section-heading"><div><span>Hasil terbit</span><h2>Kartu Hasil Studi</h2></div><button class="btn btn-sm btn-outline-secondary" type="button" onclick="window.print()"><i class="uil uil-print me-1" />Cetak</button></header><div v-if="semester?.rows.length" class="table-responsive"><table class="table align-middle"><thead><tr><th>Kode</th><th>Mata kuliah</th><th>SKS</th><th>Nilai</th></tr></thead><tbody><tr v-for="row in semester.rows" :key="row.id"><td><strong>{{ row.courseCode }}</strong></td><td>{{ row.courseName }}</td><td>{{ row.credits }}</td><td><span class="grade-chip">{{ row.letterGrade }}</span></td></tr></tbody></table></div><EmptyState v-else icon="uil-file-question" title="Belum ada nilai pada periode aktif" description="KHS hanya dibentuk dari nilai kelas yang telah diterbitkan secara imutabel." /></section>
        <section class="surface-card"><header class="section-heading"><div><span>Kalender</span><h2>Agenda dan tenggat</h2></div></header><div v-if="workspace.calendar.length" class="timeline-list"><article v-for="event in workspace.calendar" :key="event.id"><time>{{ date(event.startsAt) }}</time><div><strong>{{ event.title }}</strong><small>{{ label(event.category) }} · sampai {{ date(event.endsAt, true) }}</small><p v-if="event.description">{{ event.description }}</p></div></article></div><EmptyState v-else icon="uil-calendar-slash" title="Belum ada agenda" description="Kalender akademik untuk lingkup ini masih kosong." /></section>
      </div>
      <section v-if="transcript?.rows.length" class="surface-card"><header class="section-heading"><div><span>Dokumen sementara</span><h2>Transkrip provisional</h2><p>Belum menggantikan transkrip resmi bertanda tangan.</p></div><StatusBadge status="draft" label="Provisional" /></header><div class="table-responsive"><table class="table"><thead><tr><th>Periode</th><th>Kode</th><th>Mata kuliah</th><th>SKS</th><th>Nilai</th><th>Mutu</th></tr></thead><tbody><tr v-for="row in transcript.rows" :key="row.id"><td>{{ row.periodId }}</td><td><strong>{{ row.courseCode }}</strong></td><td>{{ row.courseName }}</td><td>{{ row.credits }}</td><td>{{ row.letterGrade }}</td><td>{{ (row.credits * row.gradePoint).toFixed(2) }}</td></tr></tbody></table></div></section>
    </template>

    <template v-else-if="workspace && tab === 'leave'">
      <div class="content-grid"><section v-if="isStudent" class="surface-card form-card"><header class="section-heading"><div><span>Pengajuan baru</span><h2>Cuti akademik</h2><p>Status studi dan cekal keuangan diperiksa otomatis.</p></div></header><form @submit.prevent="submitLeave"><label>Periode<select v-model="leaveForm.periodId" class="form-select" required><option v-for="period in workspace.periods" :key="period.id" :value="period.id">{{ period.academicYear }} · {{ label(period.term) }}</option></select></label><label>Alasan<textarea v-model="leaveForm.reason" class="form-control" rows="4" minlength="10" required /></label><label>ID berkas pendukung <small>(opsional)</small><input v-model="leaveForm.supportingFileId" class="form-control"></label><button class="btn btn-primary" :disabled="mutating">Ajukan cuti</button></form></section><RecordList title="Pengajuan cuti" eyebrow="Riwayat" :wide="!isStudent"><article v-for="item in workspace.leaveRequests" :key="item.id"><div><header><strong>{{ item.periodId }}</strong><StatusBadge :status="tone(item.status)" :label="label(item.status)" /></header><p>{{ item.reason }}</p><small>Diajukan {{ date(item.submittedAt, true) }} · versi {{ item.version }}</small><small v-if="item.reviewNote">Catatan: {{ item.reviewNote }}</small></div><aside v-if="isStaff && item.status === 'SUBMITTED'"><button class="btn btn-sm btn-outline-danger" @click="reviewLeave(item, 'REJECTED')">Tolak</button><button class="btn btn-sm btn-primary" @click="reviewLeave(item, 'APPROVED')">Setujui</button></aside></article><EmptyState v-if="!workspace.leaveRequests.length" icon="uil-pause-circle" title="Belum ada pengajuan" description="Riwayat keputusan cuti akan tampil di sini." /></RecordList></div>
    </template>

    <template v-else-if="workspace && tab === 'advising'">
      <div class="content-grid"><section v-if="isStudent" class="surface-card form-card"><header class="section-heading"><div><span>Konsultasi</span><h2>Minta sesi perwalian</h2></div></header><form @submit.prevent="requestAdvising"><label>Topik<textarea v-model="advisingForm.topic" class="form-control" rows="4" minlength="10" required /></label><label>Waktu yang diharapkan<input v-model="advisingForm.requestedAt" type="datetime-local" class="form-control" required></label><button class="btn btn-primary" :disabled="mutating">Kirim permintaan</button></form></section><RecordList title="Sesi perwalian" eyebrow="Riwayat aman" :wide="!isStudent" description="Catatan privat pembimbing tidak pernah dikirim ke mahasiswa atau wali."><article v-for="item in workspace.advisingSessions" :key="item.id"><div><header><strong>{{ item.topic }}</strong><StatusBadge :status="tone(item.status)" :label="label(item.status)" /></header><small>Diminta {{ date(item.requestedAt, true) }}<template v-if="item.scheduledAt"> · jadwal {{ date(item.scheduledAt, true) }}</template></small><p v-if="item.studentSummary">{{ item.studentSummary }}</p><p v-if="item.privateAdvisorNote" class="private-note"><i class="uil uil-lock" /> {{ item.privateAdvisorNote }}</p></div><aside v-if="canGuide && ['REQUESTED', 'SCHEDULED'].includes(item.status)"><button v-if="item.status === 'REQUESTED'" class="btn btn-sm btn-outline-primary" @click="updateAdvising(item, 'SCHEDULED')">Jadwalkan</button><button class="btn btn-sm btn-primary" @click="updateAdvising(item, 'COMPLETED')">Selesaikan</button><button class="btn btn-sm btn-outline-danger" @click="updateAdvising(item, 'CANCELLED')">Batalkan</button></aside></article><EmptyState v-if="!workspace.advisingSessions.length" icon="uil-comments" title="Belum ada sesi" description="Mahasiswa dapat meminta konsultasi kepada dosen wali." /></RecordList></div>
    </template>

    <template v-else-if="workspace && tab === 'rps'">
      <div class="content-grid"><section v-if="canGuide" class="surface-card form-card"><header class="section-heading"><div><span>Versi manual</span><h2>Susun RPS</h2><p>Setiap simpan membuat versi imutabel baru.</p></div></header><form @submit.prevent="createRps"><label>Mata kuliah<select v-model="rpsForm.courseVersionId" class="form-select" required><option v-for="course in workspace.courses" :key="course.id" :value="course.id">{{ course.code }} · {{ course.name }} (v{{ course.version }})</option></select></label><label>Periode<select v-model="rpsForm.periodId" class="form-select" required><option v-for="period in workspace.periods" :key="period.id" :value="period.id">{{ period.academicYear }} · {{ label(period.term) }}</option></select></label><label>Judul<input v-model="rpsForm.title" class="form-control" minlength="5" required></label><label>Deskripsi<textarea v-model="rpsForm.description" class="form-control" rows="3" required /></label><label>Capaian pembelajaran<textarea v-model="rpsForm.outcome" class="form-control" rows="2" minlength="3" required /></label><label>Topik minggu pertama<input v-model="rpsForm.topic" class="form-control" minlength="3" required></label><label>Status<select v-model="rpsForm.status" class="form-select"><option value="DRAFT">Draf</option><option value="PUBLISHED">Terbit (bobot 100%)</option></select></label><button class="btn btn-primary" :disabled="mutating">Simpan versi</button></form></section><RecordList title="RPS tersedia" eyebrow="Arsip versi" :wide="!canGuide"><article v-for="item in workspace.rpsVersions" :key="item.id"><div><header><strong>{{ item.title }}</strong><StatusBadge :status="tone(item.status)" :label="`${label(item.status)} · v${item.version}`" /></header><p>{{ plain(item.description) }}</p><small>{{ workspace.courses.find(course => course.id === item.courseVersionId)?.code }} · {{ item.sections.length }} minggu · bobot {{ item.assessmentWeights.reduce((sum, weight) => sum + weight.weight, 0) }}%</small></div></article><EmptyState v-if="!workspace.rpsVersions.length" icon="uil-file-alt" title="Belum ada RPS" description="RPS terbit dan versi lingkup pengampu tampil di sini." /></RecordList></div>
    </template>

    <template v-else-if="workspace && tab === 'thesis'">
      <div class="content-grid"><section v-if="isStudent && !thesis" class="surface-card form-card"><header class="section-heading"><div><span>Proposal baru</span><h2>Tugas akhir</h2></div></header><form @submit.prevent="createThesis"><label>Judul<input v-model="thesisForm.title" class="form-control" minlength="15" required></label><label>Abstrak<textarea v-model="thesisForm.abstract" class="form-control" rows="6" required /></label><label>ID berkas proposal <small>(opsional)</small><input v-model="thesisForm.proposalFileId" class="form-control"></label><button class="btn btn-primary">Ajukan proposal</button></form></section><RecordList title="Tugas akhir mahasiswa" eyebrow="Rekam jejak" :wide="!isStudent"><article v-for="item in workspace.theses" :key="item.id"><div><header><strong>{{ item.title }}</strong><StatusBadge :status="tone(item.status)" :label="label(item.status)" /></header><p>{{ plain(item.abstract) }}</p><small>{{ item.guidance.length }} bimbingan · versi {{ item.version }} · {{ date(item.updatedAt, true) }}</small><ol v-if="item.guidance.length"><li v-for="entry in item.guidance" :key="entry.id"><strong>{{ date(entry.occurredAt) }}</strong> — {{ entry.summary }}<em>Berikutnya: {{ entry.nextAction }}</em></li></ol></div><aside v-if="canGuide"><button v-for="target in thesisTargets(item)" :key="target" class="btn btn-sm" :class="target === 'REJECTED' ? 'btn-outline-danger' : 'btn-outline-primary'" @click="transitionThesis(item, target)">{{ label(target) }}</button></aside></article><EmptyState v-if="!workspace.theses.length" icon="uil-graduation-cap" title="Belum ada tugas akhir" description="Proposal dan bimbingan akan tersimpan sebagai rekam jejak." /></RecordList><section v-if="canGuide && thesis && ['APPROVED', 'IN_PROGRESS', 'READY_FOR_DEFENSE'].includes(thesis.status)" class="surface-card form-card"><header class="section-heading"><div><span>Catatan imutabel</span><h2>Tambah bimbingan</h2></div></header><form @submit.prevent="addGuidance(thesis)"><label>Waktu<input v-model="guidanceForm.occurredAt" type="datetime-local" class="form-control" required></label><label>Ringkasan<textarea v-model="guidanceForm.summary" class="form-control" rows="4" minlength="10" required /></label><label>Tindak lanjut<textarea v-model="guidanceForm.nextAction" class="form-control" rows="3" minlength="5" required /></label><button class="btn btn-primary">Simpan bimbingan</button></form></section></div>
    </template>

    <template v-else-if="workspace && tab === 'mbkm'">
      <div class="content-grid"><section v-if="isStudent && !mbkm" class="surface-card form-card"><header class="section-heading"><div><span>Aktivitas baru</span><h2>Ajukan MBKM</h2></div></header><form @submit.prevent="createMbkm"><label>Periode<select v-model="mbkmForm.periodId" class="form-select"><option v-for="period in workspace.periods" :key="period.id" :value="period.id">{{ period.academicYear }} · {{ label(period.term) }}</option></select></label><label>Skema<select v-model="mbkmForm.scheme" class="form-select"><option value="INTERNSHIP">Magang</option><option value="EXCHANGE">Pertukaran</option><option value="TEACHING">Mengajar</option><option value="RESEARCH">Riset</option><option value="ENTREPRENEURSHIP">Wirausaha</option><option value="HUMANITARIAN">Kemanusiaan</option></select></label><label>Mitra<input v-model="mbkmForm.partnerName" class="form-control" minlength="3" required></label><label>Judul kegiatan<input v-model="mbkmForm.title" class="form-control" minlength="5" required></label><div class="form-row"><label>Mulai<input v-model="mbkmForm.startsOn" type="date" class="form-control" required></label><label>Selesai<input v-model="mbkmForm.endsOn" type="date" class="form-control" required></label></div><button class="btn btn-primary">Ajukan MBKM</button></form></section><RecordList title="Riwayat MBKM" eyebrow="Aktivitas dan konversi"><article v-for="item in workspace.mbkmActivities" :key="item.id"><div><header><strong>{{ item.title }}</strong><StatusBadge :status="tone(item.status)" :label="label(item.status)" /></header><p>{{ label(item.scheme) }} · {{ item.partnerName }}</p><small>{{ item.startsOn }}—{{ item.endsOn }} · {{ item.logbook.length }} logbook · versi {{ item.version }}</small><p v-if="item.evaluation">Nilai {{ item.evaluation.score }} · {{ item.evaluation.note }}</p><div class="conversion-list"><span v-for="conversion in item.conversions" :key="conversion.courseCode">{{ conversion.courseCode }} · {{ conversion.credits }} SKS · {{ conversion.gradeLetter }}</span></div></div><aside v-if="canGuide"><button v-for="target in mbkmTargets(item)" :key="target" class="btn btn-sm" :disabled="target === 'COMPLETED' && !item.evaluation" :class="target === 'REJECTED' ? 'btn-outline-danger' : 'btn-outline-primary'" @click="transitionMbkm(item, target)">{{ label(target) }}</button></aside></article><EmptyState v-if="!workspace.mbkmActivities.length" icon="uil-briefcase-alt" title="Belum ada aktivitas MBKM" description="Pengajuan, logbook, evaluasi, dan konversi akan tampil di sini." /></RecordList><section v-if="mbkm?.status === 'ACTIVE' && (isStudent || canGuide)" class="surface-card form-card"><header class="section-heading"><div><span>Catatan harian</span><h2>Tambah logbook</h2></div></header><form @submit.prevent="addLog(mbkm)"><label>Tanggal<input v-model="logForm.occurredOn" type="date" :min="mbkm.startsOn" :max="mbkm.endsOn" class="form-control" required></label><label>Aktivitas<textarea v-model="logForm.activity" class="form-control" rows="4" minlength="10" required /></label><div class="form-row"><label>Jam<input v-model.number="logForm.hours" type="number" min="1" max="24" class="form-control"></label><label>ID bukti <small>(opsional)</small><input v-model="logForm.evidenceFileId" class="form-control"></label></div><button class="btn btn-primary">Tambah logbook</button></form></section><section v-if="mbkm && canGuide && ['APPROVED', 'ACTIVE'].includes(mbkm.status)" class="surface-card form-card"><header class="section-heading"><div><span>Penilaian pembimbing</span><h2>Evaluasi dan konversi</h2><p>Maksimal 24 SKS.</p></div></header><form @submit.prevent="evaluate(mbkm)"><label>Nilai<input v-model.number="evaluationForm.score" type="number" min="0" max="100" class="form-control"></label><label>Catatan<textarea v-model="evaluationForm.note" class="form-control" rows="3" minlength="10" required /></label><div class="form-row form-row--three"><label>Kode MK<input v-model="evaluationForm.courseCode" class="form-control" placeholder="MGT401"></label><label>SKS<input v-model.number="evaluationForm.credits" type="number" min="1" max="12" class="form-control"></label><label>Huruf<input v-model="evaluationForm.gradeLetter" class="form-control" maxlength="2"></label></div><button class="btn btn-primary">Simpan evaluasi</button></form></section></div>
    </template>
  </div>
</template>

<style scoped>
.academic-admin { display: grid; gap: 18px; }
.lookup-card { display: grid; grid-template-columns: .6fr 1fr; align-items: end; gap: 7px 18px; padding: 18px 20px; }
.lookup-card label { font-size: .7rem; font-weight: 800; }.lookup-card small { grid-column: 2; color: var(--campus-muted); font-size: .62rem; }
.profile-strip { display: grid; grid-template-columns: 1.5fr repeat(3, 1fr); align-items: center; gap: 18px; padding: 18px 20px; border: 1px solid var(--campus-border); border-radius: 16px; background: linear-gradient(125deg,#fff,#f4f8f4); box-shadow: var(--campus-shadow-sm); }
.profile-strip > div,.profile-identity > div { display: flex; flex-direction: column; gap: 4px; }.profile-identity { flex-direction: row!important; align-items: center; gap: 12px!important; }.profile-identity > span { display: grid; width: 44px; height: 44px; place-items: center; border-radius: 13px; color: #fff; background: var(--campus-forest-700); font-size: 1.25rem; }.profile-strip small { color: var(--campus-muted); font-size: .62rem; }.profile-strip strong { font-size: .78rem; }
.academic-tabs { display: flex; gap: 7px; overflow-x: auto; padding: 6px; border: 1px solid var(--campus-border); border-radius: 14px; background: #fff; }.academic-tabs button { display: inline-flex; min-width: 112px; flex: 1; align-items: center; justify-content: center; gap: 7px; padding: 10px; border: 0; border-radius: 10px; color: var(--campus-muted); background: transparent; font-size: .68rem; font-weight: 750; }.academic-tabs button.active { color: #fff; background: var(--campus-forest-700); }.academic-tabs em { padding: 1px 5px; border-radius: 8px; background: rgba(255,255,255,.16); font-size: .56rem; font-style: normal; }
.metric-grid { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 18px; }.metric-grid article { display: flex; min-height: 112px; flex-direction: column; justify-content: center; padding: 18px; border: 1px solid var(--campus-border); border-radius: 15px; background: #fff; box-shadow: var(--campus-shadow-sm); }.metric-grid span,.metric-grid small { color: var(--campus-muted); font-size: .63rem; }.metric-grid strong { margin: 5px 0 2px; color: var(--campus-forest-900); font-family: var(--campus-display); font-size: 1.3rem; }
.content-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 18px; align-items: start; }.surface-card { padding: 20px; }.section-heading { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 16px; }.section-heading span { color: var(--campus-gold-700); font-size: .57rem; font-weight: 850; letter-spacing: .09em; text-transform: uppercase; }.section-heading h2 { margin: 3px 0 0; font-size: 1rem; }.section-heading p { margin: 5px 0 0; color: var(--campus-muted); font-size: .65rem; }
.form-card form { display: grid; gap: 13px; }.form-card label { display: grid; gap: 6px; font-size: .65rem; font-weight: 750; }.form-card label small { color: var(--campus-muted); font-weight: 500; }.form-row { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 12px; }.form-row--three { grid-template-columns: 1.4fr .6fr .6fr; }.form-control,.form-select,.table { font-size: .7rem; }.table th { color: var(--campus-muted); font-size: .58rem; text-transform: uppercase; }.grade-chip { display: inline-grid; width: 30px; height: 28px; place-items: center; border-radius: 8px; color: var(--campus-forest-800); background: #e8f3ec; font-weight: 850; }
.timeline-list article { display: grid; grid-template-columns: 95px 1fr; gap: 14px; padding: 12px 0; border-bottom: 1px solid var(--campus-border); }.timeline-list time { color: var(--campus-gold-700); font-size: .64rem; font-weight: 800; }.timeline-list div { display: flex; flex-direction: column; gap: 3px; }.timeline-list strong { font-size: .72rem; }.timeline-list small,.timeline-list p { margin: 0; color: var(--campus-muted); font-size: .62rem; }.private-note { padding: 8px; border-radius: 8px; color: #6e5213!important; background: #fff6d9; }.conversion-list { display: flex; flex-wrap: wrap; gap: 6px; }.conversion-list span { padding: 5px 8px; border-radius: 7px; color: var(--campus-forest-800); background: #e8f3ec; font-size: .6rem; }
@media(max-width:1050px){.profile-strip,.metric-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.profile-identity{grid-column:1/-1}}@media(max-width:767px){.lookup-card,.content-grid,.metric-grid,.form-row,.form-row--three{grid-template-columns:1fr}.lookup-card small{grid-column:auto}}
</style>
