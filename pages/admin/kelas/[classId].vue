<script setup lang="ts">
import type { AxiosError } from 'axios'
import type { AcademicClassRecord, ClassEnrollment } from '~/shared/contracts/lms'
import {
  studentAccountSearchParams,
  useAccountCandidateSearch,
  type AccountCandidate,
  type AccountCandidatePage,
} from '~/composables/useAccountCandidateSearch'

interface ClassDetail { classRecord: AcademicClassRecord }
type AccountRecord = AccountCandidate
type AccountPage = AccountCandidatePage

definePageMeta({ middleware: ['auth', 'admin-mvp'] })
useHead({ title: 'Detail Kelas' })

const route = useRoute()
const { $api } = useNuxtApp()
const classId = computed(() => String(route.params.classId || ''))
const detail = ref<ClassDetail | null>(null)
const enrollments = ref<ClassEnrollment[]>([])
const nextCursor = ref<string>()
const lecturers = ref<AccountRecord[]>([])
const loading = ref(true)
const loadingMore = ref(false)
const saving = ref(false)
const exporting = ref(false)
const errorMessage = ref('')
const noticeMessage = ref('')
const selectedLecturerIds = ref<string[]>([])
const selectedStudentUid = ref('')
const enrollmentReason = ref('')
const statusReason = ref('')
const studentNumber = ref('')
const edit = reactive({ courseName: '', capacity: 40, status: 'ACTIVE' as 'ACTIVE' | 'CLOSED' })

const selectedStudent = computed(() => students.value.find(item => item.id === selectedStudentUid.value))
const key = (purpose: string) => `${purpose}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`
const messageFor = (error: unknown) => {
  const data = (error as AxiosError<{ statusMessage?: string; message?: string }>).response?.data
  return data?.statusMessage || data?.message || (error instanceof Error ? error.message : 'Permintaan belum dapat diproses.')
}
const {
  query: studentSearch,
  items: students,
  total: studentSearchTotal,
  loading: studentSearchLoading,
  searched: studentSearchCompleted,
  error: studentSearchError,
  retry: retryStudentSearch,
  reset: resetStudentSearch,
} = useAccountCandidateSearch(async search => {
  const programStudyId = detail.value?.classRecord.programStudyId
  if (!programStudyId) return { items: [], total: 0 }
  const { data } = await $api.get<AccountPage>('/accounts', {
    params: studentAccountSearchParams(search, programStudyId),
  })
  return data
}, { errorMessage: messageFor })

function syncEdit() {
  const record = detail.value?.classRecord
  if (!record) return
  edit.courseName = record.courseName
  edit.capacity = record.capacity ?? 40
  edit.status = record.status
  selectedLecturerIds.value = [...record.lecturerIds]
}

async function loadEnrollmentPage(cursor?: string) {
  const { data } = await $api.get<{ items: ClassEnrollment[]; nextCursor?: string }>(`/academic/classes/${encodeURIComponent(classId.value)}/enrollments`, { params: { cursor, limit: 50 } })
  enrollments.value = cursor ? [...enrollments.value, ...data.items] : data.items
  nextCursor.value = data.nextCursor
}

async function load() {
  loading.value = true
  errorMessage.value = ''
  try {
    const [classResponse, lecturerResponse] = await Promise.all([
      $api.get<ClassDetail>(`/academic/classes/${encodeURIComponent(classId.value)}`),
      $api.get<AccountPage>('/accounts', { params: { role: 'lecturer', status: 'active', pageSize: 50 } }),
      loadEnrollmentPage(),
    ])
    detail.value = classResponse.data
    lecturers.value = lecturerResponse.data.items
    syncEdit()
  } catch (error) {
    errorMessage.value = messageFor(error)
  } finally {
    loading.value = false
  }
}

async function loadMore() {
  if (!nextCursor.value) return
  loadingMore.value = true
  try { await loadEnrollmentPage(nextCursor.value) } catch (error) { errorMessage.value = messageFor(error) } finally { loadingMore.value = false }
}

