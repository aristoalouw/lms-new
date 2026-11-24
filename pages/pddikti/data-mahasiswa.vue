<script setup lang="ts">
import type {
  AcademicAdministrationWorkspace,
  AcademicPeriodDefinition,
  AcademicProgramStudy,
} from '~/server/types/academic-administration'
import type { PddiktiDiplomaEligibility, PddiktiStudentDataChangeItem, PddiktiStudentDataChangeRequest } from '~/server/types/pddikti'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'PDM dan Kelayakan Ijazah' })

const { $api } = useNuxtApp()
const config = useRuntimeConfig()
const { user } = useAuth()
const items = ref<PddiktiStudentDataChangeRequest[]>([])
const eligibility = ref<PddiktiDiplomaEligibility | null>(null)
const activeTab = ref<'pdm' | 'diploma'>('pdm')
const loading = ref(false)
const mutating = ref(false)
const errorMessage = ref('')
const noticeMessage = ref('')
const programs = ref<AcademicProgramStudy[]>([])
const periods = ref<AcademicPeriodDefinition[]>([])
const programStudyId = ref(config.public.demoMode ? 'management-s1' : user.value?.programStudyId || '')
const periodId = ref(config.public.demoMode ? '2025-2026-2' : '')
const form = reactive({
  studentId: config.public.demoMode ? 'student-001' : '',
  studentNumber: config.public.demoMode ? '23011001' : '',
  reason: '',
  field: 'birthPlace' as PddiktiStudentDataChangeItem['field'],
  previousValue: '',
  requestedValue: '',
  evidenceFileIds: '',
})
const reviewNote = ref(config.public.demoMode ? 'Dokumen bukti dan sumber data telah diperiksa.' : '')
const remoteTicket = ref('')

const activeRole = computed(() => user.value?.activeRole || user.value?.roles[0] || '')
const canMutate = computed(() => activeRole.value === 'academic_staff')
const statusLabel = (status: PddiktiStudentDataChangeRequest['status']) => ({ SUBMITTED: 'Diajukan', VALIDATED: 'Tervalidasi', QUEUED: 'Dalam proses PDDIKTI', COMPLETED: 'Selesai', REJECTED: 'Ditolak' })[status]
const statusTone = (status: PddiktiStudentDataChangeRequest['status']) => ({ SUBMITTED: 'pending', VALIDATED: 'scheduled', QUEUED: 'processing', COMPLETED: 'success', REJECTED: 'blocked' })[status]
const fieldLabel = (field: PddiktiStudentDataChangeItem['field']) => ({ name: 'Nama', birthPlace: 'Tempat lahir', birthDate: 'Tanggal lahir', gender: 'Jenis kelamin', identityNumber: 'Nomor identitas', motherName: 'Nama ibu' })[field]
const dateLabel = (value: string) => new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(value))
const key = (purpose: string) => `${purpose}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`
const errorText = (error: unknown) => {
  const value = error as { response?: { data?: { statusMessage?: string; message?: string } }; message?: string }
  return value.response?.data?.statusMessage || value.response?.data?.message || value.message || 'Permintaan PDDIKTI tidak dapat diproses.'
}

const loadCatalog = async () => {
  if (config.public.demoMode) return
  const { data } = await $api.get<AcademicAdministrationWorkspace>('/academic/administration')
  programs.value = data.programs.filter(program => program.active && !program.deletedAt)
  periods.value = data.periods.filter(period => period.active && !period.deletedAt)
  if (!programs.value.some(program => program.id === programStudyId.value)) {
    const scopedProgram = user.value?.programStudyId
    programStudyId.value = programs.value.find(program => program.id === scopedProgram)?.id
      || (programs.value.length === 1 ? programs.value[0]!.id : '')
  }
  if (!periods.value.some(period => period.id === periodId.value)) periodId.value = periods.value[0]?.id || ''
}

