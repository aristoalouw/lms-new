<script setup lang="ts">
import type { AdmissionProgram, AdmissionWave } from '~/server/types/admissions'

definePageMeta({ layout: 'auth' })
useHead({ title: 'Formulir Pendaftaran PMB' })

const route = useRoute()
const config = useRuntimeConfig()
const { $api } = useNuxtApp()
const step = ref(1)
const selectedFiles = ref<string[]>([])
const submitting = ref(false)
const submitError = ref('')
const catalogLoading = ref(true)
const catalogError = ref('')
const submittedApplication = ref<{ id: string; registrationNumber: string } | null>(null)
const idempotencyKey = ref(`admission-web-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`)
const appName = computed(() => String(config.public.appName || 'Nusa Campus').trim())
const appInitial = computed(() => appName.value.charAt(0).toUpperCase() || 'N')
const admissionsEmail = computed(() => String(config.public.admissionsEmail || '').trim())

const programs = ref<AdmissionProgram[]>([])
const waves = ref<AdmissionWave[]>([])
const queryProgram = typeof route.query.program === 'string' ? route.query.program : ''
const form = reactive({
  name: '',
  email: '',
  phone: '',
  identityNumber: '',
  program: '',
  path: 'regular',
  studyMode: 'hybrid',
  school: '',
  graduationYear: '2026',
  sourceInformation: '',
  consent: false,
})

const activeWave = computed(() => {
  const now = Date.now()
  return waves.value.find(wave => wave.active && now >= Date.parse(wave.opensAt) && now <= Date.parse(wave.closesAt)) || null
})
const availablePrograms = computed(() => programs.value.filter(program => (
  !activeWave.value?.programStudyIds.length || activeWave.value.programStudyIds.includes(program.id)
)))
const programLabel = computed(() => programs.value.find(item => item.id === form.program)?.name || 'Belum dipilih')
const pathLabels: Record<string, string> = { regular: 'Reguler', 'kip-college': 'KIP Kuliah', transfer: 'Pindahan', rpl: 'RPL' }
const modeLabels: Record<string, string> = { hybrid: 'Hybrid', evening: 'Kelas malam', weekend: 'Kelas akhir pekan' }

const canContinue = computed(() => step.value === 1
  ? Boolean(form.name && form.email && form.phone && /^\d{16}$/.test(form.identityNumber))
  : step.value === 2
    ? Boolean(activeWave.value && form.program && form.path && form.school)
    : form.consent)

const next = () => { if (canContinue.value && step.value < 3) step.value++ }
const onFiles = (event: Event) => {
  const input = event.target as HTMLInputElement
  selectedFiles.value = Array.from(input.files || []).map(file => file.name)
}
const submit = async () => {
  if (!canContinue.value || submitting.value || !activeWave.value) return
  submitting.value = true
  submitError.value = ''
  try {
    const response = await $api.post('/admissions/applications', {
      fullName: form.name,
      email: form.email,
      phone: form.phone.replace(/[\s()-]/g, ''),
      identityNumber: form.identityNumber,
      programStudyId: form.program,
      admissionPathId: form.path,
      studyModeId: form.studyMode,
      waveId: activeWave.value.id,
      priorInstitution: form.school,
      graduationYear: Number(form.graduationYear),
      ...(form.sourceInformation ? { sourceInformation: form.sourceInformation } : {}),
      consent: form.consent,
    }, { headers: { 'Idempotency-Key': idempotencyKey.value } })
    submittedApplication.value = response.data.application
  } catch (error: unknown) {
    const failure = error as { response?: { data?: { statusMessage?: string; message?: string } } }
    submitError.value = failure.response?.data?.statusMessage || failure.response?.data?.message || 'Pendaftaran belum dapat disimpan. Periksa data lalu coba kembali.'
  } finally {
    submitting.value = false
  }
}

const loadCatalog = async () => {
  catalogLoading.value = true
  catalogError.value = ''
  try {
    const { data } = await $api.get<{ programs: AdmissionProgram[]; waves: AdmissionWave[] }>('/admissions/catalog')
    programs.value = data.programs
    waves.value = data.waves
    const requested = programs.value.find(item => item.id === queryProgram || item.name === queryProgram)?.id
    if (requested && availablePrograms.value.some(item => item.id === requested)) form.program = requested
    else if (availablePrograms.value.length === 1) form.program = availablePrograms.value[0]!.id
  } catch {
    catalogError.value = 'Katalog penerimaan belum dapat dimuat. Silakan coba kembali.'
  } finally {
    catalogLoading.value = false
  }
}

onMounted(loadCatalog)
</script>

