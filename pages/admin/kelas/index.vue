<script setup lang="ts">
import type { AxiosError } from 'axios'
import type { AcademicClassRecord, LmsAcademicCatalog } from '~/shared/contracts/lms'

interface AccountOption { id: string; displayName: string; roles: string[] }
interface AccountPage { items: AccountOption[] }

definePageMeta({ middleware: ['auth', 'admin-mvp'] })
useHead({ title: 'Kelas & Peserta' })

const { can } = useAuth()
const { $api } = useNuxtApp()
const loading = ref(true)
const saving = ref(false)
const errorMessage = ref('')
const noticeMessage = ref('')
const classes = ref<AcademicClassRecord[]>([])
const nextCursor = ref<string>()
const loadingMore = ref(false)
const lecturers = ref<AccountOption[]>([])
const selectedLecturers = ref<string[]>([])
const catalog = ref<LmsAcademicCatalog>({ programs: [], periods: [], courses: [] })

const activePanel = ref<'list' | 'create' | 'catalog' | 'trash'>('list')
const searchQuery = ref('')
const periodFilter = ref('ALL')
const programFilter = ref('ALL')
const statusFilter = ref<'ALL' | 'ACTIVE' | 'CLOSED'>('ALL')
const courseProgramFilter = ref('ALL')
const pendingDeleteClass = ref<AcademicClassRecord | null>(null)

const firstMeeting = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 16)
const form = reactive({
  courseVersionId: '',
  section: 'A',
  periodId: '',
  capacity: 40,
  firstMeetingStartsAt: firstMeeting,
  meetingCount: 16,
  meetingDurationMinutes: 100,
})

const filteredCoursesForCreate = computed(() => (
  courseProgramFilter.value === 'ALL'
    ? catalog.value.courses
    : catalog.value.courses.filter(item => item.programStudyId === courseProgramFilter.value)
))
const selectedCourse = computed(() => catalog.value.courses.find(item => item.id === form.courseVersionId))
const selectedProgram = computed(() => catalog.value.programs.find(item => item.id === selectedCourse.value?.programStudyId))

const nonDeletedClasses = computed(() => classes.value.filter(item => !item.deletedAt))
const deletedClasses = computed(() => classes.value.filter(item => Boolean(item.deletedAt)))
const filteredClasses = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  return nonDeletedClasses.value.filter(item =>
    (statusFilter.value === 'ALL' || item.status === statusFilter.value)
    && (periodFilter.value === 'ALL' || item.periodId === periodFilter.value)
    && (programFilter.value === 'ALL' || item.programStudyId === programFilter.value)
    && (!q
      || item.courseCode.toLowerCase().includes(q)
      || item.courseName.toLowerCase().includes(q)
      || item.section.toLowerCase().includes(q)
      || item.lecturerNames.some(name => name.toLowerCase().includes(q))),
  )
})

const activeCount = computed(() => nonDeletedClasses.value.length)
const totalEnrolled = computed(() => nonDeletedClasses.value.reduce((sum, item) => sum + (item.enrollmentCount ?? 0), 0))
const inactivePrograms = computed(() => (catalog.value.allPrograms ?? []).filter(item => !item.active))
const inactivePeriods = computed(() => (catalog.value.allPeriods ?? []).filter(item => !item.active))
const trashedPeriods = computed(() => catalog.value.deleted?.periods ?? [])
const trashedPrograms = computed(() => catalog.value.deleted?.programs ?? [])
const coursesUnderInactivePrograms = computed(() => {
  const inactiveIds = new Set(inactivePrograms.value.map(item => item.id))
  return (catalog.value.allCourses ?? []).filter(item => item.status === 'ACTIVE' && inactiveIds.has(item.programStudyId))
})
const hasCreateBlockers = computed(() => !catalog.value.programs.length || !catalog.value.periods.length || !catalog.value.courses.length || !lecturers.value.length)