const load = async () => {
  if (!programStudyId.value) {
    items.value = []
    errorMessage.value = 'Pilih program studi dari master resmi.'
    return
  }
  loading.value = true; errorMessage.value = ''
  try {
    if (config.public.demoMode) await $api.post('/auth/demo-login', { profileId: 'admin' })
    const response = await $api.get<{ items: PddiktiStudentDataChangeRequest[] }>('/pddikti/student-data-changes', { params: { programStudyId: programStudyId.value } })
    items.value = response.data.items
  } catch (error) { errorMessage.value = errorText(error) } finally { loading.value = false }
}

const submit = async () => {
  if (!programStudyId.value || !periodId.value || !form.studentId.trim() || !form.studentNumber.trim()) {
    errorMessage.value = 'Pilih konteks akademik dan isi identitas mahasiswa dari data sumber.'
    return
  }
  mutating.value = true; errorMessage.value = ''; noticeMessage.value = ''
  try {
    await $api.post('/pddikti/student-data-changes', {
      studentId: form.studentId, studentNumber: form.studentNumber, programStudyId: programStudyId.value, periodId: periodId.value,
      reason: form.reason, changes: [{ field: form.field, previousValue: form.previousValue, requestedValue: form.requestedValue }],
      evidenceFileIds: [...new Set(form.evidenceFileIds.split(/[\s,]+/).filter(Boolean))],
    }, { headers: { 'Idempotency-Key': key('pddikti-pdm') } })
    noticeMessage.value = 'Permintaan perubahan data mahasiswa berhasil diajukan.'
    form.reason = ''; form.previousValue = ''; form.requestedValue = ''; form.evidenceFileIds = ''
    await load()
  } catch (error) { errorMessage.value = errorText(error) } finally { mutating.value = false }
}

const targets = (item: PddiktiStudentDataChangeRequest): PddiktiStudentDataChangeRequest['status'][] => ({
  SUBMITTED: ['VALIDATED', 'REJECTED'], VALIDATED: ['QUEUED', 'REJECTED'], QUEUED: ['COMPLETED', 'REJECTED'], COMPLETED: [], REJECTED: [],
})[item.status] as PddiktiStudentDataChangeRequest['status'][]
const transition = async (item: PddiktiStudentDataChangeRequest, status: PddiktiStudentDataChangeRequest['status']) => {
  if (!reviewNote.value.trim()) {
    errorMessage.value = 'Catatan peninjau wajib diisi berdasarkan pemeriksaan yang dilakukan.'
    return
  }
  mutating.value = true; errorMessage.value = ''; noticeMessage.value = ''
  try {
    await $api.post(`/pddikti/student-data-changes/${encodeURIComponent(item.id)}/transition`, { status, reviewNote: reviewNote.value, ...(status === 'COMPLETED' ? { remoteTicket: remoteTicket.value } : {}), expectedVersion: item.version })
    noticeMessage.value = `PDM diperbarui menjadi ${statusLabel(status).toLowerCase()}.`
    await load()
  } catch (error) { errorMessage.value = errorText(error) } finally { mutating.value = false }
}

const checkDiploma = async () => {
  if (!programStudyId.value || !periodId.value || !form.studentId.trim()) {
    errorMessage.value = 'Pilih konteks akademik dan isi ID mahasiswa dari data sumber.'
    return
  }
  loading.value = true; errorMessage.value = ''; eligibility.value = null
  try {
    const response = await $api.get<PddiktiDiplomaEligibility>('/pddikti/diploma-eligibility', { params: { studentId: form.studentId, programStudyId: programStudyId.value, periodId: periodId.value } })
    eligibility.value = response.data
  } catch (error) { errorMessage.value = errorText(error) } finally { loading.value = false }
}

const initialize = async () => {
  loading.value = true
  errorMessage.value = ''
  try {
    if (config.public.demoMode) {
      await load()
      return
    }
    await loadCatalog()
    if (programStudyId.value) await load()
    else errorMessage.value = 'Master program studi aktif belum tersedia.'
  } catch (error) {
    errorMessage.value = errorText(error)
  } finally {
    loading.value = false
  }
}

onMounted(initialize)
</script>