async function exportClassCsv() {
  exporting.value = true
  errorMessage.value = ''
  try {
    const response = await $api.get<Blob>(
      `/academic/classes/${encodeURIComponent(classId.value)}/export`,
      { responseType: 'blob' },
    )
    const disposition = String(response.headers['content-disposition'] || '')
    const fileName = disposition.match(/filename="([^"]+)"/)?.[1] || 'kelas-metadata.csv'
    const url = URL.createObjectURL(response.data)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = fileName
    anchor.click()
    URL.revokeObjectURL(url)
  } catch (error) {
    errorMessage.value = messageFor(error)
  } finally {
    exporting.value = false
  }
}

async function saveClass() {
  if (!detail.value) return
  saving.value = true; errorMessage.value = ''; noticeMessage.value = ''
  try {
    const selected = selectedLecturerIds.value.map(id => lecturers.value.find(item => item.id === id)).filter(Boolean) as AccountRecord[]
    await $api.patch(`/academic/classes/${encodeURIComponent(classId.value)}`, {
      expectedVersion: detail.value.classRecord.version ?? 1,
      courseName: edit.courseName,
      capacity: Number(edit.capacity),
      status: edit.status,
      lecturerIds: selected.map(item => item.id),
      lecturerNames: selected.map(item => item.displayName),
    }, { headers: { 'Idempotency-Key': key('class-update') } })
    noticeMessage.value = 'Kelas dan snapshot ruang LMS berhasil diperbarui.'
    await load()
  } catch (error) { errorMessage.value = messageFor(error) } finally { saving.value = false }
}

watch(selectedStudentUid, () => {
  studentNumber.value = selectedStudent.value?.scope.studentIds[0] || ''
})
watch(studentSearch, () => {
  selectedStudentUid.value = ''
})

async function addEnrollment() {
  const account = selectedStudent.value
  if (!account || !detail.value) return
  saving.value = true; errorMessage.value = ''; noticeMessage.value = ''
  try {
    await $api.post(`/academic/classes/${encodeURIComponent(classId.value)}/enrollments`, {
      studentId: account.scope.studentIds[0] || account.id,
      studentUid: account.id,
      studentNumber: studentNumber.value,
      studentName: account.displayName,
      programStudyId: account.scope.programStudyIds[0] || detail.value.classRecord.programStudyId,
      reason: enrollmentReason.value,
    }, { headers: { 'Idempotency-Key': key('enrollment-create') } })
    selectedStudentUid.value = ''; studentNumber.value = ''; enrollmentReason.value = ''
    resetStudentSearch()
    noticeMessage.value = 'Override enrolment tersimpan dan diaudit.'
    await load()
  } catch (error) { errorMessage.value = messageFor(error) } finally { saving.value = false }
}

async function changeStatus(item: ClassEnrollment) {
  if (statusReason.value.trim().length < 10) {
    errorMessage.value = 'Alasan withdraw/reaktivasi minimal 10 karakter.'
    return
  }
  saving.value = true; errorMessage.value = ''; noticeMessage.value = ''
  const nextStatus = item.status === 'ACTIVE' ? 'WITHDRAWN' : 'ACTIVE'
  try {
    await $api.patch(`/academic/classes/${encodeURIComponent(classId.value)}/enrollments/${encodeURIComponent(item.studentId)}`, {
      status: nextStatus,
      reason: statusReason.value,
      expectedVersion: item.version,
    }, { headers: { 'Idempotency-Key': key(`enrollment-${nextStatus.toLowerCase()}`) } })
    statusReason.value = ''
    noticeMessage.value = nextStatus === 'ACTIVE' ? 'Enrolment diaktifkan kembali.' : 'Akses kelas dicabut tanpa menghapus histori.'
    await load()
  } catch (error) { errorMessage.value = messageFor(error) } finally { saving.value = false }
}

onMounted(load)
</script>

