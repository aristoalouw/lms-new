<script setup lang="ts">
import type { AcademicClassDetail, AttendanceRecord, AttendanceStatus, IssuedAttendanceChallenge } from '~/shared/contracts/lms'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Presensi kelas' })
const route = useRoute()
const spaceId = computed(() => String(route.params.spaceId || ''))
const { $api } = useNuxtApp()
const { can } = useAuth()
const { detail, loading, error } = useLearningSpace(spaceId)
const meetingNumber = ref(1)
const ttlSeconds = ref(120)
const challenge = ref<IssuedAttendanceChallenge | null>(null)
const classDetail = ref<AcademicClassDetail | null>(null)
const attendanceRows = ref<AttendanceRecord[]>([])
const attendanceCursor = ref<string>()
const attendanceLoading = ref(false)
const correction = reactive({ studentId: '', status: 'PRESENT' as AttendanceStatus, reason: '' })
const busy = ref(false)
const actionError = ref('')
const canManageAttendance = computed(() => can('learning:manage_attendance') && detail.value?.canManage === true)
const canCheckIn = computed(() => can('learning:check_in') && detail.value?.canManage !== true)

async function issue() {
  const classId = detail.value?.space.academicClassId
  if (!classId) return
  busy.value = true; actionError.value = ''; challenge.value = null
  try {
    const { data } = await $api.post<{ value: IssuedAttendanceChallenge }>(`/academic/classes/${classId}/attendance/challenges`, { meetingNumber: meetingNumber.value, ttlSeconds: ttlSeconds.value }, { headers: { 'Idempotency-Key': learningRequestKey('attendance-qr') } })
    challenge.value = data.value
  } catch (cause) { actionError.value = learningErrorMessage(cause) } finally { busy.value = false }
}

async function loadAttendance(reset = true) {
  const classId = detail.value?.space.academicClassId
  if (!classId || (!canManageAttendance.value && !canCheckIn.value)) return
  if (reset) {
    attendanceRows.value = []
    attendanceCursor.value = undefined
  }
  attendanceLoading.value = true
  try {
    if (!classDetail.value) classDetail.value = (await $api.get<AcademicClassDetail>(`/academic/classes/${classId}`)).data
    if (!correction.studentId) correction.studentId = classDetail.value.roster[0]?.studentId || ''
    const { data } = await $api.get<{ items: AttendanceRecord[]; nextCursor?: string }>(`/academic/classes/${classId}/attendance`, {
      params: {
        limit: 50,
        ...(canManageAttendance.value ? { meetingNumber: meetingNumber.value } : {}),
        ...(!reset && attendanceCursor.value ? { cursor: attendanceCursor.value } : {}),
      },
    })
    attendanceRows.value = reset ? data.items : [...attendanceRows.value, ...data.items]
    attendanceCursor.value = data.nextCursor
  } catch (cause) { actionError.value = learningErrorMessage(cause) } finally { attendanceLoading.value = false }
}

async function correct() {
  const classId = detail.value?.space.academicClassId
  if (!classId || !correction.studentId) return
  busy.value = true; actionError.value = ''
  try {
    const currentResponse = await $api.get<{ items: AttendanceRecord[] }>(`/academic/classes/${classId}/attendance`, {
      params: { meetingNumber: meetingNumber.value, studentId: correction.studentId, limit: 1 },
    })
    const current = currentResponse.data.items[0]
    await $api.post(`/academic/classes/${classId}/attendance/corrections`, {
      meetingNumber: meetingNumber.value, studentId: correction.studentId, status: correction.status,
      reason: correction.reason, expectedVersion: current?.version || 0,
    }, { headers: { 'Idempotency-Key': learningRequestKey('attendance-correction') } })
    correction.reason = ''
    await loadAttendance()
  } catch (cause) { actionError.value = learningErrorMessage(cause) } finally { busy.value = false }
}

