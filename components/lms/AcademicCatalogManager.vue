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
const showTrash = ref(false)
const pendingDelete = ref<{ resource: 'program' | 'period' | 'course'; id: string; label: string } | null>(null)

const defaultFaculty = computed(() => props.catalog.programs[0]?.facultyId || 'stt-saint-paul')

const program = reactive({
  id: '',
  facultyId: 'stt-saint-paul',
  code: '',
  name: '',
  level: 'S1' as 'D3' | 'S1' | 'S2',
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
})
const course = reactive({
  courseId: '',
  code: '',
  name: '',
  programStudyId: '',
  credits: 3,
  semesterRecommendation: 1,
})

const slugify = (value: string) => value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

watch([() => program.code, () => program.level], () => {
  if (!editingProgramId.value && !manualProgramId.value) {
    const base = slugify(program.code)
    program.id = base ? `${base}-${program.level.toLowerCase()}` : ''
  }
})
watch(() => course.code, () => {
  if (!editingCourseId.value && !manualCourseId.value) {
    const base = slugify(course.code)
    course.courseId = base ? `course-${base}` : ''
  }
})
watch(() => props.catalog.programs, (programs) => {
  if (!course.programStudyId && programs.length) course.programStudyId = programs[0]!.id
  if (!editingProgramId.value && !program.facultyId) program.facultyId = defaultFaculty.value
}, { immediate: true })

const latestCourseVersion = computed(() => Math.max(
  0,
  ...props.catalog.courses
    .filter(item => item.courseId === course.courseId.trim())
    .map(item => item.version),
))
const existingPeriodVersion = computed(() => props.catalog.periods.find(item => item.id === period.id.trim())?.version ?? 0)
const existingProgramVersion = computed(() => props.catalog.programs.find(item => item.id === program.id.trim())?.version ?? 0)

const deletedPrograms = computed(() => props.catalog.deleted?.programs ?? [])
const deletedPeriods = computed(() => props.catalog.deleted?.periods ?? [])
const deletedCourses = computed(() => props.catalog.deleted?.courses ?? [])
const currentTrashCount = computed(() => (
  subTab.value === 'course' ? deletedCourses.value.length : subTab.value === 'program' ? deletedPrograms.value.length : deletedPeriods.value.length
))
const termLabel = (term: string) => ({ ODD: 'Gasal', EVEN: 'Genap', SHORT: 'Pendek' })[term] || term
const programName = (id: string) => props.catalog.programs.find(item => item.id === id)?.name || id
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
    programStudyId: props.catalog.programs[0]?.id || '',
    credits: 3,
    semesterRecommendation: 1,
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
  })
}

function resetPeriod() {
  editingPeriodId.value = ''
  Object.assign(period, {
    id: `${year}-${year + 1}-1`,
    academicYear: `${year}/${year + 1}`,
    term: 'ODD',
    startsAt: `${year}-08-01`,
    endsAt: `${year + 1}-01-31`,
    krsOpensAt: `${year}-07-01`,
    krsClosesAt: `${year}-08-15`,
  })
}

function editPeriod(item: AcademicPeriodDefinition) {
  subTab.value = 'period'
  editingPeriodId.value = item.id
  Object.assign(period, {
    id: item.id,
    academicYear: item.academicYear,
    term: item.term,
    startsAt: item.startsAt.slice(0, 10),
    endsAt: item.endsAt.slice(0, 10),
    krsOpensAt: item.krsOpensAt.slice(0, 10),
    krsClosesAt: item.krsClosesAt.slice(0, 10),
  })
}

