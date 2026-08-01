<script setup lang="ts">
import type { AcademicAdministrationWorkspace } from '~/server/types/academic-administration'
import type { StudentOnboardingRecord, StudentOnboardingResult, StudentOnboardingSnapshot } from '~/server/types/student-onboarding'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Onboarding Mahasiswa' })

const { $api } = useNuxtApp()
const catalog = ref<AcademicAdministrationWorkspace | null>(null)
const loading = ref(true)
const working = ref(false)
const lookupId = ref('')
const errorMessage = ref('')
const noticeMessage = ref('')

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
    <AppPageHeader eyebrow="Administrasi akademik" title="Onboarding mahasiswa" description="Hubungkan akun student aktif ke profil akademik, state KRS, dan profil billing melalui satu transaksi terkontrol.">
      <template #actions><NuxtLink class="btn btn-outline-secondary" to="/akademik/master"><i class="uil uil-database me-2" />Master akademik</NuxtLink><button class="btn btn-primary" type="button" @click="resetForm"><i class="uil uil-user-plus me-2" />Mahasiswa baru</button></template>
    </AppPageHeader>

    <div v-if="errorMessage" class="alert alert-danger" role="alert">{{ errorMessage }}</div>
    <div v-if="noticeMessage" class="alert alert-success" role="status">{{ noticeMessage }}</div>
    <div v-if="loading" class="alert alert-info" role="status">Memuat program, periode, dan kurikulum aktif...</div>

    <section v-else-if="catalog" class="onboarding-layout">
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
</style>
