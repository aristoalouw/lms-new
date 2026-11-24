<script setup lang="ts">
import type {
  AcademicAdministrationWorkspace,
  AcademicPeriodDefinition,
  AcademicProgramStudy,
} from '~/server/types/academic-administration'

type AttendanceStatus = 'PRESENT' | 'LATE' | 'EXCUSED' | 'ABSENT'
interface MeetingSchedule { meetingNumber: number; scheduledStartAt: string; scheduledEndAt: string; attendanceOpensAt: string; attendanceClosesAt: string }
interface ClassRecord { id: string; courseCode: string; courseName: string; credits: number; section: string; periodId: string; programStudyId: string; lecturerNames: string[]; status: string; totalScheduledMeetings: number; realizedMeetingCount: number; schedule: MeetingSchedule[]; gradeConfigVersion: number; gradebookVersion: number; publicationVersion: number; publishedGradebookVersion?: number; deletedAt?: string }
interface RosterEntry { studentId: string; studentNumber: string; studentName: string; status: string }
interface Journal { id: string; meetingNumber: number; scheduledStartAt: string; occurredAt: string; durationMinutes: number; topic: string; deliveryMode: string; realization: string; scheduleVarianceMinutes: number }
interface Attendance { id: string; meetingNumber: number; studentId: string; status: AttendanceStatus; source: string; version: number; checkedInAt?: string; correctionReason?: string }
interface Component { id: string; label: string; weight: number; maxScore: number; order: number }
interface GradeConfig { version: number; components: Component[] }
interface Grade { studentId: string; componentScores: Record<string, number>; finalScore: number; letterGrade: string; configVersion: number; version: number }
interface ClassDetail { classRecord: ClassRecord; roster: RosterEntry[]; journals: Journal[]; attendance: Attendance[]; gradeConfiguration?: GradeConfig; grades?: Grade[] }
interface PublishedResult { courseCode: string; courseName: string; section: string; periodId: string; credits: number; studentNumber: string; finalScore: number; letterGrade: string; qualityPoints: number; publicationVersion: number; publishedAt: string }

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Pelaksanaan Kelas' })

const route = useRoute()
const router = useRouter()
const { user, can } = useAuth()
const { $api } = useNuxtApp()

const classes = ref<ClassRecord[]>([])
const programs = ref<AcademicProgramStudy[]>([])
const periods = ref<AcademicPeriodDefinition[]>([])
const statusFilter = ref<'ACTIVE' | 'ALL'>('ALL')
const selectedClassId = ref('')
const detail = ref<ClassDetail | null>(null)
const loading = ref(false)
const submitting = ref(false)
const errorMessage = ref('')
const noticeMessage = ref('')
const activeTab = ref<'overview' | 'journal' | 'attendance' | 'grades' | 'result'>('overview')
const challenge = ref<{ challengeToken: string; expiresAt: string; meetingNumber: number } | null>(null)
const publishedResult = ref<PublishedResult | null>(null)
const gradeDrafts = reactive<Record<string, Record<string, number>>>({})
const componentDrafts = ref<Component[]>([])

const journalForm = reactive({ meetingNumber: 1, occurredAt: '', durationMinutes: 100, topic: '', deliveryMode: 'ONSITE', makeupReason: '', notes: '' })
const challengeMeeting = ref(1)
const challengeTtl = ref(120)
const correctionForm = reactive<{ meetingNumber: number; studentId: string; status: AttendanceStatus; reason: string }>({ meetingNumber: 1, studentId: '', status: 'PRESENT', reason: '' })

const activeRole = computed(() => user.value?.activeRole)
const isStudent = computed(() => activeRole.value === 'student')
const canManage = computed(() => Boolean(detail.value?.gradeConfiguration) && !isStudent.value)
const visibleClasses = computed(() => classes.value.filter(item =>
  !item.deletedAt && (statusFilter.value === 'ALL' || item.status === 'ACTIVE'),
))
const selectedClass = computed(() => detail.value?.classRecord)
const totalWeight = computed(() => componentDrafts.value.reduce((sum, component) => sum + Number(component.weight || 0), 0))
const publishedCurrentVersion = computed(() => Boolean(
  selectedClass.value?.publicationVersion
  && selectedClass.value?.publishedGradebookVersion === selectedClass.value?.gradebookVersion,
))
const tabs = computed(() => [
  { id: 'overview', label: 'Ringkasan', icon: 'uil-chart-pie' },
  { id: 'journal', label: 'Jurnal mengajar', icon: 'uil-notes' },
  { id: 'attendance', label: 'Presensi', icon: 'uil-qrcode-scan' },
  ...(canManage.value ? [{ id: 'grades', label: 'Penilaian', icon: 'uil-graduation-cap' }] : []),
  ...(isStudent.value ? [{ id: 'result', label: 'Nilai akhir', icon: 'uil-award' }] : []),
] as Array<{ id: typeof activeTab.value; label: string; icon: string }>)

const termLabel = (term: string) => ({ ODD: 'Gasal', EVEN: 'Genap', SHORT: 'Pendek' })[term] || term
const periodLabel = (periodId: string) => {
  const match = periods.value.find(item => item.id === periodId)
  return match ? `${match.academicYear} · ${termLabel(match.term)}` : periodId
}
const programLabel = (programId: string) => programs.value.find(item => item.id === programId)?.name || programId
const deliveryModeLabel = (mode: string) => ({ ONSITE: 'Tatap muka', ONLINE: 'Daring', HYBRID: 'Campuran' })[mode] || mode

