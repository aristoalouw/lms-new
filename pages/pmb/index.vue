<script setup lang="ts">
import type {
  AdmissionApplicationView,
  AdmissionListResult,
  AdmissionProgram,
  AdmissionStatus,
  AdmissionWave,
} from '~/server/types/admissions'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Penerimaan Mahasiswa Baru' })

interface AdmissionCatalogResponse {
  programs: AdmissionProgram[]
  waves: AdmissionWave[]
}

const { $api } = useNuxtApp()
const applications = ref<AdmissionApplicationView[]>([])
const programs = ref<AdmissionProgram[]>([])
const waves = ref<AdmissionWave[]>([])
const selectedWaveId = ref('')
const selectedProgramId = ref('')
const selectedApplicantId = ref('')
const nextCursor = ref<string>()
const loading = ref(true)
const errorMessage = ref('')
const initialized = ref(false)

const statusLabels: Record<AdmissionStatus, string> = {
  SUBMITTED: 'Dikirim',
  UNDER_REVIEW: 'Dalam tinjauan',
  DOCUMENTS_VERIFIED: 'Berkas terverifikasi',
  ACCEPTED: 'Diterima',
  REJECTED: 'Ditolak',
  ENROLLMENT_PENDING_IDENTITY: 'Menunggu aktivasi',
  ENROLLED: 'Mahasiswa aktif',
}

const pathLabels: Record<string, string> = {
  regular: 'Reguler',
  'kip-college': 'KIP Kuliah',
  transfer: 'Pindahan',
  rpl: 'RPL',
}

const applicantColumns = [
  { key: 'registrationNumber', label: 'Nomor pendaftaran', sortable: true },
  { key: 'fullName', label: 'Calon mahasiswa', sortable: true },
  { key: 'program', label: 'Program studi', sortable: true },
  { key: 'path', label: 'Jalur' },
  { key: 'submitted', label: 'Dikirim' },
  { key: 'fee', label: 'Biaya' },
  { key: 'statusLabel', label: 'Status' },
]

const selectedWave = computed(() => waves.value.find(item => item.id === selectedWaveId.value))
const selectedApplicant = computed(() => (
  applications.value.find(item => item.id === selectedApplicantId.value) || applications.value[0]
))
const programName = (id: string) => programs.value.find(item => item.id === id)?.name || id
const formatDate = (value: string) => new Intl.DateTimeFormat('id-ID', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Jakarta',
}).format(new Date(value))
const formatMoney = (value: number) => new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0,
}).format(value)

const rows = computed(() => applications.value.map(item => ({
  ...item,
  program: programName(item.programStudyId),
  path: pathLabels[item.admissionPathId] || item.admissionPathId,
  submitted: formatDate(item.submittedAt),
  fee: item.registrationFeeStatus === 'PAID'
    ? 'Lunas'
    : item.registrationFeeStatus === 'WAIVED' ? 'Dibebaskan' : 'Belum dibayar',
  statusLabel: statusLabels[item.status],
})))

const totalLabel = computed(() => `${applications.value.length}${nextCursor.value ? '+' : ''}`)
const waitingReview = computed(() => applications.value.filter(item => (
  item.status === 'SUBMITTED' || item.status === 'UNDER_REVIEW'
)).length)
const accepted = computed(() => applications.value.filter(item => (
  item.status === 'ACCEPTED'
  || item.status === 'ENROLLMENT_PENDING_IDENTITY'
  || item.status === 'ENROLLED'
)).length)
const enrolled = computed(() => applications.value.filter(item => item.status === 'ENROLLED').length)
const paidRevenue = computed(() => applications.value
  .filter(item => item.registrationFeeStatus === 'PAID')
  .reduce((total, item) => total + item.registrationFeeAmount, 0))

const stats = computed(() => [
  { label: 'Pendaftar pada filter', value: totalLabel.value, detail: nextCursor.value ? 'Menampilkan 100 record terbaru' : 'Data Firebase aktual', tone: 'forest' },
  { label: 'Menunggu tinjauan', value: String(waitingReview.value), detail: 'Dikirim atau sedang ditinjau', tone: 'amber' },
  { label: 'Diterima', value: String(accepted.value), detail: 'Termasuk aktivasi dan enrolment', tone: 'blue' },
  { label: 'Pembayaran formulir', value: formatMoney(paidRevenue.value), detail: 'Hanya transaksi berstatus PAID', tone: 'slate' },
] as const)

