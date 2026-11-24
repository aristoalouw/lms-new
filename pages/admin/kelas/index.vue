<script setup lang="ts">
import type { AxiosError } from 'axios'
import type { AcademicClassRecord, LmsAcademicCatalog } from '~/shared/contracts/lms'

interface AccountOption { id: string; displayName: string; roles: string[] }
interface AccountPage { items: AccountOption[] }

definePageMeta({ middleware: ['auth', 'admin-mvp'] })
useHead({ title: 'Kelola Kelas' })

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
const firstMeeting = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 16)
const form = reactive({
  courseVersionId: '', section: 'A', periodId: '',
  capacity: 40, firstMeetingStartsAt: firstMeeting,
  meetingCount: 16, meetingDurationMinutes: 100,
})
const selectedCourse = computed(() => catalog.value.courses.find(item => item.id === form.courseVersionId))
const selectedProgram = computed(() => catalog.value.programs.find(item => item.id === selectedCourse.value?.programStudyId))

const key = (purpose: string) => `${purpose}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`
const messageFor = (error: unknown) => {
  const data = (error as AxiosError<{ statusMessage?: string; message?: string }>).response?.data
  return data?.statusMessage || data?.message || (error instanceof Error ? error.message : 'Permintaan kelas gagal diproses.')
}
const formatDate = (value: string) => new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(value))
const termLabel = (term: string) => ({ ODD: 'Ganjil', EVEN: 'Genap', SHORT: 'Pendek' })[term] || term

