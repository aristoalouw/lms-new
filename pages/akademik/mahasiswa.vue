<script setup lang="ts">
import type { AcademicAdministrationWorkspace } from '~/server/types/academic-administration'
import type { BulkStudentOnboardingResult, StudentOnboardingRecord, StudentOnboardingResult, StudentOnboardingSnapshot } from '~/server/types/student-onboarding'
import { BULK_STUDENT_ONBOARDING_HEADERS } from '~/shared/contracts/student-onboarding'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Onboarding Mahasiswa' })

const { $api } = useNuxtApp()
const { user } = useAuth()
const catalog = ref<AcademicAdministrationWorkspace | null>(null)
const loading = ref(true)
const working = ref(false)
const lookupId = ref('')
const errorMessage = ref('')
const noticeMessage = ref('')
const bulkContent = ref('')
const bulkSourceName = ref('onboarding-mahasiswa.csv')
const bulkFormat = ref<'csv' | 'tsv'>('csv')
const bulkWorking = ref(false)
const bulkRequestKey = ref('')
const bulkResult = ref<BulkStudentOnboardingResult | null>(null)
const canBulkOnboard = computed(() => Boolean(user.value?.roles.includes('administrator') && user.value?.roles.includes('academic_staff')))
const bulkFailures = computed(() => bulkResult.value?.rows.filter(row => row.status === 'FAILED') || [])

const freshForm = () => ({
  accountId: '', accountEmail: '', studentId: '', studentNumber: '', programStudyId: '', cohortYear: new Date().getFullYear(),
  advisorId: '', advisorEmail: '', currentPeriodId: '', curriculumVersionId: '', status: 'ACTIVE', pathway: 'REGULAR',
  partnerInstitution: '', originInstitution: '', maximumCredits: 24, registeredCredits: 0, totalEarnedCredits: 0,
  cumulativeGpa: 0, completedCourseCodes: '', reason: '', expectedVersion: 0,
})
const form = reactive(freshForm())
const editing = computed(() => Boolean(form.accountId))
const selectedProgram = computed(() => catalog.value?.programs.find(item => item.id === form.programStudyId))
const eligibleCurricula = computed(() => catalog.value?.curricula.filter(item => item.programStudyId === form.programStudyId && item.status === 'ACTIVE') || [])
const activePeriods = computed(() => catalog.value?.periods.filter(item => item.active) || [])
const requestKey = () => `student-onboarding:${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`
const codes = (value: string) => [...new Set(value.split(/[\s,;|]+/).map(item => item.trim().toUpperCase()).filter(Boolean))]
const apiError = (error: unknown) => { const value = error as { response?: { data?: { statusMessage?: string; message?: string } }; message?: string }; return value.response?.data?.statusMessage || value.response?.data?.message || value.message || 'Onboarding mahasiswa tidak dapat diproses.' }

function resetBulkRequest() {
  bulkRequestKey.value = ''
  bulkResult.value = null
}