const key = (purpose: string) => `${purpose}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`
const messageFor = (error: unknown) => {
  const data = (error as AxiosError<{ statusMessage?: string; message?: string }>).response?.data
  return data?.statusMessage || data?.message || (error instanceof Error ? error.message : 'Permintaan kelas gagal diproses.')
}
const termLabel = (term: string) => ({ ODD: 'Gasal', EVEN: 'Genap', SHORT: 'Pendek' })[term] || term
const periodLabel = (periodId: string) => {
  const pool = [...(catalog.value.allPeriods ?? catalog.value.periods), ...(catalog.value.deleted?.periods ?? [])]
  const match = pool.find(item => item.id === periodId)
  return match ? `${match.academicYear} · ${termLabel(match.term)}` : periodId
}
const programLabel = (programId: string) => {
  const pool = [...(catalog.value.allPrograms ?? catalog.value.programs), ...(catalog.value.deleted?.programs ?? [])]
  const match = pool.find(item => item.id === programId)
  return match ? match.name : programId
}
const schedulePreview = (item: AcademicClassRecord) => {
  const first = item.schedule?.[0]
  if (!first) return 'Jadwal belum diatur'
  const start = new Date(first.scheduledStartAt)
  const end = new Date(first.scheduledEndAt)
  const day = new Intl.DateTimeFormat('id-ID', { weekday: 'long', timeZone: 'Asia/Jakarta' }).format(start)
  const clock = (date: Date) => new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Jakarta' }).format(date)
  return `${day}, ${clock(start)}–${clock(end)} WIB (${item.totalScheduledMeetings || item.schedule.length} pertemuan)`
}

function toggleLecturer(id: string) {
  selectedLecturers.value = selectedLecturers.value.includes(id)
    ? selectedLecturers.value.filter(item => item !== id)
    : [...selectedLecturers.value, id]
}

watch(courseProgramFilter, () => {
  if (!filteredCoursesForCreate.value.some(item => item.id === form.courseVersionId)) {
    form.courseVersionId = filteredCoursesForCreate.value[0]?.id || ''
  }
})

async function load(reset = true) {
  if (reset) { loading.value = true; nextCursor.value = undefined }
  else loadingMore.value = true
  errorMessage.value = ''
  try {
    const [classResponse, lecturerResponse, catalogResponse] = await Promise.all([
      $api.get<{ items: AcademicClassRecord[]; nextCursor?: string }>('/academic/classes', { params: { limit: 50, includeDeleted: 'true', ...(!reset && nextCursor.value ? { cursor: nextCursor.value } : {}) } }),
      $api.get<AccountPage>('/accounts', { params: { role: 'lecturer', status: 'active', pageSize: 50 } }).catch(() => ({ data: { items: [] as AccountOption[] } })),
      $api.get<LmsAcademicCatalog>('/academic/classes/catalog', { params: { includeDeleted: 'true' } }),
    ])
    classes.value = reset ? classResponse.data.items : [...classes.value, ...classResponse.data.items]
    nextCursor.value = classResponse.data.nextCursor
    catalog.value = catalogResponse.data
    lecturers.value = lecturerResponse.data.items.length ? lecturerResponse.data.items : (catalogResponse.data.lecturers ?? [])
    if (!filteredCoursesForCreate.value.some(item => item.id === form.courseVersionId)) {
      form.courseVersionId = filteredCoursesForCreate.value[0]?.id || ''
    }
    if (!catalog.value.periods.some(item => item.id === form.periodId)) {
      form.periodId = catalog.value.periods[0]?.id || ''
    }
    if (!selectedLecturers.value.length && lecturers.value.length === 1) {
      selectedLecturers.value = [lecturers.value[0]!.id]
    }
  } catch (error) {
    errorMessage.value = messageFor(error)
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

async function createClass() {
  if (!can('classes:manage')) return
  saving.value = true
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    const selected = selectedLecturers.value.map(id => lecturers.value.find(item => item.id === id)).filter(Boolean) as AccountOption[]
    const rawStart = form.firstMeetingStartsAt.length === 16 ? `${form.firstMeetingStartsAt}:00` : form.firstMeetingStartsAt
    await $api.post('/academic/classes', {
      ...form,
      firstMeetingStartsAt: new Date(`${rawStart}+07:00`).toISOString(),
      lecturerIds: selected.map(item => item.id),
      lecturerNames: selected.map(item => item.displayName),
    }, { headers: { 'Idempotency-Key': key('class-create') } })
    noticeMessage.value = 'Kelas baru beserta ruang pembelajarannya berhasil dibuat.'
    form.section = 'A'
    activePanel.value = 'list'
    await load()
  } catch (error) {
    errorMessage.value = messageFor(error)
  } finally {
    saving.value = false
  }
}

async function toggleClassStatus(item: AcademicClassRecord) {
  const nextStatus = item.status === 'ACTIVE' ? 'CLOSED' : 'ACTIVE'
  saving.value = true
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    await $api.patch(`/academic/classes/${encodeURIComponent(item.id)}`, {
      expectedVersion: item.version ?? 1,
      status: nextStatus,
    }, { headers: { 'Idempotency-Key': key('class-status') } })
    noticeMessage.value = nextStatus === 'CLOSED'
      ? `Kelas ${item.courseCode} (${item.section}) telah diarsipkan.`
      : `Kelas ${item.courseCode} (${item.section}) diaktifkan kembali.`
    await load()
  } catch (error) {
    errorMessage.value = messageFor(error)
  } finally {
    saving.value = false
  }
}