watch(
  [() => detail.value?.space.academicClassId, canManageAttendance, canCheckIn],
  ([classId, mayManage, mayCheckIn]) => {
    if (classId && (mayManage || mayCheckIn)) void loadAttendance()
    else {
      attendanceRows.value = []
      attendanceCursor.value = undefined
    }
  },
)
watch(meetingNumber, () => {
  if (canManageAttendance.value) void loadAttendance()
})

const statusLabel = (status: AttendanceStatus) => ({ PRESENT: 'Hadir', LATE: 'Terlambat', EXCUSED: 'Izin', ABSENT: 'Tidak hadir' })[status]
</script>

<template>
  <div class="page-stack">
    <div v-if="error || actionError" class="alert alert-danger" role="alert">{{ error || actionError }}</div>
    <div v-if="loading" class="loading-state"><span class="spinner-border spinner-border-sm" />Memuat presensi…</div>
    <LearningSpaceFrame v-else-if="detail" :detail="detail">
      <section v-if="canManageAttendance" class="attendance-panel">
        <header><small>Challenge singkat</small><h2>Tampilkan QR presensi</h2><p>QR memakai URL fragment sehingga token tidak dikirim sebagai URL request atau referrer.</p></header>
        <form @submit.prevent="issue"><label><span>Pertemuan</span><input v-model.number="meetingNumber" class="form-control" type="number" min="1" max="40" required></label><label><span>Masa berlaku</span><select v-model.number="ttlSeconds" class="form-select"><option :value="60">1 menit</option><option :value="120">2 menit</option><option :value="300">5 menit</option></select></label><button class="btn btn-primary" :disabled="busy">Buat QR</button></form>
        <div v-if="challenge" class="challenge-result"><AttendanceQr :challenge-token="challenge.challengeToken" :label="`QR presensi pertemuan ${challenge.meetingNumber}`" /><small>Berlaku hingga {{ new Date(challenge.expiresAt).toLocaleString('id-ID') }}</small></div>
        <section class="correction-panel"><h3>Koreksi manual</h3><p>Perubahan memakai version check dan wajib memiliki alasan audit.</p><form @submit.prevent="correct"><label><span>Mahasiswa</span><select v-model="correction.studentId" class="form-select" required><option v-for="student in classDetail?.roster" :key="student.studentId" :value="student.studentId">{{ student.studentNumber }} · {{ student.studentName }}</option></select></label><label><span>Status</span><select v-model="correction.status" class="form-select"><option value="PRESENT">Hadir</option><option value="LATE">Terlambat</option><option value="EXCUSED">Izin</option><option value="ABSENT">Tidak hadir</option></select></label><label class="reason"><span>Alasan</span><input v-model="correction.reason" class="form-control" minlength="10" maxlength="500" required></label><button class="btn btn-outline-primary" :disabled="busy">Simpan koreksi</button></form></section>
      </section>
      <section v-else-if="canCheckIn" class="student-attendance"><i class="uil uil-qrcode-scan" /><h2>Pindai QR dari dosen</h2><p>Gunakan kamera bawaan ponsel. Setelah membuka tautan, halaman konfirmasi akan memeriksa login dan enrolment aktif Anda.</p><NuxtLink class="btn btn-outline-primary" to="/presensi">Buka halaman konfirmasi</NuxtLink></section>
      <section v-else class="student-attendance support-readonly" aria-labelledby="attendance-support-title"><i class="uil uil-eye" /><h2 id="attendance-support-title">Tampilan dukungan baca-saja</h2><p>Administrator tidak dapat membuat challenge, mengoreksi, atau melakukan check-in presensi.</p></section>
      <section v-if="canManageAttendance || canCheckIn" class="attendance-history">
        <header><h2>{{ canManageAttendance ? `Presensi pertemuan ${meetingNumber}` : 'Riwayat presensi Anda' }}</h2><p>Record bersifat unik untuk setiap mahasiswa dan pertemuan.</p></header>
        <div v-if="attendanceLoading && !attendanceRows.length" class="history-state" role="status"><span class="spinner-border spinner-border-sm" /> Memuat riwayat…</div>
        <div v-else-if="attendanceRows.length" class="table-responsive">
          <table class="table align-middle mb-0">
            <thead><tr><th>Pertemuan</th><th v-if="canManageAttendance">Mahasiswa</th><th>Status</th><th>Sumber</th><th>Diperbarui</th></tr></thead>
            <tbody><tr v-for="item in attendanceRows" :key="item.id"><td>{{ item.meetingNumber }}</td><td v-if="canManageAttendance">{{ classDetail?.roster.find(student => student.studentId === item.studentId)?.studentName || item.studentId }}</td><td><span class="status-pill" :class="item.status.toLowerCase()">{{ statusLabel(item.status) }}</span></td><td>{{ item.source === 'QR' ? 'QR' : 'Koreksi manual' }}</td><td>{{ new Date(item.updatedAt).toLocaleString('id-ID') }}</td></tr></tbody>
          </table>
        </div>
        <p v-else class="history-state">Belum ada record presensi.</p>
        <button v-if="attendanceCursor" class="btn btn-sm btn-outline-primary history-more" type="button" :disabled="attendanceLoading" @click="loadAttendance(false)">Muat berikutnya</button>
      </section>
    </LearningSpaceFrame>
  </div>
