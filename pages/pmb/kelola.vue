<script setup lang="ts">
import type { AdmissionApplicationView, AdmissionListResult, AdmissionProgram, AdmissionStatus, AdmissionWave } from '~/server/types/admissions'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Workflow Penerimaan Mahasiswa Baru' })

const { $api } = useNuxtApp()
const { can } = useAuth()
const config = useRuntimeConfig()
const applications = ref<AdmissionApplicationView[]>([])
const selectedId = ref('')
const nextCursor = ref<string | undefined>()
const loading = ref(false)
const working = ref(false)
const errorMessage = ref('')
const noticeMessage = ref('')
const notes = ref('')
const paymentReference = ref('')
const filters = reactive({ programStudyId: '', status: '', waveId: '' })
const programs = ref<AdmissionProgram[]>([])
const waves = ref<AdmissionWave[]>([])
const sessionReady = ref(false)

const selected = computed(() => applications.value.find(item => item.id === selectedId.value) || applications.value[0])
const statusLabels: Record<AdmissionStatus, string> = {
  SUBMITTED: 'Dikirim', UNDER_REVIEW: 'Dalam tinjauan', DOCUMENTS_VERIFIED: 'Berkas terverifikasi',
  ACCEPTED: 'Diterima', REJECTED: 'Ditolak', ENROLLMENT_PENDING_IDENTITY: 'Aktivasi identitas', ENROLLED: 'Mahasiswa aktif',
}
const statusTones: Record<AdmissionStatus, string> = {
  SUBMITTED: 'pending', UNDER_REVIEW: 'review', DOCUMENTS_VERIFIED: 'verified', ACCEPTED: 'active',
  REJECTED: 'blocked', ENROLLMENT_PENDING_IDENTITY: 'review', ENROLLED: 'verified',
}
const programLabels = computed<Record<string, string>>(() => Object.fromEntries(programs.value.map(program => [program.id, program.name])))
const waveLabels = computed<Record<string, string>>(() => Object.fromEntries(waves.value.map(wave => [wave.id, wave.label])))
const transition: Partial<Record<AdmissionStatus, AdmissionStatus>> = {
  SUBMITTED: 'UNDER_REVIEW', UNDER_REVIEW: 'DOCUMENTS_VERIFIED', DOCUMENTS_VERIFIED: 'ACCEPTED',
}
const columns = [
  { key: 'registrationNumber', label: 'Nomor', sortable: true },
  { key: 'fullName', label: 'Pendaftar', sortable: true },
  { key: 'program', label: 'Program studi' },
  { key: 'fee', label: 'Biaya' },
  { key: 'status', label: 'Status' },
  { key: 'updated', label: 'Diperbarui' },
  { key: 'actions', label: '', sortable: false, align: 'end' as const },
]
const rows = computed<Record<string, unknown>[]>(() => applications.value.map(item => ({
  ...item,
  program: programLabels.value[item.programStudyId] || item.programStudyId,
  fee: item.registrationFeeStatus,
  updated: new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(item.updatedAt)),
})))

const readableError = (error: unknown) => {
  const candidate = error as { response?: { data?: { statusMessage?: string; message?: string } }; message?: string }
  return candidate.response?.data?.statusMessage || candidate.response?.data?.message || candidate.message || 'Permintaan tidak dapat diselesaikan.'
}
const actionKey = (purpose: string) => `${purpose}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`

const ensureSession = async () => {
  if (sessionReady.value) return
  try {
    await $api.get('/auth/session')
  } catch (error) {
    if (!config.public.demoMode) throw error
    await $api.post('/auth/demo-login', { profileId: 'admin' })
  }
  sessionReady.value = true
}

const loadApplications = async (append = false) => {
  loading.value = true
  errorMessage.value = ''
  try {
    await ensureSession()
    if (!programs.value.length) {
      const catalog = await $api.get<{ programs: AdmissionProgram[]; waves: AdmissionWave[] }>('/admissions/catalog')
      programs.value = catalog.data.programs
      waves.value = catalog.data.waves
    }
    const { data } = await $api.get<AdmissionListResult>('/admissions/applications', {
      params: {
        ...(filters.programStudyId ? { programStudyId: filters.programStudyId } : {}),
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.waveId ? { waveId: filters.waveId } : {}),
        ...(append && nextCursor.value ? { cursor: nextCursor.value } : {}),
        limit: 50,
      },
    })
    applications.value = append ? [...applications.value, ...data.items] : data.items
    nextCursor.value = data.nextCursor
    if (!applications.value.some(item => item.id === selectedId.value)) selectedId.value = applications.value[0]?.id || ''
  } catch (error) {
    errorMessage.value = readableError(error)
  } finally {
    loading.value = false
  }
}

const runAction = async (action: () => Promise<void>, success: string) => {
  working.value = true
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    await action()
    noticeMessage.value = success
    await loadApplications()
  } catch (error) {
    errorMessage.value = readableError(error)
  } finally {
    working.value = false
  }
}

