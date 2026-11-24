<script setup lang="ts">
import type {
  AcademicAdministrationWorkspace,
  AcademicCalendarEvent,
  AcademicCourseVersion,
  AcademicPeriodDefinition,
  AcademicProgramStudy,
  CurriculumVersion,
} from '~/server/types/academic-administration'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Master Data Akademik' })

type Tab = 'program' | 'period' | 'course' | 'curriculum' | 'calendar'
const { $api } = useNuxtApp()
const data = ref<AcademicAdministrationWorkspace | null>(null)
const tab = ref<Tab>('program')
const loading = ref(true)
const working = ref(false)
const errorMessage = ref('')
const noticeMessage = ref('')
const searchQuery = ref('')

const year = new Date().getFullYear()
const editingKey = ref('')
const manualId = ref(false)
const listMode = ref<'active' | 'trash'>('active')
const pendingDelete = ref<{ resource: Tab; id: string; label: string } | null>(null)

const program = reactive({
  id: '',
  facultyId: 'stt-saint-paul',
  code: '',
  name: '',
  level: 'S1' as 'D3' | 'S1' | 'S2',
  active: true,
  accreditationStatus: 'Baik Sekali',
  accreditationExpiresAt: `${year + 5}-12-31`,
  expectedVersion: 0,
})
const period = reactive({
  id: `${year}-${year + 1}-1`,
  academicYear: `${year}/${year + 1}`,
  term: 'ODD' as 'ODD' | 'EVEN' | 'SHORT',
  startsAt: `${year}-08-01T08:00`,
  endsAt: `${year + 1}-01-31T17:00`,
  krsOpensAt: `${year}-07-01T08:00`,
  krsClosesAt: `${year}-08-15T23:59`,
  krsRevisionClosesAt: `${year}-08-31T23:59`,
  krsStatus: 'KRS_OPEN' as 'DRAFT' | 'KRS_OPEN' | 'KRS_CLOSED' | 'CLOSED',
  active: true,
  expectedVersion: 0,
})
const course = reactive({
  courseId: '',
  code: '',
  name: '',
  programStudyId: '',
  credits: 3,
  semesterRecommendation: 1,
  prerequisiteCourseCodes: '',
  equivalentCourseCodes: '',
  status: 'ACTIVE' as 'DRAFT' | 'ACTIVE' | 'RETIRED',
  expectedCurrentVersion: 0,
})
const curriculum = reactive({
  curriculumId: '',
  programStudyId: '',
  name: '',
  effectiveCohortFrom: year,
  effectiveCohortTo: year + 4,
  selectedCourseVersionIds: [] as string[],
  status: 'ACTIVE' as 'DRAFT' | 'ACTIVE' | 'RETIRED',
  expectedCurrentVersion: 0,
})
const calendar = reactive({
  id: '',
  periodId: '',
  selectedProgramIds: [] as string[],
  title: '',
  category: 'ACADEMIC' as 'ACADEMIC' | 'KRS' | 'EXAM' | 'GRADUATION' | 'HOLIDAY' | 'DEADLINE',
  startsAt: `${year}-08-01T08:00`,
  endsAt: `${year}-08-01T17:00`,
  description: '',
  expectedVersion: 0,
})

const tabs: Array<{ id: Tab; label: string; icon: string }> = [
  { id: 'program', label: 'Program studi', icon: 'uil-building' },
  { id: 'period', label: 'Periode & KRS', icon: 'uil-calendar-alt' },
  { id: 'course', label: 'Mata kuliah', icon: 'uil-book-alt' },
  { id: 'curriculum', label: 'Kurikulum', icon: 'uil-books' },
  { id: 'calendar', label: 'Kalender', icon: 'uil-schedule' },
]

const termLabel = (term: string) => ({ ODD: 'Gasal', EVEN: 'Genap', SHORT: 'Pendek' })[term] || term
const krsStatusLabel = (status?: string) => ({ DRAFT: 'Draf', KRS_OPEN: 'KRS dibuka', KRS_CLOSED: 'KRS ditutup', CLOSED: 'Periode selesai' })[status || 'DRAFT'] || status || 'Draf'
const courseStatusLabel = (status: string) => ({ ACTIVE: 'Aktif', DRAFT: 'Draf', RETIRED: 'Nonaktif' })[status] || status
const categoryLabel = (category: string) => ({ ACADEMIC: 'Akademik', KRS: 'KRS', EXAM: 'Ujian', GRADUATION: 'Kelulusan', HOLIDAY: 'Libur', DEADLINE: 'Batas waktu' })[category] || category
const programName = (id: string) => data.value?.programs.find(item => item.id === id)?.name || id
const slugify = (value: string) => value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

const key = (purpose: string) => `${purpose}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`
const iso = (value: string) => new Date(/[zZ]|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}+07:00`).toISOString()
const list = (value: string) => [...new Set(value.split(/[\s,]+/).map(item => item.trim().toUpperCase()).filter(Boolean))]
const errorText = (error: unknown) => {
  const value = error as { response?: { data?: { statusMessage?: string; message?: string } }; message?: string }
  return value.response?.data?.statusMessage || value.response?.data?.message || value.message || 'Master data tidak dapat disimpan.'
}
const toLocalInput = (isoString: string) => {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Jakarta',
  }).formatToParts(new Date(isoString))
  const get = (type: string) => parts.find(p => p.type === type)?.value || '00'
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`
}

watch([() => program.code, () => program.level], () => {
  if (!editingKey.value && !manualId.value && tab.value === 'program') {
    const base = slugify(program.code)
    program.id = base ? `${base}-${program.level.toLowerCase()}` : ''
  }
})
watch(() => course.code, () => {
  if (!editingKey.value && !manualId.value && tab.value === 'course') {
    const base = slugify(course.code)
    course.courseId = base ? `course-${base}` : ''
  }
})
watch([() => curriculum.programStudyId, () => curriculum.effectiveCohortFrom], () => {
  if (!editingKey.value && !manualId.value && tab.value === 'curriculum') {
    const prog = data.value?.programs.find(item => item.id === curriculum.programStudyId)
    if (prog) curriculum.curriculumId = `KUR-${prog.code.toUpperCase()}-${curriculum.effectiveCohortFrom}`
  }
})
watch(() => calendar.title, () => {
  if (!editingKey.value && !manualId.value && tab.value === 'calendar') {
    const base = slugify(calendar.title).slice(0, 36)
    calendar.id = base ? `cal-${year}-${base}` : ''
  }
})

