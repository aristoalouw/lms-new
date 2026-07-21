<script setup lang="ts">
import type { AdmissionApplicationView, AdmissionDocumentRecord, AdmissionDocumentType, AdmissionDocumentWorkspace } from '~/server/types/admissions'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Dokumen Pendaftaran PMB' })

interface UploadResponse { file: { id: string }; session: { id: string }; upload: { url: string; headers: Record<string, string> } }
const route = useRoute()
const config = useRuntimeConfig()
const { $api } = useNuxtApp()
const { user } = useAuth()
const applications = ref<AdmissionApplicationView[]>([])
const applicationId = ref(typeof route.query.applicationId === 'string' ? route.query.applicationId : '')
const workspace = ref<AdmissionDocumentWorkspace | null>(null)
const selectedType = ref<AdmissionDocumentType>('IDENTITY')
const selectedFile = ref<File | null>(null)
const reviewNote = ref('Dokumen sesuai dengan sumber resmi dan dapat dibaca.')
const loading = ref(true)
const working = ref(false)
const uploadProgress = ref(0)
const errorMessage = ref('')
const noticeMessage = ref('')
const fileInput = ref<HTMLInputElement>()

const staffMode = computed(() => Boolean(route.query.applicationId) || user.value?.roles.some(role => ['administrator', 'admissions_staff'].includes(role)))
const pendingTypes = computed(() => workspace.value?.checklist.filter(item => item.status === 'MISSING' || item.status === 'REJECTED').map(item => item.documentType) || [])
const label = (type: AdmissionDocumentType) => ({ IDENTITY: 'Identitas resmi', DIPLOMA: 'Ijazah/SKL', TRANSCRIPT: 'Transkrip institusi asal', KIP_CARD: 'Bukti KIP Kuliah', RPL_PORTFOLIO: 'Portofolio RPL', OTHER: 'Dokumen lain' })[type]
const statusLabel = (status: AdmissionDocumentRecord['status'] | 'MISSING') => ({ MISSING: 'Belum diunggah', PENDING: 'Menunggu verifikasi', VERIFIED: 'Terverifikasi', REJECTED: 'Ditolak' })[status]
const statusTone = (status: AdmissionDocumentRecord['status'] | 'MISSING') => ({ MISSING: 'draft', PENDING: 'pending', VERIFIED: 'success', REJECTED: 'blocked' })[status]
const formatDate = (value: string) => new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(value))
const formatBytes = (value: number) => `${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 }).format(value / 1024)} KB`
const key = (purpose: string) => `${purpose}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`
const errorText = (error: unknown) => { const value = error as { response?: { data?: { statusMessage?: string; message?: string } }; message?: string }; return value.response?.data?.statusMessage || value.response?.data?.message || value.message || 'Permintaan dokumen PMB tidak dapat diproses.' }

const loadWorkspace = async () => {
  if (!applicationId.value) { workspace.value = null; return }
  const response = await $api.get<AdmissionDocumentWorkspace>(`/admissions/applications/${encodeURIComponent(applicationId.value)}/documents`)
  workspace.value = response.data
  const next = response.data.checklist.find(item => ['MISSING', 'REJECTED'].includes(item.status))?.documentType
  if (next) selectedType.value = next
}

const load = async () => {
  loading.value = true; errorMessage.value = ''
  try {
    if (config.public.demoMode) await $api.post('/auth/demo-login', { profileId: route.query.applicationId ? 'admissions' : 'applicant' })
    if (!applicationId.value) {
      const response = await $api.get<AdmissionApplicationView[]>('/admissions/applications/me')
      applications.value = response.data
      applicationId.value = response.data[0]?.id || ''
    }
    await loadWorkspace()
  } catch (error) { errorMessage.value = errorText(error) } finally { loading.value = false }
}