function downloadBulkTemplate() {
  const delimiter = bulkFormat.value === 'csv' ? ',' : '\t'
  const blob = new Blob([`${BULK_STUDENT_ONBOARDING_HEADERS.join(delimiter)}\n`], { type: bulkFormat.value === 'csv' ? 'text/csv;charset=utf-8' : 'text/tab-separated-values;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `template-onboarding-mahasiswa.${bulkFormat.value}`
  anchor.click()
  URL.revokeObjectURL(url)
}

async function loadBulkFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  errorMessage.value = ''; noticeMessage.value = ''
  if (file.size > 1024 * 1024) {
    errorMessage.value = 'Berkas bulk onboarding melebihi batas 1 MB.'
    input.value = ''
    return
  }
  const extension = file.name.split('.').at(-1)?.toLowerCase()
  if (extension !== 'csv' && extension !== 'tsv') {
    errorMessage.value = 'Gunakan berkas .csv atau .tsv.'
    input.value = ''
    return
  }
  bulkFormat.value = extension
  bulkSourceName.value = file.name
  bulkContent.value = await file.text()
  resetBulkRequest()
}

async function runBulkOnboarding() {
  if (!canBulkOnboard.value || !bulkContent.value.trim()) return
  bulkWorking.value = true; errorMessage.value = ''; noticeMessage.value = ''; bulkResult.value = null
  try {
    if (!bulkRequestKey.value) bulkRequestKey.value = requestKey().replace('student-onboarding:', 'student-onboarding-bulk:')
    const { data } = await $api.post<BulkStudentOnboardingResult>('/academic/students/onboard-bulk', {
      sourceName: bulkSourceName.value,
      format: bulkFormat.value,
      content: bulkContent.value,
    }, { headers: { 'Idempotency-Key': bulkRequestKey.value } })
    bulkResult.value = data
    noticeMessage.value = `${data.onboarded} mahasiswa berhasil di-onboard, ${data.replayed} replay aman, dan ${data.failed} gagal.`
  } catch (error) { errorMessage.value = apiError(error) }
  finally { bulkWorking.value = false }
}

watch([bulkContent, bulkSourceName, bulkFormat], resetBulkRequest)

async function loadCatalog() {
  loading.value = true; errorMessage.value = ''
  try { catalog.value = (await $api.get<AcademicAdministrationWorkspace>('/academic/administration')).data }
  catch (error) { errorMessage.value = apiError(error) }
  finally { loading.value = false }
}

function useRecord(record: StudentOnboardingRecord) {
  Object.assign(form, {
    accountId: record.profile.studentUid, accountEmail: '', studentId: record.profile.studentId,
    studentNumber: record.profile.studentNumber, programStudyId: record.profile.programStudyId,
    cohortYear: record.profile.cohortYear, advisorId: record.profile.advisorId, advisorEmail: '',
    currentPeriodId: record.profile.currentPeriodId, curriculumVersionId: record.profile.curriculumVersionId,
    status: record.profile.status, pathway: record.profile.pathway,
    partnerInstitution: record.profile.partnerInstitution || '', originInstitution: record.profile.originInstitution || '',
    maximumCredits: record.krsState.maximumCredits, registeredCredits: record.billingProfile.registeredCredits,
    totalEarnedCredits: record.profile.totalEarnedCredits, cumulativeGpa: record.profile.cumulativeGpa,
    completedCourseCodes: record.krsState.completedCourseCodes.join(', '), reason: '', expectedVersion: record.profile.version,
  })
  lookupId.value = record.profile.studentId
}

function useSnapshot(record: StudentOnboardingSnapshot, studentId: string) {
  const identity = record.profile || record.krsState || record.billingProfile
  if (!identity) return
  const profile = record.profile
  const krsState = record.krsState
  const billingProfile = record.billingProfile
  Object.assign(form, {
    accountId: profile?.studentUid || krsState?.studentUid || billingProfile?.studentUid || '', accountEmail: '',
    studentId, studentNumber: profile?.studentNumber || krsState?.studentNumber || billingProfile?.studentNumber || '',
    programStudyId: profile?.programStudyId || krsState?.programStudyId || billingProfile?.programStudyId || '',
    cohortYear: profile?.cohortYear || billingProfile?.cohortYear || new Date().getFullYear(),
    advisorId: profile?.advisorId || krsState?.advisorId || '', advisorEmail: '',
    currentPeriodId: profile?.currentPeriodId || billingProfile?.currentPeriodId || '',
    curriculumVersionId: profile?.curriculumVersionId || '', status: profile?.status || billingProfile?.enrollmentStatus || (krsState?.active ? 'ACTIVE' : 'INACTIVE'),
    pathway: profile?.pathway || 'REGULAR', partnerInstitution: profile?.partnerInstitution || '', originInstitution: profile?.originInstitution || '',
    maximumCredits: krsState?.maximumCredits ?? 24, registeredCredits: billingProfile?.registeredCredits ?? 0,
    totalEarnedCredits: profile?.totalEarnedCredits ?? 0, cumulativeGpa: profile?.cumulativeGpa ?? 0,
    completedCourseCodes: krsState?.completedCourseCodes.join(', ') || '', reason: '', expectedVersion: profile?.version ?? 0,
  })
  lookupId.value = studentId
}

async function lookup() {
  if (!lookupId.value.trim()) return
  working.value = true; errorMessage.value = ''; noticeMessage.value = ''
  try { const studentId = lookupId.value.trim(); const snapshot = (await $api.get<StudentOnboardingSnapshot>(`/academic/students/${encodeURIComponent(studentId)}/onboarding`)).data; useSnapshot(snapshot, studentId); noticeMessage.value = snapshot.complete ? 'Profil operasional ditemukan. Perubahan berikutnya memakai kontrol versi.' : 'Data parsial ditemukan. Lengkapi field wajib untuk memperbaiki proyeksi akademik, KRS, dan billing.' }
  catch (error) { errorMessage.value = apiError(error) }
  finally { working.value = false }
}

function resetForm() {
  Object.assign(form, freshForm()); lookupId.value = ''; errorMessage.value = ''; noticeMessage.value = ''
}

async function save() {
  working.value = true; errorMessage.value = ''; noticeMessage.value = ''
  try {
    const identity = form.accountId ? { accountId: form.accountId } : { accountEmail: form.accountEmail }
    const advisor = form.advisorId ? { advisorId: form.advisorId } : { advisorEmail: form.advisorEmail }
    const body = {
      ...identity, ...advisor, studentId: form.studentId, studentNumber: form.studentNumber,
      programStudyId: form.programStudyId, cohortYear: Number(form.cohortYear), currentPeriodId: form.currentPeriodId,
      curriculumVersionId: form.curriculumVersionId, status: form.status, pathway: form.pathway,
      ...(form.partnerInstitution ? { partnerInstitution: form.partnerInstitution } : {}),
      ...(form.originInstitution ? { originInstitution: form.originInstitution } : {}),
      maximumCredits: Number(form.maximumCredits), registeredCredits: Number(form.registeredCredits),
      totalEarnedCredits: Number(form.totalEarnedCredits), cumulativeGpa: Number(form.cumulativeGpa),
      completedCourseCodes: codes(form.completedCourseCodes), reason: form.reason, expectedVersion: Number(form.expectedVersion),
    }
    const { data } = await $api.post<StudentOnboardingResult>('/academic/students/onboard', body, { headers: { 'Idempotency-Key': requestKey() } })
    useRecord(data)
    noticeMessage.value = data.replayed ? 'Permintaan onboarding yang sama telah diproses.' : 'Profil akademik, KRS, dan billing mahasiswa berhasil disinkronkan.'
  } catch (error) { errorMessage.value = apiError(error) }
  finally { working.value = false }
}

onMounted(loadCatalog)
</script>

<template>
  <div class="page-stack onboarding-page">
    <AppPageHeader eyebrow="Administrasi akademik" title="Onboarding mahasiswa" description="Hubungkan akun mahasiswa aktif dengan profil akademik, status KRS, dan data tagihan.">
      <template #actions><NuxtLink class="btn btn-outline-secondary" to="/akademik/master"><i class="uil uil-database me-2" />Master akademik</NuxtLink><button class="btn btn-primary" type="button" @click="resetForm"><i class="uil uil-user-plus me-2" />Mahasiswa baru</button></template>
    </AppPageHeader>

    <div v-if="errorMessage" class="alert alert-danger" role="alert">{{ errorMessage }}</div>
    <div v-if="noticeMessage" class="alert alert-success" role="status">{{ noticeMessage }}</div>
    <div v-if="loading" class="alert alert-info" role="status">Memuat program, periode, dan kurikulum aktif...</div>

    <section v-if="!loading" class="surface-card bulk-card">
      <header><div><span class="section-kicker">Bulk onboarding nyata</span><h2>Siapkan hingga 100 mahasiswa per batch</h2><p>CSV/TSV membuat akun student yang belum ada lalu menulis profil akademik, state KRS, dan profil billing melalui service kanonik yang sama. Tidak ada password atau data contoh yang dibuat.</p></div><button class="btn btn-sm btn-outline-secondary" type="button" @click="downloadBulkTemplate"><i class="uil uil-file-download me-1" />Unduh template kosong</button></header>
      <div v-if="!canBulkOnboard" class="alert alert-warning mb-0">Bulk onboarding memerlukan gabungan role administrator dan staf akademik. Onboarding satu mahasiswa tetap tersedia sesuai akses staf.</div>
      <template v-else>
        <div class="bulk-controls">
          <label class="form-field"><span>Berkas CSV/TSV</span><input class="form-control" type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" :disabled="bulkWorking" @change="loadBulkFile"></label>
          <div class="bulk-source"><span>Sumber</span><strong>{{ bulkContent ? bulkSourceName : 'Belum dipilih' }}</strong><small>Maksimal 1 MB dan 100 baris. Retry memakai key yang sama sampai isi berkas berubah.</small></div>
          <button class="btn btn-primary" type="button" :disabled="bulkWorking || !bulkContent" @click="runBulkOnboarding"><span v-if="bulkWorking" class="spinner-border spinner-border-sm me-2" />{{ bulkWorking ? 'Memproses…' : 'Validasi dan onboarding' }}</button>
        </div>
        <div v-if="bulkResult" class="bulk-result" role="status"><strong>{{ bulkResult.total }} baris diproses</strong><span>{{ bulkResult.onboarded }} berhasil</span><span>{{ bulkResult.replayed }} replay</span><span :class="{ danger: bulkResult.failed }">{{ bulkResult.failed }} gagal</span></div>
        <div v-if="bulkFailures.length" class="bulk-failures"><h3>Baris yang perlu diperbaiki</h3><ul><li v-for="item in bulkFailures" :key="item.rowNumber"><strong>Baris {{ item.rowNumber }}</strong><code>{{ item.code }}</code><span>{{ item.message }}</span><small v-if="item.accountCreated">Akun telah dibuat aman dan dapat dipakai ulang setelah master data diperbaiki.</small></li></ul></div>
      </template>
    </section>

    <section v-if="!loading && catalog" class="onboarding-layout">
      <aside class="page-stack">
        <section class="surface-card lookup-card">
          <span class="section-kicker">Ubah profil</span><h2>Muat onboarding yang sudah ada</h2>
          <label for="studentLookup">ID mahasiswa</label><div class="input-group"><input id="studentLookup" v-model="lookupId" class="form-control" placeholder="Contoh: student-001" @keyup.enter="lookup"><button class="btn btn-outline-primary" type="button" :disabled="working" @click="lookup">Muat</button></div>
        </section>
        <section class="surface-card readiness-card">
          <span class="section-kicker">Prasyarat data nyata</span><h2>Sebelum menyimpan</h2>
          <ul><li>Akun harus aktif dan hanya memiliki role student.</li><li>Scope akun harus tepat memuat ID, prodi, dan angkatan ini.</li><li>Dosen wali harus aktif dengan role lecturer + advisor.</li><li>Program, periode, dan kurikulum harus aktif serta saling cocok.</li></ul>
          <p>Form tidak membuat password, akun Firebase, nilai, tagihan, atau riwayat kelulusan secara otomatis.</p>
        </section>
      </aside>

      <section class="surface-card form-card">
        <header><span class="section-kicker">{{ editing ? `Pembaruan v${form.expectedVersion + 1}` : 'Profil baru' }}</span><h2>Identitas dan proyeksi operasional</h2><p>Nama mahasiswa mengikuti display name akun. Seluruh perubahan diaudit dan update memakai expected version.</p></header>
        <form @submit.prevent="save">
          <div class="form-row"><label>ID mahasiswa<input v-model="form.studentId" class="form-control" required :readonly="editing"></label><label>NIM<input v-model="form.studentNumber" class="form-control" required></label></div>
          <label v-if="!editing">Email akun student aktif<input v-model="form.accountEmail" type="email" class="form-control" autocomplete="off" required></label><label v-else>ID akun Firebase<input v-model="form.accountId" class="form-control" readonly></label>
          <div class="form-row"><label>Program studi<select v-model="form.programStudyId" class="form-select" required><option value="" disabled>Pilih program</option><option v-for="item in catalog.programs.filter(entry => entry.active)" :key="item.id" :value="item.id">{{ item.code }} · {{ item.name }}</option></select></label><label>Angkatan<input v-model.number="form.cohortYear" type="number" min="1950" max="2200" class="form-control" required></label></div>
          <div class="form-row"><label>Periode aktif<select v-model="form.currentPeriodId" class="form-select" required><option value="" disabled>Pilih periode</option><option v-for="item in activePeriods" :key="item.id" :value="item.id">{{ item.academicYear }} · {{ item.term }}</option></select></label><label>Kurikulum aktif<select v-model="form.curriculumVersionId" class="form-select" required><option value="" disabled>Pilih kurikulum</option><option v-for="item in eligibleCurricula" :key="item.id" :value="item.id">{{ item.name }} · v{{ item.version }}</option></select></label></div>
          <label v-if="!editing">Email dosen wali aktif<input v-model="form.advisorEmail" type="email" class="form-control" autocomplete="off" required></label><label v-else>ID dosen wali<input v-model="form.advisorId" class="form-control" required></label>
          <div class="form-row"><label>Status<select v-model="form.status" class="form-select"><option>ACTIVE</option><option>LEAVE</option><option>INACTIVE</option><option>GRADUATED</option><option>TRANSFERRED_OUT</option></select></label><label>Jalur<select v-model="form.pathway" class="form-select"><option>REGULAR</option><option>TRANSFER</option><option>DOUBLE_DEGREE</option></select></label></div>
          <label v-if="form.pathway === 'TRANSFER'">Institusi asal<input v-model="form.originInstitution" class="form-control" required></label><label v-if="form.pathway === 'DOUBLE_DEGREE'">Institusi mitra<input v-model="form.partnerInstitution" class="form-control" required></label>
          <div class="form-row form-row--three"><label>Batas SKS<input v-model.number="form.maximumCredits" type="number" min="0" max="30" class="form-control" required></label><label>SKS terdaftar<input v-model.number="form.registeredCredits" type="number" min="0" max="30" class="form-control" required></label><label>SKS lulus<input v-model.number="form.totalEarnedCredits" type="number" min="0" max="400" class="form-control" required></label></div>
          <div class="form-row"><label>IPK<input v-model.number="form.cumulativeGpa" type="number" min="0" max="4" step="0.01" class="form-control" required></label><label>Kode mata kuliah lulus <small>pisahkan koma</small><input v-model="form.completedCourseCodes" class="form-control" placeholder="MGT101, MGT102"></label></div>
          <label>Alasan / sumber perubahan<textarea v-model="form.reason" class="form-control" rows="3" minlength="10" maxlength="1000" placeholder="Contoh: Registrasi mahasiswa baru berdasarkan SK penerimaan ..." required /></label>
          <div class="identity-summary"><span>Fakultas</span><strong>{{ selectedProgram?.facultyId || 'Mengikuti program studi' }}</strong><span>Versi saat ini</span><strong>{{ form.expectedVersion }}</strong></div>
          <button class="btn btn-primary" type="submit" :disabled="working"><i class="uil uil-shield-check me-2" />{{ working ? 'Memvalidasi...' : 'Simpan onboarding kanonik' }}</button>
        </form>
      </section>
    </section>
  </div>
</template>

<style scoped>
.onboarding-page{display:grid;gap:1rem}.onboarding-layout{display:grid;grid-template-columns:minmax(250px,.65fr) minmax(0,1.35fr);gap:1rem;align-items:start}.surface-card{padding:1rem}.surface-card h2{margin:.15rem 0 .65rem;color:#315348;font-size:.9rem}.surface-card p,.surface-card li{color:#71827b;font-size:.6rem;line-height:1.6}.lookup-card{display:grid;gap:.45rem}.lookup-card label,.form-card label{display:grid;gap:.28rem;color:#5f746b;font-size:.58rem;font-weight:700}.readiness-card ul{display:grid;gap:.35rem;padding-left:1.1rem}.readiness-card p{margin:1rem 0 0;padding-top:.75rem;border-top:1px solid var(--campus-border)}.form-card form{display:grid;gap:.7rem}.form-card header p{margin:0}.form-row{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.6rem}.form-row--three{grid-template-columns:repeat(3,minmax(0,1fr))}.form-control,.form-select{font-size:.67rem}.identity-summary{display:grid;grid-template-columns:auto 1fr auto 1fr;gap:.4rem .7rem;padding:.7rem;border-radius:.65rem;background:#f4f8f5;color:#6d7e77;font-size:.58rem}.identity-summary strong{color:#315348}@media(max-width:900px){.onboarding-layout{grid-template-columns:1fr}}@media(max-width:600px){.form-row,.form-row--three,.identity-summary{grid-template-columns:1fr}}
.bulk-card{display:grid;gap:.85rem}.bulk-card>header{display:flex;align-items:flex-start;justify-content:space-between;gap:1rem}.bulk-card>header h2{margin-bottom:.25rem}.bulk-card>header p{max-width:760px;margin:0}.bulk-controls{display:grid;grid-template-columns:minmax(240px,1fr) minmax(220px,.8fr) auto;gap:.8rem;align-items:end}.form-field{display:grid;gap:.3rem;color:#5f746b;font-size:.58rem;font-weight:700}.bulk-source{display:grid;gap:.12rem;padding:.45rem .7rem;border-left:3px solid #7ca691}.bulk-source span,.bulk-source small{color:#7b8a84;font-size:.53rem}.bulk-source strong{color:#315348;font-size:.64rem}.bulk-result{display:flex;flex-wrap:wrap;gap:.45rem;align-items:center;padding:.65rem .8rem;border-radius:.7rem;background:#f2f8f4;color:#557068;font-size:.6rem}.bulk-result strong{margin-right:auto;color:#315348}.bulk-result span{padding:.2rem .45rem;border-radius:999px;background:#fff}.bulk-result .danger{color:#9a3e36;background:#fff1ef}.bulk-failures{padding:.75rem;border:1px solid #f0d2ce;border-radius:.7rem;background:#fff9f8}.bulk-failures h3{margin:0 0 .55rem;color:#7f413a;font-size:.68rem}.bulk-failures ul{display:grid;gap:.45rem;margin:0;padding:0;list-style:none}.bulk-failures li{display:grid;grid-template-columns:auto auto 1fr;gap:.35rem .55rem}.bulk-failures li strong,.bulk-failures li code,.bulk-failures li span,.bulk-failures li small{font-size:.55rem}.bulk-failures li small{grid-column:1/-1;color:#8a6a66}@media(max-width:900px){.bulk-controls{grid-template-columns:1fr}.bulk-card>header{align-items:stretch;flex-direction:column}.bulk-card>header button{align-self:flex-start}}
</style>
