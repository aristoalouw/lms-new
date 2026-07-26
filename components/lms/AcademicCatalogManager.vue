<script setup lang="ts">
import type { AxiosError } from 'axios'
import type { LmsAcademicCatalog } from '~/shared/contracts/lms'

const props = defineProps<{ catalog: LmsAcademicCatalog }>()
const emit = defineEmits<{ created: [] }>()
const { $api } = useNuxtApp()
const busy = ref(false)
const errorMessage = ref('')
const noticeMessage = ref('')
const year = new Date().getFullYear()

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

const latestCourseVersion = computed(() => Math.max(
  0,
  ...props.catalog.courses
    .filter(item => item.courseId === course.courseId.trim())
    .map(item => item.version),
))
const existingPeriodVersion = computed(() => props.catalog.periods.find(item => item.id === period.id.trim())?.version ?? 0)
const requestKey = (purpose: string) => `${purpose}-${globalThis.crypto.randomUUID()}`
const instant = (date: string, end = false) => new Date(`${date}T${end ? '23:59:59' : '00:00:00'}+07:00`).toISOString()
const messageFor = (error: unknown) => {
  const data = (error as AxiosError<{ statusMessage?: string; message?: string }>).response?.data
  return data?.statusMessage || data?.message || (error instanceof Error ? error.message : 'Katalog akademik belum dapat disimpan.')
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
    noticeMessage.value = 'Periode aktif tersimpan.'
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
      prerequisiteCourseCodes: [],
      equivalentCourseCodes: [],
      status: 'ACTIVE',
      expectedCurrentVersion: latestCourseVersion.value,
    }, { headers: { 'Idempotency-Key': requestKey('catalog-course') } })
    noticeMessage.value = 'Versi mata kuliah ACTIVE dibuat dan dikunci.'
    course.courseId = ''
    course.code = ''
    course.name = ''
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
    <header>
      <span class="section-kicker">Master akademik</span>
      <h2>Periode & mata kuliah</h2>
      <p>Siapkan referensi kanonik sebelum membuat kelas. Perubahan disimpan berversi dan diaudit.</p>
    </header>
    <div v-if="noticeMessage" class="alert alert-success" role="status">{{ noticeMessage }}</div>
    <div v-if="errorMessage" class="alert alert-danger" role="alert">{{ errorMessage }}</div>

    <details>
      <summary>Tambah atau aktifkan periode</summary>
      <form class="catalog-form" @submit.prevent="savePeriod">
        <label><span>ID periode</span><input v-model="period.id" class="form-control" maxlength="128" required></label>
        <label><span>Tahun akademik</span><input v-model="period.academicYear" class="form-control" pattern="\d{4}[/-]\d{4}" required></label>
        <label><span>Semester</span><select v-model="period.term" class="form-select"><option value="ODD">Ganjil</option><option value="EVEN">Genap</option><option value="SHORT">Pendek</option></select></label>
        <label><span>Mulai kuliah</span><input v-model="period.startsAt" class="form-control" type="date" required></label>
        <label><span>Akhir kuliah</span><input v-model="period.endsAt" class="form-control" type="date" required></label>
        <label><span>KRS dibuka</span><input v-model="period.krsOpensAt" class="form-control" type="date" required></label>
        <label><span>KRS ditutup</span><input v-model="period.krsClosesAt" class="form-control" type="date" required></label>
        <button class="btn btn-outline-primary" type="submit" :disabled="busy">Simpan periode</button>
      </form>
    </details>

    <details>
      <summary>Buat versi mata kuliah</summary>
      <form class="catalog-form" @submit.prevent="saveCourse">
        <label><span>ID mata kuliah</span><input v-model="course.courseId" class="form-control" maxlength="128" placeholder="course-mgt-101" required><small>Gunakan ID yang sama untuk membuat versi berikutnya.</small></label>
        <label><span>Kode</span><input v-model="course.code" class="form-control text-uppercase" maxlength="30" placeholder="MGT101" required></label>
        <label class="wide"><span>Nama</span><input v-model="course.name" class="form-control" maxlength="180" required></label>
        <label><span>Program studi</span><select v-model="course.programStudyId" class="form-select" required><option value="" disabled>Pilih program</option><option v-for="program in catalog.programs" :key="program.id" :value="program.id">{{ program.code }} · {{ program.name }}</option></select></label>
        <label><span>SKS</span><input v-model.number="course.credits" class="form-control" type="number" min="1" max="12" required></label>
        <label><span>Rekomendasi semester</span><input v-model.number="course.semesterRecommendation" class="form-control" type="number" min="1" max="14" required></label>
        <p class="version-note">Versi berikutnya: {{ latestCourseVersion + 1 }}. Versi yang dibuat bersifat immutable.</p>
        <button class="btn btn-outline-primary" type="submit" :disabled="busy || !catalog.programs.length">Buat versi ACTIVE</button>
      </form>
    </details>
  </article>
</template>

<style scoped>
.catalog-manager{display:grid;gap:.75rem;padding:1rem;border:1px solid #dfe8e3;border-radius:1rem;background:#fff}.catalog-manager header{margin-bottom:.15rem}.catalog-manager h2{margin:.2rem 0;color:#294c40;font-size:1rem}.catalog-manager header p{margin:0;color:#74877e;font-size:.68rem}.section-kicker{color:#668278;font-size:.65rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase}details{border:1px solid #e1e9e4;border-radius:.75rem;background:#fafcfb}summary{padding:.75rem;color:#315449;font-size:.73rem;font-weight:800;cursor:pointer}.catalog-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.7rem;padding:0 .75rem .75rem}.catalog-form label>span,.catalog-form label>small{display:block;margin-bottom:.25rem;color:#5c7269;font-size:.65rem;font-weight:700}.catalog-form label>small{margin:.25rem 0 0;color:#7b8d84;font-weight:500}.wide{grid-column:1/-1}.version-note{align-self:end;margin:0;color:#74877e;font-size:.65rem}.catalog-form .btn{align-self:end}@media(max-width:575.98px){.catalog-form{grid-template-columns:1fr}.wide{grid-column:auto}}
</style>
