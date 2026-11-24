<script setup lang="ts">
import { ADMISSION_DOCUMENT_TYPES, STUDY_MODE_IDS, type AdmissionPathPolicy, type AdmissionProgram, type AdmissionWave } from '~/server/types/admissions'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Pengaturan PMB' })

const { can } = useAuth()
const { $api } = useNuxtApp()
const programs = ref<AdmissionProgram[]>([])
const waves = ref<AdmissionWave[]>([])
const pathPolicies = ref<AdmissionPathPolicy[]>([])
const loading = ref(true)
const saving = ref(false)
const errorMessage = ref('')
const noticeMessage = ref('')
const editingId = ref('')
const editingPathId = ref('')

const blank = () => ({
  id: '', academicYear: '', label: '', opensAt: '', closesAt: '', registrationFee: 0,
  active: false, programStudyIds: [] as string[], capacity: 100, expectedVersion: 0,
})
const form = reactive(blank())
const blankPath = () => ({
  id: '', label: '', description: '', active: false, programStudyIds: [] as string[],
  studyModeIds: [...STUDY_MODE_IDS] as string[], requiredDocumentTypes: [] as string[],
  registrationFee: 0, effectiveFrom: '', effectiveUntil: '', expectedVersion: 1,
})
const pathForm = reactive(blankPath())
const documentLabels: Record<string, string> = { IDENTITY: 'Identitas resmi', DIPLOMA: 'Ijazah/SKL', TRANSCRIPT: 'Transkrip', KIP_CARD: 'Kartu KIP', RPL_PORTFOLIO: 'Portofolio RPL', OTHER: 'Dokumen lain' }
const modeLabels: Record<string, string> = { hybrid: 'Hybrid', evening: 'Kelas malam', weekend: 'Kelas akhir pekan' }
const localDate = (value?: string) => value
  ? new Intl.DateTimeFormat('sv-SE', {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
      hourCycle: 'h23', timeZone: 'Asia/Jakarta',
    }).format(new Date(value)).replace(' ', 'T')
  : ''
const instant = (value: string) => new Date(`${value}:00+07:00`).toISOString()
const money = (value: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value)
const date = (value: string) => new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(value))
const requestKey = () => `admission-wave:${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`

function readable(error: unknown) {
  const candidate = error as { response?: { data?: { statusMessage?: string; message?: string } }; message?: string }
  return candidate.response?.data?.statusMessage || candidate.response?.data?.message || candidate.message || 'Pengaturan PMB tidak dapat diproses.'
}

async function load() {
  loading.value = true
  errorMessage.value = ''
  try {
    const { data } = await $api.get<{ programs: AdmissionProgram[]; waves: AdmissionWave[]; pathPolicies: AdmissionPathPolicy[] }>('/admissions/catalog/manage')
    programs.value = data.programs
    waves.value = data.waves
    pathPolicies.value = data.pathPolicies
  } catch (error) {
    errorMessage.value = readable(error)
  } finally {
    loading.value = false
  }
}

function editPath(policy: AdmissionPathPolicy) {
  editingPathId.value = policy.id
  Object.assign(pathForm, {
    id: policy.id, label: policy.label, description: policy.description, active: policy.active,
    programStudyIds: [...policy.programStudyIds], studyModeIds: [...policy.studyModeIds],
    requiredDocumentTypes: [...policy.requiredDocumentTypes], registrationFee: policy.registrationFee,
    effectiveFrom: localDate(policy.effectiveFrom), effectiveUntil: localDate(policy.effectiveUntil), expectedVersion: policy.version,
  })
}

function resetPath() {
  editingPathId.value = ''
  Object.assign(pathForm, blankPath())
}

