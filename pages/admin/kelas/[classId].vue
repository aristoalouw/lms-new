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
useHead({ title: 'Kelola Kelas & Peserta' })

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
const activeTab = ref<'participants' | 'settings'>('participants')

const selectedLecturerIds = ref<string[]>([])
const selectedStudentUid = ref('')
const enrollmentReason = ref('Penyesuaian KRS atau penempatan kelas atas persetujuan prodi')
const studentNumber = ref('')
const rosterSearch = ref('')
const rosterStatusFilter = ref<'ALL' | 'ACTIVE' | 'WITHDRAWN'>('ALL')
const pendingStatusItem = ref<ClassEnrollment | null>(null)
const pendingStatusReason = ref('')

const edit = reactive({
  courseName: '',
  section: '',
  capacity: 40,
  status: 'ACTIVE' as 'ACTIVE' | 'CLOSED',
  firstMeetingStartsAt: '',
  meetingCount: 16,
  meetingDurationMinutes: 100,
})
const initialSchedule = ref({ firstMeetingStartsAt: '', meetingCount: 16, meetingDurationMinutes: 100 })

const reasonPresets = [
  'Penyesuaian KRS atau penempatan kelas atas persetujuan prodi',
  'Mahasiswa pindahan / konversi mata kuliah semester berjalan',
  'Perbaikan data peserta kelas dari administrasi akademik',
]

const selectedStudent = computed(() => students.value.find(item => item.id === selectedStudentUid.value))
const activeEnrollmentCount = computed(() => enrollments.value.filter(item => item.status === 'ACTIVE').length)
const krsEnrollmentCount = computed(() => enrollments.value.filter(item => item.status === 'ACTIVE' && item.source !== 'ADMIN').length)
const filteredEnrollments = computed(() => {
  const q = rosterSearch.value.trim().toLowerCase()
  return enrollments.value.filter(item =>
    (rosterStatusFilter.value === 'ALL' || item.status === rosterStatusFilter.value)
    && (!q || item.studentName.toLowerCase().includes(q) || item.studentNumber.toLowerCase().includes(q)),
  )
})

