<script setup lang="ts">
import type { AxiosError } from 'axios'
import type {
  AcademicCourseVersion,
  AcademicPeriodDefinition,
  AcademicProgramStudy,
  LmsAcademicCatalog,
} from '~/shared/contracts/lms'

const props = defineProps<{ catalog: LmsAcademicCatalog }>()
const emit = defineEmits<{ created: [] }>()
const { $api } = useNuxtApp()

const subTab = ref<'program' | 'course' | 'period'>('course')
const busy = ref(false)
const errorMessage = ref('')
const noticeMessage = ref('')
const year = new Date().getFullYear()

const editingProgramId = ref('')
const editingCourseId = ref('')
const editingPeriodId = ref('')
const manualProgramId = ref(false)
const manualCourseId = ref(false)
const manualPeriodId = ref(false)
const showTrash = ref(false)
const pendingDelete = ref<{ resource: 'program' | 'period' | 'course'; id: string; label: string } | null>(null)

const managedPrograms = computed(() => props.catalog.allPrograms ?? props.catalog.programs)
const managedPeriods = computed(() => props.catalog.allPeriods ?? props.catalog.periods)
const managedCourses = computed(() => props.catalog.allCourses ?? props.catalog.courses)
const defaultFaculty = computed(() => managedPrograms.value[0]?.facultyId || 'stt-saint-paul')

const program = reactive({
  id: '',
  facultyId: 'stt-saint-paul',
  code: '',
  name: '',
  level: 'S1' as 'D3' | 'S1' | 'S2',
  active: true,
  accreditationStatus: 'Baik Sekali',
  accreditationExpiresAt: `${year + 5}-12-31`,
})
const period = reactive({
  id: `${year}-${year + 1}-1`,
  academicYear: `${year}/${year + 1}`,
  term: 'ODD' as 'ODD' | 'EVEN' | 'SHORT',
  startsAt: `${year}-08-01`,
  endsAt: `${year + 1}-01-31`,
  krsOpensAt: `${year}-07-01`,
  krsClosesAt: `${year}-08-15`,
  krsRevisionClosesAt: `${year}-08-31`,
  krsStatus: 'KRS_OPEN' as 'DRAFT' | 'KRS_OPEN' | 'KRS_CLOSED' | 'CLOSED',
  active: true,
})
const course = reactive({
  courseId: '',
  code: '',
  name: '',
  programStudyId: '',
  credits: 3,
  semesterRecommendation: 1,
  status: 'ACTIVE' as 'DRAFT' | 'ACTIVE' | 'RETIRED',
  prerequisiteCourseCodes: [] as string[],
  equivalentCourseCodes: [] as string[],
})

const deletedPrograms = computed(() => props.catalog.deleted?.programs ?? [])
const deletedPeriods = computed(() => props.catalog.deleted?.periods ?? [])
const deletedCourses = computed(() => props.catalog.deleted?.courses ?? [])

