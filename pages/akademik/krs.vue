<script setup lang="ts">
import { krsCourses as demoKrsCourses, krsStats, krsTimeline } from '~/data/workflows'
import type { Tone } from '~/data/dashboard'
import type { KrsRecord } from '~/server/types/domain'
import type { KrsCatalogEntry, KrsPeriodPolicy, KrsStudentAcademicState, KrsWriteResult } from '~/server/types/krs-enrollment'
import type { AcademicAdministrationWorkspace, AcademicPeriodDefinition } from '~/server/types/academic-administration'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Kartu Rencana Studi' })

const selectedPeriodId = ref(configuredDemoPeriodId())
const courseFilter = ref('Semua mata kuliah')
const config = useRuntimeConfig()
const { $api } = useNuxtApp()
const { user } = useAuth()
const courseCatalog = ref(config.public.demoMode
  ? demoKrsCourses.map(course => ({ ...course, id: course.code }))
  : [])
const selectedCourseCodes = ref(courseCatalog.value.filter(course => course.status === 'Terpilih').map(course => course.code))
const krsStatus = ref<'draft' | 'pending'>('draft')
const showConfirmation = ref(false)
const acceptedDeclaration = ref(false)
const mutating = ref(false)
const loading = ref(!config.public.demoMode)
const errorMessage = ref('')
const noticeMessage = ref('')
const currentPlanId = ref('')
const currentVersion = ref(0)
const studentState = ref<KrsStudentAcademicState | null>(null)
const periodPolicy = ref<KrsPeriodPolicy | null>(null)
const periods = ref<AcademicPeriodDefinition[]>([])
const setupMessage = ref('')

function configuredDemoPeriodId() {
  return '2026-2027-1'
}

const courseColumns = [
  { key: 'selection', label: 'Pilih', sortable: false, align: 'center' as const, width: '72px' },
  { key: 'code', label: 'Kode', sortable: true },
  { key: 'name', label: 'Mata kuliah', sortable: true },
  { key: 'class', label: 'Kelas' },
  { key: 'schedule', label: 'Jadwal' },
  { key: 'lecturer', label: 'Dosen pengampu' },
  { key: 'credits', label: 'SKS', align: 'center' as const },
  { key: 'capacity', label: 'Kapasitas', align: 'center' as const },
  { key: 'status', label: 'Status' },
]

const courseRows = computed(() => courseCatalog.value
  .filter(course => courseFilter.value === 'Semua mata kuliah' || (courseFilter.value === 'Terpilih' ? selectedCourseCodes.value.includes(course.code) : !selectedCourseCodes.value.includes(course.code)))
  .map(course => ({ ...course, selection: course.code, status: selectedCourseCodes.value.includes(course.code) ? 'Terpilih' : course.status })))

const selectedCredits = computed(() => courseCatalog.value
  .filter(course => selectedCourseCodes.value.includes(course.code))
  .reduce((total, course) => total + course.credits, 0))

const selectedCount = computed(() => selectedCourseCodes.value.length)
const maximumCredits = computed(() => studentState.value?.maximumCredits ?? 24)
const remainingCredits = computed(() => Math.max(0, maximumCredits.value - selectedCredits.value))
const activeHolds = computed(() => studentState.value?.holds.filter(item => item.active) ?? [])
const krsReady = computed(() => config.public.demoMode || Boolean(studentState.value && periodPolicy.value))
const canSubmit = computed(() => krsReady.value
  && krsStatus.value === 'draft'
  && selectedCount.value > 0
  && (config.public.demoMode || (periodPolicy.value?.status === 'KRS_OPEN' && activeHolds.value.length === 0)))

const termLabel = (term: AcademicPeriodDefinition['term']) => ({ ODD: 'Gasal', EVEN: 'Genap', SHORT: 'Pendek' })[term]
const selectedPeriodLabel = computed(() => {
  const period = periods.value.find(item => item.id === selectedPeriodId.value)
  return period ? `${period.academicYear} ${termLabel(period.term)}` : selectedPeriodId.value
})
const deadlineLabel = computed(() => periodPolicy.value
  ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(periodPolicy.value.krsClosesAt))
  : 'Belum dikonfigurasi')