async function confirmDeleteClass() {
  const item = pendingDeleteClass.value
  if (!item) return
  saving.value = true
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    await $api.post(`/academic/classes/${encodeURIComponent(item.id)}/delete`, {
      expectedVersion: item.version ?? 1,
    })
    pendingDeleteClass.value = null
    noticeMessage.value = `Kelas ${item.courseCode} (${item.section}) dipindahkan ke Sampah dan dapat dipulihkan sewaktu-waktu.`
    await load()
  } catch (error) {
    errorMessage.value = messageFor(error)
  } finally {
    saving.value = false
  }
}

async function quickActivateProgram(item: NonNullable<LmsAcademicCatalog['allPrograms']>[number]) {
  saving.value = true
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    await $api.post('/academic/classes/catalog/programs', {
      id: item.id,
      facultyId: item.facultyId,
      code: item.code,
      name: item.name,
      level: item.level,
      accreditationStatus: item.accreditationStatus,
      accreditationExpiresAt: item.accreditationExpiresAt.slice(0, 10),
      active: true,
      expectedVersion: item.version,
    }, { headers: { 'Idempotency-Key': key('quick-activate-program') } })
    noticeMessage.value = `Program studi "${item.name}" berhasil diaktifkan dan siap digunakan untuk membuat kelas.`
    await load()
  } catch (error) {
    errorMessage.value = messageFor(error)
  } finally {
    saving.value = false
  }
}

async function quickRestoreMaster(resource: 'program' | 'period', id: string, label: string) {
  saving.value = true
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    await $api.post('/academic/master/restore', { resource, id })
    noticeMessage.value = `"${label}" berhasil dipulihkan dari Sampah.`
    await load()
  } catch (error) {
    errorMessage.value = messageFor(error)
  } finally {
    saving.value = false
  }
}

async function restoreClass(item: AcademicClassRecord) {
  saving.value = true
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    await $api.post(`/academic/classes/${encodeURIComponent(item.id)}/restore`, {
      expectedVersion: item.version ?? 1,
    })
    noticeMessage.value = `Kelas ${item.courseCode} (${item.section}) berhasil dipulihkan.`
    await load()
  } catch (error) {
    errorMessage.value = messageFor(error)
  } finally {
    saving.value = false
  }
}

onMounted(() => load())
</script>