<template>
  <div class="page-stack pdm-page">
    <AppPageHeader eyebrow="Pelaporan PDDIKTI" title="Data mahasiswa dan ijazah" description="Kelola pengajuan perubahan data mahasiswa dan periksa kelengkapan PDDIKTI sebelum penerbitan ijazah.">
      <template #actions><NuxtLink class="btn btn-outline-secondary" to="/pddikti"><i class="uil uil-arrow-left me-2" />Kembali ke sinkronisasi</NuxtLink><button class="btn btn-primary" type="button" :disabled="loading" @click="initialize"><i class="uil uil-refresh me-2" />Muat ulang</button></template>
    </AppPageHeader>
    <div v-if="noticeMessage" class="alert alert-success" role="status">{{ noticeMessage }}</div><div v-if="errorMessage" class="alert alert-danger" role="alert">{{ errorMessage }}</div>

    <section class="context-bar"><div class="tab-strip"><button :class="{ active: activeTab === 'pdm' }" @click="activeTab = 'pdm'">Perubahan Data Mahasiswa</button><button :class="{ active: activeTab === 'diploma' }" @click="activeTab = 'diploma'">Kelayakan penomoran ijazah</button></div><label>Program studi<input v-if="config.public.demoMode" v-model="programStudyId" class="form-control form-control-sm"><select v-else v-model="programStudyId" class="form-select form-select-sm" required @change="load"><option value="" disabled>Pilih program resmi</option><option v-for="program in programs" :key="program.id" :value="program.id">{{ program.code }} · {{ program.name }}</option></select></label><label>Periode<input v-if="config.public.demoMode" v-model="periodId" class="form-control form-control-sm"><select v-else v-model="periodId" class="form-select form-select-sm" required><option value="" disabled>Pilih periode resmi</option><option v-for="period in periods" :key="period.id" :value="period.id">{{ period.academicYear }} · {{ period.term }}</option></select></label></section>
    <div v-if="loading" class="alert alert-info">Memuat data pelaporan...</div>

    <template v-if="activeTab === 'pdm'">
      <div class="pdm-grid">
        <section v-if="canMutate" class="surface-card form-card"><header><span>Permintaan baru</span><h2>Ajukan PDM</h2><p>Nilai identitas tidak ditulis ke audit metadata; audit hanya mencatat field yang berubah.</p></header><form @submit.prevent="submit"><div class="form-row"><label>ID mahasiswa<input v-model="form.studentId" class="form-control" required></label><label>NIM<input v-model="form.studentNumber" class="form-control" required></label></div><label>Field<select v-model="form.field" class="form-select"><option value="name">Nama</option><option value="birthPlace">Tempat lahir</option><option value="birthDate">Tanggal lahir</option><option value="gender">Jenis kelamin</option><option value="identityNumber">Nomor identitas</option><option value="motherName">Nama ibu</option></select></label><div class="form-row"><label>Nilai saat ini<input v-model="form.previousValue" class="form-control" required></label><label>Nilai diminta<input v-model="form.requestedValue" class="form-control" required></label></div><label>Alasan<textarea v-model="form.reason" class="form-control" rows="4" minlength="15" required /></label><label>ID berkas bukti privat <small>pisahkan koma</small><input v-model="form.evidenceFileIds" class="form-control" placeholder="Pilih ID berkas dari penyimpanan privat" required></label><button class="btn btn-primary" :disabled="mutating || !programStudyId || !periodId || !form.studentId || !form.studentNumber">Ajukan perubahan</button></form></section>
        <section class="surface-card pdm-list" :class="{ wide: !canMutate }"><header><span>Jejak keputusan</span><h2>Permintaan PDM</h2><p>Perubahan harus melalui validasi, antrean operator, dan tiket remote sebelum selesai.</p></header><div v-if="canMutate" class="review-controls"><input v-model="reviewNote" class="form-control" aria-label="Catatan peninjau"><input v-model="remoteTicket" class="form-control" placeholder="Tiket remote untuk penyelesaian" aria-label="Tiket remote"></div><article v-for="item in items" :key="item.id"><div class="pdm-copy"><div><strong>{{ item.studentNumber }} · {{ item.studentId }}</strong><StatusBadge :status="statusTone(item.status)" :label="statusLabel(item.status)" /></div><p>{{ item.reason }}</p><ul><li v-for="change in item.changes" :key="change.field"><strong>{{ fieldLabel(change.field) }}</strong><span>{{ change.previousValue }}</span><i class="uil uil-arrow-right" /><span>{{ change.requestedValue }}</span></li></ul><small>{{ item.evidenceFileIds.length }} bukti · versi {{ item.version }} · {{ dateLabel(item.updatedAt) }}</small><small v-if="item.reviewNote">Catatan: {{ item.reviewNote }}</small><small v-if="item.remoteTicket">Tiket remote: {{ item.remoteTicket }}</small></div><aside v-if="canMutate"><button v-for="target in targets(item)" :key="target" class="btn btn-sm" :disabled="mutating || (target === 'COMPLETED' && !remoteTicket)" :class="target === 'REJECTED' ? 'btn-outline-danger' : 'btn-outline-primary'" @click="transition(item, target)">{{ statusLabel(target) }}</button></aside></article><EmptyState v-if="!items.length" icon="uil-user-square" title="Belum ada PDM" description="Permintaan perubahan data dalam lingkup program studi akan tampil di sini." /></section>
      </div>
    </template>

    <template v-else>
      <section class="surface-card diploma-check"><header><span>Pemeriksaan point-in-time</span><h2>Kelayakan data dan penomoran ijazah</h2><p>Hasil tidak menerbitkan nomor; snapshot ini menjadi bukti sebelum modul kelulusan melakukan penomoran resmi.</p></header><form @submit.prevent="checkDiploma"><label>ID mahasiswa<input v-model="form.studentId" class="form-control" required></label><button class="btn btn-primary" :disabled="loading || !programStudyId || !periodId || !form.studentId">Periksa kelayakan</button></form></section>
      <section v-if="eligibility" class="surface-card eligibility-card" :class="{ eligible: eligibility.eligible }"><div class="eligibility-hero"><span><i class="uil" :class="eligibility.eligible ? 'uil-check-circle' : 'uil-exclamation-triangle'" /></span><div><small>{{ eligibility.studentNumber || eligibility.studentId }}</small><h2>{{ eligibility.eligible ? 'Layak melanjutkan penomoran' : 'Belum layak untuk penomoran' }}</h2><p>Snapshot {{ eligibility.snapshotHash.slice(0, 16) }}… · {{ dateLabel(eligibility.evaluatedAt) }}</p></div></div><div class="check-grid"><article v-for="check in eligibility.checks" :key="check.code" :class="{ passed: check.passed }"><i class="uil" :class="check.passed ? 'uil-check-circle' : 'uil-times-circle'" /><div><strong>{{ check.code }}</strong><p>{{ check.message }}</p></div></article></div></section>
    </template>
  </div>