async function savePeriod() {
  busy.value = true
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    await $api.post('/academic/classes/catalog/periods', {
      ...period,
      startsAt: instant(period.startsAt),
      endsAt: instant(period.endsAt, true),
      krsOpensAt: instant(period.krsOpensAt),
      krsClosesAt: instant(period.krsClosesAt, true),
      active: true,
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
      ...program,
      id: program.id.trim(),
      facultyId: program.facultyId.trim(),
      code: program.code.trim().toUpperCase(),
      name: program.name.trim(),
      accreditationStatus: program.accreditationStatus.trim(),
      active: true,
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
      ...course,
      courseId: course.courseId.trim(),
      code: course.code.trim().toUpperCase(),
      name: course.name.trim(),
      prerequisiteCourseCodes: [],
      equivalentCourseCodes: [],
      status: 'ACTIVE',
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
      <button type="button" :class="{ active: subTab === 'course' }" @click="subTab = 'course'">Mata kuliah ({{ catalog.courses.length }})</button>
      <button type="button" :class="{ active: subTab === 'program' }" @click="subTab = 'program'">Program studi ({{ catalog.programs.length }})</button>
      <button type="button" :class="{ active: subTab === 'period' }" @click="subTab = 'period'">Periode ({{ catalog.periods.length }})</button>
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
            <label><span>Program studi</span><select v-model="course.programStudyId" class="form-select" required><option value="" disabled>Pilih program studi</option><option v-for="prog in catalog.programs" :key="prog.id" :value="prog.id">{{ prog.code }} · {{ prog.name }}</option></select></label>
            <label class="wide"><span>Nama mata kuliah</span><input v-model="course.name" class="form-control" maxlength="180" placeholder="Pengantar Teologi Sistematika" required></label>
            <label><span>Jumlah SKS</span><input v-model.number="course.credits" class="form-control" type="number" min="1" max="12" required></label>
            <label><span>Rekomendasi semester</span><input v-model.number="course.semesterRecommendation" class="form-control" type="number" min="1" max="14" required></label>
            <label class="wide">
              <span>Kode referensi sistem</span>
              <input v-model="course.courseId" class="form-control" maxlength="128" placeholder="Otomatis dari kode mata kuliah" :readonly="Boolean(editingCourseId)" required @input="manualCourseId = true">
              <small>{{ editingCourseId ? 'Revisi baru akan disimpan tanpa menghapus arsip kelas semester sebelumnya.' : 'Terisi otomatis dari kode mata kuliah.' }}</small>
            </label>
            <button class="btn btn-primary wide" type="submit" :disabled="busy || !catalog.programs.length">
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
            <label class="wide"><span>ID periode</span><input v-model="period.id" class="form-control" maxlength="128" :readonly="Boolean(editingPeriodId)" required></label>
            <label><span>Mulai kuliah</span><input v-model="period.startsAt" class="form-control" type="date" required></label>
            <label><span>Akhir kuliah</span><input v-model="period.endsAt" class="form-control" type="date" required></label>
            <label><span>KRS dibuka</span><input v-model="period.krsOpensAt" class="form-control" type="date" required></label>
            <label><span>KRS ditutup</span><input v-model="period.krsClosesAt" class="form-control" type="date" required></label>
            <button class="btn btn-primary wide" type="submit" :disabled="busy">
              <span v-if="busy" class="spinner-border spinner-border-sm me-2" />
              {{ editingPeriodId ? 'Simpan perubahan periode' : 'Simpan periode aktif' }}
            </button>
          </form>
        </template>
      </section>

      <section class="list-box">
        <div class="list-box-head">
          <h3>{{ showTrash ? 'Sampah (dapat dipulihkan)' : subTab === 'course' ? 'Mata kuliah aktif' : subTab === 'program' ? 'Program studi aktif' : 'Periode akademik' }}</h3>
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
            <div v-for="item in catalog.courses" :key="item.id" class="item-row" :class="{ active: editingCourseId === item.courseId }">
              <div><strong>{{ item.code }} · {{ item.name }}</strong><small>{{ programName(item.programStudyId) }} · {{ item.credits }} SKS · Sem {{ item.semesterRecommendation }}</small></div>
              <div class="row-actions">
                <button class="btn btn-sm btn-outline-primary" type="button" @click="editCourse(item)">Sunting</button>
                <button class="btn btn-sm btn-outline-danger" type="button" :disabled="busy" @click="pendingDelete = { resource: 'course', id: item.courseId, label: `${item.code} · ${item.name}` }">Hapus</button>
              </div>
            </div>
            <p v-if="!catalog.courses.length" class="empty-note">Belum ada mata kuliah aktif.</p>
          </div>
          <div v-else-if="subTab === 'program'" class="item-list">
            <div v-for="item in catalog.programs" :key="item.id" class="item-row" :class="{ active: editingProgramId === item.id }">
              <div><strong>{{ item.code }} · {{ item.name }}</strong><small>{{ item.level }} · Akreditasi {{ item.accreditationStatus }}</small></div>
              <div class="row-actions">
                <button class="btn btn-sm btn-outline-primary" type="button" @click="editProgram(item)">Sunting</button>
                <button class="btn btn-sm btn-outline-danger" type="button" :disabled="busy" @click="pendingDelete = { resource: 'program', id: item.id, label: `${item.code} · ${item.name}` }">Hapus</button>
              </div>
            </div>
            <p v-if="!catalog.programs.length" class="empty-note">Belum ada program studi aktif.</p>
          </div>
          <div v-else class="item-list">
            <div v-for="item in catalog.periods" :key="item.id" class="item-row" :class="{ active: editingPeriodId === item.id }">
              <div><strong>{{ item.academicYear }} · {{ termLabel(item.term) }}</strong><small>{{ item.startsAt.slice(0, 10) }} s.d. {{ item.endsAt.slice(0, 10) }}</small></div>
              <div class="row-actions">
                <button class="btn btn-sm btn-outline-primary" type="button" @click="editPeriod(item)">Sunting</button>
                <button class="btn btn-sm btn-outline-danger" type="button" :disabled="busy" @click="pendingDelete = { resource: 'period', id: item.id, label: `${item.academicYear} · ${termLabel(item.term)}` }">Hapus</button>
              </div>
            </div>
            <p v-if="!catalog.periods.length" class="empty-note">Belum ada periode akademik.</p>
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
.confirm-overlay{position:fixed;inset:0;z-index:1080;display:grid;place-items:center;padding:1rem;background:rgba(30,20,34,.55);backdrop-filter:blur(4px)}
.confirm-dialog{width:min(100%,440px);padding:1.25rem;border-radius:1rem;background:#fff;box-shadow:0 24px 70px rgba(30,20,34,.28)}
.confirm-dialog h3{margin:.2rem 0 .4rem;color:#1e1e1e;font-size:.98rem}
.confirm-copy{margin:0 0 1rem;color:#4e5462;font-size:.74rem;line-height:1.5}
.confirm-actions{display:flex;justify-content:flex-end;gap:.5rem}
.empty-note{margin:.5rem 0;color:#6c6865;font-size:.74rem}
@media(max-width:900px){.catalog-split{grid-template-columns:1fr}}
@media(max-width:575.98px){.catalog-form{grid-template-columns:1fr}.wide{grid-column:auto}}
</style>