const daysToDeadline = computed(() => periodPolicy.value
  ? Math.max(0, Math.ceil((Date.parse(periodPolicy.value.krsClosesAt) - Date.now()) / 86_400_000))
  : 0)
const studentIdentity = computed(() => studentState.value || (config.public.demoMode ? {
  id: 'student-demo', studentUid: 'student-demo', studentNumber: '23011010', studentName: 'Mahasiswa Demo',
  programStudyId: 'management-s1', advisorId: 'advisor-demo', active: true, maximumCredits: 24,
  completedCourseCodes: [], holds: [], version: 1, updatedAt: '2026-07-20T00:00:00.000Z',
} satisfies KrsStudentAcademicState : null))
const timelineRows = computed(() => {
  if (config.public.demoMode) return krsTimeline
  if (!periodPolicy.value) return []
  const date = (value: string) => new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeZone: 'Asia/Jakarta' }).format(new Date(value))
  return [
    { label: 'Pembukaan KRS', date: date(periodPolicy.value.krsOpensAt), state: 'Terjadwal', detail: 'Katalog kelas dapat dipilih setelah periode dibuka.' },
    { label: 'Batas pengajuan', date: date(periodPolicy.value.krsClosesAt), state: periodPolicy.value.status, detail: 'Draf harus diajukan sebelum batas waktu ini.' },
    { label: 'Batas revisi', date: date(periodPolicy.value.revisionClosesAt), state: 'Terjadwal', detail: 'Revisi mengikuti keputusan dosen wali dan kebijakan periode.' },
  ]
})
const statRows = computed(() => config.public.demoMode ? krsStats : [
  { label: 'SKS dipilih', value: `${selectedCredits.value} / ${maximumCredits.value}`, detail: `${selectedCount.value} mata kuliah`, trend: selectedPeriodLabel.value, tone: 'primary' as Tone },
  { label: 'Batas SKS', value: String(maximumCredits.value), detail: 'Sesuai status akademik', trend: studentState.value?.active ? 'Mahasiswa aktif' : 'Tidak aktif', tone: studentState.value?.active ? 'success' as Tone : 'danger' as Tone },
  { label: 'Status KRS', value: krsStatus.value === 'draft' ? 'Draf' : 'Diajukan', detail: periodPolicy.value?.status || '-', trend: `Versi ${currentVersion.value}`, tone: krsStatus.value === 'draft' ? 'warning' as Tone : 'info' as Tone },
  { label: 'Pencekalan', value: String(activeHolds.value.length), detail: activeHolds.value.length ? 'Perlu diselesaikan' : 'Tidak ada', trend: 'Validasi server', tone: activeHolds.value.length ? 'danger' as Tone : 'success' as Tone },
])

const statTone = (tone: Tone): 'forest' | 'amber' | 'blue' | 'coral' | 'slate' => ({
  primary: 'forest', success: 'forest', warning: 'amber', danger: 'coral', info: 'blue', neutral: 'slate',
})[tone] as 'forest' | 'amber' | 'blue' | 'coral' | 'slate'

const toggleCourse = (code: string) => {
  const course = courseCatalog.value.find(item => item.code === code)
  if (!course || (['Kelas penuh', 'Prasyarat belum terpenuhi'].includes(course.status) && !selectedCourseCodes.value.includes(code)) || krsStatus.value !== 'draft') return

  if (selectedCourseCodes.value.includes(code)) {
    selectedCourseCodes.value = selectedCourseCodes.value.filter(item => item !== code)
    return
  }

  if (selectedCredits.value + course.credits <= 24) selectedCourseCodes.value = [...selectedCourseCodes.value, code]
}

const openConfirmation = () => {
  acceptedDeclaration.value = false
  showConfirmation.value = true
}

const printDraft = () => {
  if (import.meta.client) window.print()
}

const requestKey = (prefix: string) => `${prefix}:${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`