</template>

<style scoped>
.pdm-page{display:grid;gap:1rem}.context-bar{display:flex;align-items:end;gap:.7rem;padding:.6rem;border:1px solid var(--campus-border);border-radius:.9rem;background:#fff}.tab-strip{display:flex;flex:1;gap:.25rem}.tab-strip button{padding:.55rem .75rem;border:0;border-radius:.6rem;color:#71847c;background:transparent;font-size:.63rem;font-weight:750}.tab-strip button.active{color:#fff;background:var(--campus-forest-700)}.context-bar label{display:grid;gap:.2rem;color:#7b8c85;font-size:.52rem}.pdm-grid{display:grid;grid-template-columns:minmax(300px,.72fr) minmax(0,1.28fr);gap:1rem;align-items:start}.surface-card{padding:1rem}.form-card header,.pdm-list>header,.diploma-check>header{margin-bottom:.85rem}.form-card header span,.pdm-list>header span,.diploma-check>header span{color:#aa7d24;font-size:.52rem;font-weight:800;text-transform:uppercase}.form-card h2,.pdm-list h2,.diploma-check h2{margin:.15rem 0;color:#315549;font-size:.9rem}.form-card header p,.pdm-list>header p,.diploma-check>header p{margin:0;color:#7b8b85;font-size:.58rem}.form-card form{display:grid;gap:.7rem}.form-card label,.diploma-check label{display:grid;gap:.3rem;color:#61766d;font-size:.58rem;font-weight:700}.form-card label small{color:#899690;font-weight:400}.form-row{display:grid;grid-template-columns:1fr 1fr;gap:.55rem}.form-control,.form-select{font-size:.68rem}.pdm-list.wide{grid-column:1/-1}.review-controls{display:grid;grid-template-columns:1fr 1fr;gap:.45rem;margin-bottom:.55rem}.pdm-list>article{display:flex;align-items:flex-start;justify-content:space-between;gap:.7rem;padding:.75rem 0}.pdm-list>article+article{border-top:1px solid var(--campus-border)}.pdm-copy{display:grid;flex:1;gap:.3rem}.pdm-copy>div{display:flex;align-items:center;justify-content:space-between;gap:.5rem}.pdm-copy strong{color:#385c4f;font-size:.65rem}.pdm-copy p{margin:0;color:#62776e;font-size:.59rem}.pdm-copy small{color:#86958e;font-size:.51rem}.pdm-copy ul{display:grid;gap:.25rem;margin:.15rem 0;padding:0;list-style:none}.pdm-copy li{display:grid;grid-template-columns:100px 1fr auto 1fr;gap:.35rem;align-items:center;padding:.35rem;border-radius:.4rem;background:#f5f8f6;font-size:.53rem}.pdm-copy li span{overflow:hidden;text-overflow:ellipsis}.pdm-list aside{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:.3rem}.diploma-check{display:flex;align-items:end;justify-content:space-between;gap:1rem}.diploma-check header{margin:0}.diploma-check form{display:flex;align-items:end;gap:.5rem;min-width:340px}.diploma-check label{flex:1}.eligibility-card{border-color:#efd5c9}.eligibility-card.eligible{border-color:#c9e3d4}.eligibility-hero{display:flex;align-items:center;gap:.75rem}.eligibility-hero>span{display:grid;width:2.8rem;height:2.8rem;place-items:center;border-radius:.8rem;color:#a95b45;background:#fff0eb;font-size:1.25rem}.eligible .eligibility-hero>span{color:#2d7658;background:#e6f5ed}.eligibility-hero small{color:#84938d;font-size:.52rem}.eligibility-hero h2{margin:.1rem 0;color:#36594d;font-size:.9rem}.eligibility-hero p{margin:0;color:#87948f;font-size:.51rem}.check-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:.55rem;margin-top:1rem}.check-grid article{display:flex;gap:.5rem;padding:.65rem;border:1px solid #eed9d0;border-radius:.65rem;color:#a35e48;background:#fff8f5}.check-grid article.passed{border-color:#d4e8dc;color:#32775a;background:#f3faf6}.check-grid strong{font-size:.55rem}.check-grid p{margin:.15rem 0 0;color:#71837b;font-size:.5rem}.check-grid i{font-size:.9rem}@media(max-width:991px){.pdm-grid{grid-template-columns:1fr}.diploma-check{align-items:stretch;flex-direction:column}.diploma-check form{min-width:0}.check-grid{grid-template-columns:repeat(2,1fr)}}@media(max-width:650px){.context-bar{align-items:stretch;flex-direction:column}.tab-strip{width:100%}.tab-strip button{flex:1}.context-bar label{width:100%}.form-row,.review-controls,.check-grid{grid-template-columns:1fr}.pdm-list>article,.diploma-check form{align-items:stretch;flex-direction:column}.pdm-list aside{justify-content:flex-start}.pdm-copy li{grid-template-columns:1fr}.pdm-copy li i{transform:rotate(90deg)}}
</style>