const formatDate = (value?: string) => value ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(value)) : '-'
const toJakartaLocalInput = (value: string) => new Date(Date.parse(value) + 7 * 60 * 60 * 1_000).toISOString().slice(0, 16)
const jakartaLocalInputToIso = (value: string) => new Date(`${value}:00+07:00`).toISOString()
const idempotencyKey = (purpose: string) => `${purpose}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`
const errorText = (error: unknown) => {
  if (!error || typeof error !== 'object') return 'Permintaan tidak dapat diproses.'
  const candidate = error as { response?: { data?: { statusMessage?: string; message?: string } }; message?: string }
  return candidate.response?.data?.statusMessage || candidate.response?.data?.message || candidate.message || 'Permintaan tidak dapat diproses.'
}
const statusTone = (status: string) => ({ PRESENT: 'active', LATE: 'review', EXCUSED: 'scheduled', ABSENT: 'blocked' })[status] || status.toLowerCase()
const statusLabel = (status: string) => ({ PRESENT: 'Hadir', LATE: 'Terlambat', EXCUSED: 'Izin', ABSENT: 'Tidak hadir' })[status] || status

const initializeDrafts = () => {
  componentDrafts.value = detail.value?.gradeConfiguration?.components.map(component => ({ ...component })) || []
  for (const student of detail.value?.roster || []) {
    const grade = detail.value?.grades?.find(item => item.studentId === student.studentId)
    gradeDrafts[student.studentId] = Object.fromEntries((detail.value?.gradeConfiguration?.components || []).map(component => [component.id, grade?.componentScores[component.id] ?? 0]))
  }
  correctionForm.studentId = detail.value?.roster[0]?.studentId || ''
  const nextMeeting = Math.min((detail.value?.classRecord.realizedMeetingCount || 0) + 1, detail.value?.classRecord.totalScheduledMeetings || 1)
  journalForm.meetingNumber = nextMeeting
  challengeMeeting.value = nextMeeting
  correctionForm.meetingNumber = nextMeeting
  const meeting = detail.value?.classRecord.schedule.find(item => item.meetingNumber === nextMeeting)
  if (meeting) journalForm.occurredAt = toJakartaLocalInput(meeting.scheduledStartAt)
}

const loadClasses = async () => {
  loading.value = true
  errorMessage.value = ''
  try {
    const [classRes, adminRes] = await Promise.all([
      $api.get<{ classes?: ClassRecord[]; items?: ClassRecord[] }>('/academic/classes'),
      $api.get<AcademicAdministrationWorkspace>('/academic/administration').catch(() => null),
    ])
    classes.value = (classRes.data.classes || classRes.data.items || []).filter(item => !item.deletedAt)
    if (adminRes?.data) {
      programs.value = adminRes.data.programs
      periods.value = adminRes.data.periods
    }
    const activeExists = classes.value.some(item => item.status === 'ACTIVE')
    if (statusFilter.value === 'ACTIVE' && !activeExists && classes.value.length) {
      statusFilter.value = 'ALL'
    }
    const queryClassId = typeof route.query.classId === 'string' ? route.query.classId : ''
    const list = visibleClasses.value
    const nextClassId = (queryClassId && list.some(item => item.id === queryClassId))
      ? queryClassId
      : list.some(item => item.id === selectedClassId.value)
        ? selectedClassId.value
        : (list[0]?.id || '')
    if (!nextClassId) {
      selectedClassId.value = ''
      detail.value = null
    } else if (nextClassId === selectedClassId.value) {
      await loadDetail()
    } else {
      selectedClassId.value = nextClassId
    }
  } catch (error) {
    errorMessage.value = errorText(error)
  } finally {
    loading.value = false
  }
}

const loadDetail = async () => {
  if (!selectedClassId.value) {
    detail.value = null
    return
  }
  loading.value = true
  errorMessage.value = ''
  try {
    const { data } = await $api.get<ClassDetail>(`/academic/classes/${encodeURIComponent(selectedClassId.value)}`)
    detail.value = data
    initializeDrafts()
    challenge.value = null
    publishedResult.value = null
    if (!tabs.value.some(tab => tab.id === activeTab.value)) activeTab.value = 'overview'
  } catch (error) {
    errorMessage.value = errorText(error)
  } finally {
    loading.value = false
  }
}

const runAction = async (action: () => Promise<void>, success: string) => {
  submitting.value = true
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    await action()
    noticeMessage.value = success
  } catch (error) {
    errorMessage.value = errorText(error)
  } finally {
    submitting.value = false
  }
}

const submitJournal = () => runAction(async () => {
  await $api.post(`/academic/classes/${selectedClassId.value}/journals`, {
    ...journalForm,
    occurredAt: jakartaLocalInputToIso(journalForm.occurredAt),
    makeupReason: journalForm.makeupReason || undefined,
    notes: journalForm.notes || undefined,
  }, { headers: { 'Idempotency-Key': idempotencyKey('class-journal') } })
  journalForm.topic = ''
  journalForm.makeupReason = ''
  journalForm.notes = ''
  await loadDetail()
}, 'Jurnal pelaksanaan pertemuan berhasil disimpan.')

const issueChallenge = () => runAction(async () => {
  const { data } = await $api.post<{ value: typeof challenge.value }>(`/academic/classes/${selectedClassId.value}/attendance/challenges`, {
    meetingNumber: challengeMeeting.value,
    ttlSeconds: challengeTtl.value,
  }, { headers: { 'Idempotency-Key': idempotencyKey('attendance-challenge') } })
  challenge.value = data.value
}, 'Kode QR presensi siap ditampilkan kepada mahasiswa.')

const correctAttendanceEntry = () => runAction(async () => {
  const existing = detail.value?.attendance.find(item => item.meetingNumber === correctionForm.meetingNumber && item.studentId === correctionForm.studentId)
  await $api.post(`/academic/classes/${selectedClassId.value}/attendance/corrections`, {
    ...correctionForm,
    expectedVersion: existing?.version ?? 0,
  }, { headers: { 'Idempotency-Key': idempotencyKey('attendance-correction') } })
  correctionForm.reason = ''
  await loadDetail()
}, 'Perubahan presensi berhasil disimpan.')