const key = (purpose: string) => `${purpose}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`
const messageFor = (error: unknown) => {
  const data = (error as AxiosError<{ statusMessage?: string; message?: string }>).response?.data
  return data?.statusMessage || data?.message || (error instanceof Error ? error.message : 'Permintaan belum dapat diproses.')
}
const toJakartaInput = (isoString: string) => {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Jakarta',
  }).formatToParts(new Date(isoString))
  const get = (type: string) => parts.find(p => p.type === type)?.value || '00'
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`
}
const scheduleSummary = computed(() => {
  const first = detail.value?.classRecord.schedule?.[0]
  if (!first) return 'Jadwal belum diatur'
  const start = new Date(first.scheduledStartAt)
  const end = new Date(first.scheduledEndAt)
  const day = new Intl.DateTimeFormat('id-ID', { weekday: 'long', timeZone: 'Asia/Jakarta' }).format(start)
  const clock = (date: Date) => new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Jakarta' }).format(date)
  return `${day}, ${clock(start)}–${clock(end)} WIB · ${detail.value?.classRecord.totalScheduledMeetings || detail.value?.classRecord.schedule.length} pertemuan`
})

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

function toggleLecturer(id: string) {
  selectedLecturerIds.value = selectedLecturerIds.value.includes(id)
    ? selectedLecturerIds.value.filter(item => item !== id)
    : [...selectedLecturerIds.value, id]
}

function syncEdit() {
  const record = detail.value?.classRecord
  if (!record) return
  edit.courseName = record.courseName
  edit.section = record.section
  edit.capacity = record.capacity ?? 40
  edit.status = record.status
  selectedLecturerIds.value = [...record.lecturerIds]
  const first = record.schedule?.[0]
  const startInput = first ? toJakartaInput(first.scheduledStartAt) : ''
  const count = record.totalScheduledMeetings || record.schedule?.length || 16
  const duration = first
    ? Math.max(30, Math.min(360, Math.round((Date.parse(first.scheduledEndAt) - Date.parse(first.scheduledStartAt)) / 60_000)))
    : 100
  edit.firstMeetingStartsAt = startInput
  edit.meetingCount = count
  edit.meetingDurationMinutes = duration
  initialSchedule.value = { firstMeetingStartsAt: startInput, meetingCount: count, meetingDurationMinutes: duration }
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
  saving.value = true
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    const selected = selectedLecturerIds.value.map(id => lecturers.value.find(item => item.id === id)).filter(Boolean) as AccountRecord[]
    const scheduleChanged = (
      edit.firstMeetingStartsAt !== initialSchedule.value.firstMeetingStartsAt
      || Number(edit.meetingCount) !== initialSchedule.value.meetingCount
      || Number(edit.meetingDurationMinutes) !== initialSchedule.value.meetingDurationMinutes
    )
    const payload: Record<string, unknown> = {
      expectedVersion: detail.value.classRecord.version ?? 1,
      courseName: edit.courseName.trim(),
      section: edit.section.trim(),
      capacity: Number(edit.capacity),
      status: edit.status,
      lecturerIds: selected.map(item => item.id),
      lecturerNames: selected.map(item => item.displayName),
    }
    if (scheduleChanged && edit.firstMeetingStartsAt) {
      payload.firstMeetingStartsAt = new Date(`${edit.firstMeetingStartsAt}:00+07:00`).toISOString()
      payload.meetingCount = Number(edit.meetingCount)
      payload.meetingDurationMinutes = Number(edit.meetingDurationMinutes)
    }
    await $api.patch(`/academic/classes/${encodeURIComponent(classId.value)}`, payload, {
      headers: { 'Idempotency-Key': key('class-update') },
    })
    noticeMessage.value = 'Perubahan kelas, jadwal, dan ruang pembelajaran berhasil disimpan.'
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
  saving.value = true
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    await $api.post(`/academic/classes/${encodeURIComponent(classId.value)}/enrollments`, {
      studentId: account.scope.studentIds[0] || account.id,
      studentUid: account.id,
      studentNumber: studentNumber.value,
      studentName: account.displayName,
      programStudyId: account.scope.programStudyIds[0] || detail.value.classRecord.programStudyId,
      reason: enrollmentReason.value,
    }, { headers: { 'Idempotency-Key': key('enrollment-create') } })
    selectedStudentUid.value = ''
    studentNumber.value = ''
    resetStudentSearch()
    noticeMessage.value = `${account.displayName} berhasil ditambahkan sebagai peserta kelas.`
    await load()
  } catch (error) { errorMessage.value = messageFor(error) } finally { saving.value = false }
}

function promptStatusChange(item: ClassEnrollment) {
  pendingStatusItem.value = item
  pendingStatusReason.value = item.status === 'ACTIVE'
    ? 'Perubahan rencana studi atau pembatalan mata kuliah mahasiswa'
    : 'Pengaktifan kembali keikutsertaan kelas sesuai persetujuan prodi'
}

async function confirmStatusChange() {
  const item = pendingStatusItem.value
  if (!item || pendingStatusReason.value.trim().length < 10) {
    errorMessage.value = 'Alasan perubahan status minimal 10 karakter.'
    return
  }
  saving.value = true
  errorMessage.value = ''
  noticeMessage.value = ''
  const nextStatus = item.status === 'ACTIVE' ? 'WITHDRAWN' : 'ACTIVE'
  try {
    await $api.patch(`/academic/classes/${encodeURIComponent(classId.value)}/enrollments/${encodeURIComponent(item.studentId)}`, {
      status: nextStatus,
      reason: pendingStatusReason.value.trim(),
      expectedVersion: item.version,
    }, { headers: { 'Idempotency-Key': key(`enrollment-${nextStatus.toLowerCase()}`) } })
    pendingStatusItem.value = null
    pendingStatusReason.value = ''
    noticeMessage.value = nextStatus === 'ACTIVE'
      ? `Keikutsertaan ${item.studentName} diaktifkan kembali.`
      : `${item.studentName} dikeluarkan dari kelas aktif (riwayat tetap tersimpan).`
    await load()
  } catch (error) { errorMessage.value = messageFor(error) } finally { saving.value = false }
}

onMounted(load)
</script>

<template>
  <div class="page-stack" data-clarity-mask="true">
    <AppPageHeader
      eyebrow="Kelola kelas"
      :title="detail ? `${detail.classRecord.courseCode} · ${detail.classRecord.courseName} (Kelas ${detail.classRecord.section})` : 'Detail kelas'"
      :description="detail ? `${detail.classRecord.credits} SKS · ${scheduleSummary}` : 'Kelola peserta, dosen pengampu, dan jadwal perkuliahan.'"
      :status="detail?.classRecord.status === 'ACTIVE' ? 'active' : 'blocked'"
      :status-label="detail?.classRecord.status === 'ACTIVE' ? 'Kelas aktif' : 'Diarsipkan'"
    >
      <template #actions>
        <NuxtLink v-if="detail" class="btn btn-outline-primary" :to="`/pembelajaran/${detail.classRecord.id}`"><i class="uil uil-book-open me-1" />Buka ruang LMS</NuxtLink>
        <button class="btn btn-outline-secondary" type="button" :disabled="loading || exporting" @click="exportClassCsv">
          <span v-if="exporting" class="spinner-border spinner-border-sm me-2" aria-hidden="true" />
          <i v-else class="uil uil-file-download me-1" aria-hidden="true" />
          Ekspor CSV
        </button>
        <NuxtLink class="btn btn-outline-secondary" to="/admin/kelas"><i class="uil uil-arrow-left me-1" />Daftar kelas</NuxtLink>
      </template>
    </AppPageHeader>

    <div v-if="noticeMessage" class="alert alert-success d-flex align-items-center justify-content-between" role="status"><span>{{ noticeMessage }}</span><button class="btn-close" type="button" aria-label="Tutup" @click="noticeMessage = ''" /></div>
    <div v-if="errorMessage" class="alert alert-danger" role="alert">{{ errorMessage }}</div>
    <div v-if="loading" class="loading-state" role="status"><span class="spinner-border" /> Memuat data kelas dan peserta…</div>

    <template v-else-if="detail">
      <section class="summary-strip">
        <div><small>Peserta aktif</small><strong>{{ activeEnrollmentCount }} / {{ detail.classRecord.capacity || '∞' }}</strong></div>
        <div><small>Masuk dari KRS</small><strong>{{ krsEnrollmentCount }} mahasiswa</strong></div>
        <div><small>Dosen pengampu</small><strong>{{ detail.classRecord.lecturerNames.join(', ') || 'Belum diatur' }}</strong></div>
        <div><small>Periode</small><strong>{{ detail.classRecord.periodId }}</strong></div>
      </section>

      <nav class="detail-tabs" aria-label="Tab pengelolaan kelas">
        <button type="button" :class="{ active: activeTab === 'participants' }" @click="activeTab = 'participants'">
          <i class="uil uil-users-alt" />Peserta &amp; Enrolment ({{ enrollments.length }})
        </button>
        <button type="button" :class="{ active: activeTab === 'settings' }" @click="activeTab = 'settings'">
          <i class="uil uil-sliders-v-alt" />Sunting Kelas &amp; Jadwal
        </button>
      </nav>

      <section v-if="activeTab === 'participants'" class="participants-layout">
        <article class="surface-card">
          <header><span class="section-kicker">Penambahan manual</span><h2>Tambah peserta ke kelas</h2><p>Peserta KRS yang disetujui dosen wali masuk otomatis. Gunakan formulir ini untuk penyesuaian khusus.</p></header>
          <form class="stack-form" @submit.prevent="addEnrollment">
            <label for="student-account-search">
              <span>Cari mahasiswa</span>
              <input
                id="student-account-search"
                v-model="studentSearch"
                class="form-control"
                type="search"
                maxlength="100"
                autocomplete="off"
                aria-describedby="student-account-search-help"
                aria-controls="student-account-results"
                placeholder="Ketik nama atau email mahasiswa..."
              >
              <small id="student-account-search-help" class="field-help">Ketik minimal 2 karakter untuk mencari mahasiswa aktif pada program studi kelas ini.</small>
            </label>
            <div id="student-account-results" class="candidate-results" :aria-busy="studentSearchLoading">
              <p v-if="studentSearchLoading" class="candidate-state" role="status"><span class="spinner-border spinner-border-sm" aria-hidden="true" /> Mencari mahasiswa…</p>
              <div v-else-if="studentSearchError" class="alert alert-danger mb-0" role="alert">
                <span>{{ studentSearchError }}</span>
                <button class="btn btn-sm btn-outline-danger" type="button" @click="retryStudentSearch">Coba lagi</button>
              </div>
              <label v-else-if="students.length" for="student-account-candidate">
                <span>Pilih mahasiswa</span>
                <select id="student-account-candidate" v-model="selectedStudentUid" class="form-select" required>
                  <option value="" disabled>Pilih dari {{ studentSearchTotal }} hasil</option>
                  <option v-for="student in students" :key="student.id" :value="student.id">{{ student.displayName }} · {{ student.email }}</option>
                </select>
              </label>
              <p v-else-if="studentSearchCompleted" class="candidate-state" role="status">Tidak ada mahasiswa aktif yang cocok pada program studi kelas ini.</p>
              <p v-else class="candidate-state">Hasil pencarian mahasiswa akan muncul di sini.</p>
            </div>
            <label><span>NIM</span><input v-model="studentNumber" class="form-control" required maxlength="40" placeholder="Terisi otomatis setelah memilih mahasiswa"></label>
            <label>
              <span>Alasan penambahan</span>
              <div class="preset-chips">
                <button v-for="preset in reasonPresets" :key="preset" type="button" class="preset-chip" @click="enrollmentReason = preset">{{ preset.slice(0, 38) }}…</button>
              </div>
              <textarea v-model="enrollmentReason" class="form-control" rows="2" minlength="10" maxlength="500" required />
            </label>
            <button class="btn btn-primary" type="submit" :disabled="saving || !selectedStudent || enrollmentReason.trim().length < 10">
              <span v-if="saving" class="spinner-border spinner-border-sm me-2" />Tambahkan ke kelas
            </button>
          </form>
        </article>

        <article class="surface-card">
          <header class="roster-head">
            <div><span class="section-kicker">Daftar peserta</span><h2>{{ filteredEnrollments.length }} mahasiswa</h2></div>
            <div class="roster-filters">
              <input v-model="rosterSearch" class="form-control form-control-sm" type="search" placeholder="Cari nama atau NIM..." aria-label="Cari peserta">
              <select v-model="rosterStatusFilter" class="form-select form-select-sm" aria-label="Filter status peserta">
                <option value="ALL">Semua status</option>
                <option value="ACTIVE">Aktif</option>
                <option value="WITHDRAWN">Dikeluarkan</option>
              </select>
            </div>
          </header>

          <div v-if="filteredEnrollments.length" class="table-responsive">
            <table class="table align-middle">
              <thead><tr><th>Mahasiswa</th><th>Asal</th><th>Status</th><th class="text-end">Aksi</th></tr></thead>
              <tbody>
                <tr v-for="item in filteredEnrollments" :key="item.id">
                  <td><strong>{{ item.studentName }}</strong><small>{{ item.studentNumber }}</small></td>
                  <td>
                    <span class="source-pill">{{ item.source === 'ADMIN' ? 'Penambahan manual' : 'KRS disetujui' }}</span>
                    <small v-if="item.overrideReason">{{ item.overrideReason }}</small>
                  </td>
                  <td><StatusBadge :status="item.status === 'ACTIVE' ? 'active' : 'blocked'" :label="item.status === 'ACTIVE' ? 'Aktif' : 'Dikeluarkan'" /></td>
                  <td class="text-end">
                    <button class="btn btn-sm" :class="item.status === 'ACTIVE' ? 'btn-outline-danger' : 'btn-outline-primary'" type="button" :disabled="saving" @click="promptStatusChange(item)">
                      {{ item.status === 'ACTIVE' ? 'Keluarkan' : 'Aktifkan kembali' }}
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <EmptyState v-else title="Belum ada peserta kelas" description="Mahasiswa yang KRS-nya disetujui dosen wali atau ditambahkan secara manual akan muncul di sini." />
          <button v-if="nextCursor" class="btn btn-outline-secondary w-100 mt-2" type="button" :disabled="loadingMore" @click="loadMore"><span v-if="loadingMore" class="spinner-border spinner-border-sm me-2" />Muat peserta berikutnya</button>
        </article>
      </section>

      <section v-else class="surface-card settings-card">
        <header><span class="section-kicker">Sunting kelas</span><h2>Informasi kelas, dosen pengampu &amp; jadwal</h2><p>Perubahan tersinkron otomatis ke ruang pembelajaran dan katalog KRS.</p></header>
        <form class="settings-form" @submit.prevent="saveClass">
          <label class="span-2"><span>Nama mata kuliah</span><input v-model="edit.courseName" class="form-control" maxlength="160" required></label>
          <label><span>Kelas / Section</span><input v-model="edit.section" class="form-control" maxlength="20" required></label>
          <div class="two-fields">
            <label><span>Kapasitas kursi</span><input v-model.number="edit.capacity" class="form-control" type="number" min="1" max="5000" required></label>
            <label><span>Status kelas</span><select v-model="edit.status" class="form-select"><option value="ACTIVE">Aktif</option><option value="CLOSED">Diarsipkan</option></select></label>
          </div>

          <div class="span-2 lecturer-picker">
            <span class="field-label">Dosen pengampu ({{ selectedLecturerIds.length }} dipilih)</span>
            <div class="lecturer-chips">
              <label v-for="lecturer in lecturers" :key="lecturer.id" class="lecturer-chip" :class="{ selected: selectedLecturerIds.includes(lecturer.id) }">
                <input type="checkbox" class="form-check-input" :checked="selectedLecturerIds.includes(lecturer.id)" @change="toggleLecturer(lecturer.id)">
                <span>{{ lecturer.displayName }}</span>
              </label>
            </div>
          </div>

          <div class="span-2 schedule-box">
            <span class="field-label">Jadwal perkuliahan mingguan</span>
            <p class="field-help mb-2">Saat ini: <strong>{{ scheduleSummary }}</strong>. Ubah kolom di bawah jika ingin menjadwalkan ulang seluruh pertemuan.</p>
            <div class="schedule-fields">
              <label><span>Pertemuan pertama (WIB)</span><input v-model="edit.firstMeetingStartsAt" class="form-control" type="datetime-local"></label>
              <label><span>Jumlah pertemuan</span><input v-model.number="edit.meetingCount" class="form-control" type="number" min="1" max="32"></label>
              <label><span>Durasi (menit)</span><input v-model.number="edit.meetingDurationMinutes" class="form-control" type="number" min="30" max="360"></label>
            </div>
          </div>

          <div class="span-2 form-actions">
            <button class="btn btn-outline-secondary" type="button" @click="syncEdit">Atur ulang</button>
            <button class="btn btn-primary" type="submit" :disabled="saving || !selectedLecturerIds.length">
              <span v-if="saving" class="spinner-border spinner-border-sm me-2" />Simpan perubahan kelas
            </button>
          </div>
        </form>
      </section>

      <div v-if="pendingStatusItem" class="confirm-overlay" role="dialog" aria-modal="true" @click.self="pendingStatusItem = null">
        <form class="confirm-dialog" @submit.prevent="confirmStatusChange">
          <span class="section-kicker">Konfirmasi peserta</span>
          <h3>{{ pendingStatusItem.status === 'ACTIVE' ? `Keluarkan ${pendingStatusItem.studentName}?` : `Aktifkan kembali ${pendingStatusItem.studentName}?` }}</h3>
          <p class="field-help">{{ pendingStatusItem.status === 'ACTIVE' ? 'Akses ruang pembelajaran dicabut tanpa menghapus riwayat nilai dan presensi.' : 'Mahasiswa akan kembali aktif di kelas dan ruang pembelajaran.' }}</p>
          <label class="mt-2 d-block">
            <span class="field-label">Alasan perubahan (minimal 10 karakter)</span>
            <textarea v-model="pendingStatusReason" class="form-control" rows="3" minlength="10" maxlength="500" required />
          </label>
          <div class="form-actions mt-3">
            <button class="btn btn-outline-secondary" type="button" :disabled="saving" @click="pendingStatusItem = null">Batal</button>
            <button class="btn" :class="pendingStatusItem.status === 'ACTIVE' ? 'btn-danger' : 'btn-primary'" type="submit" :disabled="saving || pendingStatusReason.trim().length < 10">
              <span v-if="saving" class="spinner-border spinner-border-sm me-2" />Konfirmasi
            </button>
          </div>
        </form>
      </div>
    </template>
  </div>
</template>

<style scoped>
.page-stack{display:grid;gap:1.15rem}
.summary-strip{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.75rem}
.summary-strip>div{padding:.85rem 1rem;border:1px solid #e6dfd6;border-radius:.85rem;background:#fff}
.summary-strip small,.summary-strip strong{display:block}
.summary-strip small{color:#6c6865;font-size:.66rem;font-weight:700}
.summary-strip strong{margin-top:.2rem;color:#1e1e1e;font-size:.86rem}
.detail-tabs{display:flex;gap:.4rem;flex-wrap:wrap;padding:.35rem;border:1px solid #e6dfd6;border-radius:.85rem;background:#fff;width:fit-content}
.detail-tabs button{display:inline-flex;align-items:center;gap:.45rem;padding:.5rem .9rem;border:0;border-radius:.6rem;color:#4e5462;background:transparent;font-size:.76rem;font-weight:700}
.detail-tabs button.active{color:#fff;background:#593660}
.participants-layout{display:grid;grid-template-columns:minmax(310px,.85fr) minmax(0,1.35fr);gap:1rem;align-items:start}
.surface-card{padding:1.15rem;border:1px solid #e6dfd6;border-radius:1rem;background:#fff;box-shadow:0 6px 20px rgba(30,30,30,.04)}
.surface-card header{margin-bottom:.95rem}
.surface-card h2{margin:.2rem 0 0;color:#1e1e1e;font-size:1rem}
.surface-card header p{margin:.25rem 0 0;color:#6c6865;font-size:.72rem}
.section-kicker{color:#775a83;font-size:.66rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
.stack-form{display:grid;gap:.85rem}
.stack-form label>span,.field-label,.candidate-results label>span{display:block;margin-bottom:.3rem;color:#4e5462;font-size:.74rem;font-weight:700}
.field-help{display:block;margin-top:.25rem;color:#6c6865;font-size:.68rem;line-height:1.45}
.candidate-results{min-height:4.2rem;padding:.7rem;border:1px solid #e6dfd6;border-radius:.7rem;background:#faf6ef}
.candidate-state{display:flex;align-items:center;gap:.45rem;margin:0;color:#6c6865;font-size:.72rem}
.preset-chips{display:flex;flex-wrap:wrap;gap:.35rem;margin-bottom:.4rem}
.preset-chip{padding:.22rem .55rem;border:1px solid #dfd3e4;border-radius:999px;background:#f5eff7;color:#593660;font-size:.64rem;font-weight:600}
.roster-head{display:flex;align-items:flex-end;justify-content:space-between;flex-wrap:wrap;gap:.75rem}
.roster-filters{display:flex;gap:.5rem;flex-wrap:wrap}
.roster-filters input{min-width:190px}
.source-pill{display:inline-block;padding:.15rem .5rem;border-radius:999px;background:#f5eff7;color:#593660;font-size:.66rem;font-weight:700}
td strong,td small{display:block}
td strong{color:#1e1e1e;font-size:.82rem}
td small{margin-top:.15rem;color:#6c6865;font-size:.68rem}
.settings-form{display:grid;grid-template-columns:1fr 1fr;gap:.9rem}
.settings-form label>span{display:block;margin-bottom:.3rem;color:#4e5462;font-size:.74rem;font-weight:700}
.span-2{grid-column:1/-1}
.two-fields{display:grid;grid-template-columns:1fr 1fr;gap:.75rem}
.lecturer-picker,.schedule-box{padding:.85rem;border:1px solid #e6dfd6;border-radius:.75rem;background:#faf6ef}
.lecturer-chips{display:flex;flex-wrap:wrap;gap:.5rem}
.lecturer-chip{display:inline-flex;align-items:center;gap:.45rem;padding:.45rem .7rem;border:1px solid #d9d0c5;border-radius:.6rem;background:#fff;color:#1e1e1e;font-size:.76rem;font-weight:600;cursor:pointer}
.lecturer-chip.selected{border-color:#593660;background:#f5eff7;color:#3e2344}
.schedule-fields{display:grid;grid-template-columns:1.4fr .8fr .8fr;gap:.7rem}
.form-actions{display:flex;justify-content:flex-end;gap:.6rem;padding-top:.5rem;border-top:1px solid #ece6dd}
.confirm-overlay{position:fixed;inset:0;z-index:1080;display:grid;place-items:center;padding:1rem;background:rgba(30,20,34,.55);backdrop-filter:blur(4px)}
.confirm-dialog{width:min(100%,460px);padding:1.3rem;border-radius:1rem;background:#fff;box-shadow:0 24px 70px rgba(30,20,34,.28)}
.confirm-dialog h3{margin:.2rem 0 .35rem;color:#1e1e1e;font-size:1.05rem}
.loading-state{min-height:220px;display:flex;align-items:center;justify-content:center;gap:.7rem;color:#6c6865}
@media(max-width:991.98px){.summary-strip{grid-template-columns:repeat(2,1fr)}.participants-layout{grid-template-columns:1fr}.schedule-fields{grid-template-columns:1fr}}
@media(max-width:575.98px){.summary-strip,.settings-form,.two-fields{grid-template-columns:1fr}.span-2{grid-column:auto}}
</style>