<template>
  <div class="page-stack" data-clarity-mask="true">
    <AppPageHeader eyebrow="Administrasi LMS" :title="detail ? `${detail.classRecord.courseCode} · ${detail.classRecord.courseName}` : 'Detail kelas'" description="Perubahan kelas dan enrolment menggunakan version check, alasan, idempotency, serta audit.">
      <template #actions>
        <button class="btn btn-outline-primary" type="button" :disabled="loading || exporting" @click="exportClassCsv">
          <span v-if="exporting" class="spinner-border spinner-border-sm me-2" aria-hidden="true" />
          <i v-else class="uil uil-file-download me-2" aria-hidden="true" />
          Export metadata CSV
        </button>
        <NuxtLink class="btn btn-outline-secondary" to="/admin/kelas"><i class="uil uil-arrow-left me-2" />Daftar kelas</NuxtLink>
      </template>
    </AppPageHeader>
    <div v-if="noticeMessage" class="alert alert-success" role="status">{{ noticeMessage }}</div>
    <div v-if="errorMessage" class="alert alert-danger" role="alert">{{ errorMessage }}</div>
    <div v-if="loading" class="loading-state" role="status"><span class="spinner-border" /> Memuat kelas dan enrolment…</div>

    <template v-else-if="detail">
      <section class="detail-grid">
        <article class="surface-card">
          <header><span class="section-kicker">Konfigurasi kelas</span><h2>Metadata dan dosen pengampu</h2></header>
          <form class="stack-form" @submit.prevent="saveClass">
            <label><span>Nama mata kuliah</span><input v-model="edit.courseName" class="form-control" maxlength="160" required></label>
            <div class="two-fields"><label><span>Kapasitas</span><input v-model.number="edit.capacity" class="form-control" type="number" min="1" max="5000" required></label><label><span>Status</span><select v-model="edit.status" class="form-select"><option value="ACTIVE">Aktif</option><option value="CLOSED">Arsip</option></select></label></div>
            <label><span>Dosen pengampu</span><select v-model="selectedLecturerIds" class="form-select" multiple size="5" required><option v-for="lecturer in lecturers" :key="lecturer.id" :value="lecturer.id">{{ lecturer.displayName }}</option></select></label>
            <button class="btn btn-primary" type="submit" :disabled="saving || !selectedLecturerIds.length">Simpan perubahan</button>
          </form>
        </article>

        <article class="surface-card">
          <header><span class="section-kicker">Override beralasan</span><h2>Tambah mahasiswa</h2></header>
          <form class="stack-form" @submit.prevent="addEnrollment">
            <label for="student-account-search">
              <span>Cari akun mahasiswa</span>
              <input
                id="student-account-search"
                v-model="studentSearch"
                class="form-control"
                type="search"
                maxlength="100"
                autocomplete="off"
                aria-describedby="student-account-search-help"
                aria-controls="student-account-results"
                placeholder="Nama, email, atau ID akun"
              >
              <small id="student-account-search-help" class="field-help">Ketik minimal 2 karakter. Pencarian memeriksa seluruh akun mahasiswa aktif pada program studi kelas.</small>
            </label>
            <div id="student-account-results" class="candidate-results" :aria-busy="studentSearchLoading">
              <p v-if="studentSearchLoading" class="candidate-state" role="status"><span class="spinner-border spinner-border-sm" aria-hidden="true" /> Mencari mahasiswa…</p>
              <div v-else-if="studentSearchError" class="alert alert-danger mb-0" role="alert">
                <span>{{ studentSearchError }}</span>
                <button class="btn btn-sm btn-outline-danger" type="button" @click="retryStudentSearch">Coba lagi</button>
              </div>
              <label v-else-if="students.length" for="student-account-candidate">
                <span>Akun mahasiswa</span>
                <select id="student-account-candidate" v-model="selectedStudentUid" class="form-select" required>
                  <option value="" disabled>Pilih dari {{ studentSearchTotal }} hasil</option>
                  <option v-for="student in students" :key="student.id" :value="student.id">{{ student.displayName }} · {{ student.email }}</option>
                </select>
                <small v-if="studentSearchTotal > students.length" class="field-help">{{ students.length }} hasil pertama ditampilkan. Perjelas kata pencarian untuk menemukan akun lain.</small>
              </label>
              <p v-else-if="studentSearchCompleted" class="candidate-state" role="status">Tidak ada mahasiswa aktif yang cocok pada program studi kelas.</p>
              <p v-else class="candidate-state">Hasil kandidat akan muncul setelah pencarian.</p>
            </div>
            <label><span>NIM / nomor mahasiswa</span><input v-model="studentNumber" class="form-control" required maxlength="40"></label>
            <label><span>Alasan override</span><textarea v-model="enrollmentReason" class="form-control" rows="3" minlength="10" maxlength="500" required></textarea></label>
            <button class="btn btn-primary" type="submit" :disabled="saving || !selectedStudent || enrollmentReason.trim().length < 10">Tambah enrolment</button>
          </form>
        </article>
      </section>

      <section class="surface-card">
        <header class="roster-head"><div><span class="section-kicker">Roster kanonik</span><h2>{{ enrollments.length }} enrolment dimuat</h2></div><label><span>Alasan aksi status</span><input v-model="statusReason" class="form-control" minlength="10" maxlength="500" placeholder="Wajib sebelum withdraw/reaktivasi"></label></header>
        <div v-if="enrollments.length" class="table-responsive">
          <table class="table align-middle">
            <thead><tr><th>Mahasiswa</th><th>Sumber</th><th>Status</th><th>Versi</th><th class="text-end">Aksi</th></tr></thead>
            <tbody><tr v-for="item in enrollments" :key="item.id"><td><strong>{{ item.studentName }}</strong><small>{{ item.studentNumber }} · {{ item.programStudyId }}</small></td><td>{{ item.source }}<small v-if="item.overrideReason">{{ item.overrideReason }}</small></td><td><StatusBadge :status="item.status === 'ACTIVE' ? 'active' : 'blocked'" :label="item.status === 'ACTIVE' ? 'Aktif' : 'Ditarik'" /></td><td>v{{ item.version }}</td><td class="text-end"><button class="btn btn-sm" :class="item.status === 'ACTIVE' ? 'btn-outline-danger' : 'btn-outline-success'" type="button" :disabled="saving || statusReason.trim().length < 10" @click="changeStatus(item)">{{ item.status === 'ACTIVE' ? 'Withdraw' : 'Reaktivasi' }}</button></td></tr></tbody>
          </table>
        </div>
        <EmptyState v-else title="Roster masih kosong" description="Enrolment KRS approved atau override admin akan muncul di sini." />
        <button v-if="nextCursor" class="btn btn-outline-secondary w-100" type="button" :disabled="loadingMore" @click="loadMore"><span v-if="loadingMore" class="spinner-border spinner-border-sm me-2" />Muat 50 berikutnya</button>
      </section>
    </template>
  </div>