async function savePath() {
  if (!can('pmb.configure') || !editingPathId.value) return
  saving.value = true
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    await $api.patch(`/admissions/catalog/paths/${encodeURIComponent(editingPathId.value)}`, {
      id: pathForm.id, label: pathForm.label, description: pathForm.description, active: pathForm.active,
      programStudyIds: [...pathForm.programStudyIds], studyModeIds: [...pathForm.studyModeIds],
      requiredDocumentTypes: [...pathForm.requiredDocumentTypes], registrationFee: Number(pathForm.registrationFee),
      effectiveFrom: instant(pathForm.effectiveFrom),
      ...(pathForm.effectiveUntil ? { effectiveUntil: instant(pathForm.effectiveUntil) } : {}),
      expectedVersion: pathForm.expectedVersion,
    })
    noticeMessage.value = 'Kebijakan jalur PMB berhasil diperbarui.'
    resetPath()
    await load()
  } catch (error) {
    errorMessage.value = readable(error)
  } finally {
    saving.value = false
  }
}

function edit(wave: AdmissionWave) {
  editingId.value = wave.id
  Object.assign(form, {
    id: wave.id, academicYear: wave.academicYear, label: wave.label,
    opensAt: localDate(wave.opensAt), closesAt: localDate(wave.closesAt),
    registrationFee: wave.registrationFee, active: wave.active,
    programStudyIds: [...wave.programStudyIds], capacity: wave.capacity, expectedVersion: wave.version,
  })
}

function reset() {
  editingId.value = ''
  Object.assign(form, blank())
}

