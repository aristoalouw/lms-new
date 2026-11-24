<script setup lang="ts">
type AttendanceStatus = 'PRESENT' | 'LATE' | 'EXCUSED' | 'ABSENT'
interface MeetingSchedule { meetingNumber: number; scheduledStartAt: string; scheduledEndAt: string; attendanceOpensAt: string; attendanceClosesAt: string }
interface ClassRecord { id: string; courseCode: string; courseName: string; credits: number; section: string; periodId: string; programStudyId: string; lecturerNames: string[]; status: string; totalScheduledMeetings: number; realizedMeetingCount: number; schedule: MeetingSchedule[]; gradeConfigVersion: number; gradebookVersion: number; publicationVersion: number; publishedGradebookVersion?: number }
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

const { user } = useAuth()
const classes = ref<ClassRecord[]>([])
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

const isStudent = computed(() => user.value?.roles.includes('student') ?? false)
const canManage = computed(() => Boolean(detail.value?.gradeConfiguration))
const selectedClass = computed(() => detail.value?.classRecord)
const totalWeight = computed(() => componentDrafts.value.reduce((sum, component) => sum + Number(component.weight || 0), 0))
const publishedCurrentVersion = computed(() => selectedClass.value?.publishedGradebookVersion === selectedClass.value?.gradebookVersion)
const tabs = computed(() => [
  { id: 'overview', label: 'Ringkasan', icon: 'uil-chart-pie' },
  { id: 'journal', label: 'Jurnal', icon: 'uil-notes' },
  { id: 'attendance', label: 'Presensi', icon: 'uil-qrcode-scan' },
  ...(canManage.value ? [{ id: 'grades', label: 'Nilai', icon: 'uil-graduation-cap' }] : []),
  ...(isStudent.value ? [{ id: 'result', label: 'Hasil terbit', icon: 'uil-award' }] : []),
] as Array<{ id: typeof activeTab.value; label: string; icon: string }>)

const formatDate = (value?: string) => value ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(value)) : '—'
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
    const { data } = await useNuxtApp().$api.get<{ classes: ClassRecord[] }>('/academic/classes')
    classes.value = data.classes
    const nextClassId = classes.value.some(item => item.id === selectedClassId.value) ? selectedClassId.value : (classes.value[0]?.id || '')
    if (nextClassId === selectedClassId.value && nextClassId) await loadDetail()
    else selectedClassId.value = nextClassId
  } catch (error) {
    errorMessage.value = errorText(error)
  } finally {
    loading.value = false
  }
}