<template>
  <div class="page-stack" data-clarity-mask="true">
    <AppPageHeader eyebrow="Administrasi akademik" title="Kelas & peserta" description="Kelola kelas perkuliahan, dosen pengampu, jadwal, dan peserta dalam satu tempat.">
      <template #actions>
        <button class="btn btn-outline-secondary" type="button" :disabled="loading" @click="load()"><i class="uil uil-refresh me-1" />Muat ulang</button>
        <button v-if="can('classes:manage')" class="btn btn-primary" type="button" @click="activePanel = activePanel === 'create' ? 'list' : 'create'">
          <i class="uil me-1" :class="activePanel === 'create' ? 'uil-list-ul' : 'uil-plus'" />
          {{ activePanel === 'create' ? 'Lihat daftar kelas' : 'Buat kelas baru' }}
        </button>
      </template>
    </AppPageHeader>

    <div v-if="noticeMessage" class="alert alert-success d-flex align-items-center justify-content-between" role="status"><span>{{ noticeMessage }}</span><button class="btn-close" type="button" aria-label="Tutup" @click="noticeMessage = ''" /></div>
    <div v-if="errorMessage" class="alert alert-danger" role="alert">{{ errorMessage }}</div>
    <div v-if="!can('classes:manage')" class="alert alert-warning">Halaman ini hanya tersedia untuk pengelola kelas.</div>

    <template v-else>
      <nav class="panel-tabs" aria-label="Mode pengelolaan kelas">
        <button type="button" :class="{ active: activePanel === 'list' }" @click="activePanel = 'list'">
          <i class="uil uil-presentation-check" />Daftar kelas <span class="tab-count">{{ activeCount }}</span>
        </button>
        <button type="button" :class="{ active: activePanel === 'create' }" @click="activePanel = 'create'">
          <i class="uil uil-plus-circle" />Buat kelas baru
        </button>
        <button type="button" :class="{ active: activePanel === 'catalog' }" @click="activePanel = 'catalog'">
          <i class="uil uil-book-open" />Katalog prodi &amp; mata kuliah <span class="tab-count">{{ (catalog.allCourses ?? catalog.courses).length }}</span>
        </button>
        <button type="button" :class="{ active: activePanel === 'trash' }" @click="activePanel = 'trash'">
          <i class="uil uil-trash-alt" />Sampah <span class="tab-count">{{ deletedClasses.length }}</span>
        </button>
      </nav>

      <AcademicCatalogManager v-if="activePanel === 'catalog'" :catalog="catalog" @created="load()" />

      <article v-else-if="activePanel === 'trash'" class="surface-card">
        <header class="card-head">
          <div><span class="section-kicker">Pemulihan data</span><h2>Kelas terhapus ({{ deletedClasses.length }})</h2><p>Kelas di bawah ini disembunyikan dari KRS, ruang belajar, dan pelaksanaan kelas, namun dapat dipulihkan kembali beserta seluruh pesertanya.</p></div>
        </header>
        <div v-if="deletedClasses.length" class="class-list">
          <article v-for="item in deletedClasses" :key="item.id" class="class-item class-item--deleted">
            <div class="class-item__main">
              <div class="class-item__title">
                <strong>{{ item.courseCode }} · {{ item.courseName }}</strong>
                <span class="section-pill">Kelas {{ item.section }}</span>
              </div>
              <div class="class-item__meta">
                <span><i class="uil uil-calendar-alt" /> {{ periodLabel(item.periodId) }}</span>
                <span><i class="uil uil-university" /> {{ programLabel(item.programStudyId) }}</span>
                <span><i class="uil uil-trash-alt" /> Dihapus {{ item.deletedAt ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(item.deletedAt)) : '' }}</span>
              </div>
            </div>
            <div class="class-item__side">
              <StatusBadge status="blocked" label="Terhapus" />
              <div class="class-actions">
                <button class="btn btn-sm btn-primary" type="button" :disabled="saving" @click="restoreClass(item)"><i class="uil uil-history me-1" />Pulihkan kelas</button>
              </div>
            </div>
          </article>
        </div>
        <EmptyState v-else title="Sampah kelas kosong" description="Kelas yang dihapus akan muncul di sini dan dapat dipulihkan sewaktu-waktu." icon="uil-trash-alt" />
      </article>

      <article v-else-if="activePanel === 'create'" class="surface-card">
        <header class="card-head">
          <div><span class="section-kicker">Kelas baru</span><h2>Buat kelas &amp; ruang pembelajaran</h2><p>Ruang LMS dan jadwal mingguan dibuat otomatis sesuai periode dan mata kuliah yang dipilih.</p></div>
          <button class="btn btn-sm btn-outline-secondary" type="button" @click="activePanel = 'catalog'"><i class="uil uil-sliders-v-alt me-1" />Kelola mata kuliah</button>
        </header>

        <div v-if="!loading && hasCreateBlockers" class="readiness-box mb-3" role="alert">
          <strong>Persiapan sebelum membuat kelas</strong>
          <ul class="readiness-list">
            <li v-if="!catalog.programs.length">
              <span v-if="inactivePrograms.length">Program studi <strong>{{ inactivePrograms[0]!.code }} · {{ inactivePrograms[0]!.name }}</strong> masih berstatus <em>Nonaktif</em>{{ coursesUnderInactivePrograms.length ? ` (menahan ${coursesUnderInactivePrograms.length} mata kuliah aktif)` : '' }}.</span>
              <span v-else-if="trashedPrograms.length">Semua program studi berada di Sampah.</span>
              <span v-else>Belum ada program studi aktif.</span>
              <button v-if="inactivePrograms.length" class="btn btn-sm btn-primary" type="button" :disabled="saving" @click="quickActivateProgram(inactivePrograms[0]!)">Aktifkan sekarang</button>
              <button v-else-if="trashedPrograms.length" class="btn btn-sm btn-primary" type="button" :disabled="saving" @click="quickRestoreMaster('program', trashedPrograms[0]!.id, `${trashedPrograms[0]!.code} · ${trashedPrograms[0]!.name}`)">Pulihkan {{ trashedPrograms[0]!.name }}</button>
              <button v-else class="btn btn-sm btn-outline-primary" type="button" @click="activePanel = 'catalog'">Tambah prodi</button>
            </li>
            <li v-if="!catalog.periods.length">
              <span v-if="trashedPeriods.length">Belum ada periode aktif — <strong>{{ trashedPeriods[0]!.academicYear }} · {{ termLabel(trashedPeriods[0]!.term) }}</strong> ada di Sampah.</span>
              <span v-else-if="inactivePeriods.length">Periode <strong>{{ inactivePeriods[0]!.academicYear }} · {{ termLabel(inactivePeriods[0]!.term) }}</strong> masih Nonaktif.</span>
              <span v-else>Belum ada periode akademik aktif.</span>
              <button v-if="trashedPeriods.length" class="btn btn-sm btn-primary" type="button" :disabled="saving" @click="quickRestoreMaster('period', trashedPeriods[0]!.id, `${trashedPeriods[0]!.academicYear} · ${termLabel(trashedPeriods[0]!.term)}`)">Pulihkan periode</button>
              <button v-else class="btn btn-sm btn-outline-primary" type="button" @click="activePanel = 'catalog'">Kelola periode</button>
            </li>
            <li v-if="catalog.programs.length && !catalog.courses.length">
              <span>Belum ada mata kuliah aktif pada program studi aktif.</span>
              <button class="btn btn-sm btn-outline-primary" type="button" @click="activePanel = 'catalog'">Tambah mata kuliah</button>
            </li>
            <li v-if="!lecturers.length">
              <span>Belum ada akun dosen pengampu aktif.</span>
              <NuxtLink class="btn btn-sm btn-outline-primary" to="/admin/pengguna">Buka Pengguna &amp; akses</NuxtLink>
            </li>
          </ul>
        </div>

        <form class="class-form" @submit.prevent="createClass">
          <label v-if="catalog.programs.length > 1">
            <span>Filter program studi</span>
            <select v-model="courseProgramFilter" class="form-select">
              <option value="ALL">Semua program studi</option>
              <option v-for="prog in catalog.programs" :key="prog.id" :value="prog.id">{{ prog.code }} · {{ prog.name }}</option>
            </select>
          </label>
          <label :class="{ 'span-2': catalog.programs.length <= 1 }">
            <span>Mata kuliah</span>
            <select v-model="form.courseVersionId" class="form-select" required>
              <option value="" disabled>Pilih mata kuliah aktif</option>
              <option v-for="course in filteredCoursesForCreate" :key="course.id" :value="course.id">{{ course.code }} · {{ course.name }} ({{ course.credits }} SKS)</option>
            </select>
          </label>

          <div v-if="selectedCourse && selectedProgram" class="catalog-summary span-2" aria-live="polite">
            <div><small>Kode &amp; bobot</small><strong>{{ selectedCourse.code }} · {{ selectedCourse.credits }} SKS</strong></div>
            <div><small>Program studi</small><strong>{{ selectedProgram.name }}</strong></div>
            <div><small>Semester acuan</small><strong>Semester {{ selectedCourse.semesterRecommendation }}</strong></div>
          </div>

          <label><span>Periode akademik</span><select v-model="form.periodId" class="form-select" required><option value="" disabled>Pilih periode aktif</option><option v-for="period in catalog.periods" :key="period.id" :value="period.id">{{ period.academicYear }} · {{ termLabel(period.term) }}</option></select></label>
          <div class="inline-two">
            <label><span>Kelas / Section</span><input v-model="form.section" class="form-control" placeholder="A" required maxlength="20"></label>
            <label><span>Kapasitas kursi</span><input v-model.number="form.capacity" class="form-control" type="number" min="1" max="5000" required></label>
          </div>

          <div class="span-2 lecturer-picker">
            <span class="field-label">Dosen pengampu ({{ selectedLecturers.length }} dipilih)</span>
            <div v-if="lecturers.length" class="lecturer-chips">
              <label v-for="lecturer in lecturers" :key="lecturer.id" class="lecturer-chip" :class="{ selected: selectedLecturers.includes(lecturer.id) }">
                <input type="checkbox" class="form-check-input" :checked="selectedLecturers.includes(lecturer.id)" @change="toggleLecturer(lecturer.id)">
                <span>{{ lecturer.displayName }}</span>
              </label>
            </div>
            <p v-else class="text-muted small mb-0">Belum ada akun dosen aktif. Tambahkan peran dosen di menu Pengguna &amp; akses.</p>
          </div>

          <label><span>Pertemuan pertama (WIB)</span><input v-model="form.firstMeetingStartsAt" class="form-control" type="datetime-local" required></label>
          <div class="inline-two">
            <label><span>Jumlah pertemuan</span><input v-model.number="form.meetingCount" class="form-control" type="number" min="1" max="32" required></label>
            <label><span>Durasi (menit)</span><input v-model.number="form.meetingDurationMinutes" class="form-control" type="number" min="30" max="360" required></label>
          </div>

          <div class="form-actions span-2">
            <button class="btn btn-outline-secondary" type="button" @click="activePanel = 'list'">Batal</button>
            <button class="btn btn-primary" type="submit" :disabled="saving || !selectedLecturers.length || !form.courseVersionId || !form.periodId">
              <span v-if="saving" class="spinner-border spinner-border-sm me-2" />Simpan &amp; buat kelas
            </button>
          </div>
        </form>
      </article>

      <article v-else class="surface-card">
        <header class="list-header">
          <div>
            <span class="section-kicker">Daftar perkuliahan</span>
            <h2>{{ filteredClasses.length }} kelas ditampilkan <small class="count-sub">({{ totalEnrolled }} total peserta)</small></h2>
          </div>
          <div class="filter-bar">
            <input v-model="searchQuery" class="form-control form-control-sm" type="search" placeholder="Cari mata kuliah, kode, dosen..." aria-label="Cari kelas">
            <select v-model="periodFilter" class="form-select form-select-sm" aria-label="Filter periode">
              <option value="ALL">Semua periode</option>
              <option v-for="period in catalog.periods" :key="period.id" :value="period.id">{{ period.academicYear }} · {{ termLabel(period.term) }}</option>
            </select>
            <select v-if="catalog.programs.length > 1" v-model="programFilter" class="form-select form-select-sm" aria-label="Filter program studi">
              <option value="ALL">Semua prodi</option>
              <option v-for="prog in catalog.programs" :key="prog.id" :value="prog.id">{{ prog.name }}</option>
            </select>
            <select v-model="statusFilter" class="form-select form-select-sm" aria-label="Filter status">
              <option value="ACTIVE">Kelas aktif</option>
              <option value="CLOSED">Diarsipkan</option>
              <option value="ALL">Semua status</option>
            </select>
          </div>
        </header>

        <div v-if="loading" class="loading-state" role="status"><span class="spinner-border spinner-border-sm" /> Memuat daftar kelas…</div>
        <div v-else-if="filteredClasses.length" class="class-list">
          <article v-for="item in filteredClasses" :key="item.id" class="class-item">
            <div class="class-item__main">
              <div class="class-item__title">
                <strong>{{ item.courseCode }} · {{ item.courseName }}</strong>
                <span class="section-pill">Kelas {{ item.section }}</span>
                <span class="section-pill">{{ item.credits }} SKS</span>
              </div>
              <div class="class-item__meta">
                <span><i class="uil uil-calendar-alt" /> {{ periodLabel(item.periodId) }}</span>
                <span><i class="uil uil-university" /> {{ programLabel(item.programStudyId) }}</span>
                <span><i class="uil uil-clock" /> {{ schedulePreview(item) }}</span>
              </div>
              <div class="class-item__meta">
                <span><i class="uil uil-user-square" /> {{ item.lecturerNames.join(', ') || 'Dosen belum diatur' }}</span>
                <span><i class="uil uil-users-alt" /> {{ item.enrollmentCount ?? 0 }} / {{ item.capacity || '∞' }} peserta</span>
              </div>
            </div>
            <div class="class-item__side">
              <StatusBadge :status="item.status === 'ACTIVE' ? 'active' : 'blocked'" :label="item.status === 'ACTIVE' ? 'Aktif' : 'Arsip'" />
              <div class="class-actions">
                <NuxtLink class="btn btn-sm btn-primary" :to="`/admin/kelas/${item.id}`"><i class="uil uil-edit-alt me-1" />Kelola &amp; peserta</NuxtLink>
                <NuxtLink class="btn btn-sm btn-outline-secondary" :to="`/pembelajaran/${item.id}`"><i class="uil uil-book-open me-1" />Ruang LMS</NuxtLink>
                <button class="btn btn-sm btn-outline-secondary" type="button" :disabled="saving" @click="toggleClassStatus(item)">
                  {{ item.status === 'ACTIVE' ? 'Arsipkan' : 'Aktifkan' }}
                </button>
                <button class="btn btn-sm btn-outline-danger" type="button" :disabled="saving" @click="pendingDeleteClass = item">
                  <i class="uil uil-trash-alt me-1" />Hapus
                </button>
              </div>
            </div>
          </article>
          <button v-if="nextCursor" class="btn btn-sm btn-outline-secondary" :disabled="loadingMore" @click="load(false)"><span v-if="loadingMore" class="spinner-border spinner-border-sm me-2" />Muat kelas berikutnya</button>
        </div>
        <EmptyState v-else title="Belum ada kelas sesuai filter" description="Ubah filter pencarian atau buat kelas baru untuk memulai perkuliahan." />
      </article>

      <div v-if="pendingDeleteClass" class="confirm-overlay" role="dialog" aria-modal="true" @click.self="pendingDeleteClass = null">
        <div class="confirm-dialog">
          <span class="section-kicker">Konfirmasi penghapusan</span>
          <h3>Hapus kelas {{ pendingDeleteClass.courseCode }} ({{ pendingDeleteClass.section }})?</h3>
          <p class="confirm-copy">Kelas akan dipindahkan ke tab <strong>Sampah</strong> dan disembunyikan dari daftar aktif, KRS, serta pelaksanaan kelas. Data peserta dan nilai tetap aman dan dapat dipulihkan sewaktu-waktu.</p>
          <div class="form-actions mt-3">
            <button class="btn btn-outline-secondary" type="button" :disabled="saving" @click="pendingDeleteClass = null">Batal</button>
            <button class="btn btn-danger" type="button" :disabled="saving" @click="confirmDeleteClass"><span v-if="saving" class="spinner-border spinner-border-sm me-2" />Pindahkan ke Sampah</button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.page-stack{display:grid;gap:1.15rem}