async function save() {
  if (!can('pmb.configure')) return
  saving.value = true
  errorMessage.value = ''
  noticeMessage.value = ''
  const payload = {
    id: form.id, academicYear: form.academicYear, label: form.label,
    opensAt: instant(form.opensAt), closesAt: instant(form.closesAt),
    registrationFee: Number(form.registrationFee), active: form.active,
    programStudyIds: [...form.programStudyIds], capacity: Number(form.capacity),
    ...(editingId.value ? { expectedVersion: form.expectedVersion } : {}),
  }
  try {
    if (editingId.value) await $api.patch(`/admissions/catalog/waves/${encodeURIComponent(editingId.value)}`, payload)
    else await $api.post('/admissions/catalog/waves', payload, { headers: { 'Idempotency-Key': requestKey() } })
    noticeMessage.value = editingId.value ? 'Gelombang PMB berhasil diperbarui.' : 'Gelombang PMB berhasil dibuat.'
    reset()
    await load()
  } catch (error) {
    errorMessage.value = readable(error)
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="page-stack settings-page">
    <AppPageHeader eyebrow="Konfigurasi penerimaan" title="Gelombang PMB" description="Kelola gelombang, jadwal, biaya pendaftaran, kapasitas, dan program studi PMB.">
      <template #actions><NuxtLink class="btn btn-outline-secondary" to="/pmb"><i class="uil uil-arrow-left me-2" />Dashboard PMB</NuxtLink><NuxtLink class="btn btn-outline-primary" to="/akademik/master"><i class="uil uil-building me-2" />Master program studi</NuxtLink></template>
    </AppPageHeader>
    <div v-if="noticeMessage" class="alert alert-success" role="status">{{ noticeMessage }}</div>
    <div v-if="errorMessage" class="alert alert-danger" role="alert">{{ errorMessage }}</div>
    <div v-if="!can('pmb.configure')" class="alert alert-warning">Akun ini tidak memiliki izin mengubah konfigurasi PMB.</div>
    <div class="settings-layout">
      <section class="surface-card">
        <header><span>{{ editingId ? 'Perbarui versi' : 'Konfigurasi baru' }}</span><h2>{{ editingId ? `Ubah ${form.label}` : 'Buat gelombang' }}</h2><p>Waktu disimpan sebagai UTC dan ditampilkan dalam zona Asia/Jakarta.</p></header>
        <form @submit.prevent="save">
          <div class="form-row"><label>ID stabil<input v-model.trim="form.id" class="form-control" maxlength="80" required :disabled="Boolean(editingId)" placeholder="pmb-2027-gelombang-1"></label><label>Tahun akademik<input v-model.trim="form.academicYear" class="form-control" pattern="[0-9]{4}/[0-9]{4}" maxlength="9" required placeholder="2027/2028"></label></div>
          <label>Nama gelombang<input v-model.trim="form.label" class="form-control" maxlength="120" required placeholder="Gelombang 1"></label>
          <div class="form-row"><label>Dibuka<input v-model="form.opensAt" class="form-control" type="datetime-local" required></label><label>Ditutup<input v-model="form.closesAt" class="form-control" type="datetime-local" required></label></div>
          <div class="form-row"><label>Biaya formulir (IDR)<input v-model.number="form.registrationFee" class="form-control" type="number" min="0" max="1000000000" step="1000" required></label><label>Kapasitas<input v-model.number="form.capacity" class="form-control" type="number" min="1" max="100000" required></label></div>
          <fieldset><legend>Program studi yang menerima</legend><label v-for="program in programs" :key="program.id" class="program-check"><input v-model="form.programStudyIds" type="checkbox" :value="program.id"> <span><strong>{{ program.name }}</strong><small>{{ program.code }} · {{ program.unitId }}</small></span></label></fieldset>
          <label class="active-check"><input v-model="form.active" type="checkbox"> Gelombang aktif dan tampil pada formulir publik</label>
          <div class="actions"><button v-if="editingId" class="btn btn-outline-secondary" type="button" @click="reset">Batal</button><button class="btn btn-primary" type="submit" :disabled="saving || !can('pmb.configure') || !form.programStudyIds.length">{{ saving ? 'Menyimpan…' : editingId ? 'Simpan perubahan' : 'Buat gelombang' }}</button></div>
        </form>
      </section>
      <section class="surface-card inventory">
        <header><span>Data Firebase</span><h2>Gelombang tersedia</h2><p>Gelombang nonaktif tetap tersimpan untuk histori dan dapat diaktifkan kembali.</p></header>
        <div v-if="loading" class="state"><span class="spinner-border spinner-border-sm" /> Memuat katalog…</div>
        <article v-for="wave in waves" v-else :key="wave.id"><div><strong>{{ wave.label }} · {{ wave.academicYear }}</strong><small>{{ date(wave.opensAt) }}—{{ date(wave.closesAt) }} · {{ money(wave.registrationFee) }} · kapasitas {{ wave.capacity }} · v{{ wave.version }}</small><small>{{ wave.programStudyIds.length }} program studi · {{ wave.active ? 'Aktif' : 'Nonaktif' }}</small></div><button class="btn btn-sm btn-outline-primary" type="button" @click="edit(wave)">Ubah</button></article>
        <EmptyState v-if="!loading && !waves.length" title="Belum ada gelombang PMB" description="Buat gelombang resmi sebelum membuka formulir publik." />
      </section>
      <section class="surface-card path-inventory">
        <header><span>Jalur & syarat</span><h2>Kebijakan jalur efektif</h2><p>Atur biaya, program studi, sistem kuliah, dan daftar dokumen per jalur. Pendaftaran baru menyimpan snapshot versi kebijakan.</p></header>
        <article v-for="policy in pathPolicies" :key="policy.id"><div><strong>{{ policy.label }}</strong><small>{{ policy.description }}</small><small>{{ money(policy.registrationFee) }} · efektif {{ date(policy.effectiveFrom) }}{{ policy.effectiveUntil ? `—${date(policy.effectiveUntil)}` : '' }} · v{{ policy.version }}</small><small>{{ policy.requiredDocumentTypes.map(item => documentLabels[item] || item).join(', ') }} · {{ policy.active ? 'Aktif' : 'Nonaktif' }}</small></div><button class="btn btn-sm btn-outline-primary" type="button" @click="editPath(policy)">Atur</button></article>
      </section>
      <section class="surface-card path-editor">
        <header><span>Versi kebijakan</span><h2>{{ editingPathId ? `Ubah ${pathForm.label}` : 'Pilih jalur untuk diatur' }}</h2><p>Tanggal efektif wajib; versi lama tetap menjadi snapshot pada pendaftaran yang sudah masuk.</p></header>
        <form v-if="editingPathId" @submit.prevent="savePath">
          <div class="form-row"><label>ID jalur<input v-model="pathForm.id" class="form-control" disabled></label><label>Nama jalur<input v-model.trim="pathForm.label" class="form-control" maxlength="100" required></label></div>
          <label>Deskripsi<textarea v-model.trim="pathForm.description" class="form-control" rows="2" maxlength="500" required /></label>
          <div class="form-row"><label>Biaya formulir (IDR)<input v-model.number="pathForm.registrationFee" class="form-control" type="number" min="0" max="1000000000" step="1000" required></label><label>Mulai berlaku<input v-model="pathForm.effectiveFrom" class="form-control" type="datetime-local" required></label></div>
          <label>Berakhir (opsional)<input v-model="pathForm.effectiveUntil" class="form-control" type="datetime-local"></label>
          <fieldset><legend>Program studi (kosong berarti semua, khusus administrator)</legend><label v-for="program in programs" :key="program.id" class="program-check"><input v-model="pathForm.programStudyIds" type="checkbox" :value="program.id"> <span><strong>{{ program.name }}</strong><small>{{ program.code }}</small></span></label></fieldset>
          <fieldset><legend>Sistem perkuliahan</legend><label v-for="mode in STUDY_MODE_IDS" :key="mode" class="program-check"><input v-model="pathForm.studyModeIds" type="checkbox" :value="mode"> {{ modeLabels[mode] }}</label></fieldset>
          <fieldset><legend>Dokumen wajib</legend><label v-for="documentType in ADMISSION_DOCUMENT_TYPES" :key="documentType" class="program-check"><input v-model="pathForm.requiredDocumentTypes" type="checkbox" :value="documentType"> {{ documentLabels[documentType] }}</label></fieldset>
          <label class="active-check"><input v-model="pathForm.active" type="checkbox"> Jalur aktif dan dapat dipilih pendaftar</label>
          <div class="actions"><button class="btn btn-outline-secondary" type="button" @click="resetPath">Batal</button><button class="btn btn-primary" type="submit" :disabled="saving || !pathForm.studyModeIds.length || !pathForm.requiredDocumentTypes.length">{{ saving ? 'Menyimpan…' : 'Simpan kebijakan' }}</button></div>
        </form>
        <EmptyState v-else title="Belum memilih jalur" description="Klik Atur pada salah satu jalur penerimaan." />
      </section>
    </div>
  </div>
</template>

<style scoped>
.settings-page{display:grid;gap:1rem}.settings-layout{display:grid;grid-template-columns:minmax(360px,.85fr) minmax(0,1.15fr);gap:1rem;align-items:start}.surface-card{padding:1rem}.surface-card>header{margin-bottom:.9rem}.surface-card header span{color:#a17725;font-size:.55rem;font-weight:800;text-transform:uppercase}.surface-card h2{margin:.15rem 0;color:#3e2344;font-size:.95rem}.surface-card header p{margin:0;color:#7e8e87;font-size:.58rem}.surface-card form{display:grid;gap:.7rem}.surface-card label,.surface-card legend{display:grid;gap:.3rem;color:#536c62;font-size:.6rem;font-weight:700}.form-row{display:grid;grid-template-columns:1fr 1fr;gap:.6rem}.form-control{font-size:.7rem}.surface-card fieldset{display:grid;gap:.35rem;padding:.65rem;border:1px solid #e2e9e5;border-radius:.7rem}.program-check,.active-check{display:flex!important;align-items:center;gap:.5rem}.program-check strong,.program-check small{display:block}.program-check small{color:#6c6865;font-size:.54rem;font-weight:400}.actions{display:flex;justify-content:flex-end;gap:.5rem}.inventory article,.path-inventory article{display:flex;justify-content:space-between;gap:1rem;align-items:flex-start;padding:.8rem 0;border-top:1px solid #ece6dd}.inventory strong,.inventory small,.path-inventory strong,.path-inventory small{display:block}.inventory strong,.path-inventory strong{color:#35584b;font-size:.66rem}.inventory small,.path-inventory small{margin-top:.2rem;color:#809089;font-size:.54rem}.path-inventory{grid-column:1}.path-editor{grid-column:2}.state{display:flex;justify-content:center;gap:.5rem;padding:2rem;color:#72847c;font-size:.65rem}@media(max-width:900px){.settings-layout{grid-template-columns:1fr}.path-inventory,.path-editor{grid-column:1}}@media(max-width:600px){.form-row{grid-template-columns:1fr}}
</style>