const latestCourses = computed(() => {
  const map = new Map<string, AcademicCourseVersion>()
  for (const item of (data.value?.courses || []).filter(entry => !entry.deletedAt)) {
    const current = map.get(item.courseId)
    if (!current || item.version > current.version) map.set(item.courseId, item)
  }
  return [...map.values()].sort((a, b) => a.code.localeCompare(b.code))
})
const deletedCourses = computed(() => {
  const map = new Map<string, AcademicCourseVersion>()
  for (const item of (data.value?.courses || []).filter(entry => Boolean(entry.deletedAt))) {
    const current = map.get(item.courseId)
    if (!current || item.version > current.version) map.set(item.courseId, item)
  }
  return [...map.values()].sort((a, b) => (b.deletedAt || '').localeCompare(a.deletedAt || ''))
})

const coursesForSelectedCurriculumProgram = computed(() =>
  latestCourses.value.filter(item => item.status === 'ACTIVE' && (!curriculum.programStudyId || item.programStudyId === curriculum.programStudyId)),
)
const curriculumSelectedCredits = computed(() => {
  const all = data.value?.courses || []
  return curriculum.selectedCourseVersionIds.reduce((sum, id) => sum + (all.find(item => item.id === id)?.credits || 0), 0)
})

const latestCurricula = computed(() => {
  const map = new Map<string, CurriculumVersion>()
  for (const item of (data.value?.curricula || []).filter(entry => !entry.deletedAt)) {
    const current = map.get(item.curriculumId)
    if (!current || item.version > current.version) map.set(item.curriculumId, item)
  }
  return [...map.values()]
})
const deletedCurricula = computed(() => {
  const map = new Map<string, CurriculumVersion>()
  for (const item of (data.value?.curricula || []).filter(entry => Boolean(entry.deletedAt))) {
    const current = map.get(item.curriculumId)
    if (!current || item.version > current.version) map.set(item.curriculumId, item)
  }
  return [...map.values()].sort((a, b) => (b.deletedAt || '').localeCompare(a.deletedAt || ''))
})

const activePrograms = computed(() => (data.value?.programs || []).filter(item => !item.deletedAt))
const deletedPrograms = computed(() => (data.value?.programs || []).filter(item => Boolean(item.deletedAt)))
const activePeriods = computed(() => (data.value?.periods || []).filter(item => !item.deletedAt))
const deletedPeriods = computed(() => (data.value?.periods || []).filter(item => Boolean(item.deletedAt)))
const activeCalendar = computed(() => (data.value?.calendar || []).filter(item => !item.deletedAt))
const deletedCalendar = computed(() => (data.value?.calendar || []).filter(item => Boolean(item.deletedAt)))

const currentTrashCount = computed(() => ({
  program: deletedPrograms.value.length,
  period: deletedPeriods.value.length,
  course: deletedCourses.value.length,
  curriculum: deletedCurricula.value.length,
  calendar: deletedCalendar.value.length,
})[tab.value])

const filteredPrograms = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  const source = listMode.value === 'trash' ? deletedPrograms.value : activePrograms.value
  return source.filter(item => !q || item.name.toLowerCase().includes(q) || item.code.toLowerCase().includes(q))
})
const filteredPeriods = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  const source = listMode.value === 'trash' ? deletedPeriods.value : activePeriods.value
  return source.filter(item => !q || item.academicYear.toLowerCase().includes(q) || item.id.toLowerCase().includes(q))
})
const filteredCourses = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  const source = listMode.value === 'trash' ? deletedCourses.value : latestCourses.value
  return source.filter(item => !q || item.code.toLowerCase().includes(q) || item.name.toLowerCase().includes(q))
})
const filteredCurricula = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  const source = listMode.value === 'trash' ? deletedCurricula.value : latestCurricula.value
  return source.filter(item => !q || item.name.toLowerCase().includes(q) || item.curriculumId.toLowerCase().includes(q))
})
const filteredCalendar = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  const source = listMode.value === 'trash' ? deletedCalendar.value : activeCalendar.value
  return source.filter(item => !q || item.title.toLowerCase().includes(q) || item.category.toLowerCase().includes(q))
})

function switchTab(next: Tab) {
  tab.value = next
  listMode.value = 'active'
  editingKey.value = ''
  manualId.value = false
  searchQuery.value = ''
  errorMessage.value = ''
  noticeMessage.value = ''
}

function resetCurrentForm() {
  editingKey.value = ''
  manualId.value = false
  const firstProgram = data.value?.programs.find(item => item.active)?.id || ''
  const firstPeriod = data.value?.periods.find(item => item.active)?.id || ''
  const defaultFaculty = data.value?.programs[0]?.facultyId || 'stt-saint-paul'
  if (tab.value === 'program') {
    Object.assign(program, { id: '', facultyId: defaultFaculty, code: '', name: '', level: 'S1', active: true, accreditationStatus: 'Baik Sekali', accreditationExpiresAt: `${year + 5}-12-31`, expectedVersion: 0 })
  } else if (tab.value === 'period') {
    Object.assign(period, { id: `${year}-${year + 1}-1`, academicYear: `${year}/${year + 1}`, term: 'ODD', startsAt: `${year}-08-01T08:00`, endsAt: `${year + 1}-01-31T17:00`, krsOpensAt: `${year}-07-01T08:00`, krsClosesAt: `${year}-08-15T23:59`, krsRevisionClosesAt: `${year}-08-31T23:59`, krsStatus: 'KRS_OPEN', active: true, expectedVersion: 0 })
  } else if (tab.value === 'course') {
    Object.assign(course, { courseId: '', code: '', name: '', programStudyId: firstProgram, credits: 3, semesterRecommendation: 1, prerequisiteCourseCodes: '', equivalentCourseCodes: '', status: 'ACTIVE', expectedCurrentVersion: 0 })
  } else if (tab.value === 'curriculum') {
    Object.assign(curriculum, { curriculumId: '', programStudyId: firstProgram, name: '', effectiveCohortFrom: year, effectiveCohortTo: year + 4, selectedCourseVersionIds: [], status: 'ACTIVE', expectedCurrentVersion: 0 })
  } else {
    Object.assign(calendar, { id: '', periodId: firstPeriod, selectedProgramIds: firstProgram ? [firstProgram] : [], title: '', category: 'ACADEMIC', startsAt: `${year}-08-01T08:00`, endsAt: `${year}-08-01T17:00`, description: '', expectedVersion: 0 })
  }
}