.panel-tabs{display:flex;gap:.4rem;flex-wrap:wrap;padding:.35rem;border:1px solid #e6dfd6;border-radius:.85rem;background:#fff;width:fit-content}
.panel-tabs button{display:inline-flex;align-items:center;gap:.45rem;padding:.5rem .85rem;border:0;border-radius:.6rem;color:#4e5462;background:transparent;font-size:.76rem;font-weight:700}
.panel-tabs button.active{color:#fff;background:#593660}
.tab-count{padding:.1rem .45rem;border-radius:999px;font-size:.66rem;background:rgba(89,54,96,.12);color:#593660}
.panel-tabs button.active .tab-count{background:rgba(255,255,255,.22);color:#fff}
.surface-card{padding:1.15rem;border:1px solid #e6dfd6;border-radius:1rem;background:#fff;box-shadow:0 6px 20px rgba(30,30,30,.04)}
.card-head,.list-header{display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:.9rem;margin-bottom:1rem;padding-bottom:.85rem;border-bottom:1px solid #ece6dd}
.surface-card h2{margin:.2rem 0 0;color:#1e1e1e;font-size:1rem}
.count-sub{color:#6c6865;font-size:.78rem;font-weight:500}
.card-head p{margin:.25rem 0 0;color:#6c6865;font-size:.74rem}
.section-kicker{color:#775a83;font-size:.66rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
.filter-bar{display:flex;gap:.5rem;flex-wrap:wrap;align-items:center}
.filter-bar input{min-width:210px}
.filter-bar select{min-width:145px}
.class-form{display:grid;grid-template-columns:1fr 1fr;gap:.9rem}
.class-form label>span,.field-label{display:block;margin-bottom:.32rem;color:#4e5462;font-size:.74rem;font-weight:700}
.inline-two{display:grid;grid-template-columns:1fr 1fr;gap:.7rem}
.span-2{grid-column:1/-1}
.catalog-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.65rem;padding:.8rem;border:1px solid #e6dfd6;border-radius:.75rem;background:#faf6ef}
.catalog-summary small,.catalog-summary strong{display:block}
.catalog-summary small{color:#6c6865;font-size:.66rem}
.catalog-summary strong{color:#1e1e1e;font-size:.8rem;margin-top:.1rem}
.lecturer-picker{padding:.8rem;border:1px solid #e6dfd6;border-radius:.75rem;background:#faf6ef}
.lecturer-chips{display:flex;flex-wrap:wrap;gap:.5rem}
.lecturer-chip{display:inline-flex;align-items:center;gap:.45rem;padding:.45rem .7rem;border:1px solid #d9d0c5;border-radius:.6rem;background:#fff;color:#1e1e1e;font-size:.76rem;font-weight:600;cursor:pointer}
.lecturer-chip.selected{border-color:#593660;background:#f5eff7;color:#3e2344}
.form-actions{display:flex;justify-content:flex-end;gap:.6rem;padding-top:.5rem;border-top:1px solid #ece6dd}
.class-list{display:grid;gap:.75rem}
.class-item{display:flex;justify-content:space-between;align-items:center;gap:1rem;padding:.95rem 1rem;border:1px solid #e6dfd6;border-radius:.85rem;background:#fff;transition:border-color .15s ease,background .15s ease}
.class-item:hover{border-color:#c6b4ce;background:#fdfbf8}
.class-item__main{display:grid;gap:.35rem;min-width:0}
.class-item__title{display:flex;align-items:center;flex-wrap:wrap;gap:.45rem}
.class-item__title strong{color:#1e1e1e;font-size:.88rem}
.section-pill{padding:.12rem .48rem;border-radius:999px;background:#f5eff7;color:#593660;font-size:.66rem;font-weight:700}
.class-item__meta{display:flex;flex-wrap:wrap;gap:.35rem .9rem;color:#6c6865;font-size:.72rem}
.class-item__meta i{color:#775a83;margin-right:.18rem}
.class-item__side{display:flex;flex-direction:column;align-items:flex-end;gap:.55rem;flex-shrink:0}
.class-actions{display:flex;gap:.45rem;flex-wrap:wrap;justify-content:flex-end}
.class-item--deleted{background:#fffaf8;border-color:#efd6d2}
.confirm-overlay{position:fixed;inset:0;z-index:1080;display:grid;place-items:center;padding:1rem;background:rgba(30,20,34,.55);backdrop-filter:blur(4px)}
.confirm-dialog{width:min(100%,460px);padding:1.3rem;border-radius:1rem;background:#fff;box-shadow:0 24px 70px rgba(30,20,34,.28)}
.confirm-dialog h3{margin:.2rem 0 .45rem;color:#1e1e1e;font-size:1.02rem}
.confirm-copy{margin:0;color:#4e5462;font-size:.76rem;line-height:1.55}
.loading-state{display:flex;gap:.5rem;align-items:center;min-height:140px;justify-content:center;color:#6c6865}
.readiness-box{display:grid;gap:.6rem;padding:.9rem 1rem;border:1px solid #e7d4b5;border-radius:.85rem;background:#fdf8ef;color:#5c3f18;font-size:.76rem}
.readiness-box>strong{font-size:.8rem;color:#3d280d}
.readiness-list{display:grid;gap:.5rem;margin:0;padding:0;list-style:none}
.readiness-list li{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.5rem;padding:.55rem .7rem;border:1px solid #efe0c6;border-radius:.65rem;background:#fff}
@media(max-width:991.98px){.class-item{flex-direction:column;align-items:stretch}.class-item__side{align-items:flex-start}.class-actions{justify-content:flex-start}}
@media(max-width:640px){.class-form,.inline-two,.catalog-summary{grid-template-columns:1fr}.span-2{grid-column:auto}.filter-bar{width:100%}.filter-bar input,.filter-bar select{width:100%;min-width:0}}
</style>