const funnel = computed(() => {
  const total = applications.value.length
  const countAt = (statuses: AdmissionStatus[]) => applications.value.filter(item => statuses.includes(item.status)).length
  const stages = [
    { label: 'Formulir dikirim', value: total },
    { label: 'Pembayaran terverifikasi', value: applications.value.filter(item => item.registrationFeeStatus === 'PAID').length },
    { label: 'Berkas terverifikasi', value: countAt(['DOCUMENTS_VERIFIED', 'ACCEPTED', 'ENROLLMENT_PENDING_IDENTITY', 'ENROLLED']) },
    { label: 'Diterima', value: countAt(['ACCEPTED', 'ENROLLMENT_PENDING_IDENTITY', 'ENROLLED']) },
    { label: 'Menjadi mahasiswa', value: enrolled.value },
  ]
  return stages.map(stage => ({
    ...stage,
    percent: total ? Math.round(stage.value / total * 100) : 0,
  }))
})

const readableError = (error: unknown) => {
  const candidate = error as { response?: { data?: { statusMessage?: string; message?: string } }; message?: string }
  return candidate.response?.data?.statusMessage
    || candidate.response?.data?.message
    || candidate.message
    || 'Data penerimaan belum dapat dimuat.'
}

const badgeStatus = (status: string) => {
  if (['Berkas terverifikasi', 'Diterima', 'Mahasiswa aktif'].includes(status)) return 'verified'
  if (status === 'Ditolak') return 'blocked'
  if (status === 'Dalam tinjauan' || status === 'Menunggu aktivasi') return 'review'
  return 'pending'
}

async function loadApplications() {
  loading.value = true
  errorMessage.value = ''
  try {
    const { data } = await $api.get<AdmissionListResult>('/admissions/applications', {
      params: {
        ...(selectedWaveId.value ? { waveId: selectedWaveId.value } : {}),
        ...(selectedProgramId.value ? { programStudyId: selectedProgramId.value } : {}),
        limit: 100,
      },
    })
    applications.value = data.items
    nextCursor.value = data.nextCursor
    if (!applications.value.some(item => item.id === selectedApplicantId.value)) {
      selectedApplicantId.value = applications.value[0]?.id || ''
    }
  } catch (error) {
    applications.value = []
    nextCursor.value = undefined
    errorMessage.value = readableError(error)
  } finally {
    loading.value = false
  }
}

async function initializeDashboard() {
  loading.value = true
  errorMessage.value = ''
  try {
    const { data } = await $api.get<AdmissionCatalogResponse>('/admissions/catalog')
    programs.value = data.programs.filter(item => item.active)
    waves.value = data.waves.filter(item => item.active)
    const current = Date.now()
    selectedWaveId.value = waves.value.find(item => (
      Date.parse(item.opensAt) <= current && current <= Date.parse(item.closesAt)
    ))?.id || waves.value[0]?.id || ''
    initialized.value = true
    await loadApplications()
  } catch (error) {
    errorMessage.value = readableError(error)
    loading.value = false
  }
}

watch([selectedWaveId, selectedProgramId], async (_value, oldValue) => {
  if (initialized.value && oldValue !== undefined) await loadApplications()
})

onMounted(initializeDashboard)
</script>