const apiError = (error: unknown) => {
  const value = error as { response?: { data?: { statusMessage?: string; message?: string } }; message?: string }
  return value.response?.data?.statusMessage || value.response?.data?.message || value.message || 'Permintaan KRS tidak dapat diproses.'
}

const apiStatus = (error: unknown) => Number((error as { response?: { status?: number } }).response?.status || 0)

const selectedClassIds = () => courseCatalog.value
  .filter(course => selectedCourseCodes.value.includes(course.code))
  .map(course => course.id)

const persistDraft = async () => {
  const { data } = await $api.put<KrsWriteResult>('/krs/draft', {
    periodId: selectedPeriodId.value,
    classIds: selectedClassIds(),
    expectedVersion: currentVersion.value,
  }, { headers: { 'Idempotency-Key': requestKey('krs-draft') } })
  currentPlanId.value = data.record.id
  currentVersion.value = data.record.version
  return data.record
}

const saveDraft = async () => {
  if (config.public.demoMode) {
    noticeMessage.value = 'Draf demo tersimpan pada perangkat ini.'
    return
  }
  mutating.value = true
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    await persistDraft()
    noticeMessage.value = 'Draf KRS tersimpan dan versinya telah diperbarui.'
  } catch (error) {
    errorMessage.value = apiError(error)
  } finally {
    mutating.value = false
  }
}

const submitKrs = async () => {
  if (!acceptedDeclaration.value) return
  if (config.public.demoMode) {
    krsStatus.value = 'pending'
    showConfirmation.value = false
    return
  }
  mutating.value = true
  errorMessage.value = ''
  try {
    const draft = await persistDraft()
    const { data } = await $api.post<KrsWriteResult>(`/krs/${draft.id}/submit`, {
      expectedVersion: draft.version,
    }, { headers: { 'Idempotency-Key': requestKey('krs-submit') } })
    currentVersion.value = data.record.version
    krsStatus.value = 'pending'
    showConfirmation.value = false
    noticeMessage.value = 'KRS berhasil diajukan dan kursi kelas telah dipesan secara atomik.'
  } catch (error) {
    errorMessage.value = apiError(error)
  } finally {
    mutating.value = false
  }
}

const formatSchedule = (entry: KrsCatalogEntry) => {
  const meeting = entry.classRecord.schedule[0]
  if (!meeting) return 'Jadwal belum tersedia'
  const start = new Date(meeting.scheduledStartAt)
  const end = new Date(meeting.scheduledEndAt)
  const day = new Intl.DateTimeFormat('id-ID', { weekday: 'long', timeZone: 'Asia/Jakarta' }).format(start)
  const time = (value: Date) => new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Jakarta' }).format(value)
  return `${day}, ${time(start)}-${time(end)}`
}