const addComponent = () => componentDrafts.value.push({ id: `component_${componentDrafts.value.length + 1}`, label: 'Komponen baru', weight: 0, maxScore: 100, order: componentDrafts.value.length + 1 })
const removeComponent = (index: number) => {
  if (componentDrafts.value.length <= 1) return
  componentDrafts.value.splice(index, 1)
}
const saveComponents = () => runAction(async () => {
  await $api.put(`/academic/classes/${selectedClassId.value}/grade-components`, {
    expectedVersion: detail.value?.gradeConfiguration?.version,
    components: componentDrafts.value.map((component, index) => ({ ...component, order: index + 1 })),
  }, { headers: { 'Idempotency-Key': idempotencyKey('grade-components') } })
  await loadDetail()
}, 'Komponen penilaian berhasil diperbarui.')

const saveGrade = (studentId: string) => runAction(async () => {
  const grade = detail.value?.grades?.find(item => item.studentId === studentId)
  await $api.put(`/academic/classes/${selectedClassId.value}/grades/${encodeURIComponent(studentId)}`, {
    expectedVersion: grade?.version ?? 0,
    expectedConfigVersion: detail.value?.gradeConfiguration?.version,
    componentScores: gradeDrafts[studentId],
  }, { headers: { 'Idempotency-Key': idempotencyKey('grade-entry') } })
  await loadDetail()
}, 'Nilai mahasiswa berhasil disimpan.')

const publishGradebook = () => runAction(async () => {
  await $api.post(`/academic/classes/${selectedClassId.value}/grades/publish`, {
    expectedGradebookVersion: selectedClass.value?.gradebookVersion,
  }, { headers: { 'Idempotency-Key': idempotencyKey('grade-publication') } })
  await loadDetail()
}, 'Nilai akhir berhasil dipublikasikan kepada mahasiswa.')

const loadPublishedResult = () => runAction(async () => {
  const { data } = await $api.get<{ result: PublishedResult }>(`/academic/classes/${selectedClassId.value}/results/me`)
  publishedResult.value = data.result
}, 'Hasil nilai akhir berhasil dimuat.')

watch(selectedClassId, (next, previous) => {
  if (next && next !== previous) {
    if (route.query.classId !== next) router.replace({ query: { ...route.query, classId: next } }).catch(() => {})
    loadDetail()
  }
})
watch(statusFilter, () => {
  if (!visibleClasses.value.some(item => item.id === selectedClassId.value)) {
    selectedClassId.value = visibleClasses.value[0]?.id || ''
    if (!selectedClassId.value) detail.value = null
  }
})
watch(activeRole, () => loadClasses())
watch(() => journalForm.meetingNumber, (meetingNumber) => {
  const meeting = detail.value?.classRecord.schedule.find(item => item.meetingNumber === meetingNumber)
  if (meeting) journalForm.occurredAt = toJakartaLocalInput(meeting.scheduledStartAt)
})
onMounted(loadClasses)
</script>