const slugify = (value: string) => value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const sanitizeCode = (value: string, max: number) => value.trim().toUpperCase().replace(/[^A-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max)
const uniqueId = (base: string, taken: Set<string>) => {
  if (!base || !taken.has(base)) return base
  let suffix = 2
  while (taken.has(`${base}-${suffix}`)) suffix += 1
  return `${base}-${suffix}`
}
const allProgramIds = computed(() => new Set([...managedPrograms.value, ...deletedPrograms.value].map(item => item.id)))
const allPeriodIds = computed(() => new Set([...managedPeriods.value, ...deletedPeriods.value].map(item => item.id)))
const allCourseIds = computed(() => new Set([...managedCourses.value, ...deletedCourses.value].map(item => item.courseId)))

const suggestedPeriodId = (academicYear: string, term: 'ODD' | 'EVEN' | 'SHORT') => {
  const years = academicYear.replace('/', '-').replace(/[^0-9-]/g, '')
  const termNum = term === 'ODD' ? '1' : term === 'EVEN' ? '2' : '3'
  return years ? `${years}-${termNum}` : ''
}

watch([() => program.code, () => program.name, () => program.level], () => {
  if (!editingProgramId.value && !manualProgramId.value) {
    const base = slugify(program.code || program.name)
    program.id = base ? uniqueId(`${base}-${program.level.toLowerCase()}`, allProgramIds.value) : ''
  }
})
watch([() => course.code, () => course.name], () => {
  if (!editingCourseId.value && !manualCourseId.value) {
    const base = slugify(course.code || course.name)
    course.courseId = base ? uniqueId(`course-${base}`, allCourseIds.value) : ''
  }
})
watch([() => period.academicYear, () => period.term], () => {
  if (!editingPeriodId.value && !manualPeriodId.value) {
    const base = suggestedPeriodId(period.academicYear, period.term)
    if (base) period.id = uniqueId(base, allPeriodIds.value)
  }
})
watch(allPeriodIds, () => {
  if (!editingPeriodId.value && !manualPeriodId.value) {
    const base = suggestedPeriodId(period.academicYear, period.term)
    if (base && allPeriodIds.value.has(period.id)) period.id = uniqueId(base, allPeriodIds.value)
  }
}, { immediate: true })
watch(managedPrograms, (programs) => {
  if (!course.programStudyId && programs.length) {
    course.programStudyId = programs.find(item => item.active)?.id || programs[0]!.id
  }
  if (!editingProgramId.value && !program.facultyId) program.facultyId = defaultFaculty.value
}, { immediate: true })

const selectedCourseProgram = computed(() => managedPrograms.value.find(item => item.id === course.programStudyId))
const trashedProgramConflict = computed(() => !editingProgramId.value ? deletedPrograms.value.find(item => item.id === program.id.trim()) : undefined)
const trashedPeriodConflict = computed(() => !editingPeriodId.value ? deletedPeriods.value.find(item => item.id === period.id.trim()) : undefined)
const trashedCourseConflict = computed(() => !editingCourseId.value ? deletedCourses.value.find(item => item.courseId === course.courseId.trim()) : undefined)

const latestCourseVersion = computed(() => {
  if (!editingCourseId.value) return 0
  return Math.max(
    0,
    ...[...props.catalog.courses, ...managedCourses.value]
      .filter(item => item.courseId === editingCourseId.value)
      .map(item => item.version),
  )
})
const existingPeriodVersion = computed(() => (
  editingPeriodId.value ? (managedPeriods.value.find(item => item.id === editingPeriodId.value)?.version ?? 0) : 0
))
const existingProgramVersion = computed(() => (
  editingProgramId.value ? (managedPrograms.value.find(item => item.id === editingProgramId.value)?.version ?? 0) : 0
))
const currentTrashCount = computed(() => (
  subTab.value === 'course' ? deletedCourses.value.length : subTab.value === 'program' ? deletedPrograms.value.length : deletedPeriods.value.length
))
const termLabel = (term: string) => ({ ODD: 'Gasal', EVEN: 'Genap', SHORT: 'Pendek' })[term] || term
const krsStatusLabel = (status: string) => ({ DRAFT: 'Draf', KRS_OPEN: 'KRS dibuka', KRS_CLOSED: 'KRS ditutup', CLOSED: 'Selesai' })[status] || status
const courseStatusLabel = (status: string) => ({ ACTIVE: 'Aktif', DRAFT: 'Draf', RETIRED: 'Nonaktif' })[status] || status
const semesterLabel = (sem: number) => `Semester ${sem} (${sem % 2 === 1 ? 'Ganjil' : 'Genap'})`
const programName = (id: string) => managedPrograms.value.find(item => item.id === id)?.name || deletedPrograms.value.find(item => item.id === id)?.name || id
const requestKey = (purpose: string) => `${purpose}-${globalThis.crypto.randomUUID()}`
const instant = (date: string, end = false) => new Date(`${date}T${end ? '23:59:59' : '00:00:00'}+07:00`).toISOString()
const messageFor = (error: unknown) => {
  const data = (error as AxiosError<{ statusMessage?: string; message?: string }>).response?.data
  return data?.statusMessage || data?.message || (error instanceof Error ? error.message : 'Katalog akademik belum dapat disimpan.')
}

function resetProgram() {
  editingProgramId.value = ''
  manualProgramId.value = false
  Object.assign(program, {
    id: '',
    facultyId: defaultFaculty.value,
    code: '',
    name: '',
    level: 'S1',
    active: true,
    accreditationStatus: 'Baik Sekali',
    accreditationExpiresAt: `${year + 5}-12-31`,
  })
}

function editProgram(item: AcademicProgramStudy) {
  subTab.value = 'program'
  editingProgramId.value = item.id
  manualProgramId.value = true
  Object.assign(program, {
    id: item.id,
    facultyId: item.facultyId,
    code: item.code,
    name: item.name,
    level: item.level,
    active: item.active,
    accreditationStatus: item.accreditationStatus,
    accreditationExpiresAt: item.accreditationExpiresAt.slice(0, 10),
  })
}

function resetCourse() {
  editingCourseId.value = ''
  manualCourseId.value = false
  Object.assign(course, {
    courseId: '',
    code: '',
    name: '',
    programStudyId: managedPrograms.value.find(item => item.active)?.id || managedPrograms.value[0]?.id || '',
    credits: 3,
    semesterRecommendation: 1,
    status: 'ACTIVE',
    prerequisiteCourseCodes: [],
    equivalentCourseCodes: [],
  })
}

function editCourse(item: AcademicCourseVersion) {
  subTab.value = 'course'
  editingCourseId.value = item.courseId
  manualCourseId.value = true
  Object.assign(course, {
    courseId: item.courseId,
    code: item.code,
    name: item.name,
    programStudyId: item.programStudyId,
    credits: item.credits,
    semesterRecommendation: item.semesterRecommendation,
    status: item.status,
    prerequisiteCourseCodes: [...(item.prerequisiteCourseCodes || [])],
    equivalentCourseCodes: [...(item.equivalentCourseCodes || [])],
  })
}

function resetPeriod() {
  editingPeriodId.value = ''
  manualPeriodId.value = false
  const nextId = uniqueId(`${year}-${year + 1}-1`, allPeriodIds.value)
  Object.assign(period, {
    id: nextId,
    academicYear: `${year}/${year + 1}`,
    term: 'ODD',
    startsAt: `${year}-08-01`,
    endsAt: `${year + 1}-01-31`,
    krsOpensAt: `${year}-07-01`,
    krsClosesAt: `${year}-08-15`,
    krsRevisionClosesAt: `${year}-08-31`,
    krsStatus: 'KRS_OPEN',
    active: true,
  })
}

function editPeriod(item: AcademicPeriodDefinition) {
  subTab.value = 'period'
  editingPeriodId.value = item.id
  manualPeriodId.value = true
  Object.assign(period, {
    id: item.id,
    academicYear: item.academicYear,
    term: item.term,
    startsAt: item.startsAt.slice(0, 10),
    endsAt: item.endsAt.slice(0, 10),
    krsOpensAt: item.krsOpensAt.slice(0, 10),
    krsClosesAt: item.krsClosesAt.slice(0, 10),
    krsRevisionClosesAt: (item.krsRevisionClosesAt || item.endsAt).slice(0, 10),
    krsStatus: item.krsStatus,
    active: item.active,
  })
}

async function savePeriod() {
  busy.value = true
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    const safeKrsStatus = !period.active && period.krsStatus === 'KRS_OPEN' ? 'KRS_CLOSED' : period.krsStatus
    await $api.post('/academic/classes/catalog/periods', {
      id: period.id.trim(),
      academicYear: period.academicYear.trim(),
      term: period.term,
      startsAt: instant(period.startsAt),
      endsAt: instant(period.endsAt, true),
      krsOpensAt: instant(period.krsOpensAt),
      krsClosesAt: instant(period.krsClosesAt, true),
      krsRevisionClosesAt: instant(period.krsRevisionClosesAt || period.endsAt, true),
      krsStatus: safeKrsStatus,
      active: period.active,
      expectedVersion: existingPeriodVersion.value,
    }, { headers: { 'Idempotency-Key': requestKey('catalog-period') } })
    noticeMessage.value = editingPeriodId.value ? 'Periode akademik berhasil diperbarui.' : 'Periode akademik baru berhasil disimpan.'
    resetPeriod()
    emit('created')
  } catch (error) {
    errorMessage.value = messageFor(error)
  } finally {
    busy.value = false
  }
}