</template>

<style scoped>
.page-stack{display:grid;gap:1.2rem}.detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:1rem}.surface-card{padding:1rem;border:1px solid #dfe8e3;border-radius:1rem;background:#fff}.surface-card header{margin-bottom:1rem}.surface-card h2{margin:.2rem 0 0;color:#294c40;font-size:1rem}.section-kicker{color:#668278;font-size:.65rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase}.stack-form{display:grid;gap:.85rem}.stack-form label>span,.roster-head label>span,.candidate-results label>span{display:block;margin-bottom:.3rem;color:#5c7269;font-size:.7rem;font-weight:700}.field-help{display:block;margin-top:.3rem;color:#71847b;font-size:.64rem;line-height:1.45}.candidate-results{min-height:4.5rem;padding:.7rem;border:1px solid #e2eae5;border-radius:.65rem;background:#f9fbfa}.candidate-state{display:flex;align-items:center;gap:.45rem;margin:0;color:#6c7f76;font-size:.7rem}.candidate-results .alert{display:flex;align-items:center;justify-content:space-between;gap:.6rem}.two-fields{display:grid;grid-template-columns:1fr 1fr;gap:.75rem}.roster-head{display:flex;align-items:end;justify-content:space-between;gap:1rem}.roster-head label{width:min(100%,380px)}td strong,td small{display:block}td strong{color:#315449;font-size:.78rem}td small{margin-top:.2rem;color:#788a82;font-size:.65rem}.loading-state{min-height:240px;display:flex;align-items:center;justify-content:center;gap:.7rem;color:#657a72}@media(max-width:767.98px){.detail-grid{grid-template-columns:1fr}.roster-head{align-items:stretch;flex-direction:column}.roster-head label{width:100%}}@media(max-width:575.98px){.two-fields{grid-template-columns:1fr}.candidate-results .alert{align-items:flex-start;flex-direction:column}}
</style>