<template>
  <div class="page-stack">
    <AppPageHeader
      eyebrow="Akuisisi mahasiswa"
      title="Penerimaan Mahasiswa Baru"
      description="Pantau pendaftaran, verifikasi berkas, hasil seleksi, dan proses aktivasi mahasiswa dari data Firebase."
      :status="selectedWave ? 'active' : 'pending'"
      :status-label="selectedWave?.label || 'Belum ada gelombang aktif'"
    >
      <template #actions>
        <NuxtLink class="btn btn-outline-secondary" to="/pmb/status"><i class="uil uil-search me-2" aria-hidden="true" />Status saya</NuxtLink>
        <NuxtLink class="btn btn-outline-secondary" to="/pmb/dokumen"><i class="uil uil-file-check-alt me-2" aria-hidden="true" />Dokumen saya</NuxtLink>
        <NuxtLink class="btn btn-outline-primary" to="/pmb/seleksi"><i class="uil uil-calendar-alt me-2" aria-hidden="true" />Seleksi & LoA</NuxtLink>
        <NuxtLink class="btn btn-primary" to="/pmb/kelola"><i class="uil uil-user-check me-2" aria-hidden="true" />Kelola workflow</NuxtLink>
      </template>
    </AppPageHeader>

    <div v-if="errorMessage" class="alert alert-danger" role="alert">{{ errorMessage }}</div>

    <section class="workflow-toolbar" aria-label="Filter PMB">
      <div class="workflow-toolbar__meta">
        <i class="uil uil-database" aria-hidden="true" />
        <div><strong>Data penerimaan aktual</strong><small>Angka berasal dari record Firebase, tanpa data contoh.</small></div>
      </div>
      <div class="workflow-toolbar__filters">
        <label><span>Gelombang</span>
          <select v-model="selectedWaveId" class="form-select form-select-sm" :disabled="loading">
            <option value="">Semua gelombang</option>
            <option v-for="wave in waves" :key="wave.id" :value="wave.id">{{ wave.label }} · {{ wave.academicYear }}</option>
          </select>
        </label>
        <label><span>Program studi</span>
          <select v-model="selectedProgramId" class="form-select form-select-sm" :disabled="loading">
            <option value="">Semua program studi</option>
            <option v-for="program in programs" :key="program.id" :value="program.id">{{ program.name }}</option>
          </select>
        </label>
      </div>
    </section>

    <section class="row g-3" aria-label="Ringkasan PMB">
      <div v-for="stat in stats" :key="stat.label" class="col-sm-6 col-xl-3">
        <StatCard :label="stat.label" :value="stat.value" :detail="stat.detail" :tone="stat.tone" />
      </div>
    </section>

    <section v-if="selectedWave" class="context-banner">
      <div class="context-banner__copy">
        <span class="context-banner__icon"><i class="uil uil-calendar-alt" aria-hidden="true" /></span>
        <div>
          <span class="section-kicker">Periode penerimaan</span>
          <h2>{{ selectedWave.label }} · {{ selectedWave.academicYear }}</h2>
          <p>{{ formatDate(selectedWave.opensAt) }} sampai {{ formatDate(selectedWave.closesAt) }}. Biaya formulir {{ formatMoney(selectedWave.registrationFee) }}.</p>
        </div>
      </div>
      <div class="context-banner__aside">
        <strong>{{ totalLabel }}</strong><small>pendaftar pada filter</small>
      </div>
    </section>

    <section class="row g-4">
      <div class="col-12 col-xl-7">
        <article class="workflow-surface h-100">
          <header class="workflow-surface__header workflow-surface__header--plain">
            <div><span class="section-kicker">Konversi PMB</span><h2>Funnel pendaftaran</h2><p>Dihitung dari status record pada filter aktif.</p></div>
          </header>
          <div class="workflow-surface__body">
            <div v-if="loading" class="placeholder-glow"><span class="placeholder col-12" /><span class="placeholder col-10 mt-3" /></div>
            <div v-else-if="!applications.length" class="empty-inline">Belum ada data pendaftar pada filter ini.</div>
            <div v-else class="funnel-stack">
              <div v-for="stage in funnel" :key="stage.label" class="funnel-step">
                <div class="funnel-step__label"><span>{{ stage.label }}</span><strong>{{ stage.value }}</strong></div>
                <div class="funnel-step__bar" aria-hidden="true"><span :style="{ width: `${stage.percent}%` }" /></div>
                <small>{{ stage.percent }}%</small>
              </div>
            </div>
          </div>
        </article>
      </div>

      <div class="col-12 col-xl-5">
        <article class="workflow-surface h-100">
          <header class="workflow-surface__header workflow-surface__header--plain">
            <div><span class="section-kicker">Status aktual</span><h2>Ringkasan proses</h2><p>Tidak menampilkan tren atau perbandingan yang belum tersedia.</p></div>
          </header>
          <div class="workflow-surface__body">
            <dl class="detail-list">
              <div><dt>Formulir pada filter</dt><dd>{{ totalLabel }}</dd></div>
              <div><dt>Menunggu tinjauan</dt><dd>{{ waitingReview }}</dd></div>
              <div><dt>Diterima</dt><dd>{{ accepted }}</dd></div>
              <div><dt>Menjadi mahasiswa</dt><dd>{{ enrolled }}</dd></div>
              <div><dt>Pembayaran formulir terverifikasi</dt><dd>{{ formatMoney(paidRevenue) }}</dd></div>
            </dl>
          </div>
        </article>
      </div>
    </section>

    <section class="row g-4 align-items-stretch">
      <div class="col-12 col-xl-9">
        <article class="workflow-surface h-100">
          <header class="workflow-surface__header">
            <div><span class="section-kicker">Antrean verifikasi</span><h2>Pendaftar terbaru</h2><p>Pilih nomor pendaftaran untuk melihat ringkasan record.</p></div>
            <button class="btn btn-sm btn-outline-secondary" type="button" :disabled="loading" @click="loadApplications"><i class="uil uil-refresh me-1" aria-hidden="true" />Muat ulang</button>
          </header>
          <DataTable
            :columns="applicantColumns"
            :rows="rows"
            :page-size="10"
            search-placeholder="Cari nama atau nomor pendaftaran…"
            empty-title="Tidak ada pendaftar"
            empty-description="Belum ada record nyata yang cocok dengan filter saat ini."
          >
            <template #cell-registrationNumber="{ value, row }">
              <button class="table-id-button" type="button" @click="selectedApplicantId = String(row.id)">{{ value }}</button>
            </template>
            <template #cell-statusLabel="{ value }">
              <StatusBadge :status="badgeStatus(String(value))" :label="String(value)" />
            </template>
          </DataTable>
        </article>
      </div>

      <div class="col-12 col-xl-3">
        <aside v-if="selectedApplicant" class="workflow-surface applicant-panel h-100" aria-label="Ringkasan pendaftar terpilih">
          <div class="applicant-panel__hero">
            <span class="applicant-avatar" aria-hidden="true">{{ selectedApplicant.fullName.split(' ').map(part => part[0]).slice(0, 2).join('') }}</span>
            <h2>{{ selectedApplicant.fullName }}</h2>
            <p>{{ selectedApplicant.registrationNumber }}</p>
            <StatusBadge :status="badgeStatus(statusLabels[selectedApplicant.status])" :label="statusLabels[selectedApplicant.status]" />
          </div>
          <div class="workflow-surface__body pt-3">
            <dl class="detail-list">
              <div><dt>Program studi</dt><dd>{{ programName(selectedApplicant.programStudyId) }}</dd></div>
              <div><dt>Jalur masuk</dt><dd>{{ pathLabels[selectedApplicant.admissionPathId] || selectedApplicant.admissionPathId }}</dd></div>
              <div><dt>Status biaya</dt><dd>{{ selectedApplicant.registrationFeeStatus }}</dd></div>
              <div><dt>Dikirim</dt><dd>{{ formatDate(selectedApplicant.submittedAt) }}</dd></div>
              <div><dt>Diperbarui</dt><dd>{{ formatDate(selectedApplicant.updatedAt) }}</dd></div>
            </dl>
            <NuxtLink class="btn btn-primary w-100 mt-4" :to="`/pmb/kelola?applicationId=${encodeURIComponent(selectedApplicant.id)}`">Tinjau pendaftar</NuxtLink>
          </div>
        </aside>
      </div>
    </section>
  </div>
</template>

<style scoped src="~/pages/_workflow.css"></style>
<style scoped>
.empty-inline { padding: 1.5rem; border: 1px dashed #d5dfda; border-radius: .8rem; color: #73817c; text-align: center; }
.table-id-button { padding: 0; border: 0; color: #2f6e58; background: transparent; font-size: inherit; font-weight: 800; text-decoration: underline; text-decoration-color: #b8d0c4; text-underline-offset: .2rem; }
.applicant-panel__hero { display: grid; justify-items: center; padding: 1.4rem 1rem 1.2rem; border-bottom: 1px solid #e9efeb; text-align: center; background: linear-gradient(180deg, #edf5ef, #fff); }
.applicant-avatar { display: grid; place-items: center; width: 3.2rem; height: 3.2rem; border: 3px solid #fff; border-radius: 50%; color: #285d4a; background: #cee5d4; font-size: .9rem; font-weight: 800; box-shadow: 0 5px 16px rgba(35,76,60,.12); }
.applicant-panel__hero h2 { margin: .8rem 0 .18rem; color: #29473e; font-size: .88rem; }
.applicant-panel__hero p { margin: 0 0 .55rem; color: #87948f; font-size: .67rem; }
</style>