const advance = () => {
  if (!selected.value) return
  const next = transition[selected.value.status]
  if (!next) return
  return runAction(async () => {
    await $api.post(`/admissions/applications/${encodeURIComponent(selected.value!.id)}/review`, {
      status: next, expectedVersion: selected.value!.version, ...(notes.value.trim() ? { notes: notes.value.trim() } : {}),
    }, { headers: { 'Idempotency-Key': actionKey(`admission-review-${next.toLowerCase()}`) } })
    notes.value = ''
  }, `Status diperbarui menjadi ${statusLabels[next]}.`)
}

const reject = () => {
  if (!selected.value || !['UNDER_REVIEW', 'DOCUMENTS_VERIFIED'].includes(selected.value.status)) return
  if (!notes.value.trim()) {
    errorMessage.value = 'Alasan penolakan wajib dicatat.'
    return
  }
  return runAction(async () => {
    await $api.post(`/admissions/applications/${encodeURIComponent(selected.value!.id)}/review`, {
      status: 'REJECTED', expectedVersion: selected.value!.version, notes: notes.value.trim(),
    }, { headers: { 'Idempotency-Key': actionKey('admission-reject') } })
    notes.value = ''
  }, 'Pendaftaran ditolak dengan alasan yang tercatat.')
}

const markFee = () => {
  if (!selected.value) return
  const reference = paymentReference.value.trim()
  if (!reference) {
    errorMessage.value = 'Referensi pembayaran wajib diisi.'
    return
  }
  return runAction(async () => {
    await $api.post(`/admissions/applications/${encodeURIComponent(selected.value!.id)}/fee`, {
      status: 'PAID', externalReference: reference, expectedVersion: selected.value!.version,
    }, { headers: { 'Idempotency-Key': actionKey('admission-fee') } })
    paymentReference.value = ''
  }, 'Biaya pendaftaran ditandai lunas.')
}

const convert = () => {
  if (!selected.value) return
  const key = actionKey('admission-convert')
  return runAction(async () => {
    await $api.post(`/admissions/applications/${encodeURIComponent(selected.value!.id)}/convert`, {
      expectedVersion: selected.value!.version,
    }, { headers: { 'Idempotency-Key': key } })
  }, 'Pendaftar dikonversi menjadi mahasiswa aktif dan NIM telah dialokasikan.')
}

watch(() => [filters.programStudyId, filters.status, filters.waveId], () => loadApplications())
onMounted(() => loadApplications())
</script>