const uploadToTarget = (target: UploadResponse['upload'], file: File) => new Promise<void>((resolve, reject) => {
  const request = new XMLHttpRequest(); request.open('PUT', target.url)
  for (const [name, value] of Object.entries(target.headers)) request.setRequestHeader(name, value)
  request.upload.addEventListener('progress', event => { if (event.lengthComputable) uploadProgress.value = Math.max(10, Math.round(event.loaded / event.total * 78)) })
  request.addEventListener('load', () => request.status >= 200 && request.status < 300 ? resolve() : reject(new Error('Penyimpanan menolak unggahan.')))
  request.addEventListener('error', () => reject(new Error('Koneksi unggahan terputus.'))); request.send(file)
})

const submitDocument = async () => {
  const file = selectedFile.value, application = workspace.value?.application
  if (!file || !application) return
  working.value = true; uploadProgress.value = 3; errorMessage.value = ''; noticeMessage.value = ''
  try {
    const upload = await $api.post<UploadResponse>('/files/upload-sessions', { name: file.name, declaredMimeType: file.type, sizeBytes: file.size, access: { visibility: 'SCOPED', allowedRoles: ['admissions_staff'], programStudyIds: [application.programStudyId] } })
    uploadProgress.value = 10; await uploadToTarget(upload.data.upload, file); uploadProgress.value = 84
    await $api.post(`/files/upload-sessions/${encodeURIComponent(upload.data.session.id)}/finalize`); uploadProgress.value = 92
    await $api.post(`/admissions/applications/${encodeURIComponent(application.id)}/documents`, { documentType: selectedType.value, fileId: upload.data.file.id }, { headers: { 'Idempotency-Key': key('admission-document') } })
    uploadProgress.value = 100; selectedFile.value = null; if (fileInput.value) fileInput.value.value = ''
    noticeMessage.value = 'Berkas lolos pemindaian dan masuk antrean verifikasi PMB.'; await loadWorkspace()
  } catch (error) { errorMessage.value = errorText(error) } finally { working.value = false }
}

const review = async (document: AdmissionDocumentRecord, status: 'VERIFIED' | 'REJECTED') => {
  working.value = true; errorMessage.value = ''; noticeMessage.value = ''
  try {
    await $api.post(`/admissions/applications/${encodeURIComponent(document.applicationId)}/documents/${encodeURIComponent(document.id)}/review`, { status, reviewNote: reviewNote.value, expectedVersion: document.version })
    noticeMessage.value = `Dokumen berhasil ${status === 'VERIFIED' ? 'diverifikasi' : 'ditolak'}.`; await loadWorkspace()
  } catch (error) { errorMessage.value = errorText(error) } finally { working.value = false }
}

const download = async (document: AdmissionDocumentRecord) => {
  try { const response = await $api.post<{ url: string }>(`/files/${encodeURIComponent(document.fileId)}/download`, { version: document.fileVersion }); window.open(response.data.url, '_blank', 'noopener,noreferrer') } catch (error) { errorMessage.value = errorText(error) }
}

watch(applicationId, async () => { if (!loading.value) await loadWorkspace() })
onMounted(load)
</script>