async function loadPeriod(periodId: string) {
  loading.value = true
  errorMessage.value = ''
  setupMessage.value = ''
  try {
    const [catalogResponse, planResponse] = await Promise.all([
      $api.get<{ period: KrsPeriodPolicy; student: KrsStudentAcademicState; classes: KrsCatalogEntry[] }>('/krs/catalog', { params: { periodId } }),
      $api.get<{ record: KrsRecord | null }>('/krs/me', { params: { periodId } }),
    ])
    studentState.value = catalogResponse.data.student
    periodPolicy.value = catalogResponse.data.period
    courseCatalog.value = catalogResponse.data.classes.map(entry => ({
      id: entry.classRecord.id,
      code: entry.classRecord.courseCode,
      name: entry.classRecord.courseName,
      class: `${entry.classRecord.courseCode}-${entry.classRecord.section}`,
      schedule: formatSchedule(entry),
      lecturer: entry.classRecord.lecturerNames.join(', ') || 'Belum ditetapkan',
      credits: entry.classRecord.credits,
      capacity: `${(entry.classRecord.capacity || 0) - entry.availableSeats} / ${entry.classRecord.capacity || 0}`,
      status: entry.availableSeats > 0 && entry.eligibleByPrerequisite ? 'Tersedia' : entry.availableSeats === 0 ? 'Kelas penuh' : 'Prasyarat belum terpenuhi',
    }))
    const record = planResponse.data.record
    if (record) {
      currentPlanId.value = record.id
      currentVersion.value = record.version
      selectedCourseCodes.value = [...record.courseCodes]
      krsStatus.value = record.status === 'DRAFT' || record.status === 'REJECTED' ? 'draft' : 'pending'
    } else {
      currentPlanId.value = ''
      currentVersion.value = 0
      selectedCourseCodes.value = []
      krsStatus.value = 'draft'
    }
  } catch (error) {
    studentState.value = null
    periodPolicy.value = null
    courseCatalog.value = []
    if ([403, 404, 409].includes(apiStatus(error))) {
      setupMessage.value = 'Profil akademik mahasiswa dan kebijakan KRS untuk periode aktif belum lengkap. Administrator perlu menyelesaikan data master sebelum KRS dapat digunakan.'
    } else errorMessage.value = apiError(error)
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  if (config.public.demoMode) {
    loading.value = false
    return
  }
  if (!user.value?.roles.includes('student')) {
    setupMessage.value = 'Halaman ini adalah ruang pengisian KRS mahasiswa. Gunakan Administrasi Akademik untuk pengelolaan data dan persetujuan staf.'
    loading.value = false
    return
  }
  try {
    const { data } = await $api.get<AcademicAdministrationWorkspace>('/academic/administration')
    if (!data.profile) throw new Error('Profil akademik mahasiswa belum tersedia.')
    periods.value = data.periods.filter(item => item.active)
    const periodId = data.profile.currentPeriodId || periods.value[0]?.id
    if (!periodId) throw new Error('Periode akademik aktif belum tersedia.')
    selectedPeriodId.value = periodId
    await loadPeriod(periodId)
  } catch (error) {
    const localSetupError = error instanceof Error && !(error as { response?: unknown }).response
    if ([403, 404, 409].includes(apiStatus(error)) || localSetupError) {
      setupMessage.value = 'Profil akademik mahasiswa dan periode aktif belum lengkap. Administrator perlu menyelesaikan onboarding akademik sebelum KRS dapat digunakan.'
    } else errorMessage.value = apiError(error)
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="page-stack">
    <AppPageHeader
      eyebrow="Administrasi akademik"
      title="Kartu Rencana Studi"
      description="Susun rencana studi semester, periksa jadwal, lalu ajukan kepada dosen wali untuk memperoleh persetujuan."
      :status="krsStatus"
      :status-label="krsStatus === 'draft' ? 'Draf KRS' : 'Menunggu dosen wali'"
    >
      <template #actions>
        <button class="btn btn-outline-secondary" type="button" :disabled="!krsReady" @click="printDraft"><i class="uil uil-print me-2" aria-hidden="true" />Cetak draf</button>
        <button class="btn btn-primary" type="button" :disabled="!canSubmit" @click="openConfirmation">
          <i class="uil uil-message me-2" aria-hidden="true" />Ajukan KRS
        </button>
      </template>
    </AppPageHeader>

    <div v-if="errorMessage" class="alert alert-danger" role="alert">{{ errorMessage }}</div>
    <div v-if="noticeMessage" class="alert alert-success" role="status">{{ noticeMessage }}</div>
    <div v-if="loading" class="alert alert-info" role="status">Memuat katalog dan KRS terbaru...</div>
    <EmptyState
      v-else-if="setupMessage"
      icon="uil-setting"
      title="KRS belum siap digunakan"
      :description="setupMessage"
    />

    <template v-if="!loading && krsReady">
    <section class="workflow-toolbar" aria-label="Konteks akademik">
      <div class="workflow-toolbar__meta">
        <i class="uil uil-user-square" aria-hidden="true" />
        <div><strong>{{ studentIdentity?.studentName }} · {{ studentIdentity?.studentNumber }}</strong><small>{{ studentIdentity?.programStudyId }} · Dosen wali {{ studentIdentity?.advisorId }}</small></div>
      </div>
      <div class="workflow-toolbar__filters">
        <label><span>Semester</span>
          <select v-model="selectedPeriodId" class="form-select form-select-sm" :disabled="config.public.demoMode || periods.length < 2" @change="loadPeriod(selectedPeriodId)">
            <option v-if="config.public.demoMode" :value="configuredDemoPeriodId()">2026/2027 Gasal</option>
            <option v-for="period in periods" :key="period.id" :value="period.id">{{ period.academicYear }} {{ termLabel(period.term) }}</option>
          </select>
        </label>
        <label><span>Tampilan</span>
          <select v-model="courseFilter" class="form-select form-select-sm"><option>Semua mata kuliah</option><option>Terpilih</option><option>Belum dipilih</option></select>
        </label>
      </div>
    </section>

    <section v-if="krsStatus === 'pending'" class="context-banner" role="status">
      <div class="context-banner__copy">
        <span class="context-banner__icon"><i class="uil uil-check-circle" aria-hidden="true" /></span>
        <div><span class="section-kicker">Pengajuan berhasil</span><h2>KRS sudah dikirim kepada dosen wali</h2><p>Anda akan menerima notifikasi setelah pengajuan disetujui atau dikembalikan untuk perbaikan.</p></div>
      </div>
      <div class="context-banner__aside"><strong>{{ selectedCredits }} SKS</strong><small>{{ selectedCount }} mata kuliah diajukan</small></div>
    </section>

    <section v-else class="context-banner">
      <div class="context-banner__copy">
        <span class="context-banner__icon"><i class="uil uil-clipboard-notes" aria-hidden="true" /></span>
        <div><span class="section-kicker">Periode pengisian</span><h2>Pengisian KRS sampai {{ deadlineLabel }}</h2><p>Pastikan mata kuliah, kelas, dan jadwal sudah sesuai. Perubahan masih dapat dilakukan sebelum KRS diajukan.</p></div>
      </div>
      <div class="context-banner__aside"><strong>{{ daysToDeadline }} hari</strong><small>menuju batas pengajuan</small></div>
    </section>

    <section class="row g-3" aria-label="Ringkasan KRS">
      <div v-for="stat in statRows" :key="stat.label" class="col-sm-6 col-xl-3">
        <StatCard
          :label="stat.label"
          :value="stat.label === 'SKS dipilih' ? `${selectedCredits} / ${maximumCredits}` : stat.value"
          :detail="stat.detail"
          :trend="stat.label === 'SKS dipilih' ? `${selectedCount} mata kuliah` : stat.trend"
          :tone="statTone(stat.tone)"
        />
      </div>
    </section>

    <section class="row g-4">
      <div class="col-12 col-xl-8">
        <article class="workflow-surface h-100">
          <header class="workflow-surface__header workflow-surface__header--plain">
            <div><span class="section-kicker">Kesiapan pengajuan</span><h2>Beban studi semester</h2><p>Batas SKS dihitung dari IPS semester sebelumnya.</p></div>
            <StatusBadge status="verified" label="Validasi server aktif" />
          </header>
          <div class="workflow-surface__body">
            <div class="credit-meter">
              <div class="credit-meter__number"><strong>{{ selectedCredits }}</strong><span>/ {{ maximumCredits }} SKS</span></div>
              <div class="credit-meter__track" role="progressbar" aria-label="SKS terpilih" :aria-valuenow="selectedCredits" aria-valuemin="0" :aria-valuemax="maximumCredits"><span :style="{ width: `${maximumCredits ? selectedCredits / maximumCredits * 100 : 0}%` }" /></div>
              <small>{{ remainingCredits }} SKS masih dapat ditambahkan</small>
            </div>
            <div class="eligibility-grid mt-4">
              <div><i class="uil uil-check-circle" aria-hidden="true" /><span><strong>Akademik</strong><small>Maksimum {{ maximumCredits }} SKS</small></span></div>
              <div><i class="uil" :class="activeHolds.length ? 'uil-exclamation-triangle' : 'uil-check-circle'" aria-hidden="true" /><span><strong>Keuangan</strong><small>{{ activeHolds.length ? `${activeHolds.length} pencekalan aktif` : 'Tidak ada pencekalan' }}</small></span></div>
              <div><i class="uil uil-check-circle" aria-hidden="true" /><span><strong>Prasyarat</strong><small>Diperiksa per kelas oleh server</small></span></div>
            </div>
          </div>
        </article>
      </div>
      <div class="col-12 col-xl-4">
        <article class="workflow-surface h-100">
          <header class="workflow-surface__header workflow-surface__header--plain"><div><span class="section-kicker">Jadwal penting</span><h2>Tahapan KRS</h2></div></header>
          <div class="workflow-surface__body pt-2">
            <ol class="timeline-list">
              <li v-for="(step, index) in timelineRows" :key="step.label"><span class="timeline-list__dot" :class="{ 'timeline-list__dot--active': index < 2 }" /><div><strong>{{ step.label }}</strong><small>{{ step.date }} · {{ step.state }}</small><p>{{ step.detail }}</p></div></li>
            </ol>
          </div>
        </article>
      </div>
    </section>

    <section class="workflow-surface">
      <header class="workflow-surface__header">
        <div><span class="section-kicker">Katalog semester</span><h2>Pilih mata kuliah dan kelas</h2><p>Kapasitas kelas diperbarui otomatis. Kelas penuh tidak dapat dipilih.</p></div>
        <button class="btn btn-sm btn-outline-secondary" type="button"><i class="uil uil-calendar-alt me-1" aria-hidden="true" />Lihat jadwal mingguan</button>
      </header>
      <DataTable
        :columns="courseColumns"
        :rows="courseRows"
        :page-size="8"
        search-placeholder="Cari kode, mata kuliah, atau dosen…"
        empty-title="Mata kuliah tidak ditemukan"
        empty-description="Ubah filter atau kata kunci untuk menemukan mata kuliah."
      >
        <template #cell-selection="{ row }">
          <input
            class="form-check-input course-checkbox"
            type="checkbox"
            :checked="selectedCourseCodes.includes(String(row.code))"
            :disabled="(['Kelas penuh', 'Prasyarat belum terpenuhi'].includes(String(row.status)) && !selectedCourseCodes.includes(String(row.code))) || krsStatus !== 'draft'"
            :aria-label="`Pilih ${String(row.name)}`"
            @change="toggleCourse(String(row.code))"
          >
        </template>
        <template #cell-name="{ row, value }"><div class="course-name"><strong>{{ value }}</strong><small>{{ row.code }} · {{ row.class }}</small></div></template>
        <template #cell-status="{ value }"><StatusBadge :status="String(value) === 'Terpilih' ? 'active' : 'blocked'" :label="String(value)" /></template>
      </DataTable>
      <div class="action-dock">
        <div class="action-dock__summary"><strong>{{ selectedCount }} mata kuliah · {{ selectedCredits }} SKS dipilih</strong><small>{{ currentVersion ? `Draf versi ${currentVersion}` : 'Draf belum disimpan' }}</small></div>
        <div class="action-dock__buttons"><button class="btn btn-outline-secondary" type="button" :disabled="mutating || !canSubmit" @click="saveDraft">Simpan draf</button><button class="btn btn-primary" type="button" :disabled="mutating || !canSubmit" @click="openConfirmation">Ajukan ke dosen wali</button></div>
      </div>
    </section>

    <section v-if="showConfirmation" class="submission-overlay" role="dialog" aria-modal="true" aria-labelledby="submission-title">
      <div class="submission-dialog">
        <button class="submission-dialog__close" type="button" aria-label="Tutup konfirmasi" @click="showConfirmation = false"><i class="uil uil-times" aria-hidden="true" /></button>
        <span class="submission-dialog__icon"><i class="uil uil-message" aria-hidden="true" /></span>
        <span class="section-kicker">Konfirmasi pengajuan</span>
        <h2 id="submission-title">Ajukan {{ selectedCredits }} SKS kepada dosen wali?</h2>
        <p>Setelah diajukan, pilihan mata kuliah tidak dapat diubah sampai dosen wali memberikan keputusan atau mengembalikan KRS.</p>
        <dl class="detail-list my-3"><div><dt>Mahasiswa</dt><dd>{{ studentIdentity?.studentName }}</dd></div><div><dt>Mata kuliah</dt><dd>{{ selectedCount }} mata kuliah</dd></div><div><dt>Total beban</dt><dd>{{ selectedCredits }} SKS</dd></div></dl>
        <label class="declaration-check"><input v-model="acceptedDeclaration" class="form-check-input" type="checkbox"><span>Saya telah memeriksa pilihan kelas dan tidak menemukan bentrok jadwal.</span></label>
        <div class="d-grid grid-template-columns gap-2 mt-4"><button class="btn btn-outline-secondary" type="button" :disabled="mutating" @click="showConfirmation = false">Kembali periksa</button><button class="btn btn-primary" type="button" :disabled="!acceptedDeclaration || mutating" @click="submitKrs">{{ mutating ? 'Memproses...' : 'Ya, ajukan KRS' }}</button></div>
      </div>
    </section>
    </template>
  </div>
</template>

<style scoped src="~/pages/_workflow.css"></style>
<style scoped>
.credit-meter { display: grid; grid-template-columns: auto 1fr auto; gap: 1rem; align-items: center; }
.credit-meter__number { display: flex; align-items: baseline; gap: .25rem; white-space: nowrap; }
.credit-meter__number strong { color: #245241; font-size: 1.8rem; letter-spacing: -.04em; }
.credit-meter__number span,
.credit-meter > small { color: #788b83; font-size: .68rem; }
.credit-meter__track { height: .55rem; overflow: hidden; border-radius: 999px; background: #e8eeea; }
.credit-meter__track span { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, #27634f, #78a988); }
.eligibility-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: .75rem; }
.eligibility-grid > div { display: flex; gap: .55rem; padding: .75rem; border: 1px solid #e3eae6; border-radius: .75rem; background: #fafcfb; }
.eligibility-grid i { color: #4f8a71; }
.eligibility-grid strong,
.eligibility-grid small { display: block; }
.eligibility-grid strong { color: #345149; font-size: .7rem; }
.eligibility-grid small { margin-top: .15rem; color: #899690; font-size: .61rem; }
.course-checkbox { width: 1.05rem; height: 1.05rem; border-color: #a9bbb2; }
.course-checkbox:checked { border-color: #2f715a; background-color: #2f715a; }
.course-name strong,
.course-name small { display: block; }
.course-name strong { color: #2d4b42; font-size: .73rem; }
.course-name small { margin-top: .15rem; color: #8a9892; font-size: .61rem; }
.submission-overlay { position: fixed; z-index: 1080; inset: 0; display: grid; place-items: center; padding: 1rem; background: rgba(15, 38, 31, .58); backdrop-filter: blur(4px); }
.submission-dialog { position: relative; width: min(100%, 480px); padding: 1.5rem; border-radius: 1rem; background: #fff; box-shadow: 0 28px 80px rgba(9,34,26,.28); }
.submission-dialog__close { position: absolute; right: .8rem; top: .8rem; display: grid; place-items: center; width: 2rem; height: 2rem; border: 0; border-radius: .55rem; color: #6d7e78; background: #f1f5f2; }
.submission-dialog__icon { display: grid; place-items: center; width: 3rem; height: 3rem; margin-bottom: 1.2rem; border-radius: .85rem; color: #2d6954; background: #e5f2e9; font-size: 1.25rem; }
.submission-dialog h2 { margin: 0; color: #23483a; font-size: 1.25rem; }
.submission-dialog > p { margin: .55rem 0 0; color: #77877f; font-size: .72rem; line-height: 1.6; }
.declaration-check { display: flex; align-items: flex-start; gap: .6rem; padding: .75rem; border-radius: .7rem; color: #5f746c; background: #f5f8f6; font-size: .68rem; line-height: 1.45; }
.grid-template-columns { grid-template-columns: 1fr 1fr; }
@media (max-width: 767.98px) { .credit-meter { grid-template-columns: auto 1fr; } .credit-meter > small { grid-column: 1 / -1; } .eligibility-grid { grid-template-columns: 1fr; } }
</style>