<template>
  <main class="registration-page">
    <header class="registration-header">
      <NuxtLink to="/pmb/informasi" class="registration-brand"><span>{{ appInitial }}</span><div><strong>{{ appName }}</strong><small>Portal pendaftaran</small></div></NuxtLink>
      <div v-if="admissionsEmail" class="registration-help"><span class="d-none d-sm-inline">Butuh bantuan?</span><a :href="`mailto:${admissionsEmail}`"><i class="uil uil-envelope" /> {{ admissionsEmail }}</a></div>
    </header>

    <section v-if="submittedApplication" class="registration-success">
      <span><i class="uil uil-check" /></span>
      <p class="eyebrow">Pendaftaran tersimpan</p>
      <h1>Terima kasih, {{ form.name }}.</h1>
      <p>Nomor pendaftaran Anda <strong>{{ submittedApplication.registrationNumber }}</strong>. Simpan nomor ini untuk menautkan pendaftaran setelah akun portal diaktifkan.</p>
      <div class="success-next"><i class="uil uil-shield-check" /><div><strong>Langkah berikutnya di portal</strong><small>Masuk dengan email {{ form.email }}, tautkan nomor pendaftaran, lalu unggah dokumen melalui penyimpanan privat yang dipindai.</small></div></div>
      <NuxtLink class="btn btn-primary" to="/login">Masuk ke portal pendaftar</NuxtLink>
      <NuxtLink class="btn btn-link" to="/pmb/informasi">Kembali ke informasi PMB</NuxtLink>
    </section>

    <div v-else class="registration-layout">
      <aside class="registration-summary">
        <p class="eyebrow">{{ activeWave ? `Pendaftaran ${activeWave.academicYear}` : 'Pendaftaran belum dibuka' }}</p>
        <h1>Mulai pendaftaranmu.</h1>
        <p>Progres tersimpan setelah akun diaktifkan. Pastikan data sesuai dokumen resmi.</p>
        <ol class="registration-steps">
          <li v-for="item in [{n:1,t:'Data calon mahasiswa',d:'Identitas dan kontak aktif'},{n:2,t:'Pilihan studi',d:'Program, jalur, dan asal sekolah'},{n:3,t:'Dokumen & persetujuan',d:'Berkas awal dan konfirmasi'}]" :key="item.n" :class="{ active: step === item.n, done: step > item.n }">
            <span><i v-if="step > item.n" class="uil uil-check" /><template v-else>{{ item.n }}</template></span>
            <div><strong>{{ item.t }}</strong><small>{{ item.d }}</small></div>
          </li>
        </ol>
        <div class="registration-security"><i class="uil uil-shield-check" /><div><strong>Data Anda bersifat privat</strong><small>Halaman formulir ini tidak mengaktifkan analytics atau session recording.</small></div></div>
      </aside>

      <section class="registration-form-card" data-clarity-mask="true">
        <div v-if="catalogLoading" class="alert alert-info" role="status">Memuat gelombang dan program studi aktif…</div>
        <div v-else-if="catalogError" class="alert alert-danger" role="alert">{{ catalogError }} <button class="btn btn-sm btn-link" type="button" @click="loadCatalog">Coba lagi</button></div>
        <div v-else-if="!activeWave" class="alert alert-warning" role="alert">Belum ada gelombang PMB aktif. Formulir tidak menerima pendaftaran sampai panitia membuka gelombang resmi.</div>
        <div class="registration-form-card__head">
          <div><span>Langkah {{ step }} dari 3</span><h2>{{ step === 1 ? 'Data calon mahasiswa' : step === 2 ? 'Pilihan studi' : 'Dokumen & persetujuan' }}</h2></div>
          <strong>{{ Math.round(step / 3 * 100) }}%</strong>
        </div>
        <div class="progress" role="progressbar" :aria-valuenow="step" aria-valuemin="1" aria-valuemax="3"><div class="progress-bar" :style="{ width: `${step / 3 * 100}%` }" /></div>

        <form @submit.prevent="submit">
          <fieldset v-if="step === 1">
            <legend class="visually-hidden">Data calon mahasiswa</legend>
            <div class="mb-3"><label class="form-label" for="name">Nama lengkap sesuai identitas</label><input id="name" v-model.trim="form.name" class="form-control" autocomplete="name" required placeholder="Contoh: Nadya Safitri"></div>
            <div class="row g-3">
              <div class="col-md-6"><label class="form-label" for="email">Email aktif</label><input id="email" v-model.trim="form.email" class="form-control" type="email" autocomplete="email" required placeholder="nama@email.com"></div>
              <div class="col-md-6"><label class="form-label" for="phone">Nomor WhatsApp</label><input id="phone" v-model.trim="form.phone" class="form-control" type="tel" autocomplete="tel" required placeholder="08xxxxxxxxxx"></div>
            </div>
            <div class="mt-3"><label class="form-label" for="identity">NIK / nomor identitas</label><input id="identity" v-model.trim="form.identityNumber" class="form-control" inputmode="numeric" autocomplete="off" minlength="16" maxlength="16" pattern="[0-9]{16}" required placeholder="Masukkan 16 digit"><div class="form-text">Nomor mentah tidak disimpan; server menyimpan sidik HMAC untuk deduplikasi dan empat digit terakhir untuk verifikasi.</div></div>
          </fieldset>

          <fieldset v-else-if="step === 2">
            <legend class="visually-hidden">Pilihan studi</legend>
            <div class="mb-3"><label class="form-label" for="program">Program studi pilihan</label><select id="program" v-model="form.program" class="form-select" required :disabled="!activeWave"><option value="" disabled>Pilih program studi</option><option v-for="program in availablePrograms" :key="program.id" :value="program.id">{{ program.name }}</option></select></div>
            <div class="row g-3">
              <div class="col-md-6"><label class="form-label" for="path">Jalur pendaftaran</label><select id="path" v-model="form.path" class="form-select"><option value="regular">Reguler</option><option value="kip-college">KIP Kuliah</option><option value="transfer">Pindahan</option><option value="rpl">RPL</option></select></div>
              <div class="col-md-6"><label class="form-label" for="mode">Sistem perkuliahan</label><select id="mode" v-model="form.studyMode" class="form-select"><option value="hybrid">Hybrid</option><option value="evening">Kelas malam</option><option value="weekend">Kelas akhir pekan</option></select></div>
            </div>
            <div class="row g-3 mt-0">
              <div class="col-md-8"><label class="form-label" for="school">Asal sekolah / perguruan tinggi</label><input id="school" v-model.trim="form.school" class="form-control" required placeholder="Nama institusi asal"></div>
              <div class="col-md-4"><label class="form-label" for="year">Tahun lulus</label><select id="year" v-model="form.graduationYear" class="form-select"><option v-for="year in ['2026','2025','2024','2023','2022','2021','2020']" :key="year">{{ year }}</option></select></div>
            </div>
            <div class="mt-3"><label class="form-label" for="source">Mengetahui kampus dari</label><select id="source" v-model="form.sourceInformation" class="form-select"><option value="">Tidak ingin menjawab</option><option value="school-visit">Kunjungan sekolah</option><option value="website">Website kampus</option><option value="family-friend">Keluarga atau teman</option><option value="education-fair">Pameran pendidikan</option></select></div>
          </fieldset>

          <fieldset v-else>
            <legend class="visually-hidden">Dokumen dan persetujuan</legend>
            <label class="document-drop" for="documents">
              <span><i class="uil uil-cloud-upload" /></span><strong>Pilih dokumen untuk daftar periksa</strong><small>File belum dikirim dari halaman publik. Unggah dilakukan setelah login melalui karantina privat · PDF, JPG, PNG.</small>
              <input id="documents" class="visually-hidden" type="file" multiple accept=".pdf,.jpg,.jpeg,.png" @change="onFiles">
            </label>
            <ul v-if="selectedFiles.length" class="selected-files"><li v-for="file in selectedFiles" :key="file"><i class="uil uil-file-check-alt" /> {{ file }} <StatusBadge status="pending" label="Belum diunggah" /></li></ul>
            <div class="application-review">
              <div><span>Program studi</span><strong>{{ programLabel }}</strong></div><div><span>Jalur</span><strong>{{ pathLabels[form.path] }}</strong></div><div><span>Sistem kuliah</span><strong>{{ modeLabels[form.studyMode] }}</strong></div>
            </div>
            <div class="form-check consent-check"><input id="consent" v-model="form.consent" class="form-check-input" type="checkbox" required><label class="form-check-label" for="consent">Saya menyatakan data yang diberikan benar dan menyetujui pemrosesan data untuk proses penerimaan mahasiswa baru sesuai kebijakan privasi kampus.</label></div>
            <div v-if="submitError" class="alert alert-danger mt-3 mb-0" role="alert">{{ submitError }}</div>
          </fieldset>

          <div class="registration-form-card__footer">
            <button v-if="step > 1" class="btn btn-light" type="button" @click="step--"><i class="uil uil-arrow-left" /> Kembali</button><span v-else />
            <button v-if="step < 3" class="btn btn-primary" type="button" :disabled="!canContinue" @click="next">Lanjutkan <i class="uil uil-arrow-right" /></button>
            <button v-else class="btn btn-primary" type="submit" :disabled="!canContinue || submitting"><span v-if="submitting" class="spinner-border spinner-border-sm me-1" aria-hidden="true" />{{ submitting ? 'Menyimpan…' : 'Kirim pendaftaran' }} <i v-if="!submitting" class="uil uil-check" /></button>
          </div>
        </form>
      </section>
    </div>
  </main>
