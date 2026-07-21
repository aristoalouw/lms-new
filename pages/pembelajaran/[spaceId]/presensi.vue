<script setup lang="ts">
import type { AcademicClassDetail, AttendanceStatus, IssuedAttendanceChallenge } from '~/shared/contracts/lms'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Presensi kelas' })
const route = useRoute()
const spaceId = computed(() => String(route.params.spaceId || ''))
const { $api } = useNuxtApp()
const { detail, loading, error } = useLearningSpace(spaceId)
const meetingNumber = ref(1)
const ttlSeconds = ref(120)
const challenge = ref<IssuedAttendanceChallenge | null>(null)
const classDetail = ref<AcademicClassDetail | null>(null)
const correction = reactive({ studentId: '', status: 'PRESENT' as AttendanceStatus, reason: '' })
const busy = ref(false)
const actionError = ref('')

async function issue() {
  const classId = detail.value?.space.academicClassId
  if (!classId) return
  busy.value = true; actionError.value = ''; challenge.value = null
  try {
    const { data } = await $api.post<{ value: IssuedAttendanceChallenge }>(`/academic/classes/${classId}/attendance/challenges`, { meetingNumber: meetingNumber.value, ttlSeconds: ttlSeconds.value }, { headers: { 'Idempotency-Key': learningRequestKey('attendance-qr') } })
    challenge.value = data.value
  } catch (cause) { actionError.value = learningErrorMessage(cause) } finally { busy.value = false }
}

async function loadAttendance() {
  const classId = detail.value?.space.academicClassId
  if (!classId || !detail.value?.canManage) return
  try {
    classDetail.value = (await $api.get<AcademicClassDetail>(`/academic/classes/${classId}`)).data
    if (!correction.studentId) correction.studentId = classDetail.value.roster[0]?.studentId || ''
  } catch (cause) { actionError.value = learningErrorMessage(cause) }
}

async function correct() {
  const classId = detail.value?.space.academicClassId
  if (!classId || !correction.studentId) return
  const current = classDetail.value?.attendance.find(item => item.meetingNumber === meetingNumber.value && item.studentId === correction.studentId)
  busy.value = true; actionError.value = ''
  try {
    await $api.post(`/academic/classes/${classId}/attendance/corrections`, {
      meetingNumber: meetingNumber.value, studentId: correction.studentId, status: correction.status,
      reason: correction.reason, expectedVersion: current?.version || 0,
    }, { headers: { 'Idempotency-Key': learningRequestKey('attendance-correction') } })
    correction.reason = ''
    await loadAttendance()
  } catch (cause) { actionError.value = learningErrorMessage(cause) } finally { busy.value = false }
}

watch(() => detail.value?.canManage, loadAttendance)
</script>

<template>
  <div class="page-stack">
    <div v-if="error || actionError" class="alert alert-danger" role="alert">{{ error || actionError }}</div>
    <div v-if="loading" class="loading-state"><span class="spinner-border spinner-border-sm" />Memuat presensi…</div>
    <LearningSpaceFrame v-else-if="detail" :detail="detail">
      <section v-if="detail.canManage" class="attendance-panel">
        <header><small>Challenge singkat</small><h2>Tampilkan QR presensi</h2><p>QR memakai URL fragment sehingga token tidak dikirim sebagai URL request atau referrer.</p></header>
        <form @submit.prevent="issue"><label><span>Pertemuan</span><input v-model.number="meetingNumber" class="form-control" type="number" min="1" max="40" required></label><label><span>Masa berlaku</span><select v-model.number="ttlSeconds" class="form-select"><option :value="60">1 menit</option><option :value="120">2 menit</option><option :value="300">5 menit</option></select></label><button class="btn btn-primary" :disabled="busy">Buat QR</button></form>
        <div v-if="challenge" class="challenge-result"><AttendanceQr :challenge-token="challenge.challengeToken" :label="`QR presensi pertemuan ${challenge.meetingNumber}`" /><small>Berlaku hingga {{ new Date(challenge.expiresAt).toLocaleString('id-ID') }}</small></div>
        <section class="correction-panel"><h3>Koreksi manual</h3><p>Perubahan memakai version check dan wajib memiliki alasan audit.</p><form @submit.prevent="correct"><label><span>Mahasiswa</span><select v-model="correction.studentId" class="form-select" required><option v-for="student in classDetail?.roster" :key="student.studentId" :value="student.studentId">{{ student.studentNumber }} · {{ student.studentName }}</option></select></label><label><span>Status</span><select v-model="correction.status" class="form-select"><option value="PRESENT">Hadir</option><option value="LATE">Terlambat</option><option value="EXCUSED">Izin</option><option value="ABSENT">Tidak hadir</option></select></label><label class="reason"><span>Alasan</span><input v-model="correction.reason" class="form-control" minlength="10" maxlength="500" required></label><button class="btn btn-outline-primary" :disabled="busy">Simpan koreksi</button></form></section>
      </section>
      <section v-else class="student-attendance"><i class="uil uil-qrcode-scan" /><h2>Pindai QR dari dosen</h2><p>Gunakan kamera bawaan ponsel. Setelah membuka tautan, halaman konfirmasi akan memeriksa login dan enrolment aktif Anda.</p><NuxtLink class="btn btn-outline-primary" to="/presensi">Buka halaman konfirmasi</NuxtLink></section>
    </LearningSpaceFrame>
  </div>
</template>

<style scoped src="~/pages/_workflow.css"></style>
<style scoped>
.loading-state{display:flex;gap:.5rem;justify-content:center;padding:4rem}.attendance-panel,.student-attendance{padding:1rem;border:1px solid #e0e8e3;border-radius:.9rem;background:#fff}.attendance-panel header small{color:#56806e;font-size:.54rem;font-weight:800;text-transform:uppercase}.attendance-panel h2,.student-attendance h2{margin:.15rem 0;color:#315145;font-size:.86rem}.attendance-panel header p,.student-attendance p{color:#74877e;font-size:.62rem}.attendance-panel>form{display:grid;grid-template-columns:160px 180px auto;gap:.6rem;align-items:end;margin:1rem 0}.attendance-panel label>span{display:block;margin-bottom:.25rem;color:#6d8077;font-size:.58rem;font-weight:700}.challenge-result{display:grid;justify-items:center;gap:.45rem}.challenge-result>small{color:#6d8077;font-size:.6rem}.correction-panel{margin-top:1.25rem;padding-top:1rem;border-top:1px solid #e5ece8}.correction-panel h3{margin:0;color:#315145;font-size:.76rem}.correction-panel p{color:#74877e;font-size:.58rem}.correction-panel form{display:grid;grid-template-columns:1fr 150px 1.3fr auto;gap:.6rem;align-items:end}.student-attendance{display:grid;justify-items:center;padding:2rem;text-align:center}.student-attendance>i{color:#39705a;font-size:2.2rem}@media(max-width:991.98px){.correction-panel form{grid-template-columns:1fr 1fr}.correction-panel .reason{grid-column:1/-1}}@media(max-width:767.98px){.attendance-panel>form,.correction-panel form{grid-template-columns:1fr}.correction-panel .reason{grid-column:auto}}
</style>