async function saveProgram() {
  busy.value = true
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    await $api.post('/academic/classes/catalog/programs', {
      id: program.id.trim(),
      facultyId: program.facultyId.trim(),
      code: sanitizeCode(program.code, 20),
      name: program.name.trim(),
      level: program.level,
      accreditationStatus: program.accreditationStatus.trim(),
      accreditationExpiresAt: program.accreditationExpiresAt,
      active: program.active,
      expectedVersion: existingProgramVersion.value,
    }, { headers: { 'Idempotency-Key': requestKey('catalog-program') } })
    noticeMessage.value = editingProgramId.value ? 'Program studi berhasil diperbarui.' : 'Program studi baru berhasil disimpan.'
    resetProgram()
    emit('created')
  } catch (error) {
    errorMessage.value = messageFor(error)
  } finally {
    busy.value = false
  }
}

async function confirmDeleteCatalogItem() {
  const target = pendingDelete.value
  if (!target) return
  busy.value = true
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    await $api.post('/academic/master/delete', { resource: target.resource, id: target.id })
    pendingDelete.value = null
    noticeMessage.value = `"${target.label}" dipindahkan ke Sampah dan dapat dipulihkan.`
    emit('created')
  } catch (error) {
    errorMessage.value = messageFor(error)
  } finally {
    busy.value = false
  }
}

async function toggleProgramActive(item: AcademicProgramStudy) {
  busy.value = true
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
      active: !item.active,
      expectedVersion: item.version,
    }, { headers: { 'Idempotency-Key': requestKey('catalog-program-toggle') } })
    noticeMessage.value = !item.active
      ? `Program studi "${item.name}" berhasil diaktifkan.`
      : `Program studi "${item.name}" dinonaktifkan.`
    emit('created')
  } catch (error) {
    errorMessage.value = messageFor(error)
  } finally {
    busy.value = false
  }
}