function selectProgram(item: AcademicProgramStudy) {
  editingKey.value = item.id
  manualId.value = true
  Object.assign(program, {
    id: item.id,
    facultyId: item.facultyId,
    code: item.code,
    name: item.name,
    level: item.level,
    active: item.active,
    accreditationStatus: item.accreditationStatus,
    accreditationExpiresAt: item.accreditationExpiresAt.slice(0, 10),
    expectedVersion: item.version,
  })
}

function selectPeriod(item: AcademicPeriodDefinition) {
  editingKey.value = item.id
  manualId.value = true
  Object.assign(period, {
    id: item.id,
    academicYear: item.academicYear,
    term: item.term,
    startsAt: toLocalInput(item.startsAt),
    endsAt: toLocalInput(item.endsAt),
    krsOpensAt: toLocalInput(item.krsOpensAt),
    krsClosesAt: toLocalInput(item.krsClosesAt),
    krsRevisionClosesAt: toLocalInput(item.krsRevisionClosesAt || item.endsAt),
    krsStatus: item.krsStatus || 'DRAFT',
    active: item.active,
    expectedVersion: item.version,
  })
}

function selectCourse(item: AcademicCourseVersion) {
  editingKey.value = item.courseId
  manualId.value = true
  Object.assign(course, {
    courseId: item.courseId,
    code: item.code,
    name: item.name,
    programStudyId: item.programStudyId,
    credits: item.credits,
    semesterRecommendation: item.semesterRecommendation,
    prerequisiteCourseCodes: item.prerequisiteCourseCodes.join(', '),
    equivalentCourseCodes: item.equivalentCourseCodes.join(', '),
    status: item.status,
    expectedCurrentVersion: item.version,
  })
}

function selectCurriculum(item: CurriculumVersion) {
  editingKey.value = item.curriculumId
  manualId.value = true
  Object.assign(curriculum, {
    curriculumId: item.curriculumId,
    programStudyId: item.programStudyId,
    name: item.name,
    effectiveCohortFrom: item.effectiveCohortFrom,
    effectiveCohortTo: item.effectiveCohortTo,
    selectedCourseVersionIds: [...item.courseVersionIds],
    status: item.status,
    expectedCurrentVersion: item.version,
  })
}

function selectCalendar(item: AcademicCalendarEvent) {
  editingKey.value = item.id
  manualId.value = true
  Object.assign(calendar, {
    id: item.id,
    periodId: item.periodId,
    selectedProgramIds: [...item.programStudyIds],
    title: item.title,
    category: item.category,
    startsAt: toLocalInput(item.startsAt),
    endsAt: toLocalInput(item.endsAt),
    description: item.description || '',
    expectedVersion: item.version,
  })
}

function toggleCurriculumCourse(versionId: string) {
  curriculum.selectedCourseVersionIds = curriculum.selectedCourseVersionIds.includes(versionId)
    ? curriculum.selectedCourseVersionIds.filter(id => id !== versionId)
    : [...curriculum.selectedCourseVersionIds, versionId]
}

function toggleCalendarProgram(programId: string) {
  calendar.selectedProgramIds = calendar.selectedProgramIds.includes(programId)
    ? calendar.selectedProgramIds.filter(id => id !== programId)
    : [...calendar.selectedProgramIds, programId]
}

const load = async () => {
  loading.value = true
  try {
    data.value = (await $api.get<AcademicAdministrationWorkspace>('/academic/administration')).data
    const firstProgram = data.value.programs.find(item => item.active && !item.deletedAt)?.id || ''
    const firstPeriod = data.value.periods.find(item => item.active && !item.deletedAt)?.id || ''
    if (!course.programStudyId) course.programStudyId = firstProgram
    if (!curriculum.programStudyId) curriculum.programStudyId = firstProgram
    if (!calendar.selectedProgramIds.length && firstProgram) calendar.selectedProgramIds = [firstProgram]
    if (!calendar.periodId) calendar.periodId = firstPeriod
  } catch (error) {
    errorMessage.value = errorText(error)
  } finally {
    loading.value = false
  }
}

const run = async (path: string, body: Record<string, unknown>, message: string) => {
  working.value = true
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    await $api.post(path, body, { headers: { 'Idempotency-Key': key(`academic-master-${tab.value}`) } })
    noticeMessage.value = message
    await load()
    resetCurrentForm()
  } catch (error) {
    errorMessage.value = errorText(error)
  } finally {
    working.value = false
  }
}

const saveProgram = () => run('/academic/master/programs', {
  ...program,
  id: program.id.trim(),
  facultyId: program.facultyId.trim(),
  code: program.code.trim().toUpperCase(),
  name: program.name.trim(),
}, editingKey.value ? 'Program studi berhasil diperbarui.' : 'Program studi baru berhasil disimpan.')

const savePeriod = () => run('/academic/master/periods', {
  ...period,
  startsAt: iso(period.startsAt),
  endsAt: iso(period.endsAt),
  krsOpensAt: iso(period.krsOpensAt),
  krsClosesAt: iso(period.krsClosesAt),
  krsRevisionClosesAt: iso(period.krsRevisionClosesAt),
}, editingKey.value ? 'Periode akademik dan kebijakan KRS berhasil diperbarui.' : 'Periode akademik baru berhasil disimpan.')