<template>
  <div class="page-stack" data-clarity-mask="true">
    <AppPageHeader eyebrow="Penerimaan mahasiswa baru" title="Kelola pendaftar" description="Tinjau berkas pendaftaran, verifikasi pembayaran, tetapkan hasil seleksi, dan aktifkan akun mahasiswa baru.">
      <template #actions><NuxtLink class="btn btn-outline-secondary" to="/pmb"><i class="uil uil-arrow-left me-2" />Ringkasan</NuxtLink><button class="btn btn-primary" type="button" :disabled="loading" @click="loadApplications()"><i class="uil uil-refresh me-2" />Muat ulang</button></template>
    </AppPageHeader>

    <div v-if="noticeMessage" class="alert alert-success mb-0" role="status">{{ noticeMessage }}</div>
    <div v-if="errorMessage" class="alert alert-danger mb-0" role="alert">{{ errorMessage }}</div>

    <section class="workflow-toolbar" aria-label="Filter pendaftar">
      <div class="workflow-toolbar__meta"><i class="uil uil-user-check" /><div><strong>{{ applications.length }} pendaftar dimuat</strong><small>Identitas penuh hanya tampil bagi petugas dalam lingkup program studi.</small></div></div>
      <div class="workflow-toolbar__filters">
        <label><span>Program studi</span><select v-model="filters.programStudyId" class="form-select form-select-sm"><option value="">Semua lingkup</option><option v-for="(label, id) in programLabels" :key="id" :value="id">{{ label }}</option></select></label>
        <label><span>Gelombang</span><select v-model="filters.waveId" class="form-select form-select-sm"><option value="">Semua gelombang</option><option v-for="(label, id) in waveLabels" :key="id" :value="id">{{ label }}</option></select></label>
        <label><span>Status</span><select v-model="filters.status" class="form-select form-select-sm"><option value="">Semua status</option><option v-for="(label, status) in statusLabels" :key="status" :value="status">{{ label }}</option></select></label>
      </div>
    </section>

    <section class="workflow-surface">
      <header class="workflow-surface__header"><div><span class="section-kicker">Antrean operasional</span><h2>Pendaftaran tersimpan</h2><p>Setiap perubahan status memakai versi optimistis dan jejak audit server.</p></div></header>
      <DataTable :columns="columns" :rows="rows" :page-size="10" search-placeholder="Cari nomor, nama, atau program…" empty-title="Belum ada pendaftaran" empty-description="Pendaftaran baru akan muncul setelah formulir publik berhasil disimpan.">
        <template #cell-registrationNumber="{ value }"><strong>{{ value }}</strong></template>
        <template #cell-fullName="{ row, value }"><button class="applicant-link" type="button" @click="selectedId = String(row.id)">{{ value }}</button><small>{{ row.email }}</small></template>
        <template #cell-fee="{ value }"><StatusBadge :status="value === 'PAID' || value === 'WAIVED' ? 'verified' : 'pending'" :label="String(value)" /></template>
        <template #cell-status="{ value }"><StatusBadge :status="statusTones[value as AdmissionStatus]" :label="statusLabels[value as AdmissionStatus]" /></template>
        <template #cell-actions="{ row }"><button class="btn btn-sm btn-outline-secondary" type="button" @click="selectedId = String(row.id)">Tinjau</button></template>
      </DataTable>
      <div v-if="nextCursor" class="workflow-surface__footer"><button class="btn btn-sm btn-outline-secondary" type="button" :disabled="loading" @click="loadApplications(true)">Muat halaman berikutnya</button></div>
    </section>

    <section v-if="selected" class="workflow-surface">
      <header class="workflow-surface__header"><div><span class="section-kicker">{{ selected.registrationNumber }}</span><h2>{{ selected.fullName }}</h2><p>{{ programLabels[selected.programStudyId] || selected.programStudyId }} · {{ waveLabels[selected.waveId] || selected.waveId }} · {{ selected.email }} · identitas berakhir {{ selected.identityLast4 }}</p></div><StatusBadge :status="statusTones[selected.status]" :label="statusLabels[selected.status]" /></header>
      <div class="workflow-surface__body">
        <div class="detail-grid">
          <div><span>Jalur / sistem</span><strong>{{ selected.admissionPathId }} · {{ selected.studyModeId }}</strong></div><div><span>Asal institusi</span><strong>{{ selected.priorInstitution }}</strong></div><div><span>Biaya formulir</span><strong>{{ selected.registrationFeeStatus }} · Rp {{ selected.registrationFeeAmount.toLocaleString('id-ID') }}</strong></div><div><span>Akun tertaut</span><strong>{{ selected.applicantUid || 'Belum ditautkan' }}</strong></div><div><span>NIM</span><strong>{{ selected.studentNumber || 'Belum dialokasikan' }}</strong></div><div><span>Versi</span><strong>{{ selected.version }}</strong></div>
        </div>
        <label class="form-label mt-4"><span>Catatan tinjauan / alasan penolakan</span><textarea v-model="notes" class="form-control" rows="3" maxlength="1000" /></label>
        <div v-if="selected.registrationFeeStatus === 'UNPAID' && can('payments:record')" class="input-group mt-3"><span class="input-group-text">Referensi bayar</span><input v-model.trim="paymentReference" class="form-control" maxlength="120" placeholder="Contoh: VA-2026-000123"><button class="btn btn-outline-primary" type="button" :disabled="working" @click="markFee">Tandai lunas</button></div>
        <div class="action-row mt-4">
          <NuxtLink class="btn btn-outline-secondary" :to="`/pmb/dokumen?applicationId=${encodeURIComponent(selected.id)}`"><i class="uil uil-file-check-alt me-2" />Verifikasi dokumen</NuxtLink>
          <button v-if="transition[selected.status]" class="btn btn-primary" type="button" :disabled="working" @click="advance">Lanjut ke {{ statusLabels[transition[selected.status]!] }}</button>
          <button v-if="['UNDER_REVIEW','DOCUMENTS_VERIFIED'].includes(selected.status)" class="btn btn-outline-danger" type="button" :disabled="working" @click="reject">Tolak</button>
          <button v-if="selected.status === 'ACCEPTED'" class="btn btn-primary" type="button" :disabled="working || selected.registrationFeeStatus === 'UNPAID' || !selected.applicantUid" @click="convert"><i class="uil uil-graduation-cap me-2" />Konversi & alokasikan NIM</button>
        </div>
        <p v-if="selected.status === 'ACCEPTED' && (!selected.applicantUid || selected.registrationFeeStatus === 'UNPAID')" class="form-text mt-2">Konversi dibuka setelah akun applicant tertaut dan biaya pendaftaran berstatus PAID/WAIVED.</p>
      </div>
    </section>
  </div>
</template>

<style scoped src="~/pages/_workflow.css"></style>
<style scoped>
.applicant-link { display: block; padding: 0; border: 0; color: #245c49; background: transparent; font-weight: 800; text-align: left; }.applicant-link + small { display: block; margin-top: .15rem; color: #81918b; font-size: .62rem; }
.detail-grid { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: .8rem; }.detail-grid > div { display: grid; gap: .25rem; padding: .8rem; border: 1px solid #e3ebe6; border-radius: .75rem; background: #f8faf8; }.detail-grid span,.form-label span { color: #7a8c85; font-size: .62rem; }.detail-grid strong { color: #29483d; font-size: .74rem; overflow-wrap: anywhere; }.form-label { display: grid; gap: .4rem; }.action-row { display: flex; flex-wrap: wrap; gap: .6rem; }
@media (max-width: 767.98px) { .detail-grid { grid-template-columns: 1fr; } }
</style>