async function togglePeriodActive(item: AcademicPeriodDefinition) {
  busy.value = true
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    const nextActive = !item.active
    const nextKrsStatus = nextActive ? (item.krsStatus === 'CLOSED' ? 'KRS_OPEN' : item.krsStatus) : (item.krsStatus === 'KRS_OPEN' ? 'KRS_CLOSED' : item.krsStatus)
    await $api.post('/academic/classes/catalog/periods', {
      id: item.id,
      academicYear: item.academicYear,
      term: item.term,
      startsAt: item.startsAt,
      endsAt: item.endsAt,
      krsOpensAt: item.krsOpensAt,
      krsClosesAt: item.krsClosesAt,
      krsRevisionClosesAt: item.krsRevisionClosesAt || item.endsAt,
      krsStatus: nextKrsStatus,
      active: nextActive,
      expectedVersion: item.version,
    }, { headers: { 'Idempotency-Key': requestKey('catalog-period-toggle') } })
    noticeMessage.value = nextActive
      ? `Periode "${item.academicYear} · ${termLabel(item.term)}" berhasil diaktifkan.`
      : `Periode "${item.academicYear} · ${termLabel(item.term)}" dinonaktifkan.`
    emit('created')
  } catch (error) {
    errorMessage.value = messageFor(error)
  } finally {
    busy.value = false
  }
}

async function restoreCatalogItem(resource: 'program' | 'period' | 'course', id: string, label: string) {
  busy.value = true
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    await $api.post('/academic/master/restore', { resource, id })
    noticeMessage.value = `"${label}" berhasil dipulihkan.`
    emit('created')
  } catch (error) {
    errorMessage.value = messageFor(error)
  } finally {
    busy.value = false
  }
}

