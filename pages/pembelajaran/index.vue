<script setup lang="ts">
import type {
  AcademicAdministrationWorkspace,
  AcademicPeriodDefinition,
  AcademicProgramStudy,
} from '~/server/types/academic-administration'
import type { LearningPage, LearningSpace } from '~/shared/contracts/lms'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Pembelajaran' })

const { $api } = useNuxtApp()
const { can, user } = useAuth()
const spaces = ref<LearningSpace[]>([])
const programs = ref<AcademicProgramStudy[]>([])
const periods = ref<AcademicPeriodDefinition[]>([])
const nextCursor = ref<string>()
const loading = ref(true)
const loadingMore = ref(false)
const errorMessage = ref('')
const searchQuery = ref('')
const statusFilter = ref<'ALL' | 'ACTIVE' | 'ARCHIVED'>('ALL')

const termLabel = (term: string) => ({ ODD: 'Gasal', EVEN: 'Genap', SHORT: 'Pendek' })[term] || term
const periodLabel = (periodId?: string) => {
  if (!periodId) return ''
  const match = periods.value.find(item => item.id === periodId)
  return match ? `${match.academicYear} · ${termLabel(match.term)}` : periodId
}
const programLabel = (programId?: string) => {
  if (!programId) return ''
  return programs.value.find(item => item.id === programId)?.name || programId
}

const filteredSpaces = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  return spaces.value.filter(space =>
    (statusFilter.value === 'ALL' || space.status === statusFilter.value)
    && (!q
      || space.title.toLowerCase().includes(q)
      || (space.courseCode || '').toLowerCase().includes(q)
      || periodLabel(space.periodId).toLowerCase().includes(q)
      || programLabel(space.programStudyId).toLowerCase().includes(q)),
  )
})

async function load(reset = false) {
  if (reset) {
    spaces.value = []
    nextCursor.value = undefined
    loading.value = true
  } else loadingMore.value = true
  errorMessage.value = ''
  try {
    const [spaceRes, adminRes] = await Promise.all([
      $api.get<LearningPage<LearningSpace> & { spaces?: LearningSpace[] }>('/learning/spaces', {
        params: { limit: 24, ...(nextCursor.value ? { cursor: nextCursor.value } : {}) },
      }),
      reset ? $api.get<AcademicAdministrationWorkspace>('/academic/administration').catch(() => null) : Promise.resolve(null),
    ])
    spaces.value = reset ? spaceRes.data.items : [...spaces.value, ...spaceRes.data.items]
    nextCursor.value = spaceRes.data.nextCursor
    if (adminRes?.data) {
      programs.value = adminRes.data.programs
      periods.value = adminRes.data.periods
    }
  } catch (error) {
    errorMessage.value = learningErrorMessage(error)
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

watch(() => user.value?.activeRole, () => load(true))
onMounted(() => load(true))
</script>

<template>
  <div class="page-stack">
    <AppPageHeader eyebrow="LMS" title="Ruang pembelajaran" description="Akses materi, tugas, diskusi, pengumuman, dan presensi yang tersinkron dengan kelas aktif Anda.">
      <template #actions>
        <button class="btn btn-outline-secondary" type="button" :disabled="loading" @click="load(true)"><i class="uil uil-refresh me-1" />Muat ulang</button>
        <NuxtLink v-if="can('academic.read')" class="btn btn-outline-secondary" to="/akademik/kelas"><i class="uil uil-presentation-check me-1" />Pelaksanaan kelas</NuxtLink>
        <NuxtLink v-if="can('classes:manage')" class="btn btn-primary" to="/admin/kelas"><i class="uil uil-plus me-1" />Kelola kelas</NuxtLink>
      </template>
    </AppPageHeader>

    <div v-if="errorMessage" class="alert alert-danger d-flex align-items-center justify-content-between" role="alert"><span>{{ errorMessage }}</span><button class="btn btn-sm btn-outline-danger" @click="load(true)">Coba lagi</button></div>

    <section v-if="!loading && spaces.length" class="space-toolbar">
      <input v-model="searchQuery" class="form-control form-control-sm" type="search" placeholder="Cari mata kuliah, kode, periode..." aria-label="Cari ruang pembelajaran">
      <select v-model="statusFilter" class="form-select form-select-sm" aria-label="Filter status ruang">
        <option value="ALL">Semua ruang ({{ spaces.length }})</option>
        <option value="ACTIVE">Aktif ({{ spaces.filter(s => s.status === 'ACTIVE').length }})</option>
        <option value="ARCHIVED">Diarsipkan ({{ spaces.filter(s => s.status === 'ARCHIVED').length }})</option>
      </select>
    </section>

    <div v-if="loading" class="loading-state" aria-live="polite"><span class="spinner-border spinner-border-sm" />Memuat ruang pembelajaran…</div>

    <section v-else-if="filteredSpaces.length" class="space-grid" aria-label="Daftar ruang pembelajaran">
      <SpaceCard
        v-for="space in filteredSpaces"
        :key="space.id"
        :space="space"
        :period-label="periodLabel(space.periodId)"
        :program-label="programLabel(space.programStudyId)"
      />
    </section>
    <section v-else class="empty-state">
      <i class="uil uil-books" />
      <h2>{{ spaces.length ? 'Tidak ada ruang sesuai filter' : 'Belum ada ruang pembelajaran aktif' }}</h2>
      <p>{{ spaces.length ? 'Ubah kata kunci pencarian atau filter status untuk melihat ruang lain.' : 'Ruang pembelajaran muncul otomatis setelah kelas aktif dibuat atau dipulihkan dari Sampah.' }}</p>
      <NuxtLink v-if="!spaces.length && can('classes:manage')" class="btn btn-primary btn-sm mt-2" to="/admin/kelas"><i class="uil uil-presentation-check me-1" />Buka Kelas &amp; Peserta</NuxtLink>
    </section>

    <button v-if="nextCursor" class="btn btn-outline-secondary load-more" :disabled="loadingMore" @click="load()"><span v-if="loadingMore" class="spinner-border spinner-border-sm me-2" />Muat kelas berikutnya</button>
  </div>
</template>

<style scoped src="~/pages/_workflow.css"></style>
<style scoped>
.space-toolbar{display:flex;gap:.6rem;flex-wrap:wrap;align-items:center;padding:.8rem 1rem;border:1px solid #e6dfd6;border-radius:.9rem;background:#fff}
.space-toolbar input{flex:1;min-width:220px}
.space-toolbar select{width:auto;min-width:170px}
.space-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.85rem}
.loading-state,.empty-state{display:grid;place-items:center;align-content:center;gap:.5rem;min-height:260px;padding:2rem;border:1px solid #e6dfd6;border-radius:.9rem;color:#6c6865;background:#fff;text-align:center}
.loading-state{display:flex;justify-content:center}
.empty-state i{color:#593660;font-size:2rem}
.empty-state h2{margin:0;color:#1e1e1e;font-size:.96rem}
.empty-state p{margin:0;font-size:.74rem;max-width:460px}
.load-more{justify-self:center}
@media(max-width:767.98px){.space-grid{grid-template-columns:1fr}.space-toolbar select{width:100%}}
</style>