<template>
  <div class="page-stack documents-page">
    <AppPageHeader eyebrow="Penerimaan mahasiswa baru" title="Dokumen pendaftaran" description="Berkas privat dipindai, ditautkan ke aplikasi, dan diverifikasi dengan histori versi serta checksum.">
      <template #actions><NuxtLink class="btn btn-outline-secondary" :to="staffMode ? '/pmb/kelola' : '/pmb'"><i class="uil uil-arrow-left me-2" />Kembali</NuxtLink><NuxtLink v-if="!staffMode" class="btn btn-primary" to="/berkas"><i class="uil uil-folder-open me-2" />Berkas saya</NuxtLink></template>
    </AppPageHeader>
    <div v-if="noticeMessage" class="alert alert-success">{{ noticeMessage }}</div><div v-if="errorMessage" class="alert alert-danger">{{ errorMessage }}</div><div v-if="loading" class="alert alert-info">Memuat checklist dokumen...</div>

    <section v-if="applications.length > 1" class="surface-card application-picker"><label>Aplikasi<select v-model="applicationId" class="form-select"><option v-for="item in applications" :key="item.id" :value="item.id">{{ item.registrationNumber }} · {{ item.programStudyId }}</option></select></label></section>
    <section v-if="workspace" class="application-context"><div><small>Nomor pendaftaran</small><strong>{{ workspace.application.registrationNumber }}</strong></div><div><small>Nama pendaftar</small><strong>{{ workspace.application.fullName }}</strong></div><div><small>Jalur</small><strong>{{ workspace.application.admissionPathId }}</strong></div><div><small>Kelengkapan</small><StatusBadge :status="workspace.complete ? 'success' : 'review'" :label="workspace.complete ? 'Lengkap' : 'Belum lengkap'" /></div></section>

    <div v-if="workspace" class="document-grid">
      <section class="surface-card checklist-card"><header><span>Persyaratan jalur</span><h2>Checklist wajib</h2><p>Status “lengkap” hanya tercapai bila seluruh butir telah diverifikasi petugas.</p></header><article v-for="item in workspace.checklist" :key="item.documentType"><span><i class="uil" :class="item.status === 'VERIFIED' ? 'uil-check-circle' : item.status === 'REJECTED' ? 'uil-times-circle' : 'uil-file-question-alt'" /></span><div><strong>{{ item.label }}</strong><small>{{ item.documentType }}</small></div><StatusBadge :status="statusTone(item.status)" :label="statusLabel(item.status)" /></article></section>

      <section v-if="!staffMode && pendingTypes.length" class="surface-card upload-card"><header><span>Unggah aman</span><h2>Kirim dokumen</h2><p>PDF/JPG/PNG melewati validasi ukuran, MIME, magic bytes, karantina, dan pemindaian malware.</p></header><form @submit.prevent="submitDocument"><label>Jenis dokumen<select v-model="selectedType" class="form-select"><option v-for="type in pendingTypes" :key="type" :value="type">{{ label(type) }}</option></select></label><label class="file-drop"><i class="uil uil-cloud-upload" /><strong>{{ selectedFile?.name || 'Pilih berkas' }}</strong><small>Maksimal sesuai kebijakan penyimpanan kampus</small><input ref="fileInput" type="file" accept=".pdf,.jpg,.jpeg,.png" required @change="selectedFile = ($event.target as HTMLInputElement).files?.[0] || null"></label><div v-if="working" class="progress"><div class="progress-bar" :style="{ width: `${uploadProgress}%` }" /></div><button class="btn btn-primary" :disabled="working || !selectedFile">{{ working ? 'Memproses...' : 'Unggah dan kirim' }}</button></form></section>

      <section class="surface-card history-card" :class="{ wide: staffMode || !pendingTypes.length }"><header><span>Arsip privat</span><h2>Riwayat berkas</h2><p v-if="staffMode">Buka berkas melalui URL bertanda tangan sebelum mengambil keputusan.</p></header><label v-if="staffMode" class="review-note">Catatan peninjau<input v-model="reviewNote" class="form-control"></label><article v-for="document in workspace.documents" :key="document.id"><span class="file-icon"><i class="uil uil-file-check-alt" /></span><div><div><strong>{{ label(document.documentType) }}</strong><StatusBadge :status="statusTone(document.status)" :label="statusLabel(document.status)" /></div><p>{{ document.fileName }} · {{ formatBytes(document.sizeBytes) }} · v{{ document.fileVersion }}</p><small>Checksum {{ document.checksumSha256.slice(0, 14) }}… · {{ formatDate(document.updatedAt) }}</small><small v-if="document.reviewNote">Catatan: {{ document.reviewNote }}</small></div><aside><button class="btn btn-sm btn-outline-secondary" @click="download(document)">Buka</button><template v-if="staffMode && document.status === 'PENDING'"><button class="btn btn-sm btn-outline-danger" :disabled="working" @click="review(document, 'REJECTED')">Tolak</button><button class="btn btn-sm btn-primary" :disabled="working" @click="review(document, 'VERIFIED')">Verifikasi</button></template></aside></article><EmptyState v-if="!workspace.documents.length" icon="uil-file-question-alt" title="Belum ada berkas" description="Berkas yang dikirim akan tampil di sini." /></section>
    </div>
  </div>