const saveCourse = () => run('/academic/master/courses', {
  ...course,
  courseId: course.courseId.trim(),
  code: course.code.trim().toUpperCase(),
  name: course.name.trim(),
  credits: Number(course.credits),
  semesterRecommendation: Number(course.semesterRecommendation),
  prerequisiteCourseCodes: list(course.prerequisiteCourseCodes),
  equivalentCourseCodes: list(course.equivalentCourseCodes),
}, editingKey.value ? 'Revisi mata kuliah berhasil disimpan.' : 'Mata kuliah baru berhasil dibuat.')

const saveCurriculum = () => run('/academic/master/curricula', {
  curriculumId: curriculum.curriculumId.trim(),
  programStudyId: curriculum.programStudyId,
  name: curriculum.name.trim(),
  effectiveCohortFrom: Number(curriculum.effectiveCohortFrom),
  effectiveCohortTo: Number(curriculum.effectiveCohortTo),
  courseVersionIds: curriculum.selectedCourseVersionIds,
  status: curriculum.status,
  expectedCurrentVersion: curriculum.expectedCurrentVersion,
}, editingKey.value ? 'Revisi kurikulum berhasil disimpan.' : 'Kurikulum baru berhasil dibuat.')

const saveCalendar = () => run('/academic/master/calendar', {
  id: calendar.id.trim(),
  periodId: calendar.periodId,
  programStudyIds: calendar.selectedProgramIds,
  title: calendar.title.trim(),
  category: calendar.category,
  startsAt: iso(calendar.startsAt),
  endsAt: iso(calendar.endsAt),
  description: calendar.description.trim() || undefined,
  expectedVersion: calendar.expectedVersion,
}, editingKey.value ? 'Agenda kalender berhasil diperbarui.' : 'Agenda kalender baru berhasil disimpan.')

async function confirmDeleteMaster() {
  const target = pendingDelete.value
  if (!target) return
  working.value = true
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    await $api.post('/academic/master/delete', { resource: target.resource, id: target.id })
    pendingDelete.value = null
    noticeMessage.value = `"${target.label}" dipindahkan ke Sampah dan dapat dipulihkan sewaktu-waktu.`
    await load()
    resetCurrentForm()
  } catch (error) {
    errorMessage.value = errorText(error)
  } finally {
    working.value = false
  }
}