</template>

<style scoped src="~/pages/_workflow.css"></style>
<style scoped>
.loading-state{display:flex;gap:.5rem;justify-content:center;padding:4rem}.attendance-panel,.student-attendance,.attendance-history{padding:1rem;border:1px solid #e0e8e3;border-radius:.9rem;background:#fff}.attendance-panel header small{color:#56806e;font-size:.54rem;font-weight:800;text-transform:uppercase}.attendance-panel h2,.student-attendance h2,.attendance-history h2{margin:.15rem 0;color:#315145;font-size:.86rem}.attendance-panel header p,.student-attendance p,.attendance-history header p{margin:.2rem 0;color:#74877e;font-size:.62rem}.attendance-panel>form{display:grid;grid-template-columns:160px 180px auto;gap:.6rem;align-items:end;margin:1rem 0}.attendance-panel label>span{display:block;margin-bottom:.25rem;color:#6d8077;font-size:.58rem;font-weight:700}.challenge-result{display:grid;justify-items:center;gap:.45rem}.challenge-result>small{color:#6d8077;font-size:.6rem}.correction-panel{margin-top:1.25rem;padding-top:1rem;border-top:1px solid #e5ece8}.correction-panel h3{margin:0;color:#315145;font-size:.76rem}.correction-panel p{color:#74877e;font-size:.58rem}.correction-panel form{display:grid;grid-template-columns:1fr 150px 1.3fr auto;gap:.6rem;align-items:end}.student-attendance{display:grid;justify-items:center;padding:2rem;text-align:center}.student-attendance>i{color:#39705a;font-size:2.2rem}.attendance-history{overflow:hidden;padding:0}.attendance-history>header{padding:1rem}.attendance-history th,.attendance-history td{padding:.65rem 1rem;font-size:.62rem}.attendance-history th{color:#587165}.history-state{display:flex;justify-content:center;gap:.45rem;margin:0;padding:1.2rem;color:#74877e;font-size:.65rem}.history-more{margin:0 1rem 1rem}.status-pill{display:inline-flex;padding:.2rem .45rem;border-radius:999px;background:#eef3f0;color:#50695e;font-size:.55rem;font-weight:800}.status-pill.present{background:#e8f5ed;color:#246648}.status-pill.late{background:#fff3d8;color:#865f12}.status-pill.absent{background:#fae9e9;color:#943f3f}@media(max-width:991.98px){.correction-panel form{grid-template-columns:1fr 1fr}.correction-panel .reason{grid-column:1/-1}}@media(max-width:767.98px){.attendance-panel>form,.correction-panel form{grid-template-columns:1fr}.correction-panel .reason{grid-column:auto}}
</style>