async function saveCourse() {
  busy.value = true
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    await $api.post('/academic/classes/catalog/courses', {
      courseId: course.courseId.trim(),
      code: sanitizeCode(course.code, 30),
      name: course.name.trim(),
      programStudyId: course.programStudyId,
      credits: course.credits,
      semesterRecommendation: course.semesterRecommendation,
      prerequisiteCourseCodes: course.prerequisiteCourseCodes,
      equivalentCourseCodes: course.equivalentCourseCodes,
      status: course.status,
      expectedCurrentVersion: latestCourseVersion.value,
    }, { headers: { 'Idempotency-Key': requestKey('catalog-course') } })
    noticeMessage.value = editingCourseId.value ? 'Revisi mata kuliah berhasil disimpan dan aktif.' : 'Mata kuliah baru berhasil disimpan dan siap dipakai membuat kelas.'
    resetCourse()
    emit('created')
  } catch (error) {
    errorMessage.value = messageFor(error)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <article class="catalog-manager">
    <header class="catalog-head">
      <div>
        <span class="section-kicker">Katalog akademik</span>
        <h2>Kelola program studi, mata kuliah &amp; periode</h2>
        <p>Pilih data yang ada di sebelah kanan untuk menyunting, atau isi formulir untuk menambah data baru.</p>
      </div>
      <NuxtLink class="btn btn-sm btn-outline-secondary" to="/akademik/master"><i class="uil uil-sliders-v-alt me-1" />Master data lengkap</NuxtLink>
    </header>

    <div v-if="noticeMessage" class="alert alert-success py-2 mb-0" role="status">{{ noticeMessage }}</div>
    <div v-if="errorMessage" class="alert alert-danger py-2 mb-0" role="alert">{{ errorMessage }}</div>

    <nav class="sub-tabs" aria-label="Kategori katalog">
      <button type="button" :class="{ active: subTab === 'course' }" @click="subTab = 'course'">Mata kuliah ({{ managedCourses.length }})</button>
      <button type="button" :class="{ active: subTab === 'program' }" @click="subTab = 'program'">Program studi ({{ managedPrograms.length }})</button>
      <button type="button" :class="{ active: subTab === 'period' }" @click="subTab = 'period'">Periode ({{ managedPeriods.length }})</button>
    </nav>

    <div class="catalog-split">
      <section class="editor-box">
        <template v-if="subTab === 'course'">
          <div class="editor-head">
            <h3>{{ editingCourseId ? `Sunting mata kuliah (${course.code})` : 'Tambah mata kuliah baru' }}</h3>
            <button v-if="editingCourseId" class="btn btn-sm btn-outline-secondary" type="button" @click="resetCourse">+ Buat baru</button>
          </div>
          <form class="catalog-form" @submit.prevent="saveCourse">
            <label><span>Kode mata kuliah</span><input v-model="course.code" class="form-control text-uppercase" maxlength="30" placeholder="TEO101" required></label>
            <label><span>Program studi</span><select v-model="course.programStudyId" class="form-select" required><option value="" disabled>Pilih program studi</option><option v-for="prog in managedPrograms" :key="prog.id" :value="prog.id">{{ prog.code }} · {{ prog.name }}{{ prog.active ? '' : ' (Nonaktif)' }}</option></select></label>
            <label class="wide"><span>Nama mata kuliah</span><input v-model="course.name" class="form-control" maxlength="180" placeholder="Pengantar Teologi Sistematika" required></label>
            <label><span>Jumlah SKS</span><input v-model.number="course.credits" class="form-control" type="number" min="1" max="12" required></label>
            <label><span>Semester ({{ course.semesterRecommendation % 2 === 1 ? 'Ganjil' : 'Genap' }})</span><input v-model.number="course.semesterRecommendation" class="form-control" type="number" min="1" max="14" required></label>
            <label><span>Status mata kuliah</span><select v-model="course.status" class="form-select"><option value="ACTIVE">Aktif (tersedia untuk kelas)</option><option value="DRAFT">Draf</option><option value="RETIRED">Nonaktif</option></select></label>
            <label>
              <span>Kode referensi sistem</span>
              <input v-model="course.courseId" class="form-control" maxlength="128" placeholder="Otomatis dari kode mata kuliah" :readonly="Boolean(editingCourseId)" required @input="manualCourseId = true">
            </label>
            <div v-if="selectedCourseProgram && !selectedCourseProgram.active" class="inline-hint wide">
              <span>Program studi <strong>{{ selectedCourseProgram.name }}</strong> masih Nonaktif, sehingga mata kuliah ini belum bisa dipilih di pembuatan kelas.</span>
              <button class="btn btn-sm btn-primary" type="button" :disabled="busy" @click="toggleProgramActive(selectedCourseProgram)">Aktifkan prodi</button>
            </div>
            <div v-if="trashedCourseConflict" class="inline-hint wide">
              <span>ID <strong>{{ trashedCourseConflict.courseId }}</strong> ada di Sampah.</span>
              <button class="btn btn-sm btn-primary" type="button" :disabled="busy" @click="restoreCatalogItem('course', trashedCourseConflict.courseId, `${trashedCourseConflict.code} · ${trashedCourseConflict.name}`)">Pulihkan</button>
            </div>
            <button class="btn btn-primary wide" type="submit" :disabled="busy || !managedPrograms.length">
              <span v-if="busy" class="spinner-border spinner-border-sm me-2" />
              {{ editingCourseId ? 'Simpan perubahan mata kuliah' : 'Simpan mata kuliah baru' }}
            </button>
          </form>
        </template>

        <template v-else-if="subTab === 'program'">
          <div class="editor-head">
            <h3>{{ editingProgramId ? `Sunting program studi (${program.code})` : 'Tambah program studi baru' }}</h3>
            <button v-if="editingProgramId" class="btn btn-sm btn-outline-secondary" type="button" @click="resetProgram">+ Buat baru</button>
          </div>
          <form class="catalog-form" @submit.prevent="saveProgram">
            <label><span>Kode program</span><input v-model="program.code" class="form-control text-uppercase" maxlength="20" placeholder="TEOLOGI" required></label>
            <label><span>Jenjang</span><select v-model="program.level" class="form-select"><option value="D3">D3</option><option value="S1">S1</option><option value="S2">S2</option></select></label>
            <label class="wide"><span>Nama program studi</span><input v-model="program.name" class="form-control" maxlength="180" placeholder="Sarjana Teologi" required></label>
            <label><span>Status akreditasi</span><input v-model="program.accreditationStatus" class="form-control" maxlength="80" placeholder="Baik Sekali" required></label>
            <label><span>Akreditasi berlaku sampai</span><input v-model="program.accreditationExpiresAt" class="form-control" type="date" required></label>
            <label><span>Unit / Fakultas</span><input v-model="program.facultyId" class="form-control" maxlength="128" placeholder="stt-saint-paul" required></label>
            <label><span>ID program studi</span><input v-model="program.id" class="form-control" maxlength="128" placeholder="teologi-s1" :readonly="Boolean(editingProgramId)" required @input="manualProgramId = true"></label>
            <label class="check-row wide"><input v-model="program.active" class="form-check-input" type="checkbox"><span>Program studi aktif (tersedia untuk kelas &amp; KRS)</span></label>
            <div v-if="trashedProgramConflict" class="inline-hint wide">
              <span>ID <strong>{{ trashedProgramConflict.id }}</strong> ada di Sampah.</span>
              <button class="btn btn-sm btn-primary" type="button" :disabled="busy" @click="restoreCatalogItem('program', trashedProgramConflict.id, `${trashedProgramConflict.code} · ${trashedProgramConflict.name}`)">Pulihkan</button>
            </div>
            <button class="btn btn-primary wide" type="submit" :disabled="busy">
              <span v-if="busy" class="spinner-border spinner-border-sm me-2" />
              {{ editingProgramId ? 'Simpan perubahan prodi' : 'Simpan program studi' }}
            </button>
          </form>
        </template>

        <template v-else>
          <div class="editor-head">
            <h3>{{ editingPeriodId ? `Sunting periode (${period.academicYear})` : 'Tambah periode akademik' }}</h3>
            <button v-if="editingPeriodId" class="btn btn-sm btn-outline-secondary" type="button" @click="resetPeriod">+ Buat baru</button>
          </div>
          <form class="catalog-form" @submit.prevent="savePeriod">
            <label><span>Tahun akademik</span><input v-model="period.academicYear" class="form-control" pattern="\d{4}[/-]\d{4}" placeholder="2026/2027" required></label>
            <label><span>Semester</span><select v-model="period.term" class="form-select"><option value="ODD">Gasal</option><option value="EVEN">Genap</option><option value="SHORT">Pendek</option></select></label>
            <label><span>ID periode</span><input v-model="period.id" class="form-control" maxlength="128" :readonly="Boolean(editingPeriodId)" required @input="manualPeriodId = true"></label>
            <label><span>Status pengisian KRS</span><select v-model="period.krsStatus" class="form-select"><option value="DRAFT">Draf</option><option value="KRS_OPEN">KRS dibuka</option><option value="KRS_CLOSED">Pengisian ditutup</option><option value="CLOSED">Periode selesai</option></select></label>
            <label><span>Mulai kuliah</span><input v-model="period.startsAt" class="form-control" type="date" required></label>
            <label><span>Akhir kuliah</span><input v-model="period.endsAt" class="form-control" type="date" required></label>
            <label><span>KRS dibuka</span><input v-model="period.krsOpensAt" class="form-control" type="date" required></label>
            <label><span>KRS ditutup</span><input v-model="period.krsClosesAt" class="form-control" type="date" required></label>
            <label class="wide"><span>Batas revisi KRS</span><input v-model="period.krsRevisionClosesAt" class="form-control" type="date" required></label>
            <label class="check-row wide"><input v-model="period.active" class="form-check-input" type="checkbox"><span>Periode aktif (tersedia untuk kelas &amp; KRS)</span></label>
            <div v-if="trashedPeriodConflict" class="inline-hint wide">
              <span>Periode <strong>{{ trashedPeriodConflict.id }}</strong> ada di Sampah.</span>
              <button class="btn btn-sm btn-primary" type="button" :disabled="busy" @click="restoreCatalogItem('period', trashedPeriodConflict.id, `${trashedPeriodConflict.academicYear} · ${termLabel(trashedPeriodConflict.term)}`)">Pulihkan</button>
            </div>
            <button class="btn btn-primary wide" type="submit" :disabled="busy">
              <span v-if="busy" class="spinner-border spinner-border-sm me-2" />
              {{ editingPeriodId ? 'Simpan perubahan periode' : 'Simpan periode akademik' }}
            </button>
          </form>
        </template>
      </section>

      <section class="list-box">
        <div class="list-box-head">
          <h3>{{ showTrash ? 'Sampah (dapat dipulihkan)' : subTab === 'course' ? 'Daftar mata kuliah' : subTab === 'program' ? 'Daftar program studi' : 'Daftar periode akademik' }}</h3>
          <button class="btn btn-sm" :class="showTrash ? 'btn-primary' : 'btn-outline-secondary'" type="button" @click="showTrash = !showTrash">
            <i class="uil me-1" :class="showTrash ? 'uil-list-ul' : 'uil-trash-alt'" />{{ showTrash ? 'Lihat aktif' : `Sampah (${currentTrashCount})` }}
          </button>
        </div>

        <template v-if="showTrash">
          <div v-if="subTab === 'course'" class="item-list">
            <div v-for="item in deletedCourses" :key="item.id" class="item-row item-row--deleted">
              <div><strong>{{ item.code }} · {{ item.name }}</strong><small>{{ programName(item.programStudyId) }} · {{ item.credits }} SKS</small></div>
              <button class="btn btn-sm btn-primary" type="button" :disabled="busy" @click="restoreCatalogItem('course', item.courseId, `${item.code} · ${item.name}`)">Pulihkan</button>
            </div>
            <p v-if="!deletedCourses.length" class="empty-note">Tidak ada mata kuliah terhapus.</p>
          </div>
          <div v-else-if="subTab === 'program'" class="item-list">
            <div v-for="item in deletedPrograms" :key="item.id" class="item-row item-row--deleted">
              <div><strong>{{ item.code }} · {{ item.name }}</strong><small>{{ item.level }} · {{ item.accreditationStatus }}</small></div>
              <button class="btn btn-sm btn-primary" type="button" :disabled="busy" @click="restoreCatalogItem('program', item.id, `${item.code} · ${item.name}`)">Pulihkan</button>
            </div>
            <p v-if="!deletedPrograms.length" class="empty-note">Tidak ada program studi terhapus.</p>
          </div>
          <div v-else class="item-list">
            <div v-for="item in deletedPeriods" :key="item.id" class="item-row item-row--deleted">
              <div><strong>{{ item.academicYear }} · {{ termLabel(item.term) }}</strong><small>{{ item.startsAt.slice(0, 10) }} s.d. {{ item.endsAt.slice(0, 10) }}</small></div>
              <button class="btn btn-sm btn-primary" type="button" :disabled="busy" @click="restoreCatalogItem('period', item.id, `${item.academicYear} · ${termLabel(item.term)}`)">Pulihkan</button>
            </div>
            <p v-if="!deletedPeriods.length" class="empty-note">Tidak ada periode terhapus.</p>
          </div>
        </template>

        <template v-else>
          <div v-if="subTab === 'course'" class="item-list">
            <div v-for="item in managedCourses" :key="item.id" class="item-row" :class="{ active: editingCourseId === item.courseId, inactive: item.status !== 'ACTIVE' }">
              <div>
                <div class="item-title-line"><strong>{{ item.code }} · {{ item.name }}</strong><span class="state-pill" :class="item.status === 'ACTIVE' ? 'state-pill--active' : 'state-pill--inactive'">{{ courseStatusLabel(item.status) }}</span></div>
                <small>{{ programName(item.programStudyId) }} · {{ item.credits }} SKS · {{ semesterLabel(item.semesterRecommendation) }}</small>
              </div>
              <div class="row-actions">
                <button class="btn btn-sm btn-outline-primary" type="button" @click="editCourse(item)">Sunting</button>
                <button class="btn btn-sm btn-outline-danger" type="button" :disabled="busy" @click="pendingDelete = { resource: 'course', id: item.courseId, label: `${item.code} · ${item.name}` }">Hapus</button>
              </div>
            </div>
            <p v-if="!managedCourses.length" class="empty-note">Belum ada mata kuliah di daftar.</p>
          </div>
          <div v-else-if="subTab === 'program'" class="item-list">
            <div v-for="item in managedPrograms" :key="item.id" class="item-row" :class="{ active: editingProgramId === item.id, inactive: !item.active }">
              <div>
                <div class="item-title-line"><strong>{{ item.code }} · {{ item.name }}</strong><span class="state-pill" :class="item.active ? 'state-pill--active' : 'state-pill--inactive'">{{ item.active ? 'Aktif' : 'Nonaktif' }}</span></div>
                <small>{{ item.level }} · Akreditasi {{ item.accreditationStatus }}</small>
              </div>
              <div class="row-actions">
                <button v-if="!item.active" class="btn btn-sm btn-primary" type="button" :disabled="busy" @click="toggleProgramActive(item)">Aktifkan</button>
                <button class="btn btn-sm btn-outline-primary" type="button" @click="editProgram(item)">Sunting</button>
                <button class="btn btn-sm btn-outline-danger" type="button" :disabled="busy" @click="pendingDelete = { resource: 'program', id: item.id, label: `${item.code} · ${item.name}` }">Hapus</button>
              </div>
            </div>
            <p v-if="!managedPrograms.length" class="empty-note">Belum ada program studi di daftar.</p>
          </div>
          <div v-else class="item-list">
            <div v-for="item in managedPeriods" :key="item.id" class="item-row" :class="{ active: editingPeriodId === item.id, inactive: !item.active }">
              <div>
                <div class="item-title-line"><strong>{{ item.academicYear }} · {{ termLabel(item.term) }}</strong><span class="state-pill" :class="item.active ? 'state-pill--active' : 'state-pill--inactive'">{{ item.active ? 'Aktif' : 'Nonaktif' }}</span></div>
                <small>{{ krsStatusLabel(item.krsStatus) }} · {{ item.startsAt.slice(0, 10) }} s.d. {{ item.endsAt.slice(0, 10) }}</small>
              </div>
              <div class="row-actions">
                <button v-if="!item.active" class="btn btn-sm btn-primary" type="button" :disabled="busy" @click="togglePeriodActive(item)">Aktifkan</button>
                <button class="btn btn-sm btn-outline-primary" type="button" @click="editPeriod(item)">Sunting</button>
                <button class="btn btn-sm btn-outline-danger" type="button" :disabled="busy" @click="pendingDelete = { resource: 'period', id: item.id, label: `${item.academicYear} · ${termLabel(item.term)}` }">Hapus</button>
              </div>
            </div>
            <p v-if="!managedPeriods.length" class="empty-note">Belum ada periode akademik di daftar.</p>
          </div>
        </template>
      </section>
    </div>

    <div v-if="pendingDelete" class="confirm-overlay" role="dialog" aria-modal="true" @click.self="pendingDelete = null">
      <div class="confirm-dialog">
        <span class="section-kicker">Konfirmasi penghapusan</span>
        <h3>Hapus "{{ pendingDelete.label }}"?</h3>
        <p class="confirm-copy">Data akan dipindahkan ke <strong>Sampah</strong> dan disembunyikan dari daftar aktif. Anda dapat memulihkannya kembali jika terhapus tanpa sengaja.</p>
        <div class="confirm-actions">
          <button class="btn btn-outline-secondary btn-sm" type="button" :disabled="busy" @click="pendingDelete = null">Batal</button>
          <button class="btn btn-danger btn-sm" type="button" :disabled="busy" @click="confirmDeleteCatalogItem">Pindahkan ke Sampah</button>
        </div>
      </div>
    </div>
  </article>
</template>

<style scoped>
.catalog-manager{display:grid;gap:.9rem;padding:1.15rem;border:1px solid #e6dfd6;border-radius:1rem;background:#fff;box-shadow:0 6px 20px rgba(30,30,30,.04)}
.catalog-head{display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:.75rem}
.catalog-head h2{margin:.2rem 0 .2rem;color:#1e1e1e;font-size:1rem}
.catalog-head p{margin:0;color:#6c6865;font-size:.74rem}
.section-kicker{color:#775a83;font-size:.66rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
.sub-tabs{display:flex;gap:.4rem;flex-wrap:wrap;border-bottom:1px solid #ece6dd;padding-bottom:.6rem}
.sub-tabs button{padding:.42rem .75rem;border:1px solid #e6dfd6;border-radius:.55rem;background:#faf6ef;color:#4e5462;font-size:.74rem;font-weight:700}
.sub-tabs button.active{border-color:#593660;background:#593660;color:#fff}
.catalog-split{display:grid;grid-template-columns:minmax(320px,1.05fr) minmax(260px,.95fr);gap:1rem;align-items:start}
.editor-box,.list-box{padding:.95rem;border:1px solid #ece6dd;border-radius:.85rem;background:#fdfbf8}
.editor-head{display:flex;justify-content:space-between;align-items:center;gap:.5rem;margin-bottom:.75rem}
.editor-box h3,.list-box h3{margin:0;color:#1e1e1e;font-size:.86rem}
.list-box h3{margin-bottom:.75rem}
.catalog-form{display:grid;grid-template-columns:1fr 1fr;gap:.7rem}
.catalog-form label>span,.catalog-form label>small{display:block;margin-bottom:.25rem;color:#4e5462;font-size:.7rem;font-weight:700}
.catalog-form label>small{margin:.25rem 0 0;color:#6c6865;font-weight:500;font-size:.64rem}
.wide{grid-column:1/-1}
.item-list{display:grid;gap:.5rem;max-height:420px;overflow-y:auto}
.item-row{display:flex;justify-content:space-between;align-items:center;gap:.65rem;padding:.7rem .8rem;border:1px solid #e6dfd6;border-radius:.7rem;background:#fff}
.item-row.active{border-color:#593660;background:#f5eff7}
.item-row strong,.item-row small{display:block}
.item-row strong{color:#1e1e1e;font-size:.78rem}
.item-row small{color:#6c6865;font-size:.66rem;margin-top:.15rem}
.list-box-head{display:flex;justify-content:space-between;align-items:center;gap:.5rem;margin-bottom:.75rem}
.list-box-head h3{margin:0}
.row-actions{display:flex;gap:.35rem;flex-shrink:0}
.item-row--deleted{background:#fffaf8;border-color:#efd6d2}
.item-row.inactive{background:#faf8f5;border-style:dashed}
.item-title-line{display:flex;align-items:center;flex-wrap:wrap;gap:.4rem}
.state-pill{display:inline-flex;align-items:center;padding:.1rem .45rem;border-radius:999px;font-size:.62rem;font-weight:700}
.state-pill--active{background:#e7f6ee;color:#1b6b42}
.state-pill--inactive{background:#f3ece2;color:#7a5628}
.check-row{display:flex;align-items:center;gap:.45rem;cursor:pointer}
.check-row>span{margin:0!important;font-weight:600!important;color:#1e1e1e!important}
.inline-hint{display:flex;align-items:center;justify-content:space-between;gap:.65rem;padding:.6rem .75rem;border:1px solid #e7d4b5;border-radius:.65rem;background:#fdf8ef;color:#6c4b1e;font-size:.72rem}
.confirm-overlay{position:fixed;inset:0;z-index:1080;display:grid;place-items:center;padding:1rem;background:rgba(30,20,34,.55);backdrop-filter:blur(4px)}
.confirm-dialog{width:min(100%,440px);padding:1.25rem;border-radius:1rem;background:#fff;box-shadow:0 24px 70px rgba(30,20,34,.28)}
.confirm-dialog h3{margin:.2rem 0 .4rem;color:#1e1e1e;font-size:.98rem}
.confirm-copy{margin:0 0 1rem;color:#4e5462;font-size:.74rem;line-height:1.5}
.confirm-actions{display:flex;justify-content:flex-end;gap:.5rem}
.empty-note{margin:.5rem 0;color:#6c6865;font-size:.74rem}
@media(max-width:900px){.catalog-split{grid-template-columns:1fr}}
@media(max-width:575.98px){.catalog-form{grid-template-columns:1fr}.wide{grid-column:auto}}
</style>