const loadDetail = async () => {
  if (!selectedClassId.value) return
  loading.value = true
  errorMessage.value = ''
  try {
    const { data } = await useNuxtApp().$api.get<ClassDetail>(`/academic/classes/${encodeURIComponent(selectedClassId.value)}`)
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
  await useNuxtApp().$api.post(`/academic/classes/${selectedClassId.value}/journals`, {
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
  const { data } = await useNuxtApp().$api.post<{ value: typeof challenge.value }>(`/academic/classes/${selectedClassId.value}/attendance/challenges`, {
    meetingNumber: challengeMeeting.value,
    ttlSeconds: challengeTtl.value,
  }, { headers: { 'Idempotency-Key': idempotencyKey('attendance-challenge') } })
  challenge.value = data.value
}, 'Tantangan presensi siap ditampilkan pada perangkat kelas.')

const correctAttendanceEntry = () => runAction(async () => {
  const existing = detail.value?.attendance.find(item => item.meetingNumber === correctionForm.meetingNumber && item.studentId === correctionForm.studentId)
  await useNuxtApp().$api.post(`/academic/classes/${selectedClassId.value}/attendance/corrections`, {
    ...correctionForm,
    expectedVersion: existing?.version ?? 0,
  }, { headers: { 'Idempotency-Key': idempotencyKey('attendance-correction') } })
  correctionForm.reason = ''
  await loadDetail()
}, 'Koreksi presensi tersimpan dalam jejak audit.')

const addComponent = () => componentDrafts.value.push({ id: `component_${componentDrafts.value.length + 1}`, label: 'Komponen baru', weight: 0, maxScore: 100, order: componentDrafts.value.length + 1 })
const saveComponents = () => runAction(async () => {
  await useNuxtApp().$api.put(`/academic/classes/${selectedClassId.value}/grade-components`, {
    expectedVersion: detail.value?.gradeConfiguration?.version,
    components: componentDrafts.value.map((component, index) => ({ ...component, order: index + 1 })),
  }, { headers: { 'Idempotency-Key': idempotencyKey('grade-components') } })
  await loadDetail()
}, 'Konfigurasi komponen nilai berhasil diperbarui.')

const saveGrade = (studentId: string) => runAction(async () => {
  const grade = detail.value?.grades?.find(item => item.studentId === studentId)
  await useNuxtApp().$api.put(`/academic/classes/${selectedClassId.value}/grades/${encodeURIComponent(studentId)}`, {
    expectedVersion: grade?.version ?? 0,
    expectedConfigVersion: detail.value?.gradeConfiguration?.version,
    componentScores: gradeDrafts[studentId],
  }, { headers: { 'Idempotency-Key': idempotencyKey('grade-entry') } })
  await loadDetail()
}, 'Nilai mahasiswa berhasil disimpan.')

const publishGradebook = () => runAction(async () => {
  await useNuxtApp().$api.post(`/academic/classes/${selectedClassId.value}/grades/publish`, {
    expectedGradebookVersion: selectedClass.value?.gradebookVersion,
  }, { headers: { 'Idempotency-Key': idempotencyKey('grade-publication') } })
  await loadDetail()
}, 'Snapshot nilai berhasil dipublikasikan kepada mahasiswa.')

const loadPublishedResult = () => runAction(async () => {
  const { data } = await useNuxtApp().$api.get<{ result: PublishedResult }>(`/academic/classes/${selectedClassId.value}/results/me`)
  publishedResult.value = data.result
}, 'Hasil nilai terbit berhasil dimuat.')

watch(selectedClassId, (next, previous) => { if (next && next !== previous) loadDetail() })
watch(() => journalForm.meetingNumber, (meetingNumber) => {
  const meeting = detail.value?.classRecord.schedule.find(item => item.meetingNumber === meetingNumber)
  if (meeting) journalForm.occurredAt = toJakartaLocalInput(meeting.scheduledStartAt)
})
onMounted(loadClasses)
</script>

<template>
  <div class="page-stack">
    <AppPageHeader eyebrow="Pelaksanaan akademik" title="Kelas & perkuliahan" description="Kelola daftar mahasiswa, jurnal perkuliahan, presensi, dan penilaian kelas.">
      <template #actions><button class="btn btn-outline-secondary" type="button" :disabled="loading" @click="loadClasses"><i class="uil uil-refresh me-2" aria-hidden="true" />Muat ulang</button></template>
    </AppPageHeader>

    <div v-if="noticeMessage" class="alert alert-success d-flex gap-2 align-items-start mb-0" role="status"><i class="uil uil-check-circle mt-1" aria-hidden="true" /><span>{{ noticeMessage }}</span><button class="btn-close ms-auto" type="button" aria-label="Tutup" @click="noticeMessage = ''" /></div>
    <div v-if="errorMessage" class="alert alert-danger d-flex gap-2 align-items-start mb-0" role="alert"><i class="uil uil-exclamation-triangle mt-1" aria-hidden="true" /><span>{{ errorMessage }}</span></div>

    <section class="class-context" aria-label="Pilih kelas">
      <div class="class-context__identity"><span><i class="uil uil-presentation-play" aria-hidden="true" /></span><div><strong>{{ selectedClass ? `${selectedClass.courseCode} · ${selectedClass.courseName}` : 'Pilih kelas' }}</strong><small v-if="selectedClass">Kelas {{ selectedClass.section }} · {{ selectedClass.credits }} SKS · {{ selectedClass.periodId }}</small><small v-else>Kelas yang berada dalam lingkup akun akan muncul di sini.</small></div></div>
      <label><span>Kelas aktif</span><select v-model="selectedClassId" class="form-select" :disabled="loading || !classes.length"><option v-for="item in classes" :key="item.id" :value="item.id">{{ item.courseCode }} · {{ item.section }} · {{ item.courseName }}</option></select></label>
    </section>

    <section v-if="loading && !detail" class="loading-panel" role="status"><span class="spinner-border" aria-hidden="true" /><strong>Memuat ruang kelas…</strong></section>
    <EmptyState v-else-if="!detail" title="Tidak ada kelas dalam lingkup Anda" description="Hubungi pengelola akademik bila penugasan atau roster belum tersedia." />

    <template v-else>
      <section class="row g-3" aria-label="Ringkasan kelas">
        <div class="col-sm-6 col-xl-3"><StatCard label="Roster aktif" :value="String(detail.roster.filter(row => row.status === 'ACTIVE').length)" detail="Mahasiswa di kelas" trend="Scope terlindungi" tone="forest" /></div>
        <div class="col-sm-6 col-xl-3"><StatCard label="Realisasi" :value="`${detail.classRecord.realizedMeetingCount} / ${detail.classRecord.totalScheduledMeetings}`" detail="Pertemuan berjurnal" trend="Sesuai jadwal" tone="blue" /></div>
        <div class="col-sm-6 col-xl-3"><StatCard label="Presensi tercatat" :value="String(detail.attendance.length)" detail="Seluruh pertemuan" trend="QR + koreksi" tone="amber" /></div>
        <div class="col-sm-6 col-xl-3"><StatCard label="Versi publikasi" :value="String(detail.classRecord.publicationVersion)" :detail="publishedCurrentVersion ? 'Sinkron dengan gradebook' : 'Belum / perlu diterbitkan'" trend="Snapshot beku" :tone="publishedCurrentVersion ? 'forest' : 'coral'" /></div>
      </section>

      <section class="class-workspace">
        <nav class="class-tabs" aria-label="Bagian kelas"><button v-for="tab in tabs" :key="tab.id" type="button" :class="{ active: activeTab === tab.id }" :aria-current="activeTab === tab.id ? 'page' : undefined" @click="activeTab = tab.id"><i class="uil" :class="tab.icon" aria-hidden="true" />{{ tab.label }}</button></nav>

        <div v-if="activeTab === 'overview'" class="workspace-grid">
          <article class="workspace-card workspace-card--wide"><header><div><span class="section-kicker">Jadwal semester</span><h2>Pertemuan terencana & realisasi</h2></div><StatusBadge :status="detail.classRecord.status === 'ACTIVE' ? 'active' : 'inactive'" :label="detail.classRecord.status === 'ACTIVE' ? 'Kelas aktif' : 'Kelas ditutup'" /></header><div class="meeting-strip"><article v-for="meeting in detail.classRecord.schedule.slice(0, 8)" :key="meeting.meetingNumber" :class="{ realized: detail.journals.some(journal => journal.meetingNumber === meeting.meetingNumber) }"><span>{{ meeting.meetingNumber }}</span><strong>{{ formatDate(meeting.scheduledStartAt).split(',')[0] }}</strong><small>{{ detail.journals.some(journal => journal.meetingNumber === meeting.meetingNumber) ? 'Terealisasi' : 'Terjadwal' }}</small></article></div></article>
          <article class="workspace-card"><header><div><span class="section-kicker">Pengampu</span><h2>Penanggung jawab kelas</h2></div></header><div class="lecturer-panel"><span>{{ detail.classRecord.lecturerNames.map(name => name.split(/\s+/).map(part => part[0]).slice(0, 2).join('')).join('/') }}</span><div><strong>{{ detail.classRecord.lecturerNames.join(', ') }}</strong><small>{{ detail.classRecord.programStudyId }} · {{ detail.classRecord.courseCode }}</small></div></div><dl class="detail-list mt-3"><div><dt>Periode</dt><dd>{{ detail.classRecord.periodId }}</dd></div><div><dt>Bobot</dt><dd>{{ detail.classRecord.credits }} SKS</dd></div><div><dt>Versi gradebook</dt><dd>v{{ detail.classRecord.gradebookVersion }}</dd></div></dl></article>
          <article class="workspace-card"><header><div><span class="section-kicker">Roster privat</span><h2>Peserta kelas</h2></div><span>{{ detail.roster.length }} akun</span></header><ul class="roster-list" data-clarity-mask="true"><li v-for="row in detail.roster.slice(0, 6)" :key="row.studentId"><span>{{ row.studentName.split(/\s+/).map(part => part[0]).slice(0, 2).join('') }}</span><div><strong>{{ row.studentName }}</strong><small>{{ row.studentNumber }}</small></div><StatusBadge :status="row.status === 'ACTIVE' ? 'active' : 'inactive'" :label="row.status === 'ACTIVE' ? 'Aktif' : 'Keluar'" /></li></ul></article>
        </div>

        <div v-else-if="activeTab === 'journal'" class="workspace-grid">
          <article v-if="canManage" class="workspace-card"><header><div><span class="section-kicker">Realisasi pembelajaran</span><h2>Catat jurnal mengajar</h2></div></header><form class="stack-form" @submit.prevent="submitJournal"><div class="two-fields"><label><span>Pertemuan</span><select v-model.number="journalForm.meetingNumber" class="form-select"><option v-for="meeting in detail.classRecord.schedule" :key="meeting.meetingNumber" :value="meeting.meetingNumber">Pertemuan {{ meeting.meetingNumber }}</option></select></label><label><span>Mode</span><select v-model="journalForm.deliveryMode" class="form-select"><option>ONSITE</option><option>ONLINE</option><option>HYBRID</option></select></label></div><div class="two-fields"><label><span>Waktu realisasi</span><input v-model="journalForm.occurredAt" class="form-control" type="datetime-local" required></label><label><span>Durasi (menit)</span><input v-model.number="journalForm.durationMinutes" class="form-control" type="number" min="30" max="300" required></label></div><label><span>Pokok bahasan</span><input v-model="journalForm.topic" class="form-control" minlength="3" maxlength="300" required placeholder="Materi yang direalisasikan"></label><label><span>Alasan kuliah pengganti</span><input v-model="journalForm.makeupReason" class="form-control" maxlength="500" placeholder="Wajib jika realisasi jauh dari jadwal"></label><label><span>Catatan</span><textarea v-model="journalForm.notes" class="form-control" rows="3" maxlength="1000" /></label><button class="btn btn-primary" type="submit" :disabled="submitting"><i class="uil uil-notes me-2" aria-hidden="true" />Simpan jurnal</button></form></article>
          <article class="workspace-card" :class="{ 'workspace-card--wide': !canManage }"><header><div><span class="section-kicker">Jejak pertemuan</span><h2>Jurnal terealisasi</h2></div><span>{{ detail.journals.length }} jurnal</span></header><ol v-if="detail.journals.length" class="journal-list"><li v-for="journal in detail.journals" :key="journal.id"><span>{{ journal.meetingNumber }}</span><div><strong>{{ journal.topic }}</strong><small>{{ formatDate(journal.occurredAt) }} · {{ journal.durationMinutes }} menit · {{ journal.deliveryMode }}</small></div><StatusBadge :status="journal.realization === 'ON_SCHEDULE' ? 'active' : 'review'" :label="journal.realization === 'ON_SCHEDULE' ? 'Sesuai jadwal' : 'Pengganti'" /></li></ol><EmptyState v-else title="Belum ada jurnal" description="Realisasi pembelajaran akan muncul setelah pengampu menyimpan jurnal." /></article>
        </div>

        <div v-else-if="activeTab === 'attendance'" class="workspace-grid">
          <article v-if="canManage" class="workspace-card"><header><div><span class="section-kicker">Tantangan singkat</span><h2>Aktifkan presensi QR</h2></div><i class="uil uil-qrcode-scan card-icon" aria-hidden="true" /></header><p class="helper-copy">QR hanya berlaku pada kelas, jadwal, dan enrolment aktif ini. Setiap mahasiswa hanya dapat tercatat satu kali; tidak ada pengenalan wajah atau AI.</p><div class="two-fields"><label><span>Pertemuan</span><select v-model.number="challengeMeeting" class="form-select"><option v-for="meeting in detail.classRecord.schedule" :key="meeting.meetingNumber" :value="meeting.meetingNumber">Pertemuan {{ meeting.meetingNumber }}</option></select></label><label><span>Masa berlaku</span><select v-model.number="challengeTtl" class="form-select"><option :value="60">1 menit</option><option :value="120">2 menit</option><option :value="300">5 menit</option></select></label></div><button class="btn btn-primary w-100 mt-3" type="button" :disabled="submitting" @click="issueChallenge">Buat QR presensi</button><div v-if="challenge" class="challenge-panel"><AttendanceQr :challenge-token="challenge.challengeToken" :label="`QR presensi pertemuan ${challenge.meetingNumber}`" /><small>Kedaluwarsa {{ formatDate(challenge.expiresAt) }}</small></div></article>
          <article v-if="isStudent" class="workspace-card"><header><div><span class="section-kicker">Check-in mandiri</span><h2>Pindai dengan kamera ponsel</h2></div></header><p class="helper-copy">Arahkan kamera bawaan perangkat ke QR yang ditampilkan dosen. Tautan akan membuka halaman konfirmasi aman dan token segera dihapus dari riwayat browser.</p><NuxtLink class="btn btn-outline-primary" to="/presensi">Buka halaman konfirmasi</NuxtLink></article>
          <article v-if="canManage" class="workspace-card"><header><div><span class="section-kicker">Koreksi beralasan</span><h2>Ubah presensi manual</h2></div></header><form class="stack-form" @submit.prevent="correctAttendanceEntry"><div class="two-fields"><label><span>Mahasiswa</span><select v-model="correctionForm.studentId" class="form-select" data-clarity-mask="true"><option v-for="row in detail.roster" :key="row.studentId" :value="row.studentId">{{ row.studentNumber }} · {{ row.studentName }}</option></select></label><label><span>Pertemuan</span><select v-model.number="correctionForm.meetingNumber" class="form-select"><option v-for="meeting in detail.classRecord.schedule" :key="meeting.meetingNumber" :value="meeting.meetingNumber">{{ meeting.meetingNumber }}</option></select></label></div><label><span>Status</span><select v-model="correctionForm.status" class="form-select"><option value="PRESENT">Hadir</option><option value="LATE">Terlambat</option><option value="EXCUSED">Izin</option><option value="ABSENT">Tidak hadir</option></select></label><label><span>Alasan koreksi</span><textarea v-model="correctionForm.reason" class="form-control" rows="3" minlength="10" maxlength="500" required /></label><button class="btn btn-outline-primary" type="submit" :disabled="submitting">Simpan koreksi & audit</button></form></article>
          <article class="workspace-card" :class="{ 'workspace-card--wide': !canManage && !isStudent }"><header><div><span class="section-kicker">Rekap tercatat</span><h2>Presensi kelas</h2></div><span>{{ detail.attendance.length }} record</span></header><div v-if="detail.attendance.length" class="attendance-list"><article v-for="entry in detail.attendance" :key="entry.id"><span>P{{ entry.meetingNumber }}</span><div><strong>{{ detail.roster.find(row => row.studentId === entry.studentId)?.studentName || entry.studentId }}</strong><small>{{ entry.source }} · versi {{ entry.version }}<template v-if="entry.correctionReason"> · {{ entry.correctionReason }}</template></small></div><StatusBadge :status="statusTone(entry.status)" :label="statusLabel(entry.status)" /></article></div><EmptyState v-else title="Belum ada presensi" description="Check-in QR dan koreksi manual akan muncul di sini." /></article>
        </div>

        <div v-else-if="activeTab === 'grades' && canManage" class="grade-workspace">
          <article class="workspace-card"><header><div><span class="section-kicker">Bobot penilaian</span><h2>Komponen nilai</h2></div><strong :class="totalWeight === 100 ? 'weight-ok' : 'weight-error'">{{ totalWeight }}%</strong></header><div class="component-editor"><article v-for="(component, index) in componentDrafts" :key="`${component.id}-${index}`"><input v-model="component.id" class="form-control" aria-label="ID komponen"><input v-model="component.label" class="form-control" aria-label="Nama komponen"><label><span>Bobot</span><input v-model.number="component.weight" class="form-control" type="number" min="0.01" max="100" step="0.01"></label><label><span>Skor maks.</span><input v-model.number="component.maxScore" class="form-control" type="number" min="1" max="1000"></label></article></div><div class="component-actions"><button class="btn btn-sm btn-outline-secondary" type="button" @click="addComponent"><i class="uil uil-plus me-1" />Tambah</button><button class="btn btn-sm btn-primary" type="button" :disabled="submitting || totalWeight !== 100" @click="saveComponents">Simpan konfigurasi v{{ detail.gradeConfiguration!.version + 1 }}</button></div></article>
          <article class="workspace-card grade-table-card"><header><div><span class="section-kicker">Penilaian kelas</span><h2>Nilai per mahasiswa</h2><p>Lengkapi nilai seluruh komponen sebelum memublikasikan hasil akhir kepada mahasiswa.</p></div><button class="btn btn-primary" type="button" :disabled="submitting || publishedCurrentVersion" @click="publishGradebook"><i class="uil uil-upload-alt me-2" />{{ publishedCurrentVersion ? 'Versi sudah terbit' : `Publikasikan v${detail.classRecord.gradebookVersion}` }}</button></header><div class="table-responsive"><table class="table grade-table mb-0"><thead><tr><th>Mahasiswa</th><th v-for="component in detail.gradeConfiguration!.components" :key="component.id">{{ component.label }}<small>{{ component.weight }}%</small></th><th>Nilai akhir</th><th /></tr></thead><tbody><tr v-for="row in detail.roster" :key="row.studentId"><td data-clarity-mask="true"><strong>{{ row.studentName }}</strong><small>{{ row.studentNumber }}</small></td><td v-for="component in detail.gradeConfiguration!.components" :key="component.id"><input v-model.number="gradeDrafts[row.studentId]![component.id]" class="form-control form-control-sm" type="number" min="0" :max="component.maxScore" :aria-label="`${component.label} ${row.studentName}`"></td><td><strong>{{ detail.grades?.find(grade => grade.studentId === row.studentId)?.finalScore ?? '—' }}</strong><StatusBadge v-if="detail.grades?.find(grade => grade.studentId === row.studentId)" status="active" :label="detail.grades?.find(grade => grade.studentId === row.studentId)?.letterGrade" /></td><td><button class="btn btn-sm btn-outline-primary" type="button" :disabled="submitting" @click="saveGrade(row.studentId)">Simpan</button></td></tr></tbody></table></div></article>
        </div>

        <div v-else-if="activeTab === 'result' && isStudent" class="result-layout"><article v-if="publishedResult" class="result-card"><span class="result-card__seal"><i class="uil uil-award" aria-hidden="true" /></span><span class="section-kicker">Hasil studi resmi · versi {{ publishedResult.publicationVersion }}</span><h2>{{ publishedResult.courseCode }} · {{ publishedResult.courseName }}</h2><p>{{ publishedResult.periodId }} · Kelas {{ publishedResult.section }} · {{ publishedResult.credits }} SKS</p><div class="result-score"><strong>{{ publishedResult.letterGrade }}</strong><span><b>{{ publishedResult.finalScore }}</b><small>nilai akhir</small></span><span><b>{{ publishedResult.qualityPoints }}</b><small>mutu × SKS</small></span></div><footer><span>Dipublikasikan {{ formatDate(publishedResult.publishedAt) }}</span><span data-clarity-mask="true">{{ publishedResult.studentNumber }}</span></footer></article><article v-else class="workspace-card result-empty"><span><i class="uil uil-file-lock-alt" aria-hidden="true" /></span><h2>Muat hasil yang telah dipublikasikan</h2><p>Nilai akhir akan tampil di sini setelah dosen menyelesaikan penilaian dan memublikasikannya.</p><button class="btn btn-primary" type="button" :disabled="submitting" @click="loadPublishedResult">Muat hasil terbit</button></article></div>
      </section>
    </template>
  </div>
</template>

<style scoped src="~/pages/_workflow.css"></style>
<style scoped>
.class-context { display: flex; align-items: center; justify-content: space-between; gap: 1.2rem; padding: 1rem 1.15rem; border: 1px solid #dce6e0; border-radius: 1rem; background: #fff; }
.class-context__identity { display: flex; align-items: center; gap: .75rem; min-width: 0; }
.class-context__identity > span { display: grid; place-items: center; flex: 0 0 auto; width: 2.6rem; height: 2.6rem; border-radius: .75rem; color: #326b57; background: #eaf3ed; font-size: 1.1rem; }
.class-context__identity strong, .class-context__identity small { display: block; }
.class-context__identity strong { overflow: hidden; color: #294b40; font-size: .8rem; text-overflow: ellipsis; white-space: nowrap; }
.class-context__identity small { margin-top: .18rem; color: #83918c; font-size: .64rem; }
.class-context > label { display: grid; gap: .3rem; min-width: min(100%, 360px); }
.class-context > label span, .stack-form label > span, .two-fields label > span { color: #687c73; font-size: .62rem; font-weight: 750; }
.class-context .form-select { border-color: #d8e2dc; font-size: .7rem; }
.loading-panel { display: grid; min-height: 280px; place-items: center; align-content: center; gap: .8rem; border: 1px solid #e0e8e3; border-radius: 1rem; color: #527065; background: #fff; font-size: .75rem; }
.class-workspace { overflow: hidden; border: 1px solid #dfe7e2; border-radius: 1rem; background: #f6f9f7; }
.class-tabs { display: flex; overflow-x: auto; gap: .25rem; padding: .55rem; border-bottom: 1px solid #e1e8e4; background: #fff; }
.class-tabs button { display: inline-flex; align-items: center; gap: .4rem; padding: .58rem .85rem; border: 0; border-radius: .65rem; color: #72847d; background: transparent; font-size: .68rem; font-weight: 750; white-space: nowrap; }
.class-tabs button.active { color: #2b5c4b; background: #edf5f0; }
.workspace-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; padding: 1rem; }
.workspace-card { min-width: 0; padding: 1.1rem; border: 1px solid #e0e8e3; border-radius: .9rem; background: #fff; }
.workspace-card--wide { grid-column: 1 / -1; }
.workspace-card > header { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; margin-bottom: 1rem; }
.workspace-card > header h2 { margin: 0; color: #294b40; font-size: .88rem; }
.workspace-card > header p { margin: .25rem 0 0; color: #87948f; font-size: .62rem; }
.workspace-card > header > span, .workspace-card > header > strong { color: #71847b; font-size: .66rem; }
.meeting-strip { display: grid; grid-template-columns: repeat(8, 1fr); gap: .45rem; }
.meeting-strip article { display: grid; justify-items: center; gap: .2rem; padding: .65rem .3rem; border: 1px solid #e4ebe7; border-radius: .7rem; color: #829088; background: #fafcfb; text-align: center; }
.meeting-strip article.realized { border-color: #bcd4c7; color: #326751; background: #eff6f1; }
.meeting-strip article > span { display: grid; width: 1.5rem; height: 1.5rem; place-items: center; border-radius: 50%; color: #fff; background: #81968c; font-size: .6rem; font-weight: 800; }
.meeting-strip article.realized > span { background: #3e7a62; }
.meeting-strip strong { font-size: .6rem; }
.meeting-strip small { font-size: .54rem; }
.lecturer-panel { display: flex; align-items: center; gap: .75rem; }
.lecturer-panel > span { display: grid; width: 2.8rem; height: 2.8rem; place-items: center; border-radius: .8rem; color: #326651; background: #eaf3ed; font-size: .65rem; font-weight: 850; }
.lecturer-panel strong, .lecturer-panel small { display: block; }
.lecturer-panel strong { color: #345249; font-size: .72rem; }.lecturer-panel small { margin-top: .15rem; color: #899690; font-size: .6rem; }
.roster-list { display: grid; gap: .4rem; margin: 0; padding: 0; list-style: none; }
.roster-list li { display: grid; grid-template-columns: 2rem 1fr auto; gap: .6rem; align-items: center; padding: .48rem; border-bottom: 1px solid #edf1ef; }
.roster-list li > span { display: grid; width: 2rem; height: 2rem; place-items: center; border-radius: .55rem; color: #477064; background: #edf4f0; font-size: .58rem; font-weight: 800; }
.roster-list strong, .roster-list small { display: block; }.roster-list strong { color: #3b574f; font-size: .67rem; }.roster-list small { color: #8b9893; font-size: .58rem; }
.stack-form { display: grid; gap: .75rem; }.stack-form label, .two-fields label { display: grid; gap: .3rem; }.stack-form .form-control, .stack-form .form-select, .two-fields .form-control, .two-fields .form-select { border-color: #d9e2dd; font-size: .7rem; }.two-fields { display: grid; grid-template-columns: 1fr 1fr; gap: .65rem; }
.journal-list { display: grid; gap: .55rem; margin: 0; padding: 0; list-style: none; }.journal-list li { display: grid; grid-template-columns: 2rem 1fr auto; gap: .65rem; align-items: center; padding: .65rem; border: 1px solid #e5ebe8; border-radius: .7rem; }.journal-list li > span { display: grid; width: 2rem; height: 2rem; place-items: center; border-radius: .55rem; color: #fff; background: #4d7f6c; font-size: .66rem; font-weight: 850; }.journal-list strong, .journal-list small { display: block; }.journal-list strong { color: #38564c; font-size: .68rem; }.journal-list small { margin-top: .12rem; color: #87948f; font-size: .58rem; }
.helper-copy { margin: 0 0 1rem; color: #7d8d86; font-size: .66rem; line-height: 1.55; }.card-icon { color: #477968; font-size: 1.3rem; }.challenge-panel { display: grid; justify-items: center; gap: .75rem; margin-top: 1rem; padding: .85rem; border: 1px solid #bfd6ca; border-radius: .75rem; background: #f0f7f2; }.challenge-panel small { color: #61756d; font-size: .67rem; font-weight: 700; }
.attendance-list { display: grid; gap: .45rem; }.attendance-list article { display: grid; grid-template-columns: 2rem 1fr auto; gap: .6rem; align-items: center; padding: .6rem; border-bottom: 1px solid #edf1ef; }.attendance-list article > span { color: #416d5e; font-size: .65rem; font-weight: 850; }.attendance-list strong, .attendance-list small { display: block; }.attendance-list strong { color: #3b574f; font-size: .67rem; }.attendance-list small { color: #899690; font-size: .57rem; }
.grade-workspace { display: grid; gap: 1rem; padding: 1rem; }.component-editor { display: grid; gap: .55rem; }.component-editor article { display: grid; grid-template-columns: .8fr 1.4fr .6fr .6fr; gap: .5rem; align-items: end; }.component-editor label { display: grid; gap: .25rem; }.component-editor label span { color: #75877f; font-size: .57rem; }.component-editor .form-control { font-size: .66rem; }.component-actions { display: flex; justify-content: space-between; gap: .6rem; margin-top: .75rem; }.weight-ok { color: #39775e !important; }.weight-error { color: #a65146 !important; }.grade-table-card { padding: 0; overflow: hidden; }.grade-table-card > header { padding: 1rem 1.1rem 0; }.grade-table { min-width: 850px; }.grade-table th { color: #647970; background: #f7faf8; font-size: .6rem; }.grade-table th small { display: block; margin-top: .12rem; color: #94a09a; font-size: .53rem; }.grade-table td { color: #405a51; font-size: .65rem; }.grade-table td:first-child strong, .grade-table td:first-child small { display: block; }.grade-table td:first-child small { color: #8a9691; font-size: .56rem; }.grade-table input { width: 78px; }.grade-table td:nth-last-child(2) { display: flex; align-items: center; gap: .35rem; }
.result-layout { display: grid; min-height: 380px; place-items: center; padding: 1rem; }.result-card { width: min(100%, 680px); padding: 1.7rem; border: 1px solid #c9dacf; border-radius: 1rem; color: #294a3e; background: linear-gradient(135deg, #fff, #f1f7f3); box-shadow: 0 16px 45px rgba(31, 70, 55, .08); }.result-card__seal { display: grid; width: 3.5rem; height: 3.5rem; margin-bottom: 1rem; place-items: center; border-radius: 1rem; color: #fff; background: #2f6c55; font-size: 1.5rem; }.result-card h2 { margin: 0; font-size: 1.15rem; }.result-card > p { margin: .35rem 0 1.2rem; color: #71847b; font-size: .68rem; }.result-score { display: grid; grid-template-columns: 1.2fr 1fr 1fr; gap: .75rem; align-items: center; padding: 1rem; border-radius: .85rem; background: #e7f1ea; }.result-score > strong { font-size: 3rem; letter-spacing: -.08em; }.result-score span b, .result-score span small { display: block; }.result-score span b { font-size: 1.2rem; }.result-score span small { color: #76887f; font-size: .6rem; }.result-card footer { display: flex; justify-content: space-between; gap: 1rem; margin-top: 1.2rem; padding-top: .8rem; border-top: 1px solid #dce6df; color: #819089; font-size: .6rem; }.result-empty { max-width: 460px; text-align: center; }.result-empty > span { display: grid; width: 3.5rem; height: 3.5rem; margin: 0 auto 1rem; place-items: center; border-radius: 1rem; color: #42705f; background: #e9f2ec; font-size: 1.4rem; }.result-empty h2 { color: #315248; font-size: .95rem; }.result-empty p { color: #7d8d86; font-size: .66rem; line-height: 1.55; }
@media (max-width: 991.98px) { .meeting-strip { grid-template-columns: repeat(4, 1fr); }.workspace-grid { grid-template-columns: 1fr; }.workspace-card--wide { grid-column: auto; } }
@media (max-width: 767.98px) { .class-context { align-items: stretch; flex-direction: column; }.class-context > label { min-width: 0; }.two-fields, .component-editor article { grid-template-columns: 1fr; }.component-editor article { padding-bottom: .7rem; border-bottom: 1px solid #edf1ef; }.result-score { grid-template-columns: 1fr 1fr; }.result-score > strong { grid-column: 1 / -1; }.result-card footer { flex-direction: column; }.workspace-grid, .grade-workspace { padding: .65rem; } }
</style>