</template>

<style scoped>
.registration-page { min-height: 100vh; padding-bottom: 50px; color: #18342b; background: radial-gradient(circle at 15% 10%,rgba(211,155,42,.12),transparent 25%),#f2f5f1; }
.registration-header { display: flex; max-width: 1180px; height: 78px; margin: auto; padding: 0 20px; align-items: center; justify-content: space-between; }
.registration-brand { display: flex; gap: 10px; align-items: center; color: inherit; text-decoration: none; }.registration-brand > span { display: grid; width: 38px; height: 38px; place-items: center; border-radius: 12px 12px 12px 4px; color: #fff; background: #d39b2a; font: 700 1.3rem Georgia,serif; }.registration-brand > div { display: flex; flex-direction: column; }.registration-brand strong { font-size: .84rem; }.registration-brand small { margin-top: 2px; color: #7d8d87; font-size: .58rem; }
.registration-help { display: flex; gap: 10px; align-items: center; color: #80908a; font-size: .63rem; }.registration-help a { display: inline-flex; gap: 5px; align-items: center; color: #2e6e59; font-weight: 800; text-decoration: none; }
.registration-layout { display: grid; width: min(1060px,calc(100% - 32px)); margin: 42px auto; grid-template-columns: 340px minmax(0,1fr); overflow: hidden; border: 1px solid #dfe7e2; border-radius: 24px; background: #fff; box-shadow: 0 28px 70px rgba(18,50,40,.11); }
.registration-summary { padding: 42px 35px; color: #fff; background: linear-gradient(155deg,#194b3c,#0c2d24); }.registration-summary h1 { margin: 8px 0 12px; font-size: 2rem; font-weight: 800; letter-spacing: -.05em; }.registration-summary > p:not(.eyebrow) { color: rgba(255,255,255,.56); font-size: .7rem; line-height: 1.65; }.registration-summary .eyebrow { color: #e7be61; }
.registration-steps { display: grid; gap: 23px; margin: 39px 0; padding: 0; list-style: none; }.registration-steps li { display: flex; gap: 12px; align-items: flex-start; opacity: .46; }.registration-steps li.active,.registration-steps li.done { opacity: 1; }.registration-steps li > span { display: grid; width: 29px; height: 29px; flex: 0 0 29px; border: 1px solid rgba(255,255,255,.26); border-radius: 9px; place-items: center; font-size: .62rem; font-weight: 800; }.registration-steps li.active > span { color: #203b32; border-color: #e3ba5c; background: #e3ba5c; }.registration-steps li.done > span { color: #a6ddc4; border-color: rgba(126,206,167,.35); background: rgba(126,206,167,.12); }.registration-steps div { display: flex; flex-direction: column; }.registration-steps strong { font-size: .7rem; }.registration-steps small { margin-top: 3px; color: rgba(255,255,255,.45); font-size: .56rem; }
.registration-security { display: flex; gap: 10px; align-items: flex-start; padding: 13px; border: 1px solid rgba(255,255,255,.09); border-radius: 12px; background: rgba(255,255,255,.05); }.registration-security > i { color: #e7c36e; font-size: 1rem; }.registration-security div { display: flex; flex-direction: column; }.registration-security strong { font-size: .62rem; }.registration-security small { margin-top: 3px; color: rgba(255,255,255,.45); font-size: .54rem; line-height: 1.45; }
.registration-form-card { min-height: 620px; padding: 42px 45px 28px; }.registration-form-card__head { display: flex; align-items: flex-end; justify-content: space-between; }.registration-form-card__head span { color: #789087; font-size: .6rem; font-weight: 800; text-transform: uppercase; }.registration-form-card__head h2 { margin: 5px 0 0; font-size: 1.3rem; font-weight: 800; letter-spacing: -.03em; }.registration-form-card__head > strong { color: #39725f; font-size: .72rem; }.registration-form-card > .progress { height: 4px; margin: 15px 0 34px; }.registration-form-card form { display: flex; min-height: 485px; flex-direction: column; }.registration-form-card fieldset { flex: 1; }.registration-form-card .form-control,.registration-form-card .form-select { font-size: .75rem; }.registration-form-card__footer { display: flex; align-items: center; justify-content: space-between; margin-top: 32px; padding-top: 20px; border-top: 1px solid #e7ece9; }
.document-drop { display: flex; min-height: 150px; align-items: center; justify-content: center; flex-direction: column; padding: 25px; border: 1px dashed #b8cac1; border-radius: 15px; cursor: pointer; background: #f7faf8; text-align: center; }.document-drop:hover { border-color: #39705e; background: #f0f7f3; }.document-drop > span { display: grid; width: 40px; height: 40px; margin-bottom: 9px; border-radius: 12px; place-items: center; color: #34705b; background: #e6f2ec; font-size: 1.15rem; }.document-drop strong { font-size: .72rem; }.document-drop small { margin-top: 5px; color: #83918c; font-size: .58rem; }
.selected-files { display: grid; gap: 5px; margin: 10px 0 0; padding: 0; list-style: none; }.selected-files li { display: flex; gap: 7px; align-items: center; padding: 8px 10px; border: 1px solid #e4e9e6; border-radius: 9px; font-size: .62rem; }.selected-files li .status-badge { margin-left: auto; }
.application-review { display: grid; margin: 17px 0; padding: 14px; grid-template-columns: repeat(3,1fr); border-radius: 12px; background: #f1f6f3; }.application-review > div { display: flex; padding: 0 12px; flex-direction: column; border-right: 1px solid #dce6e0; }.application-review > div:first-child { padding-left: 0; }.application-review > div:last-child { border: 0; }.application-review span { color: #81918b; font-size: .55rem; }.application-review strong { margin-top: 3px; font-size: .64rem; }
.consent-check { padding: 13px 13px 13px 36px; border: 1px solid #e0e7e3; border-radius: 11px; background: #fbfcfa; }.consent-check .form-check-input { margin-left: -23px; }.consent-check label { color: #60716b; font-size: .6rem; line-height: 1.5; }
.registration-success { display: flex; width: min(540px,calc(100% - 32px)); margin: 70px auto; align-items: center; flex-direction: column; padding: 48px; border: 1px solid #dfe7e2; border-radius: 24px; background: #fff; box-shadow: 0 28px 70px rgba(18,50,40,.1); text-align: center; }.registration-success > span { display: grid; width: 64px; height: 64px; margin-bottom: 20px; border-radius: 20px; place-items: center; color: #fff; background: #2d765b; font-size: 1.8rem; }.registration-success h1 { margin: 0; font-size: 1.8rem; font-weight: 800; letter-spacing: -.04em; }.registration-success > p:not(.eyebrow) { margin: 12px 0 22px; color: #6e8179; font-size: .72rem; line-height: 1.7; }.success-next { display: flex; width: 100%; gap: 11px; align-items: center; margin-bottom: 22px; padding: 14px; border-radius: 12px; color: #2b5c4d; background: #eef6f2; text-align: left; }.success-next > i { font-size: 1.2rem; }.success-next div { display: flex; flex-direction: column; }.success-next strong { font-size: .67rem; }.success-next small { margin-top: 3px; color: #73847d; font-size: .57rem; }.registration-success .btn-link { margin-top: 7px; font-size: .65rem; text-decoration: none; }
@media (max-width: 799.98px) { .registration-layout { margin-top: 18px; grid-template-columns: 1fr; }.registration-summary { padding: 28px; }.registration-summary > p:not(.eyebrow),.registration-security { display: none; }.registration-summary h1 { margin-bottom: 23px; font-size: 1.45rem; }.registration-steps { grid-template-columns: repeat(3,1fr); gap: 8px; margin: 0; }.registration-steps li { align-items: center; flex-direction: column; }.registration-steps li div { text-align: center; }.registration-steps li small { display: none; }.registration-form-card { min-height: auto; padding: 32px; }.registration-form-card form { min-height: 450px; } }
@media (max-width: 575.98px) { .registration-header { padding-inline: 14px; }.registration-layout { width: calc(100% - 20px); border-radius: 18px; }.registration-summary { padding: 22px 18px; }.registration-summary h1 { font-size: 1.2rem; }.registration-steps strong { font-size: .56rem; }.registration-form-card { padding: 25px 18px 20px; }.registration-form-card__head h2 { font-size: 1.05rem; }.application-review { gap: 9px; grid-template-columns: 1fr; }.application-review > div { padding: 5px 0; border: 0; }.registration-form-card__footer .btn { padding-inline: .75rem; }.registration-success { margin-top: 30px; padding: 32px 20px; } }
</style>