<template>
  <div class="page-stack">
    <AppPageHeader eyebrow="Pelaksanaan akademik" title="Pelaksanaan kelas" description="Catat jurnal perkuliahan, kelola presensi mahasiswa, dan publikasikan nilai kelas yang terhubung dengan ruang belajar.">
      <template #actions>
        <NuxtLink v-if="selectedClassId" class="btn btn-outline-primary" :to="`/pembelajaran/${selectedClassId}`"><i class="uil uil-book-open me-1" />Ruang LMS</NuxtLink>
        <NuxtLink v-if="selectedClassId && can('classes:manage')" class="btn btn-outline-secondary" :to="`/admin/kelas/${selectedClassId}`"><i class="uil uil-sliders-v-alt me-1" />Kelola kelas</NuxtLink>
        <button class="btn btn-outline-secondary" type="button" :disabled="loading" @click="loadClasses"><i class="uil uil-refresh me-1" aria-hidden="true" />Muat ulang</button>
      </template>
    </AppPageHeader>

    <div v-if="noticeMessage" class="alert alert-success d-flex gap-2 align-items-start mb-0" role="status"><i class="uil uil-check-circle mt-1" aria-hidden="true" /><span>{{ noticeMessage }}</span><button class="btn-close ms-auto" type="button" aria-label="Tutup" @click="noticeMessage = ''" /></div>
    <div v-if="errorMessage" class="alert alert-danger d-flex gap-2 align-items-start mb-0" role="alert"><i class="uil uil-exclamation-triangle mt-1" aria-hidden="true" /><span>{{ errorMessage }}</span></div>

    <section class="class-context" aria-label="Pilih kelas">
      <div class="class-context__identity">
        <span><i class="uil uil-presentation-play" aria-hidden="true" /></span>
        <div>
          <strong>{{ selectedClass ? `${selectedClass.courseCode} · ${selectedClass.courseName}` : 'Pilih kelas perkuliahan' }}</strong>
          <small v-if="selectedClass">Kelas {{ selectedClass.section }} · {{ selectedClass.credits }} SKS · {{ periodLabel(selectedClass.periodId) }} · {{ programLabel(selectedClass.programStudyId) }}</small>
          <small v-else>Kelas yang berada dalam lingkup peran Anda tampil di sini.</small>
        </div>
      </div>
      <div class="class-context__controls">
        <label>
          <span>Status</span>
          <select v-model="statusFilter" class="form-select">
            <option value="ALL">Semua ({{ classes.length }})</option>
            <option value="ACTIVE">Aktif ({{ classes.filter(c => c.status === 'ACTIVE').length }})</option>
          </select>
        </label>
        <label class="class-picker">
          <span>Kelas</span>
          <select v-model="selectedClassId" class="form-select" :disabled="loading || !visibleClasses.length">
            <option v-for="item in visibleClasses" :key="item.id" :value="item.id">
              {{ item.courseCode }} · Kelas {{ item.section }} · {{ item.courseName }}{{ item.status !== 'ACTIVE' ? ' [Arsip]' : '' }}
            </option>
          </select>
        </label>
      </div>
    </section>

    <section v-if="loading && !detail" class="loading-panel" role="status"><span class="spinner-border" aria-hidden="true" /><strong>Memuat data pelaksanaan kelas…</strong></section>
    <div v-else-if="!detail" class="empty-wrap">
      <EmptyState title="Belum ada kelas yang tersedia" description="Buat atau aktifkan kelas terlebih dahulu di menu Kelas & Peserta, atau pastikan Anda sudah terdaftar pada kelas semester aktif." />
      <div v-if="can('classes:manage')" class="text-center mt-2">
        <NuxtLink class="btn btn-primary" to="/admin/kelas"><i class="uil uil-presentation-check me-1" />Buka Kelas &amp; Peserta</NuxtLink>
      </div>
    </div>

    <template v-else>
      <div v-if="detail.classRecord.status !== 'ACTIVE'" class="alert alert-warning d-flex align-items-center justify-content-between flex-wrap gap-2 mb-0" role="status">
        <span><strong>Kelas ini sedang diarsipkan.</strong> Aktifkan kembali di menu Kelola Kelas agar mahasiswa dapat mengaksesnya pada semester berjalan.</span>
        <NuxtLink v-if="can('classes:manage')" class="btn btn-sm btn-primary" :to="`/admin/kelas/${detail.classRecord.id}`">Kelola status kelas</NuxtLink>
      </div>

      <section class="summary-strip" aria-label="Ringkasan kelas">
        <div><small>Peserta aktif</small><strong>{{ detail.roster.filter(row => row.status === 'ACTIVE').length }} mahasiswa</strong><span>Dari {{ detail.roster.length }} terdaftar</span></div>
        <div><small>Realisasi pertemuan</small><strong>{{ detail.classRecord.realizedMeetingCount }} / {{ detail.classRecord.totalScheduledMeetings }}</strong><span>Pertemuan berjurnal</span></div>
        <div><small>Presensi tercatat</small><strong>{{ detail.attendance.length }} catatan</strong><span>QR dan koreksi manual</span></div>
        <div><small>Status nilai akhir</small><strong>{{ publishedCurrentVersion ? 'Sudah terbit' : 'Belum diterbitkan' }}</strong><span>{{ detail.classRecord.publicationVersion ? `Publikasi ke-${detail.classRecord.publicationVersion}` : 'Menunggu publikasi dosen' }}</span></div>
      </section>

      <section class="class-workspace">
        <nav class="class-tabs" aria-label="Bagian kelas">
          <button v-for="tab in tabs" :key="tab.id" type="button" :class="{ active: activeTab === tab.id }" :aria-current="activeTab === tab.id ? 'page' : undefined" @click="activeTab = tab.id">
            <i class="uil" :class="tab.icon" aria-hidden="true" />{{ tab.label }}
          </button>
        </nav>

        <div v-if="activeTab === 'overview'" class="workspace-grid">
          <article class="workspace-card workspace-card--wide">
            <header>
              <div><span class="section-kicker">Jadwal semester</span><h2>Pertemuan terencana &amp; realisasi ({{ detail.classRecord.schedule.length }} sesi)</h2></div>
              <StatusBadge :status="detail.classRecord.status === 'ACTIVE' ? 'active' : 'inactive'" :label="detail.classRecord.status === 'ACTIVE' ? 'Kelas aktif' : 'Diarsipkan'" />
            </header>
            <div class="meeting-strip">
              <article v-for="meeting in detail.classRecord.schedule" :key="meeting.meetingNumber" :class="{ realized: detail.journals.some(journal => journal.meetingNumber === meeting.meetingNumber) }">
                <span>{{ meeting.meetingNumber }}</span>
                <strong>{{ formatDate(meeting.scheduledStartAt).split(',')[0] }}</strong>
                <small>{{ detail.journals.some(journal => journal.meetingNumber === meeting.meetingNumber) ? 'Selesai' : 'Terjadwal' }}</small>
              </article>
            </div>
          </article>

          <article class="workspace-card">
            <header><div><span class="section-kicker">Pengampu</span><h2>Dosen penanggung jawab</h2></div></header>
            <div class="lecturer-panel">
              <span>{{ detail.classRecord.lecturerNames.map(name => name.split(/\s+/).map(part => part[0]).slice(0, 2).join('')).join('/') || 'DS' }}</span>
              <div><strong>{{ detail.classRecord.lecturerNames.join(', ') || 'Belum ditetapkan' }}</strong><small>{{ programLabel(detail.classRecord.programStudyId) }} · {{ detail.classRecord.courseCode }}</small></div>
            </div>
            <dl class="detail-list mt-3">
              <div><dt>Periode</dt><dd>{{ periodLabel(detail.classRecord.periodId) }}</dd></div>
              <div><dt>Bobot</dt><dd>{{ detail.classRecord.credits }} SKS</dd></div>
              <div><dt>Kelas / Section</dt><dd>{{ detail.classRecord.section }}</dd></div>
            </dl>
          </article>

          <article class="workspace-card">
            <header>
              <div><span class="section-kicker">Daftar mahasiswa</span><h2>Peserta kelas</h2></div>
              <span>{{ detail.roster.length }} mahasiswa</span>
            </header>
            <ul v-if="detail.roster.length" class="roster-list" data-clarity-mask="true">
              <li v-for="row in detail.roster" :key="row.studentId">
                <span>{{ row.studentName.split(/\s+/).map(part => part[0]).slice(0, 2).join('') }}</span>
                <div><strong>{{ row.studentName }}</strong><small>{{ row.studentNumber }}</small></div>
                <StatusBadge :status="row.status === 'ACTIVE' ? 'active' : 'inactive'" :label="row.status === 'ACTIVE' ? 'Aktif' : 'Keluar'" />
              </li>
            </ul>
            <EmptyState v-else title="Belum ada peserta" description="Mahasiswa yang KRS-nya disetujui atau ditambahkan oleh staf akademik akan tampil di sini." />
          </article>
        </div>

        <div v-else-if="activeTab === 'journal'" class="workspace-grid">
          <article v-if="canManage" class="workspace-card">
            <header><div><span class="section-kicker">Catatan mengajar</span><h2>Catat jurnal pertemuan</h2></div></header>
            <form class="stack-form" @submit.prevent="submitJournal">
              <div class="two-fields">
                <label><span>Pertemuan</span><select v-model.number="journalForm.meetingNumber" class="form-select"><option v-for="meeting in detail.classRecord.schedule" :key="meeting.meetingNumber" :value="meeting.meetingNumber">Pertemuan {{ meeting.meetingNumber }}</option></select></label>
                <label><span>Mode kelas</span><select v-model="journalForm.deliveryMode" class="form-select"><option value="ONSITE">Tatap muka</option><option value="ONLINE">Daring</option><option value="HYBRID">Campuran</option></select></label>
              </div>
              <div class="two-fields">
                <label><span>Waktu pelaksanaan</span><input v-model="journalForm.occurredAt" class="form-control" type="datetime-local" required></label>
                <label><span>Durasi (menit)</span><input v-model.number="journalForm.durationMinutes" class="form-control" type="number" min="30" max="300" required></label>
              </div>
              <label><span>Pokok bahasan</span><input v-model="journalForm.topic" class="form-control" minlength="3" maxlength="300" required placeholder="Materi yang dibahas pada pertemuan ini"></label>
              <label><span>Alasan kuliah pengganti</span><input v-model="journalForm.makeupReason" class="form-control" maxlength="500" placeholder="Diisi bila waktu pelaksanaan berbeda dari jadwal"></label>
              <label><span>Catatan tambahan</span><textarea v-model="journalForm.notes" class="form-control" rows="3" maxlength="1000" /></label>
              <button class="btn btn-primary" type="submit" :disabled="submitting"><i class="uil uil-notes me-2" aria-hidden="true" />Simpan jurnal</button>
            </form>
          </article>
          <article class="workspace-card" :class="{ 'workspace-card--wide': !canManage }">
            <header><div><span class="section-kicker">Riwayat mengajar</span><h2>Jurnal pertemuan tercatat</h2></div><span>{{ detail.journals.length }} jurnal</span></header>
            <ol v-if="detail.journals.length" class="journal-list">
              <li v-for="journal in detail.journals" :key="journal.id">
                <span>{{ journal.meetingNumber }}</span>
                <div><strong>{{ journal.topic }}</strong><small>{{ formatDate(journal.occurredAt) }} · {{ journal.durationMinutes }} menit · {{ deliveryModeLabel(journal.deliveryMode) }}</small></div>
                <StatusBadge :status="journal.realization === 'ON_SCHEDULE' ? 'active' : 'review'" :label="journal.realization === 'ON_SCHEDULE' ? 'Sesuai jadwal' : 'Pengganti'" />
              </li>
            </ol>
            <EmptyState v-else title="Belum ada jurnal" description="Jurnal perkuliahan akan tampil setelah dosen mencatat pertemuan." />
          </article>
        </div>

        <div v-else-if="activeTab === 'attendance'" class="workspace-grid">
          <article v-if="canManage" class="workspace-card">
            <header><div><span class="section-kicker">Presensi mandiri</span><h2>Aktifkan QR presensi</h2></div><i class="uil uil-qrcode-scan card-icon" aria-hidden="true" /></header>
            <p class="helper-copy">Kode QR hanya berlaku untuk peserta aktif kelas ini pada pertemuan yang dipilih dan kedaluwarsa otomatis sesuai batas waktu.</p>
            <div class="two-fields">
              <label><span>Pertemuan</span><select v-model.number="challengeMeeting" class="form-select"><option v-for="meeting in detail.classRecord.schedule" :key="meeting.meetingNumber" :value="meeting.meetingNumber">Pertemuan {{ meeting.meetingNumber }}</option></select></label>
              <label><span>Masa berlaku</span><select v-model.number="challengeTtl" class="form-select"><option :value="60">1 menit</option><option :value="120">2 menit</option><option :value="300">5 menit</option></select></label>
            </div>
            <button class="btn btn-primary w-100 mt-3" type="button" :disabled="submitting" @click="issueChallenge">Buat QR presensi</button>
            <div v-if="challenge" class="challenge-panel"><AttendanceQr :challenge-token="challenge.challengeToken" :label="`QR presensi pertemuan ${challenge.meetingNumber}`" /><small>Berlaku hingga {{ formatDate(challenge.expiresAt) }}</small></div>
          </article>
          <article v-if="isStudent" class="workspace-card">
            <header><div><span class="section-kicker">Presensi mahasiswa</span><h2>Pindai QR kelas</h2></div></header>
            <p class="helper-copy">Arahkan kamera ponsel ke kode QR yang ditampilkan dosen untuk mencatat kehadiran Anda secara langsung.</p>
            <NuxtLink class="btn btn-primary" to="/presensi">Buka halaman presensi</NuxtLink>
          </article>
          <article v-if="canManage" class="workspace-card">
            <header><div><span class="section-kicker">Penyesuaian presensi</span><h2>Ubah status kehadiran</h2></div></header>
            <form class="stack-form" @submit.prevent="correctAttendanceEntry">
              <div class="two-fields">
                <label><span>Mahasiswa</span><select v-model="correctionForm.studentId" class="form-select" data-clarity-mask="true"><option v-for="row in detail.roster" :key="row.studentId" :value="row.studentId">{{ row.studentNumber }} · {{ row.studentName }}</option></select></label>
                <label><span>Pertemuan</span><select v-model.number="correctionForm.meetingNumber" class="form-select"><option v-for="meeting in detail.classRecord.schedule" :key="meeting.meetingNumber" :value="meeting.meetingNumber">Pertemuan {{ meeting.meetingNumber }}</option></select></label>
              </div>
              <label><span>Status kehadiran</span><select v-model="correctionForm.status" class="form-select"><option value="PRESENT">Hadir</option><option value="LATE">Terlambat</option><option value="EXCUSED">Izin</option><option value="ABSENT">Tidak hadir</option></select></label>
              <label><span>Alasan perubahan</span><textarea v-model="correctionForm.reason" class="form-control" rows="2" minlength="10" maxlength="500" placeholder="Tuliskan alasan perubahan status kehadiran (min. 10 karakter)" required /></label>
              <button class="btn btn-outline-primary" type="submit" :disabled="submitting || !correctionForm.studentId">Simpan perubahan presensi</button>
            </form>
          </article>
          <article class="workspace-card" :class="{ 'workspace-card--wide': !canManage && !isStudent }">
            <header><div><span class="section-kicker">Rekap kehadiran</span><h2>Daftar presensi tercatat</h2></div><span>{{ detail.attendance.length }} catatan</span></header>
            <div v-if="detail.attendance.length" class="attendance-list">
              <article v-for="entry in detail.attendance" :key="entry.id">
                <span>P{{ entry.meetingNumber }}</span>
                <div><strong>{{ detail.roster.find(row => row.studentId === entry.studentId)?.studentName || entry.studentId }}</strong><small>{{ entry.source === 'QR' ? 'Scan QR' : 'Manual' }}<template v-if="entry.correctionReason"> · {{ entry.correctionReason }}</template></small></div>
                <StatusBadge :status="statusTone(entry.status)" :label="statusLabel(entry.status)" />
              </article>
            </div>
            <EmptyState v-else title="Belum ada presensi" description="Kehadiran melalui QR atau pencatatan manual akan tampil di sini." />
          </article>
        </div>

        <div v-else-if="activeTab === 'grades' && canManage" class="grade-workspace">
          <article class="workspace-card">
            <header><div><span class="section-kicker">Bobot penilaian</span><h2>Komponen nilai kelas</h2></div><strong :class="totalWeight === 100 ? 'weight-ok' : 'weight-error'">Total {{ totalWeight }}%</strong></header>
            <div class="component-editor">
              <article v-for="(component, index) in componentDrafts" :key="`${component.id}-${index}`">
                <label><span>Kode</span><input v-model="component.id" class="form-control" aria-label="ID komponen"></label>
                <label><span>Nama komponen</span><input v-model="component.label" class="form-control" aria-label="Nama komponen"></label>
                <label><span>Bobot (%)</span><input v-model.number="component.weight" class="form-control" type="number" min="0.01" max="100" step="0.01"></label>
                <label><span>Skor maks.</span><input v-model.number="component.maxScore" class="form-control" type="number" min="1" max="1000"></label>
                <button class="btn btn-sm btn-outline-danger" type="button" :disabled="componentDrafts.length <= 1" title="Hapus komponen" @click="removeComponent(index)"><i class="uil uil-trash-alt" /></button>
              </article>
            </div>
            <div class="component-actions">
              <button class="btn btn-sm btn-outline-secondary" type="button" @click="addComponent"><i class="uil uil-plus me-1" />Tambah komponen</button>
              <button class="btn btn-sm btn-primary" type="button" :disabled="submitting || totalWeight !== 100" @click="saveComponents">Simpan bobot penilaian</button>
            </div>
          </article>

          <article class="workspace-card grade-table-card">
            <header>
              <div><span class="section-kicker">Buku nilai</span><h2>Nilai per mahasiswa</h2><p>Lengkapi nilai seluruh komponen sebelum memublikasikan hasil akhir kepada mahasiswa.</p></div>
              <button class="btn btn-primary" type="button" :disabled="submitting || publishedCurrentVersion" @click="publishGradebook">
                <i class="uil uil-upload-alt me-1" />{{ publishedCurrentVersion ? 'Nilai sudah terbit' : 'Publikasikan nilai akhir' }}
              </button>
            </header>
            <div class="table-responsive">
              <table class="table grade-table mb-0">
                <thead><tr><th>Mahasiswa</th><th v-for="component in detail.gradeConfiguration!.components" :key="component.id">{{ component.label }}<small>{{ component.weight }}%</small></th><th>Nilai akhir</th><th /></tr></thead>
                <tbody>
                  <tr v-for="row in detail.roster" :key="row.studentId">
                    <td data-clarity-mask="true"><strong>{{ row.studentName }}</strong><small>{{ row.studentNumber }}</small></td>
                    <td v-for="component in detail.gradeConfiguration!.components" :key="component.id"><input v-model.number="gradeDrafts[row.studentId]![component.id]" class="form-control form-control-sm" type="number" min="0" :max="component.maxScore" :aria-label="`${component.label} ${row.studentName}`"></td>
                    <td><strong>{{ detail.grades?.find(grade => grade.studentId === row.studentId)?.finalScore ?? '-' }}</strong><StatusBadge v-if="detail.grades?.find(grade => grade.studentId === row.studentId)" status="active" :label="detail.grades?.find(grade => grade.studentId === row.studentId)?.letterGrade" /></td>
                    <td><button class="btn btn-sm btn-outline-primary" type="button" :disabled="submitting" @click="saveGrade(row.studentId)">Simpan</button></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </article>
        </div>

        <div v-else-if="activeTab === 'result' && isStudent" class="result-layout">
          <article v-if="publishedResult" class="result-card">
            <span class="result-card__seal"><i class="uil uil-award" aria-hidden="true" /></span>
            <span class="section-kicker">Hasil studi resmi</span>
            <h2>{{ publishedResult.courseCode }} · {{ publishedResult.courseName }}</h2>
            <p>{{ periodLabel(publishedResult.periodId) }} · Kelas {{ publishedResult.section }} · {{ publishedResult.credits }} SKS</p>
            <div class="result-score"><strong>{{ publishedResult.letterGrade }}</strong><span><b>{{ publishedResult.finalScore }}</b><small>nilai akhir</small></span><span><b>{{ publishedResult.qualityPoints }}</b><small>mutu × SKS</small></span></div>
            <footer><span>Dipublikasikan {{ formatDate(publishedResult.publishedAt) }}</span><span data-clarity-mask="true">{{ publishedResult.studentNumber }}</span></footer>
          </article>
          <article v-else class="workspace-card result-empty">
            <span><i class="uil uil-file-lock-alt" aria-hidden="true" /></span>
            <h2>Muat nilai akhir yang sudah terbit</h2>
            <p>Nilai akhir akan tampil di sini setelah dosen menyelesaikan penilaian dan memublikasikannya.</p>
            <button class="btn btn-primary" type="button" :disabled="submitting" @click="loadPublishedResult">Muat nilai akhir</button>
          </article>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped src="~/pages/_workflow.css"></style>