async function load(reset = true) {
  if (reset) { loading.value = true; nextCursor.value = undefined }
  else loadingMore.value = true
  errorMessage.value = ''
  try {
    const [classResponse, lecturerResponse, catalogResponse] = await Promise.all([
      $api.get<{ items: AcademicClassRecord[]; nextCursor?: string }>('/academic/classes', { params: { limit: 50, ...(!reset && nextCursor.value ? { cursor: nextCursor.value } : {}) } }),
      $api.get<AccountPage>('/accounts', { params: { role: 'lecturer', status: 'active', pageSize: 50 } }),
      $api.get<LmsAcademicCatalog>('/academic/classes/catalog'),
    ])
    classes.value = reset ? classResponse.data.items : [...classes.value, ...classResponse.data.items]
    nextCursor.value = classResponse.data.nextCursor
    lecturers.value = lecturerResponse.data.items
    catalog.value = catalogResponse.data
    if (!catalog.value.courses.some(item => item.id === form.courseVersionId)) {
      form.courseVersionId = catalog.value.courses[0]?.id || ''
    }
    if (!catalog.value.periods.some(item => item.id === form.periodId)) {
      form.periodId = catalog.value.periods[0]?.id || ''
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
    await $api.post('/academic/classes', {
      ...form,
      firstMeetingStartsAt: new Date(`${form.firstMeetingStartsAt}:00+07:00`).toISOString(),
      lecturerIds: selected.map(item => item.id),
      lecturerNames: selected.map(item => item.displayName),
    }, { headers: { 'Idempotency-Key': key('class-create') } })
    noticeMessage.value = 'Kelas dan ruang LMS berhasil dibuat secara atomik.'
    form.section = 'A'
    await load()
  } catch (error) {
    errorMessage.value = messageFor(error)
  } finally {
    saving.value = false
  }
}

async function archiveClass(item: AcademicClassRecord) {
  saving.value = true
  errorMessage.value = ''
  try {
    await $api.patch(`/academic/classes/${encodeURIComponent(item.id)}`, {
      expectedVersion: item.version ?? 1,
      status: 'CLOSED',
    }, { headers: { 'Idempotency-Key': key('class-archive') } })
    noticeMessage.value = 'Kelas dan ruang LMS telah diarsipkan.'
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
    <AppPageHeader eyebrow="Administrasi LMS" title="Kelas & enrolment" description="Satu kelas akademik menghasilkan tepat satu ruang LMS. Kombinasi periode, mata kuliah, dan section dijaga unik secara transactional.">
      <template #actions><button class="btn btn-outline-secondary" type="button" :disabled="loading" @click="load()"><i class="uil uil-refresh me-2" />Muat ulang</button></template>
    </AppPageHeader>

    <div v-if="noticeMessage" class="alert alert-success" role="status">{{ noticeMessage }}</div>
    <div v-if="errorMessage" class="alert alert-danger" role="alert">{{ errorMessage }}</div>
    <div v-if="!can('classes:manage')" class="alert alert-warning">Halaman ini hanya tersedia untuk pengelola kelas.</div>

    <template v-else>
      <AcademicCatalogManager :catalog="catalog" @created="load()" />
      <section class="admin-class-grid">
      <article class="surface-card">
        <header><span class="section-kicker">Kelas baru</span><h2>Buat kelas dan ruang LMS</h2></header>
        <form class="class-form" @submit.prevent="createClass">
          <div v-if="!loading && (!catalog.courses.length || !catalog.periods.length)" class="alert alert-warning span-2 mb-0" role="alert">Buat minimal satu versi mata kuliah ACTIVE dan periode aktif melalui API katalog sebelum membuat kelas.</div>
          <label class="span-2"><span>Versi mata kuliah</span><select v-model="form.courseVersionId" class="form-select" required><option value="" disabled>Pilih versi mata kuliah</option><option v-for="course in catalog.courses" :key="course.id" :value="course.id">{{ course.code }} · {{ course.name }} (v{{ course.version }})</option></select><small>Hanya versi ACTIVE dan immutable yang dapat dipakai.</small></label>
          <label><span>Section</span><input v-model="form.section" class="form-control" required maxlength="20"></label>
          <label><span>Periode akademik</span><select v-model="form.periodId" class="form-select" required><option value="" disabled>Pilih periode aktif</option><option v-for="period in catalog.periods" :key="period.id" :value="period.id">{{ period.academicYear }} · {{ termLabel(period.term) }}</option></select></label>
          <div v-if="selectedCourse && selectedProgram" class="catalog-summary span-2" aria-live="polite"><div><small>Kode / SKS</small><strong>{{ selectedCourse.code }} · {{ selectedCourse.credits }} SKS</strong></div><div><small>Program studi</small><strong>{{ selectedProgram.name }}</strong></div><div><small>Unit</small><strong>{{ selectedProgram.facultyId }}</strong></div></div>
          <label><span>Kapasitas</span><input v-model.number="form.capacity" class="form-control" type="number" min="1" max="5000" required></label>
          <label class="span-2"><span>Dosen pengampu</span><select v-model="selectedLecturers" class="form-select" multiple required size="4"><option v-for="lecturer in lecturers" :key="lecturer.id" :value="lecturer.id">{{ lecturer.displayName }}</option></select><small>Pilih minimal satu dosen.</small></label>
          <label><span>Pertemuan pertama (WIB)</span><input v-model="form.firstMeetingStartsAt" class="form-control" type="datetime-local" required></label>
          <label><span>Jumlah pertemuan</span><input v-model.number="form.meetingCount" class="form-control" type="number" min="1" max="32" required></label>
          <label><span>Durasi (menit)</span><input v-model.number="form.meetingDurationMinutes" class="form-control" type="number" min="30" max="360" required></label>
          <button class="btn btn-primary span-2" type="submit" :disabled="saving || !selectedLecturers.length || !form.courseVersionId || !form.periodId"><span v-if="saving" class="spinner-border spinner-border-sm me-2" />Buat kelas</button>
        </form>
      </article>

      <article class="surface-card class-list-card">
        <header><span class="section-kicker">Kelas tersedia</span><h2>{{ classes.length }} kelas dalam lingkup akun</h2></header>
        <div v-if="loading" class="loading-state" role="status"><span class="spinner-border spinner-border-sm" /> Memuat kelas…</div>
        <div v-else-if="classes.length" class="class-list">
          <article v-for="item in classes" :key="item.id">
            <div><strong>{{ item.courseCode }} · {{ item.courseName }}</strong><small>Kelas {{ item.section }} · {{ item.periodId }} · {{ item.enrollmentCount ?? 0 }}/{{ item.capacity || '∞' }} peserta</small><small>{{ item.lecturerNames.join(', ') }} · diperbarui {{ formatDate(item.updatedAt) }}</small></div>
            <StatusBadge :status="item.status === 'ACTIVE' ? 'active' : 'blocked'" :label="item.status === 'ACTIVE' ? 'Aktif' : 'Arsip'" />
            <div class="class-actions"><NuxtLink class="btn btn-sm btn-outline-primary" :to="`/admin/kelas/${item.id}`">Kelola</NuxtLink><button v-if="item.status === 'ACTIVE'" class="btn btn-sm btn-outline-danger" type="button" :disabled="saving" @click="archiveClass(item)">Arsipkan</button></div>
          </article>
          <button v-if="nextCursor" class="btn btn-sm btn-outline-secondary" :disabled="loadingMore" @click="load(false)"><span v-if="loadingMore" class="spinner-border spinner-border-sm me-2" />Muat kelas berikutnya</button>
        </div>
        <EmptyState v-else title="Belum ada kelas" description="Buat kelas pertama untuk menghasilkan ruang LMS otomatis." />
      </article>
      </section>
    </template>
  </div>
</template>

<style scoped>
.page-stack{display:grid;gap:1.25rem}.admin-class-grid{display:grid;grid-template-columns:minmax(320px,.8fr) minmax(0,1.2fr);gap:1rem;align-items:start}.surface-card{padding:1rem;border:1px solid #e6dfd6;border-radius:1rem;background:#fff}.surface-card header{margin-bottom:1rem}.surface-card h2{margin:.2rem 0 0;color:#294c40;font-size:1rem}.section-kicker{color:#668278;font-size:.65rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase}.class-form{display:grid;grid-template-columns:1fr 1fr;gap:.8rem}.class-form label>span,.class-form small{display:block;margin-bottom:.3rem;color:#5c7269;font-size:.7rem;font-weight:700}.class-form small{margin:.3rem 0 0;color:#82918c;font-weight:500}.span-2{grid-column:1/-1}.catalog-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.65rem;padding:.75rem;border:1px solid #e6dfd6;border-radius:.75rem;background:#faf6ef}.catalog-summary small,.catalog-summary strong{display:block}.catalog-summary strong{color:#315449;font-size:.75rem}.class-list{display:grid;gap:.65rem}.class-list>article{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:.65rem;padding:.85rem;border:1px solid #e4ebe7;border-radius:.8rem}.class-list strong,.class-list small{display:block}.class-list strong{color:#315449;font-size:.82rem}.class-list small{margin-top:.25rem;color:#77877f;font-size:.68rem}.class-actions{grid-column:1/-1;display:flex;gap:.5rem}.loading-state{display:flex;gap:.5rem;align-items:center;min-height:140px;justify-content:center;color:#6e8179}@media(max-width:991.98px){.admin-class-grid{grid-template-columns:1fr}}@media(max-width:575.98px){.class-form,.catalog-summary{grid-template-columns:1fr}.span-2{grid-column:auto}.class-list>article{grid-template-columns:1fr}}
</style>