</template>

<style scoped>
.documents-page{display:grid;gap:1rem}.application-picker{padding:1rem}.application-picker label{display:grid;max-width:420px;gap:.3rem;font-size:.6rem;font-weight:700}.application-context{display:grid;grid-template-columns:repeat(4,1fr);gap:.8rem;padding:1rem;border:1px solid var(--campus-border);border-radius:.9rem;background:#fff}.application-context div{display:flex;flex-direction:column;gap:.2rem}.application-context small{color:#81908a;font-size:.52rem}.application-context strong{color:#35574b;font-size:.7rem}.document-grid{display:grid;grid-template-columns:.8fr 1.2fr;gap:1rem;align-items:start}.surface-card{padding:1rem}.surface-card>header{margin-bottom:.8rem}.surface-card>header span{color:#aa7b20;font-size:.52rem;font-weight:800;text-transform:uppercase}.surface-card h2{margin:.12rem 0;color:#315348;font-size:.9rem}.surface-card header p{margin:0;color:#7a8b84;font-size:.57rem}.checklist-card article{display:flex;align-items:center;gap:.55rem;padding:.65rem 0;border-top:1px solid var(--campus-border)}.checklist-card article>span{display:grid;width:2rem;height:2rem;place-items:center;border-radius:.55rem;color:#39765e;background:#e9f4ed}.checklist-card article>div{display:flex;flex:1;flex-direction:column}.checklist-card strong{font-size:.63rem}.checklist-card small{color:#8a9791;font-size:.49rem}.upload-card form{display:grid;gap:.7rem}.upload-card form>label:first-child,.review-note{display:grid;gap:.3rem;color:#60746c;font-size:.58rem;font-weight:700}.file-drop{position:relative;display:flex;min-height:135px;align-items:center;justify-content:center;flex-direction:column;border:1px dashed #a9c2b7;border-radius:.8rem;color:#3b715d;background:#f4f9f6;cursor:pointer}.file-drop i{font-size:1.4rem}.file-drop strong{margin-top:.2rem;font-size:.65rem}.file-drop small{color:#85938d;font-size:.5rem}.file-drop input{position:absolute;width:1px;height:1px;opacity:0}.history-card{grid-column:1/-1}.history-card.wide{grid-column:2}.review-note{margin-bottom:.65rem}.history-card article{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:.65rem;align-items:center;padding:.7rem 0;border-top:1px solid var(--campus-border)}.file-icon{display:grid;width:2.3rem;height:2.3rem;place-items:center;border-radius:.65rem;color:#39765e;background:#e9f4ed}.history-card article>div{display:grid;gap:.2rem}.history-card article>div>div{display:flex;align-items:center;gap:.5rem}.history-card strong{font-size:.64rem}.history-card p{margin:0;color:#62766e;font-size:.55rem}.history-card small{color:#88958f;font-size:.49rem}.history-card aside{display:flex;gap:.3rem}.form-control,.form-select{font-size:.68rem}@media(max-width:900px){.application-context{grid-template-columns:repeat(2,1fr)}.document-grid{grid-template-columns:1fr}.history-card,.history-card.wide{grid-column:1}}@media(max-width:600px){.application-context{grid-template-columns:1fr}.history-card article{grid-template-columns:auto 1fr}.history-card aside{grid-column:2;flex-wrap:wrap}}
</style>