async function restoreMaster(resource: Tab, id: string, label: string) {
  working.value = true
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    await $api.post('/academic/master/restore', { resource, id })
    noticeMessage.value = `"${label}" berhasil dipulihkan.`
    await load()
  } catch (error) {
    errorMessage.value = errorText(error)
  } finally {
    working.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="page-stack master-page">
    <AppPageHeader eyebrow="Administrasi akademik" title="Master data akademik" description="Kelola program studi, periode akademik, mata kuliah, kurikulum, dan kalender kampus.">
      <template #actions>
        <NuxtLink class="btn btn-outline-secondary" to="/akademik/administrasi"><i class="uil uil-arrow-left me-1" />Kembali</NuxtLink>
        <button class="btn btn-primary" type="button" :disabled="loading" @click="load"><i class="uil uil-refresh me-1" />Muat ulang</button>
      </template>
    </AppPageHeader>

    <div v-if="noticeMessage" class="alert alert-success d-flex align-items-center justify-content-between" role="status"><span>{{ noticeMessage }}</span><button class="btn-close" type="button" aria-label="Tutup" @click="noticeMessage = ''" /></div>
    <div v-if="errorMessage" class="alert alert-danger" role="alert">{{ errorMessage }}</div>
    <div v-if="loading" class="alert alert-info" role="status">Memuat master data akademik...</div>

    <nav class="master-tabs" aria-label="Kategori master data">
      <button v-for="item in tabs" :key="item.id" type="button" :class="{ active: tab === item.id }" @click="switchTab(item.id)">
        <i class="uil" :class="item.icon" />{{ item.label }}
      </button>
    </nav>

    <div v-if="data" class="master-layout">
      <section class="surface-card form-card">
        <template v-if="tab === 'program'">
          <header class="form-head">
            <div><span>{{ editingKey ? 'Mode sunting' : 'Data baru' }}</span><h2>{{ editingKey ? `Sunting ${program.name}` : 'Tambah program studi' }}</h2><p>Klik tombol Sunting pada daftar di kanan untuk memperbarui program studi yang ada.</p></div>
            <button v-if="editingKey" class="btn btn-sm btn-outline-secondary" type="button" @click="resetCurrentForm">+ Buat baru</button>
          </header>
          <form @submit.prevent="saveProgram">
            <div class="form-row">
              <label>Kode program<input v-model="program.code" class="form-control text-uppercase" placeholder="TEOLOGI" required></label>
              <label>Jenjang<select v-model="program.level" class="form-select"><option value="D3">D3</option><option value="S1">S1</option><option value="S2">S2</option></select></label>
            </div>
            <label>Nama program studi<input v-model="program.name" class="form-control" placeholder="Sarjana Teologi" required></label>
            <div class="form-row">
              <label>Status akreditasi<input v-model="program.accreditationStatus" class="form-control" placeholder="Baik Sekali" required></label>
              <label>Berlaku sampai<input v-model="program.accreditationExpiresAt" type="date" class="form-control" required></label>
            </div>
            <div class="form-row">
              <label>ID program studi<input v-model="program.id" class="form-control" :readonly="Boolean(editingKey)" required @input="manualId = true"></label>
              <label>Unit / Fakultas<input v-model="program.facultyId" class="form-control" required></label>
            </div>
            <label class="check"><input v-model="program.active" class="form-check-input" type="checkbox"><span>Program studi aktif</span></label>
            <button class="btn btn-primary" type="submit" :disabled="working"><span v-if="working" class="spinner-border spinner-border-sm me-2" />{{ editingKey ? 'Simpan perubahan prodi' : 'Simpan program studi' }}</button>
          </form>
        </template>

        <template v-else-if="tab === 'period'">
          <header class="form-head">
            <div><span>{{ editingKey ? 'Mode sunting' : 'Data baru' }}</span><h2>{{ editingKey ? `Sunting ${period.academicYear} · ${termLabel(period.term)}` : 'Tambah periode & KRS' }}</h2><p>Satu penyimpanan memperbarui kalender semester sekaligus jadwal KRS mahasiswa.</p></div>
            <button v-if="editingKey" class="btn btn-sm btn-outline-secondary" type="button" @click="resetCurrentForm">+ Buat baru</button>
          </header>
          <form @submit.prevent="savePeriod">
            <div class="form-row">
              <label>Tahun akademik<input v-model="period.academicYear" class="form-control" placeholder="2026/2027" required></label>
              <label>Semester<select v-model="period.term" class="form-select"><option value="ODD">Gasal</option><option value="EVEN">Genap</option><option value="SHORT">Pendek</option></select></label>
            </div>
            <div class="form-row">
              <label>ID periode<input v-model="period.id" class="form-control" :readonly="Boolean(editingKey)" required></label>
              <label>Status pengisian KRS<select v-model="period.krsStatus" class="form-select"><option value="DRAFT">Draf</option><option value="KRS_OPEN">KRS dibuka</option><option value="KRS_CLOSED">Pengisian ditutup</option><option value="CLOSED">Periode selesai</option></select></label>
            </div>
            <div class="form-row"><label>Mulai semester<input v-model="period.startsAt" type="datetime-local" class="form-control" required></label><label>Selesai semester<input v-model="period.endsAt" type="datetime-local" class="form-control" required></label></div>
            <div class="form-row"><label>KRS dibuka<input v-model="period.krsOpensAt" type="datetime-local" class="form-control" required></label><label>KRS ditutup<input v-model="period.krsClosesAt" type="datetime-local" class="form-control" required></label></div>
            <label>Batas revisi KRS<input v-model="period.krsRevisionClosesAt" type="datetime-local" class="form-control" required></label>
            <label class="check"><input v-model="period.active" class="form-check-input" type="checkbox"><span>Periode aktif</span></label>
            <button class="btn btn-primary" type="submit" :disabled="working"><span v-if="working" class="spinner-border spinner-border-sm me-2" />{{ editingKey ? 'Simpan perubahan periode' : 'Simpan periode & KRS' }}</button>
          </form>
        </template>

        <template v-else-if="tab === 'course'">
          <header class="form-head">
            <div><span>{{ editingKey ? 'Mode sunting' : 'Data baru' }}</span><h2>{{ editingKey ? `Sunting ${course.code} · ${course.name}` : 'Tambah mata kuliah' }}</h2><p>Perubahan mata kuliah disimpan sebagai arsip baru tanpa mengubah riwayat kelas semester lalu.</p></div>
            <button v-if="editingKey" class="btn btn-sm btn-outline-secondary" type="button" @click="resetCurrentForm">+ Buat baru</button>
          </header>
          <form @submit.prevent="saveCourse">
            <div class="form-row">
              <label>Kode mata kuliah<input v-model="course.code" class="form-control text-uppercase" placeholder="TEO101" required></label>
              <label>Program studi<select v-model="course.programStudyId" class="form-select" required><option v-for="item in activePrograms" :key="item.id" :value="item.id">{{ item.name }}</option></select></label>
            </div>
            <label>Nama mata kuliah<input v-model="course.name" class="form-control" placeholder="Pengantar Perjanjian Lama" required></label>
            <div class="form-row">
              <label>SKS<input v-model.number="course.credits" type="number" min="1" max="12" class="form-control" required></label>
              <label>Rekomendasi semester<input v-model.number="course.semesterRecommendation" type="number" min="1" max="14" class="form-control" required></label>
            </div>
            <div class="form-row">
              <label>Status<select v-model="course.status" class="form-select"><option value="ACTIVE">Aktif (tersedia untuk kelas)</option><option value="DRAFT">Draf</option><option value="RETIRED">Nonaktif</option></select></label>
              <label>ID mata kuliah<input v-model="course.courseId" class="form-control" :readonly="Boolean(editingKey)" required @input="manualId = true"></label>
            </div>
            <label>Mata kuliah prasyarat <small>opsional, pisahkan kode dengan koma</small><input v-model="course.prerequisiteCourseCodes" class="form-control" placeholder="Contoh: TEO101, TEO102"></label>
            <label>Mata kuliah ekuivalen <small>opsional, pisahkan kode dengan koma</small><input v-model="course.equivalentCourseCodes" class="form-control" placeholder="Contoh: TEO001"></label>
            <button class="btn btn-primary" type="submit" :disabled="working"><span v-if="working" class="spinner-border spinner-border-sm me-2" />{{ editingKey ? 'Simpan perubahan mata kuliah' : 'Simpan mata kuliah' }}</button>
          </form>
        </template>

        <template v-else-if="tab === 'curriculum'">
          <header class="form-head">
            <div><span>{{ editingKey ? 'Mode sunting' : 'Data baru' }}</span><h2>{{ editingKey ? `Sunting ${curriculum.name}` : 'Tambah kurikulum' }}</h2><p>Centang mata kuliah aktif yang masuk ke dalam struktur kurikulum ini.</p></div>
            <button v-if="editingKey" class="btn btn-sm btn-outline-secondary" type="button" @click="resetCurrentForm">+ Buat baru</button>
          </header>
          <form @submit.prevent="saveCurriculum">
            <label>Nama kurikulum<input v-model="curriculum.name" class="form-control" placeholder="Kurikulum Sarjana Teologi 2026" required></label>
            <div class="form-row">
              <label>Program studi<select v-model="curriculum.programStudyId" class="form-select" required><option v-for="item in activePrograms" :key="item.id" :value="item.id">{{ item.name }}</option></select></label>
              <label>Status<select v-model="curriculum.status" class="form-select"><option value="ACTIVE">Aktif</option><option value="DRAFT">Draf</option><option value="RETIRED">Nonaktif</option></select></label>
            </div>
            <div class="form-row">
              <label>Angkatan mulai<input v-model.number="curriculum.effectiveCohortFrom" type="number" class="form-control" required></label>
              <label>Angkatan akhir<input v-model.number="curriculum.effectiveCohortTo" type="number" class="form-control" required></label>
            </div>
            <label>ID kurikulum<input v-model="curriculum.curriculumId" class="form-control" :readonly="Boolean(editingKey)" required @input="manualId = true"></label>
            <div class="picker-box">
              <div class="picker-box__head"><span>Mata kuliah dalam kurikulum</span><strong>{{ curriculum.selectedCourseVersionIds.length }} MK · {{ curriculumSelectedCredits }} SKS</strong></div>
              <div v-if="coursesForSelectedCurriculumProgram.length" class="picker-list">
                <label v-for="c in coursesForSelectedCurriculumProgram" :key="c.id" class="picker-item" :class="{ selected: curriculum.selectedCourseVersionIds.includes(c.id) }">
                  <input type="checkbox" class="form-check-input" :checked="curriculum.selectedCourseVersionIds.includes(c.id)" @change="toggleCurriculumCourse(c.id)">
                  <span><strong>{{ c.code }} · {{ c.name }}</strong><small>{{ c.credits }} SKS · Sem {{ c.semesterRecommendation }}</small></span>
                </label>
              </div>
              <p v-else class="text-muted small mb-0">Belum ada mata kuliah berstatus Aktif untuk program studi ini.</p>
            </div>
            <button class="btn btn-primary" type="submit" :disabled="working || !curriculum.selectedCourseVersionIds.length"><span v-if="working" class="spinner-border spinner-border-sm me-2" />{{ editingKey ? 'Simpan revisi kurikulum' : 'Simpan kurikulum' }}</button>
          </form>
        </template>

        <template v-else>
          <header class="form-head">
            <div><span>{{ editingKey ? 'Mode sunting' : 'Data baru' }}</span><h2>{{ editingKey ? `Sunting ${calendar.title}` : 'Tambah agenda kalender' }}</h2><p>Agenda yang disimpan muncul pada kalender akademik program studi terkait.</p></div>
            <button v-if="editingKey" class="btn btn-sm btn-outline-secondary" type="button" @click="resetCurrentForm">+ Buat baru</button>
          </header>
          <form @submit.prevent="saveCalendar">
            <label>Judul agenda<input v-model="calendar.title" class="form-control" placeholder="Ujian Tengah Semester Gasal" required></label>
            <div class="form-row">
              <label>Periode<select v-model="calendar.periodId" class="form-select" required><option v-for="item in activePeriods" :key="item.id" :value="item.id">{{ item.academicYear }} · {{ termLabel(item.term) }}</option></select></label>
              <label>Kategori<select v-model="calendar.category" class="form-select"><option value="ACADEMIC">Akademik</option><option value="KRS">KRS</option><option value="EXAM">Ujian</option><option value="GRADUATION">Kelulusan</option><option value="HOLIDAY">Libur</option><option value="DEADLINE">Batas waktu</option></select></label>
            </div>
            <div class="picker-box">
              <div class="picker-box__head"><span>Berlaku untuk program studi</span><strong>{{ calendar.selectedProgramIds.length }} dipilih</strong></div>
              <div class="picker-chips">
                <label v-for="prog in activePrograms" :key="prog.id" class="picker-chip" :class="{ selected: calendar.selectedProgramIds.includes(prog.id) }">
                  <input type="checkbox" class="form-check-input" :checked="calendar.selectedProgramIds.includes(prog.id)" @change="toggleCalendarProgram(prog.id)">
                  <span>{{ prog.code }} · {{ prog.name }}</span>
                </label>
              </div>
            </div>
            <div class="form-row"><label>Mulai<input v-model="calendar.startsAt" type="datetime-local" class="form-control" required></label><label>Selesai<input v-model="calendar.endsAt" type="datetime-local" class="form-control" required></label></div>
            <label>Keterangan<textarea v-model="calendar.description" class="form-control" rows="2" /></label>
            <label>ID agenda<input v-model="calendar.id" class="form-control" :readonly="Boolean(editingKey)" required @input="manualId = true"></label>
            <button class="btn btn-primary" type="submit" :disabled="working || !calendar.selectedProgramIds.length"><span v-if="working" class="spinner-border spinner-border-sm me-2" />{{ editingKey ? 'Simpan perubahan agenda' : 'Simpan agenda' }}</button>
          </form>
        </template>
      </section>

      <section class="surface-card inventory">
        <header class="inventory-head">
          <div>
            <span>{{ listMode === 'trash' ? 'Sampah (dapat dipulihkan)' : 'Daftar data' }}</span>
            <h2>{{ tabs.find(item => item.id === tab)?.label }}</h2>
          </div>
          <div class="inventory-controls">
            <div class="mode-switch">
              <button type="button" :class="{ active: listMode === 'active' }" @click="listMode = 'active'">Aktif</button>
              <button type="button" :class="{ active: listMode === 'trash' }" @click="listMode = 'trash'">Sampah ({{ currentTrashCount }})</button>
            </div>
            <input v-model="searchQuery" class="form-control form-control-sm" type="search" placeholder="Cari data..." aria-label="Cari data master">
          </div>
        </header>

        <template v-if="tab === 'program'">
          <article v-for="item in filteredPrograms" :key="item.id" :class="{ editing: editingKey === item.id, deleted: Boolean(item.deletedAt) }">
            <div><strong>{{ item.code }} · {{ item.name }}</strong><small>{{ item.level }} · Akreditasi {{ item.accreditationStatus }} · s.d. {{ item.accreditationExpiresAt.slice(0, 10) }}</small></div>
            <div class="row-actions">
              <template v-if="listMode === 'trash'">
                <button class="btn btn-sm btn-primary" type="button" :disabled="working" @click="restoreMaster('program', item.id, `${item.code} · ${item.name}`)"><i class="uil uil-history me-1" />Pulihkan</button>
              </template>
              <template v-else>
                <button class="btn btn-sm btn-outline-primary" type="button" @click="selectProgram(item)">Sunting</button>
                <button class="btn btn-sm btn-outline-danger" type="button" :disabled="working" @click="pendingDelete = { resource: 'program', id: item.id, label: `${item.code} · ${item.name}` }">Hapus</button>
              </template>
            </div>
          </article>
          <p v-if="!filteredPrograms.length" class="empty-note">{{ listMode === 'trash' ? 'Tidak ada program studi di Sampah.' : 'Belum ada program studi.' }}</p>
        </template>

        <template v-else-if="tab === 'period'">
          <article v-for="item in filteredPeriods" :key="item.id" :class="{ editing: editingKey === item.id, deleted: Boolean(item.deletedAt) }">
            <div><strong>{{ item.academicYear }} · {{ termLabel(item.term) }}</strong><small>{{ krsStatusLabel(item.krsStatus) }} · {{ item.startsAt.slice(0, 10) }} s.d. {{ item.endsAt.slice(0, 10) }}</small></div>
            <div class="row-actions">
              <template v-if="listMode === 'trash'">
                <button class="btn btn-sm btn-primary" type="button" :disabled="working" @click="restoreMaster('period', item.id, `${item.academicYear} · ${termLabel(item.term)}`)"><i class="uil uil-history me-1" />Pulihkan</button>
              </template>
              <template v-else>
                <button class="btn btn-sm btn-outline-primary" type="button" @click="selectPeriod(item)">Sunting</button>
                <button class="btn btn-sm btn-outline-danger" type="button" :disabled="working" @click="pendingDelete = { resource: 'period', id: item.id, label: `${item.academicYear} · ${termLabel(item.term)}` }">Hapus</button>
              </template>
            </div>
          </article>
          <p v-if="!filteredPeriods.length" class="empty-note">{{ listMode === 'trash' ? 'Tidak ada periode di Sampah.' : 'Belum ada periode akademik.' }}</p>
        </template>

        <template v-else-if="tab === 'course'">
          <article v-for="item in filteredCourses" :key="item.id" :class="{ editing: editingKey === item.courseId, deleted: Boolean(item.deletedAt) }">
            <div><strong>{{ item.code }} · {{ item.name }}</strong><small>{{ programName(item.programStudyId) }} · {{ item.credits }} SKS · {{ courseStatusLabel(item.status) }}</small></div>
            <div class="row-actions">
              <template v-if="listMode === 'trash'">
                <button class="btn btn-sm btn-primary" type="button" :disabled="working" @click="restoreMaster('course', item.courseId, `${item.code} · ${item.name}`)"><i class="uil uil-history me-1" />Pulihkan</button>
              </template>
              <template v-else>
                <button class="btn btn-sm btn-outline-primary" type="button" @click="selectCourse(item)">Sunting</button>
                <button class="btn btn-sm btn-outline-danger" type="button" :disabled="working" @click="pendingDelete = { resource: 'course', id: item.courseId, label: `${item.code} · ${item.name}` }">Hapus</button>
              </template>
            </div>
          </article>
          <p v-if="!filteredCourses.length" class="empty-note">{{ listMode === 'trash' ? 'Tidak ada mata kuliah di Sampah.' : 'Belum ada mata kuliah.' }}</p>
        </template>

        <template v-else-if="tab === 'curriculum'">
          <article v-for="item in filteredCurricula" :key="item.id" :class="{ editing: editingKey === item.curriculumId, deleted: Boolean(item.deletedAt) }">
            <div><strong>{{ item.name }}</strong><small>{{ programName(item.programStudyId) }} · {{ item.totalCredits }} SKS · Angkatan {{ item.effectiveCohortFrom }}–{{ item.effectiveCohortTo }}</small></div>
            <div class="row-actions">
              <template v-if="listMode === 'trash'">
                <button class="btn btn-sm btn-primary" type="button" :disabled="working" @click="restoreMaster('curriculum', item.curriculumId, item.name)"><i class="uil uil-history me-1" />Pulihkan</button>
              </template>
              <template v-else>
                <button class="btn btn-sm btn-outline-primary" type="button" @click="selectCurriculum(item)">Sunting</button>
                <button class="btn btn-sm btn-outline-danger" type="button" :disabled="working" @click="pendingDelete = { resource: 'curriculum', id: item.curriculumId, label: item.name }">Hapus</button>
              </template>
            </div>
          </article>
          <p v-if="!filteredCurricula.length" class="empty-note">{{ listMode === 'trash' ? 'Tidak ada kurikulum di Sampah.' : 'Belum ada kurikulum.' }}</p>
        </template>

        <template v-else>
          <article v-for="item in filteredCalendar" :key="item.id" :class="{ editing: editingKey === item.id, deleted: Boolean(item.deletedAt) }">
            <div><strong>{{ item.title }}</strong><small>{{ categoryLabel(item.category) }} · {{ item.startsAt.slice(0, 10) }}</small></div>
            <div class="row-actions">
              <template v-if="listMode === 'trash'">
                <button class="btn btn-sm btn-primary" type="button" :disabled="working" @click="restoreMaster('calendar', item.id, item.title)"><i class="uil uil-history me-1" />Pulihkan</button>
              </template>
              <template v-else>
                <button class="btn btn-sm btn-outline-primary" type="button" @click="selectCalendar(item)">Sunting</button>
                <button class="btn btn-sm btn-outline-danger" type="button" :disabled="working" @click="pendingDelete = { resource: 'calendar', id: item.id, label: item.title }">Hapus</button>
              </template>
            </div>
          </article>
          <p v-if="!filteredCalendar.length" class="empty-note">{{ listMode === 'trash' ? 'Tidak ada agenda di Sampah.' : 'Belum ada agenda kalender.' }}</p>
        </template>
      </section>
    </div>

    <div v-if="pendingDelete" class="confirm-overlay" role="dialog" aria-modal="true" @click.self="pendingDelete = null">
      <div class="confirm-dialog">
        <span class="section-kicker">Konfirmasi penghapusan</span>
        <h3>Hapus "{{ pendingDelete.label }}"?</h3>
        <p class="confirm-copy">Data akan dipindahkan ke tab <strong>Sampah</strong> dan tidak muncul di pilihan aktif. Anda dapat memulihkannya kembali kapan saja.</p>
        <div class="confirm-actions">
          <button class="btn btn-outline-secondary btn-sm" type="button" :disabled="working" @click="pendingDelete = null">Batal</button>
          <button class="btn btn-danger btn-sm" type="button" :disabled="working" @click="confirmDeleteMaster"><span v-if="working" class="spinner-border spinner-border-sm me-2" />Pindahkan ke Sampah</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.master-page{display:grid;gap:1.1rem}
.master-tabs{display:flex;gap:.35rem;overflow:auto;padding:.35rem;border:1px solid #e6dfd6;border-radius:.85rem;background:#fff}
.master-tabs button{display:flex;min-width:130px;flex:1;align-items:center;justify-content:center;gap:.45rem;padding:.55rem .7rem;border:0;border-radius:.6rem;color:#4e5462;background:transparent;font-size:.76rem;font-weight:700}
.master-tabs button.active{color:#fff;background:#593660}
.master-layout{display:grid;grid-template-columns:minmax(380px,1fr) minmax(0,1fr);gap:1rem;align-items:start}
.surface-card{padding:1.15rem;border:1px solid #e6dfd6;border-radius:1rem;background:#fff;box-shadow:0 6px 20px rgba(30,30,30,.04)}
.form-head,.inventory-head{display:flex;justify-content:space-between;align-items:flex-start;gap:.75rem;margin-bottom:.9rem;padding-bottom:.75rem;border-bottom:1px solid #ece6dd}
.inventory-head input{max-width:210px}
.surface-card header span{color:#775a83;font-size:.66rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
.surface-card h2{margin:.18rem 0;color:#1e1e1e;font-size:.98rem}
.surface-card header p{margin:0;color:#6c6865;font-size:.72rem}
.form-card form{display:grid;gap:.75rem}
.form-card label{display:grid;gap:.25rem;color:#4e5462;font-size:.72rem;font-weight:700}
.form-card label small{color:#6c6865;font-weight:400;font-size:.66rem}
.form-row{display:grid;grid-template-columns:1fr 1fr;gap:.65rem}
.check{display:flex!important;align-items:center;gap:.5rem;margin-top:.2rem}
.picker-box{padding:.75rem;border:1px solid #e6dfd6;border-radius:.75rem;background:#faf6ef}
.picker-box__head{display:flex;justify-content:space-between;align-items:center;margin-bottom:.55rem;font-size:.72rem}
.picker-box__head span{color:#4e5462;font-weight:700}
.picker-box__head strong{color:#593660}
.picker-list{display:grid;gap:.4rem;max-height:210px;overflow-y:auto}
.picker-item{display:flex!important;align-items:flex-start;gap:.5rem;padding:.45rem .6rem;border:1px solid #e6dfd6;border-radius:.55rem;background:#fff;cursor:pointer}
.picker-item.selected{border-color:#593660;background:#f5eff7}
.picker-item strong,.picker-item small{display:block}
.picker-item strong{color:#1e1e1e;font-size:.74rem}
.picker-item small{color:#6c6865;font-size:.64rem}
.picker-chips{display:flex;flex-wrap:wrap;gap:.45rem}
.picker-chip{display:inline-flex!important;align-items:center;gap:.4rem;padding:.38rem .65rem;border:1px solid #e6dfd6;border-radius:.55rem;background:#fff;font-size:.72rem;cursor:pointer}
.picker-chip.selected{border-color:#593660;background:#f5eff7;color:#3e2344}
.inventory article{display:flex;justify-content:space-between;align-items:center;gap:.7rem;padding:.75rem .7rem;border-top:1px solid #ece6dd;border-radius:.5rem}
.inventory-controls{display:flex;gap:.5rem;align-items:center;flex-wrap:wrap}
.mode-switch{display:inline-flex;border:1px solid #e6dfd6;border-radius:.55rem;overflow:hidden;background:#faf6ef}
.mode-switch button{border:0;padding:.32rem .65rem;background:transparent;color:#4e5462;font-size:.7rem;font-weight:700}
.mode-switch button.active{background:#593660;color:#fff}
.row-actions{display:flex;gap:.35rem;flex-shrink:0}
.empty-note{margin:.75rem 0;color:#6c6865;font-size:.74rem}
.inventory article.editing{background:#f5eff7;border-color:#d8c4e0}
.inventory article.deleted{background:#fffaf8}
.confirm-overlay{position:fixed;inset:0;z-index:1080;display:grid;place-items:center;padding:1rem;background:rgba(30,20,34,.55);backdrop-filter:blur(4px)}
.confirm-dialog{width:min(100%,450px);padding:1.3rem;border-radius:1rem;background:#fff;box-shadow:0 24px 70px rgba(30,20,34,.28)}
.confirm-dialog h3{margin:.2rem 0 .45rem;color:#1e1e1e;font-size:1rem}
.confirm-copy{margin:0 0 1rem;color:#4e5462;font-size:.75rem;line-height:1.55}
.confirm-actions{display:flex;justify-content:flex-end;gap:.5rem}
.inventory strong,.inventory small{display:block}
.inventory strong{color:#1e1e1e;font-size:.8rem}
.inventory small{color:#6c6865;font-size:.68rem;margin-top:.15rem}
@media(max-width:960px){.master-layout{grid-template-columns:1fr}}
@media(max-width:600px){.form-row{grid-template-columns:1fr}.inventory-head{flex-direction:column;align-items:stretch}.inventory-head input{max-width:none}}
</style>