<style scoped>
.class-context { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 1rem; padding: 1rem 1.15rem; border: 1px solid #e6dfd6; border-radius: 1rem; background: #fff; }
.class-context__identity { display: flex; align-items: center; gap: .75rem; min-width: 0; }
.class-context__identity > span { display: grid; place-items: center; flex: 0 0 auto; width: 2.6rem; height: 2.6rem; border-radius: .75rem; color: #593660; background: #f5eff7; font-size: 1.1rem; }
.class-context__identity strong, .class-context__identity small { display: block; }
.class-context__identity strong { overflow: hidden; color: #1e1e1e; font-size: .88rem; text-overflow: ellipsis; white-space: nowrap; }
.class-context__identity small { margin-top: .18rem; color: #6c6865; font-size: .7rem; }
.class-context__controls { display: flex; gap: .6rem; flex-wrap: wrap; align-items: flex-end; }
.class-context__controls label { display: grid; gap: .25rem; }
.class-picker { min-width: min(100%, 300px); }
.class-context__controls label span, .stack-form label > span, .two-fields label > span { color: #4e5462; font-size: .68rem; font-weight: 700; }
.class-context .form-select { border-color: #d9d0c5; font-size: .76rem; }
.empty-wrap { padding: 1.2rem; border: 1px solid #e6dfd6; border-radius: 1rem; background: #fff; }
.summary-strip { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: .75rem; }
.summary-strip > div { padding: .9rem 1rem; border: 1px solid #e6dfd6; border-radius: .9rem; background: #fff; }
.summary-strip small, .summary-strip strong, .summary-strip span { display: block; }
.summary-strip small { color: #6c6865; font-size: .66rem; font-weight: 700; }
.summary-strip strong { margin-top: .2rem; color: #1e1e1e; font-size: 1rem; }
.summary-strip span { margin-top: .15rem; color: #775a83; font-size: .66rem; }
.loading-panel { display: grid; min-height: 260px; place-items: center; align-content: center; gap: .8rem; border: 1px solid #e6dfd6; border-radius: 1rem; color: #593660; background: #fff; font-size: .78rem; }
.class-workspace { overflow: hidden; border: 1px solid #e6dfd6; border-radius: 1rem; background: #faf6ef; }
.class-tabs { display: flex; overflow-x: auto; gap: .3rem; padding: .55rem; border-bottom: 1px solid #ece6dd; background: #fff; }
.class-tabs button { display: inline-flex; align-items: center; gap: .4rem; padding: .55rem .9rem; border: 0; border-radius: .6rem; color: #4e5462; background: transparent; font-size: .74rem; font-weight: 700; white-space: nowrap; }
.class-tabs button.active { color: #fff; background: #593660; }
.workspace-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; padding: 1rem; }
.workspace-card { min-width: 0; padding: 1.1rem; border: 1px solid #e6dfd6; border-radius: .9rem; background: #fff; }
.workspace-card--wide { grid-column: 1 / -1; }
.workspace-card > header { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; margin-bottom: 1rem; }
.workspace-card > header h2 { margin: .15rem 0 0; color: #1e1e1e; font-size: .92rem; }
.workspace-card > header p { margin: .25rem 0 0; color: #6c6865; font-size: .68rem; }
.workspace-card > header > span, .workspace-card > header > strong { color: #6c6865; font-size: .7rem; }
.meeting-strip { display: grid; grid-template-columns: repeat(8, 1fr); gap: .45rem; }
.meeting-strip article { display: grid; justify-items: center; gap: .2rem; padding: .6rem .3rem; border: 1px solid #e6dfd6; border-radius: .7rem; color: #6c6865; background: #faf6ef; text-align: center; }
.meeting-strip article.realized { border-color: #c8b6d0; color: #3e2344; background: #f5eff7; }
.meeting-strip article > span { display: grid; width: 1.55rem; height: 1.55rem; place-items: center; border-radius: 50%; color: #fff; background: #8c8783; font-size: .64rem; font-weight: 800; }
.meeting-strip article.realized > span { background: #593660; }
.meeting-strip strong { font-size: .64rem; }
.meeting-strip small { font-size: .58rem; }
.lecturer-panel { display: flex; align-items: center; gap: .75rem; }
.lecturer-panel > span { display: grid; width: 2.8rem; height: 2.8rem; place-items: center; border-radius: .8rem; color: #593660; background: #f5eff7; font-size: .72rem; font-weight: 800; }
.lecturer-panel strong, .lecturer-panel small { display: block; }
.lecturer-panel strong { color: #1e1e1e; font-size: .8rem; }
.lecturer-panel small { margin-top: .15rem; color: #6c6865; font-size: .68rem; }
.roster-list { display: grid; gap: .4rem; margin: 0; padding: 0; list-style: none; max-height: 300px; overflow-y: auto; }
.roster-list li { display: grid; grid-template-columns: 2rem 1fr auto; gap: .6rem; align-items: center; padding: .5rem; border-bottom: 1px solid #ece6dd; }
.roster-list li > span { display: grid; width: 2rem; height: 2rem; place-items: center; border-radius: .55rem; color: #593660; background: #f5eff7; font-size: .64rem; font-weight: 800; }
.roster-list strong, .roster-list small { display: block; }
.roster-list strong { color: #1e1e1e; font-size: .76rem; }
.roster-list small { color: #6c6865; font-size: .64rem; }
.stack-form { display: grid; gap: .75rem; }
.stack-form label, .two-fields label { display: grid; gap: .3rem; }
.stack-form .form-control, .stack-form .form-select, .two-fields .form-control, .two-fields .form-select { border-color: #d9d0c5; font-size: .76rem; }
.two-fields { display: grid; grid-template-columns: 1fr 1fr; gap: .65rem; }
.journal-list { display: grid; gap: .55rem; margin: 0; padding: 0; list-style: none; }
.journal-list li { display: grid; grid-template-columns: 2rem 1fr auto; gap: .65rem; align-items: center; padding: .7rem; border: 1px solid #e6dfd6; border-radius: .7rem; }
.journal-list li > span { display: grid; width: 2rem; height: 2rem; place-items: center; border-radius: .55rem; color: #fff; background: #593660; font-size: .7rem; font-weight: 800; }
.journal-list strong, .journal-list small { display: block; }
.journal-list strong { color: #1e1e1e; font-size: .78rem; }
.journal-list small { margin-top: .12rem; color: #6c6865; font-size: .66rem; }
.helper-copy { margin: 0 0 1rem; color: #6c6865; font-size: .72rem; line-height: 1.55; }
.card-icon { color: #593660; font-size: 1.3rem; }
.challenge-panel { display: grid; justify-items: center; gap: .75rem; margin-top: 1rem; padding: .85rem; border: 1px solid #dfd3e4; border-radius: .75rem; background: #f5eff7; }
.challenge-panel small { color: #3e2344; font-size: .72rem; font-weight: 700; }
.attendance-list { display: grid; gap: .45rem; max-height: 360px; overflow-y: auto; }
.attendance-list article { display: grid; grid-template-columns: 2.2rem 1fr auto; gap: .6rem; align-items: center; padding: .6rem; border-bottom: 1px solid #ece6dd; }
.attendance-list article > span { color: #593660; font-size: .72rem; font-weight: 800; }
.attendance-list strong, .attendance-list small { display: block; }
.attendance-list strong { color: #1e1e1e; font-size: .76rem; }
.attendance-list small { color: #6c6865; font-size: .64rem; }
.grade-workspace { display: grid; gap: 1rem; padding: 1rem; }
.component-editor { display: grid; gap: .55rem; }
.component-editor article { display: grid; grid-template-columns: .7fr 1.4fr .65fr .65fr auto; gap: .5rem; align-items: end; }
.component-editor label { display: grid; gap: .25rem; }
.component-editor label span { color: #6c6865; font-size: .64rem; font-weight: 700; }
.component-editor .form-control { font-size: .74rem; }
.component-actions { display: flex; justify-content: space-between; gap: .6rem; margin-top: .75rem; }
.weight-ok { color: #2d6a4f !important; }
.weight-error { color: #a63d34 !important; }
.grade-table-card { padding: 0; overflow: hidden; }
.grade-table-card > header { padding: 1rem 1.1rem 0; }
.grade-table { min-width: 820px; }
.grade-table th { color: #4e5462; background: #faf6ef; font-size: .68rem; }
.grade-table th small { display: block; margin-top: .12rem; color: #6c6865; font-size: .6rem; }
.grade-table td { color: #1e1e1e; font-size: .74rem; }
.grade-table td:first-child strong, .grade-table td:first-child small { display: block; }
.grade-table td:first-child small { color: #6c6865; font-size: .64rem; }
.grade-table input { width: 78px; }
.grade-table td:nth-last-child(2) { display: flex; align-items: center; gap: .35rem; }
.result-layout { display: grid; min-height: 360px; place-items: center; padding: 1rem; }
.result-card { width: min(100%, 660px); padding: 1.7rem; border: 1px solid #dfd3e4; border-radius: 1rem; color: #1e1e1e; background: #fff; box-shadow: 0 12px 36px rgba(89,54,96,.08); }
.result-card__seal { display: grid; width: 3.4rem; height: 3.4rem; margin-bottom: 1rem; place-items: center; border-radius: .95rem; color: #fff; background: #593660; font-size: 1.45rem; }
.result-card h2 { margin: 0; font-size: 1.15rem; }
.result-card > p { margin: .35rem 0 1.2rem; color: #6c6865; font-size: .74rem; }
.result-score { display: grid; grid-template-columns: 1.2fr 1fr 1fr; gap: .75rem; align-items: center; padding: 1rem; border-radius: .85rem; background: #f5eff7; color: #3e2344; }
.result-score > strong { font-size: 2.8rem; letter-spacing: -.06em; }
.result-score span b, .result-score span small { display: block; }
.result-score span b { font-size: 1.2rem; }
.result-score span small { color: #6c6865; font-size: .66rem; }
.result-card footer { display: flex; justify-content: space-between; gap: 1rem; margin-top: 1.2rem; padding-top: .8rem; border-top: 1px solid #ece6dd; color: #6c6865; font-size: .68rem; }
.result-empty { max-width: 460px; text-align: center; }
.result-empty > span { display: grid; width: 3.4rem; height: 3.4rem; margin: 0 auto 1rem; place-items: center; border-radius: .95rem; color: #593660; background: #f5eff7; font-size: 1.4rem; }
.result-empty h2 { color: #1e1e1e; font-size: .98rem; }
.result-empty p { color: #6c6865; font-size: .72rem; line-height: 1.55; }
@media (max-width: 991.98px) { .summary-strip { grid-template-columns: repeat(2, 1fr); }.meeting-strip { grid-template-columns: repeat(4, 1fr); }.workspace-grid { grid-template-columns: 1fr; }.workspace-card--wide { grid-column: auto; } }
@media (max-width: 767.98px) { .summary-strip { grid-template-columns: 1fr; }.class-context { align-items: stretch; flex-direction: column; }.class-picker { min-width: 0; width: 100%; }.two-fields, .component-editor article { grid-template-columns: 1fr; }.component-editor article { padding-bottom: .7rem; border-bottom: 1px solid #ece6dd; }.result-score { grid-template-columns: 1fr 1fr; }.result-score > strong { grid-column: 1 / -1; }.result-card footer { flex-direction: column; }.workspace-grid, .grade-workspace { padding: .7rem; } }
</style>
