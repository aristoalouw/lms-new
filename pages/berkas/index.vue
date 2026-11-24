<script setup lang="ts">
import type { AxiosError } from 'axios'

definePageMeta({ middleware: 'auth' })

type FileStatus = 'UPLOADING' | 'QUARANTINED' | 'CLEAN' | 'REJECTED' | 'DELETED'
type FileMime = 'application/pdf' | 'image/jpeg' | 'image/png'

interface FileRecord {
  id: string
  ownerUid: string
  ownerName: string
  name: string
  mimeType: FileMime
  sizeBytes: number
  status: FileStatus
  currentVersion: number | null
  versionCount: number
  pendingVersion?: number
  updatedAt: string
  deleted: boolean
  access: { visibility: 'OWNER' | 'SCOPED' }
}

interface FileVersion {
  id: string
  version: number
  name: string
  status: Exclude<FileStatus, 'DELETED'>
  sizeBytes?: number
  expectedSizeBytes: number
  createdAt: string
  scannedAt?: string
  scanResult?: 'CLEAN' | 'INFECTED' | 'UNAVAILABLE' | 'ERROR'
  rejectionCode?: string
}

interface Quota {
  usedBytes: number
  reservedBytes: number
  limitBytes: number
}

interface FileListResponse {
  items: FileRecord[]
  nextCursor?: string
  quota: Quota
}

interface FileDetailResponse {
  file: FileRecord
  versions: FileVersion[]
  quota: Quota
}

interface FilePolicy {
  uploadsEnabled: boolean
  disabledReason?: string
  quotaBytes: number
  uploadSessionTtlSeconds: number
  downloadUrlTtlSeconds: number
  allowedTypes: Array<{ extension: string; mimeType: FileMime; maxSizeBytes: number; label: string }>
}

interface UploadSessionResponse {
  file: FileRecord
  session: { id: string; expiresAt: string; version: number }
  upload: { url: string; method: 'PUT'; headers: Record<string, string> }
  quota: Quota
}

const { user } = useAuth()
const { $api } = useNuxtApp()
const config = useRuntimeConfig()

useHead({ title: 'Berkas Privat' })

const files = ref<FileRecord[]>([])
const quota = ref<Quota>({ usedBytes: 0, reservedBytes: 0, limitBytes: 1 })
const policy = ref<FilePolicy | null>(null)
const nextCursor = ref<string>()
const loading = ref(true)
const loadingMore = ref(false)
const actionId = ref('')
const pageError = ref('')
const notice = ref<{ tone: 'success' | 'warning'; message: string } | null>(null)

const search = ref('')
const statusFilter = ref('')
const typeFilter = ref('')
const scopeFilter = ref<'owned' | 'accessible'>('owned')

const showUpload = ref(false)
const fileInput = ref<HTMLInputElement>()
const selectedFile = ref<File | null>(null)
const versionTarget = ref<FileRecord | null>(null)
const shareFile = ref(false)
const shareRole = ref('student')
const uploadProgress = ref(0)
const uploadStage = ref('')
const uploading = ref(false)
const uploadError = ref('')
const uploadsEnabled = computed(() => policy.value?.uploadsEnabled ?? Boolean(config.public.fileUploadsEnabled))
const uploadDisabledReason = computed(() => policy.value?.disabledReason || 'Unggahan file belum tersedia pada paket awal; gunakan rich text atau tautan HTTPS.')

const detailDialog = ref<HTMLDialogElement>()
const detail = ref<FileDetailResponse | null>(null)
const detailLoading = ref(false)

const canShare = computed(() => Boolean(user.value && [
  'lecturer', 'advisor', 'academic_staff', 'finance_staff', 'student_affairs_staff',
  'admissions_staff', 'leader', 'administrator',
].includes(user.value.activeRole)))

const allowedAccept = computed(() => policy.value
  ? policy.value.allowedTypes.map(type => `.${type.extension}`).join(',')
  : '.pdf,.jpg,.jpeg,.png')

const quotaPercent = computed(() => Math.min(100, Math.round(
  ((quota.value.usedBytes + quota.value.reservedBytes) / Math.max(quota.value.limitBytes, 1)) * 100,
)))
const cleanCount = computed(() => files.value.filter(file => file.status === 'CLEAN').length)
const quarantineCount = computed(() => files.value.filter(file => file.status === 'QUARANTINED').length)

const formatBytes = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
  return `${new Intl.NumberFormat('id-ID', { maximumFractionDigits: exponent ? 1 : 0 }).format(value / (1024 ** exponent))} ${units[exponent]}`
}

const formatDate = (value: string) => new Intl.DateTimeFormat('id-ID', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta',
}).format(new Date(value))

const statusPresentation: Record<FileStatus | FileVersion['status'], { badge: string; label: string; icon: string }> = {
  UPLOADING: { badge: 'processing', label: 'Mengunggah', icon: 'uil-cloud-upload' },
  QUARANTINED: { badge: 'review', label: 'Karantina', icon: 'uil-shield-exclamation' },
  CLEAN: { badge: 'success', label: 'Aman', icon: 'uil-file-check-alt' },
  REJECTED: { badge: 'blocked', label: 'Ditolak', icon: 'uil-file-block-alt' },
  DELETED: { badge: 'draft', label: 'Dihapus', icon: 'uil-trash-alt' },
}

const fileIcon = (mimeType: FileMime) => mimeType === 'application/pdf' ? 'uil-file-alt' : 'uil-image-v'

function errorMessage(error: unknown): string {
  const response = (error as AxiosError<{ statusMessage?: string; message?: string; data?: { code?: string } }>).response?.data
  return response?.statusMessage || response?.message || (error instanceof Error ? error.message : 'Permintaan tidak dapat diproses.')
}

function errorCode(error: unknown): string | undefined {
  const data = (error as AxiosError<{ data?: { code?: string }; code?: string }>).response?.data
  return data?.data?.code || data?.code
}

async function loadPolicy() {
  const { data } = await $api.get<FilePolicy>('/files/policy')
  policy.value = data
}

async function loadFiles(reset = true) {
  if (reset) {
    loading.value = true
    pageError.value = ''
  } else loadingMore.value = true
  try {
    const { data } = await $api.get<FileListResponse>('/files', {
      params: {
        scope: scopeFilter.value,
        search: search.value || undefined,
        status: statusFilter.value || undefined,
        mimeType: typeFilter.value || undefined,
        limit: 20,
        cursor: reset ? undefined : nextCursor.value,
      },
    })
    files.value = reset ? data.items : [...files.value, ...data.items]
    quota.value = data.quota
    nextCursor.value = data.nextCursor
  } catch (error) {
    pageError.value = errorMessage(error)
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

function chooseFile(file?: File) {
  uploadError.value = ''
  if (!file) return
  const type = policy.value?.allowedTypes.find(item => item.mimeType === file.type && file.name.toLowerCase().endsWith(`.${item.extension}`))
  if (!type) {
    uploadError.value = 'Pilih PDF, JPEG, atau PNG dengan ekstensi yang sesuai.'
    return
  }
  if (file.size > type.maxSizeBytes) {
    uploadError.value = `${type.label} maksimal ${formatBytes(type.maxSizeBytes)}.`
    return
  }
  selectedFile.value = file
}

function onFileInput(event: Event) {
  chooseFile((event.target as HTMLInputElement).files?.[0])
}

function onDrop(event: DragEvent) {
  chooseFile(event.dataTransfer?.files?.[0])
}

function openUpload(target?: FileRecord) {
  if (!uploadsEnabled.value) return
  versionTarget.value = target || null
  selectedFile.value = null
  shareFile.value = target?.access.visibility === 'SCOPED'
  uploadProgress.value = 0
  uploadStage.value = ''
  uploadError.value = ''
  showUpload.value = true
  window.setTimeout(() => fileInput.value?.focus(), 50)
}

function closeUpload() {
  if (uploading.value) return
  showUpload.value = false
  versionTarget.value = null
  selectedFile.value = null
}

function uploadToTarget(target: UploadSessionResponse['upload'], file: File): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open(target.method, target.url)
    request.withCredentials = target.url.startsWith('/')
    Object.entries(target.headers).forEach(([key, value]) => request.setRequestHeader(key, value))
    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) uploadProgress.value = Math.max(12, Math.round((event.loaded / event.total) * 70))
    })
    request.addEventListener('load', () => request.status >= 200 && request.status < 300
      ? resolve()
      : reject(new Error('Penyimpanan menolak data unggahan.')))
    request.addEventListener('error', () => reject(new Error('Koneksi unggahan terputus.')))
    request.addEventListener('abort', () => reject(new Error('Unggahan dibatalkan.')))
    request.send(file)
  })
}

async function startUpload() {
  const file = selectedFile.value
  if (!file || uploading.value) return
  uploading.value = true
  uploadError.value = ''
  uploadProgress.value = 5
  uploadStage.value = 'Memesan ruang privat…'
  try {
    const access = !versionTarget.value && shareFile.value
      ? {
          visibility: 'SCOPED',
          allowedRoles: [shareRole.value],
          programStudyIds: user.value?.programStudyId ? [user.value.programStudyId] : [],
        }
      : { visibility: 'OWNER' }
    const { data } = await $api.post<UploadSessionResponse>('/files/upload-sessions', {
      fileId: versionTarget.value?.id,
      name: file.name,
      declaredMimeType: file.type,
      sizeBytes: file.size,
      access,
    })
    uploadStage.value = 'Mengirim langsung ke penyimpanan privat…'
    uploadProgress.value = 12
    await uploadToTarget(data.upload, file)
    uploadStage.value = 'Memverifikasi format dan memindai malware…'
    uploadProgress.value = 84
    await $api.post(`/files/upload-sessions/${data.session.id}/finalize`)
    uploadProgress.value = 100
    uploadStage.value = 'File aman dan siap digunakan.'
    notice.value = { tone: 'success', message: `${file.name} lolos pemeriksaan dan tersimpan sebagai versi ${data.session.version}.` }
    await loadFiles()
    window.setTimeout(closeUpload, 650)
  } catch (error) {
    if (errorCode(error) === 'MALWARE_SCANNER_UNAVAILABLE') {
      uploadError.value = 'File tersimpan dalam karantina. Unduhan baru tersedia setelah pemindai keamanan kembali aktif.'
      notice.value = { tone: 'warning', message: uploadError.value }
      await loadFiles()
    } else uploadError.value = errorMessage(error)
  } finally {
    uploading.value = false
  }
}

async function openDetail(file: FileRecord) {
  detail.value = null
  detailLoading.value = true
  detailDialog.value?.showModal()
  try {
    const { data } = await $api.get<FileDetailResponse>(`/files/${file.id}`)
    detail.value = data
  } catch (error) {
    pageError.value = errorMessage(error)
    detailDialog.value?.close()
  } finally {
    detailLoading.value = false
  }
}

async function downloadFile(file: FileRecord, version?: number) {
  actionId.value = `download:${file.id}:${version || 'current'}`
  try {
    const { data } = await $api.post<{ url: string }>(`/files/${file.id}/download`, version ? { version } : {})
    window.location.assign(data.url)
  } catch (error) {
    pageError.value = errorMessage(error)
  } finally {
    actionId.value = ''
  }
}

async function deleteFile(file: FileRecord) {
  if (!window.confirm(`Hapus “${file.name}”? Metadata disembunyikan, tetapi objek tetap dipertahankan sesuai kebijakan retensi.`)) return
  actionId.value = `delete:${file.id}`
  try {
    await $api.delete(`/files/${file.id}`)
    detailDialog.value?.close()
    notice.value = { tone: 'success', message: `${file.name} telah dihapus secara lunak dan tidak dapat diunduh.` }
    await loadFiles()
  } catch (error) {
    pageError.value = errorMessage(error)
  } finally {
    actionId.value = ''
  }
}

onMounted(async () => {
  try {
    await Promise.all([loadPolicy(), loadFiles()])
  } catch (error) {
    pageError.value = errorMessage(error)
    loading.value = false
  }
})
</script>

<template>
  <div class="files-page">
    <AppPageHeader
      eyebrow="Penyimpanan privat"
      title="Berkas"
      description="Unggah, simpan, dan bagikan dokumen kampus secara privat."
    >
      <template #actions>
        <button class="btn btn-primary" type="button" :disabled="!uploadsEnabled" @click="openUpload()">
          <i class="uil uil-cloud-upload me-2" aria-hidden="true" />Unggah file
        </button>
      </template>
    </AppPageHeader>

    <div v-if="!uploadsEnabled" class="alert alert-info mb-0" role="status">
      <i class="uil uil-info-circle me-2" aria-hidden="true" />{{ uploadDisabledReason }}
    </div>

    <div v-if="notice" class="notice" :class="`notice--${notice.tone}`" role="status">
      <i :class="notice.tone === 'success' ? 'uil uil-check-circle' : 'uil uil-shield-exclamation'" aria-hidden="true" />
      <span>{{ notice.message }}</span>
      <button type="button" aria-label="Tutup pemberitahuan" @click="notice = null"><i class="uil uil-times" /></button>
    </div>

    <section class="summary-grid" aria-label="Ringkasan penyimpanan">
      <article class="summary-card summary-card--quota">
        <span class="summary-icon"><i class="uil uil-database" /></span>
        <div><small>Kuota digunakan</small><strong>{{ formatBytes(quota.usedBytes + quota.reservedBytes) }}</strong><p>dari {{ formatBytes(quota.limitBytes) }}</p></div>
        <div class="quota-ring" :style="{ '--quota': `${quotaPercent * 3.6}deg` }"><span>{{ quotaPercent }}%</span></div>
      </article>
      <article class="summary-card"><span class="summary-icon"><i class="uil uil-file-check-alt" /></span><div><small>File aman tampil</small><strong>{{ cleanCount }}</strong><p>Lolos verifikasi dan pemindaian</p></div></article>
      <article class="summary-card"><span class="summary-icon summary-icon--amber"><i class="uil uil-shield-exclamation" /></span><div><small>Dalam karantina</small><strong>{{ quarantineCount }}</strong><p>Tidak dapat diunduh sementara</p></div></article>
      <article class="summary-card"><span class="summary-icon summary-icon--blue"><i class="uil uil-lock-access" /></span><div><small>Privasi unduhan</small><strong>5 menit</strong><p>Tautan unduhan otomatis berakhir setelah 5 menit</p></div></article>
    </section>

    <section class="security-strip" aria-label="Perlindungan file">
      <span><i class="uil uil-shield-check" /></span>
      <div><strong>Pemeriksaan keamanan berkas aktif</strong><p>Jenis, ukuran, dan keamanan setiap berkas diperiksa sebelum dapat diunduh.</p></div>
      <small><i class="uil uil-lock me-1" />Tidak ada URL publik</small>
    </section>

    <section class="file-surface">
      <header class="file-toolbar">
        <div class="search-control">
          <i class="uil uil-search" aria-hidden="true" />
          <input v-model.trim="search" type="search" placeholder="Cari nama file…" aria-label="Cari nama file" @keyup.enter="loadFiles()">
          <button v-if="search" type="button" aria-label="Hapus pencarian" @click="search = ''; loadFiles()"><i class="uil uil-times" /></button>
        </div>
        <div class="filter-controls">
          <label><span class="visually-hidden">Lingkup</span><select v-model="scopeFilter" class="form-select form-select-sm" @change="loadFiles()"><option value="owned">Milik saya</option><option value="accessible">Dapat saya akses</option></select></label>
          <label><span class="visually-hidden">Status</span><select v-model="statusFilter" class="form-select form-select-sm" @change="loadFiles()"><option value="">Semua status</option><option value="CLEAN">Aman</option><option value="QUARANTINED">Karantina</option><option value="REJECTED">Ditolak</option><option value="UPLOADING">Mengunggah</option></select></label>
          <label><span class="visually-hidden">Jenis file</span><select v-model="typeFilter" class="form-select form-select-sm" @change="loadFiles()"><option value="">Semua jenis</option><option value="application/pdf">PDF</option><option value="image/jpeg">JPEG</option><option value="image/png">PNG</option></select></label>
          <button class="btn btn-sm btn-outline-secondary" type="button" aria-label="Terapkan filter" @click="loadFiles()"><i class="uil uil-filter" /></button>
        </div>
      </header>

      <div v-if="pageError" class="inline-error" role="alert"><i class="uil uil-exclamation-octagon" /><span>{{ pageError }}</span><button type="button" @click="pageError = ''; loadFiles()">Coba lagi</button></div>

      <div v-if="loading" class="files-loading" aria-live="polite"><span class="spinner-border spinner-border-sm" /><span>Memuat metadata berkas privat…</span></div>
      <EmptyState v-else-if="files.length === 0" title="Belum ada file pada tampilan ini" :description="uploadsEnabled ? 'Unggah file baru atau ubah lingkup dan filter pencarian.' : 'Penyimpanan file belum aktif pada paket awal.'" icon="uil-folder-open">
        <div class="d-flex gap-2 justify-content-center mt-2">
          <button v-if="uploadsEnabled" class="btn btn-sm btn-primary" type="button" @click="openUpload()">Unggah file pertama</button>
          <button v-if="nextCursor" class="btn btn-sm btn-outline-secondary" type="button" :disabled="loadingMore" @click="loadFiles(false)">Lanjutkan pencarian</button>
        </div>
      </EmptyState>

      <template v-else>
        <div class="file-table-wrap d-none d-md-block">
          <table class="file-table">
            <thead><tr><th>File</th><th>Pemilik & akses</th><th>Versi</th><th>Ukuran</th><th>Diperbarui</th><th>Status</th><th><span class="visually-hidden">Tindakan</span></th></tr></thead>
            <tbody>
              <tr v-for="file in files" :key="file.id">
                <td><button class="file-name" type="button" @click="openDetail(file)"><span><i class="uil" :class="fileIcon(file.mimeType)" /></span><span><strong>{{ file.name }}</strong><small>{{ file.mimeType }}</small></span></button></td>
                <td><strong class="owner-name">{{ file.ownerName }}</strong><small class="access-label"><i :class="file.access.visibility === 'OWNER' ? 'uil uil-lock' : 'uil uil-users-alt'" /> {{ file.access.visibility === 'OWNER' ? 'Hanya pemilik' : 'Lingkup terbatas' }}</small></td>
                <td><span class="version-chip">v{{ file.currentVersion || file.pendingVersion || 1 }}</span><small v-if="file.versionCount > 1" class="version-total">{{ file.versionCount }} versi aman</small></td>
                <td>{{ formatBytes(file.sizeBytes) }}</td>
                <td><time :datetime="file.updatedAt">{{ formatDate(file.updatedAt) }}</time></td>
                <td><StatusBadge :status="statusPresentation[file.status].badge" :label="statusPresentation[file.status].label" /></td>
                <td><div class="row-actions"><button type="button" title="Lihat detail" aria-label="Lihat detail" @click="openDetail(file)"><i class="uil uil-eye" /></button><button :disabled="file.status !== 'CLEAN' || actionId.startsWith('download:')" type="button" title="Unduh" aria-label="Unduh file" @click="downloadFile(file)"><i class="uil uil-download-alt" /></button></div></td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="file-cards d-md-none">
          <article v-for="file in files" :key="file.id" class="file-card">
            <button class="file-card__main" type="button" @click="openDetail(file)"><span class="file-card__icon"><i class="uil" :class="fileIcon(file.mimeType)" /></span><span><strong>{{ file.name }}</strong><small>{{ formatBytes(file.sizeBytes) }} · v{{ file.currentVersion || file.pendingVersion || 1 }}</small></span><i class="uil uil-angle-right-b" /></button>
            <footer><StatusBadge :status="statusPresentation[file.status].badge" :label="statusPresentation[file.status].label" /><time :datetime="file.updatedAt">{{ formatDate(file.updatedAt) }}</time><button :disabled="file.status !== 'CLEAN'" type="button" aria-label="Unduh file" @click="downloadFile(file)"><i class="uil uil-download-alt" /></button></footer>
          </article>
        </div>

        <footer v-if="nextCursor" class="load-more"><button class="btn btn-sm btn-outline-secondary" type="button" :disabled="loadingMore" @click="loadFiles(false)"><span v-if="loadingMore" class="spinner-border spinner-border-sm me-2" />Muat berikutnya</button></footer>
      </template>
    </section>

    <div v-if="showUpload" class="upload-backdrop" @click.self="closeUpload">
      <section class="upload-panel" role="dialog" aria-modal="true" aria-labelledby="upload-title">
        <header><div><span>{{ versionTarget ? `Versi baru · ${versionTarget.name}` : 'Unggahan privat' }}</span><h2 id="upload-title">{{ versionTarget ? 'Tambah versi file' : 'Unggah file baru' }}</h2></div><button type="button" aria-label="Tutup" :disabled="uploading" @click="closeUpload"><i class="uil uil-times" /></button></header>
        <div class="upload-panel__body">
          <label class="drop-zone" :class="{ 'drop-zone--selected': selectedFile }" @dragover.prevent @drop.prevent="onDrop">
            <input ref="fileInput" class="visually-hidden" type="file" :accept="allowedAccept" :disabled="uploading" @change="onFileInput">
            <span><i :class="selectedFile ? 'uil uil-file-check-alt' : 'uil uil-cloud-upload'" /></span>
            <strong>{{ selectedFile?.name || 'Pilih atau letakkan file di sini' }}</strong>
            <small v-if="selectedFile">{{ formatBytes(selectedFile.size) }} · {{ selectedFile.type }}</small>
            <small v-else>PDF maks. 25 MB · JPEG/PNG maks. 10 MB</small>
            <em>{{ selectedFile ? 'Pilih file lain' : 'Telusuri perangkat' }}</em>
          </label>

          <div v-if="!versionTarget && canShare" class="share-control">
            <label class="form-check form-switch"><input v-model="shareFile" class="form-check-input" type="checkbox" :disabled="uploading"><span><strong>Bagikan dalam lingkup kampus</strong><small>Server tetap memeriksa role dan program studi setiap kali unduhan diminta.</small></span></label>
            <label v-if="shareFile" class="share-role"><span>Penerima</span><select v-model="shareRole" class="form-select form-select-sm" :disabled="uploading"><option value="student">Mahasiswa satu prodi</option><option value="lecturer">Dosen satu prodi</option><option value="academic_staff">Staf akademik satu prodi</option></select></label>
          </div>

          <div class="policy-note"><i class="uil uil-shield-check" /><p><strong>Karantina otomatis</strong><span>Berkas dapat diunduh segera setelah pemeriksaan keamanan selesai.</span></p></div>
          <div v-if="uploading || uploadProgress" class="upload-progress" aria-live="polite"><div><span>{{ uploadStage }}</span><strong>{{ uploadProgress }}%</strong></div><div class="progress"><div class="progress-bar" :style="{ width: `${uploadProgress}%` }" /></div></div>
          <p v-if="uploadError" class="upload-error" role="alert"><i class="uil uil-exclamation-triangle" />{{ uploadError }}</p>
        </div>
        <footer><button class="btn btn-outline-secondary" type="button" :disabled="uploading" @click="closeUpload">Batal</button><button class="btn btn-primary" type="button" :disabled="!selectedFile || uploading" @click="startUpload"><span v-if="uploading" class="spinner-border spinner-border-sm me-2" />{{ versionTarget ? 'Unggah versi' : 'Unggah dan periksa' }}</button></footer>
      </section>
    </div>

    <dialog ref="detailDialog" class="detail-dialog" @click="($event.target === detailDialog) && detailDialog?.close()">
      <div class="detail-dialog__panel">
        <header><div><span>Detail file privat</span><h2>{{ detail?.file.name || 'Memuat file…' }}</h2></div><button type="button" aria-label="Tutup" @click="detailDialog?.close()"><i class="uil uil-times" /></button></header>
        <div v-if="detailLoading" class="detail-loading"><span class="spinner-border spinner-border-sm" />Memuat riwayat versi…</div>
        <template v-else-if="detail">
          <section class="detail-summary"><span class="detail-file-icon"><i class="uil" :class="fileIcon(detail.file.mimeType)" /></span><div><StatusBadge :status="statusPresentation[detail.file.status].badge" :label="statusPresentation[detail.file.status].label" /><p>{{ detail.file.ownerName }} · {{ detail.file.access.visibility === 'OWNER' ? 'Hanya pemilik' : 'Lingkup terbatas' }}</p></div><strong>{{ formatBytes(detail.file.sizeBytes) }}</strong></section>
          <section class="version-section"><header><div><span>Jejak perubahan</span><h3>Riwayat versi</h3></div><button class="btn btn-sm btn-outline-secondary" type="button" :disabled="detail.file.deleted || !uploadsEnabled" @click="detailDialog?.close(); openUpload(detail.file)"><i class="uil uil-plus me-1" />Versi baru</button></header><ol><li v-for="version in detail.versions" :key="version.id"><span class="version-number">v{{ version.version }}</span><div><strong>{{ version.name }}</strong><small>{{ formatDate(version.createdAt) }} · {{ formatBytes(version.sizeBytes || version.expectedSizeBytes) }}</small><em v-if="version.scanResult === 'UNAVAILABLE'">Menunggu pemindai keamanan</em><em v-if="version.rejectionCode === 'MALWARE_DETECTED'" class="text-danger">Malware terdeteksi; objek ditolak</em></div><StatusBadge :status="statusPresentation[version.status].badge" :label="statusPresentation[version.status].label" /><button v-if="version.status === 'CLEAN'" type="button" aria-label="Unduh versi ini" @click="downloadFile(detail.file, version.version)"><i class="uil uil-download-alt" /></button></li></ol></section>
          <footer><button class="btn btn-sm btn-outline-danger" type="button" :disabled="actionId === `delete:${detail.file.id}` || detail.file.deleted" @click="deleteFile(detail.file)"><i class="uil uil-trash-alt me-1" />Hapus file</button><button class="btn btn-sm btn-primary" type="button" :disabled="detail.file.status !== 'CLEAN'" @click="downloadFile(detail.file)"><i class="uil uil-download-alt me-1" />Unduh terbaru</button></footer>
        </template>
      </div>
    </dialog>
  </div>
</template>

<style scoped>
.files-page { display: grid; gap: 1.35rem; }
.notice { display: grid; grid-template-columns: auto 1fr auto; gap: .7rem; align-items: center; padding: .75rem .9rem; border: 1px solid #bedfca; border-radius: .8rem; color: #2f654e; background: #f0f8f3; font-size: .72rem; }
.notice--warning { border-color: #ead9ad; color: #7c5f21; background: #fff9eb; }
.notice > i { font-size: 1rem; }.notice button { border: 0; color: inherit; background: transparent; }
.summary-grid { display: grid; grid-template-columns: 1.35fr repeat(3, 1fr); gap: .85rem; }
.summary-card { display: flex; gap: .8rem; align-items: center; min-width: 0; padding: 1rem; border: 1px solid #e1e8e4; border-radius: .95rem; background: #fff; box-shadow: 0 3px 14px rgba(27,59,49,.035); }
.summary-card--quota { position: relative; padding-right: 4.6rem; }.summary-icon { display: grid; place-items: center; flex: 0 0 auto; width: 2.45rem; height: 2.45rem; border-radius: .75rem; color: #376d59; background: #e9f4ed; font-size: 1.12rem; }.summary-icon--amber { color: #87621e; background: #fbefd7; }.summary-icon--blue { color: #397180; background: #e6f2f5; }
.summary-card small,.summary-card strong,.summary-card p { display: block; }.summary-card small { color: #7d8d86; font-size: .61rem; font-weight: 700; }.summary-card strong { margin-top: .12rem; color: #294a3e; font-size: 1.05rem; }.summary-card p { overflow: hidden; margin: .12rem 0 0; color: #8b9993; font-size: .59rem; line-height: 1.4; text-overflow: ellipsis; white-space: nowrap; }
.quota-ring { position: absolute; right: 1rem; display: grid; place-items: center; width: 3rem; height: 3rem; border-radius: 50%; background: conic-gradient(#447c65 var(--quota), #eaf0ec 0); }.quota-ring::after { position: absolute; width: 2.2rem; height: 2.2rem; border-radius: 50%; background: white; content: ''; }.quota-ring span { z-index: 1; color: #3d6857; font-size: .58rem; font-weight: 800; }
.security-strip { display: grid; grid-template-columns: auto 1fr auto; gap: .75rem; align-items: center; padding: .8rem 1rem; border: 1px solid #d5e5dc; border-radius: .85rem; background: linear-gradient(90deg,#f1f8f3,#f8fbf9); }.security-strip > span { display: grid; place-items: center; width: 2.25rem; height: 2.25rem; border-radius: .65rem; color: white; background: #3e745d; }.security-strip strong { display: block; color: #315545; font-size: .7rem; }.security-strip p { margin: .15rem 0 0; color: #75877f; font-size: .62rem; }.security-strip > small { padding: .35rem .6rem; border-radius: 999px; color: #47705f; background: white; font-size: .58rem; font-weight: 800; }
.file-surface { overflow: hidden; border: 1px solid #dfe7e2; border-radius: 1rem; background: white; box-shadow: 0 5px 20px rgba(25,58,46,.04); }.file-toolbar { display: flex; gap: .8rem; justify-content: space-between; padding: 1rem; border-bottom: 1px solid #eaf0ec; }.search-control { display: flex; align-items: center; width: min(360px,100%); padding: 0 .65rem; border: 1px solid #dce5e0; border-radius: .65rem; background: #fbfcfb; }.search-control > i { color: #7e9088; }.search-control input { flex: 1; min-width: 0; padding: .52rem; border: 0; outline: 0; background: transparent; font-size: .7rem; }.search-control button { border: 0; color: #7a8b84; background: transparent; }.filter-controls { display: flex; gap: .45rem; }.filter-controls .form-select { min-width: 125px; border-color: #dce5e0; font-size: .65rem; }
.inline-error { display: flex; gap: .55rem; align-items: center; margin: .85rem; padding: .7rem .8rem; border: 1px solid #edcfc8; border-radius: .7rem; color: #8a4134; background: #fff7f5; font-size: .67rem; }.inline-error span { flex: 1; }.inline-error button { border: 0; color: #7b382e; background: transparent; font-weight: 800; }.files-loading,.detail-loading { display: flex; gap: .6rem; align-items: center; justify-content: center; min-height: 12rem; color: #768981; font-size: .68rem; }
.file-table-wrap { overflow-x: auto; }.file-table { width: 100%; min-width: 920px; border-collapse: collapse; }.file-table th { padding: .7rem .8rem; color: #788981; background: #f7faf8; font-size: .58rem; letter-spacing: .03em; text-align: left; text-transform: uppercase; }.file-table td { padding: .78rem .8rem; border-top: 1px solid #edf1ef; color: #576a62; font-size: .64rem; vertical-align: middle; }.file-table tbody tr:hover { background: #fbfdfc; }.file-name { display: flex; gap: .65rem; align-items: center; max-width: 280px; padding: 0; border: 0; color: inherit; background: none; text-align: left; }.file-name > span:first-child,.file-card__icon { display: grid; place-items: center; flex: 0 0 auto; width: 2.25rem; height: 2.25rem; border-radius: .62rem; color: #3e745f; background: #eaf4ed; font-size: 1rem; }.file-name > span:last-child { min-width: 0; }.file-name strong,.file-name small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.file-name strong { color: #2f5043; font-size: .68rem; }.file-name small,.access-label,.version-total { margin-top: .13rem; color: #8a9892; font-size: .56rem; }.owner-name { display: block; color: #486157; font-size: .62rem; }.access-label { display: block; }.version-chip { display: inline-grid; place-items: center; min-width: 1.8rem; padding: .18rem .35rem; border-radius: .4rem; color: #426b5b; background: #edf4ef; font-size: .58rem; font-weight: 800; }.version-total { display: block; }.row-actions { display: flex; gap: .25rem; justify-content: flex-end; }.row-actions button,.file-card footer button,.version-section li > button { display: grid; place-items: center; width: 1.9rem; height: 1.9rem; border: 1px solid #dfe6e2; border-radius: .5rem; color: #537267; background: white; }.row-actions button:disabled,.file-card footer button:disabled { opacity: .35; }.load-more { padding: .9rem; border-top: 1px solid #edf1ef; text-align: center; }
.file-cards { display: grid; gap: .7rem; padding: .8rem; }.file-card { overflow: hidden; border: 1px solid #e0e8e3; border-radius: .8rem; }.file-card__main { display: grid; grid-template-columns: auto 1fr auto; gap: .65rem; align-items: center; width: 100%; padding: .75rem; border: 0; background: white; text-align: left; }.file-card__main > span:nth-child(2) { min-width: 0; }.file-card__main strong,.file-card__main small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.file-card__main strong { color: #315044; font-size: .7rem; }.file-card__main small { margin-top: .15rem; color: #899790; font-size: .57rem; }.file-card footer { display: flex; gap: .5rem; align-items: center; padding: .55rem .7rem; border-top: 1px solid #edf1ef; background: #fafcfa; }.file-card footer time { flex: 1; color: #899790; font-size: .54rem; text-align: right; }
.upload-backdrop { position: fixed; z-index: 1060; inset: 0; display: flex; justify-content: flex-end; background: rgba(18,39,32,.38); backdrop-filter: blur(2px); }.upload-panel { display: flex; flex-direction: column; width: min(520px,100%); height: 100%; background: white; box-shadow: -14px 0 40px rgba(13,34,27,.16); animation: slide-in .18s ease-out; }.upload-panel > header,.detail-dialog__panel > header { display: flex; align-items: flex-start; justify-content: space-between; padding: 1.1rem 1.2rem; border-bottom: 1px solid #e8eeea; }.upload-panel > header span,.detail-dialog__panel > header span,.version-section > header span { color: #648075; font-size: .56rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }.upload-panel h2,.detail-dialog h2 { margin: .2rem 0 0; color: #294b3e; font-size: 1rem; }.upload-panel > header button,.detail-dialog__panel > header button { display: grid; place-items: center; width: 2rem; height: 2rem; border: 1px solid #dce5e0; border-radius: .55rem; color: #637970; background: white; }.upload-panel__body { display: grid; gap: 1rem; overflow-y: auto; flex: 1; padding: 1.2rem; }.drop-zone { display: flex; align-items: center; flex-direction: column; justify-content: center; min-height: 220px; padding: 1.2rem; border: 1.5px dashed #b9cec2; border-radius: .9rem; background: #f8fbf9; cursor: pointer; text-align: center; }.drop-zone--selected { border-style: solid; border-color: #8eb4a2; background: #f1f8f3; }.drop-zone > span { display: grid; place-items: center; width: 3.5rem; height: 3.5rem; margin-bottom: .75rem; border-radius: 1rem; color: #3e745d; background: #e4f1e8; font-size: 1.55rem; }.drop-zone strong { max-width: 100%; overflow: hidden; color: #305144; font-size: .8rem; text-overflow: ellipsis; white-space: nowrap; }.drop-zone small { margin-top: .3rem; color: #809189; font-size: .62rem; }.drop-zone em { margin-top: .75rem; padding: .4rem .75rem; border: 1px solid #d7e3dc; border-radius: .55rem; color: #416a59; background: white; font-size: .62rem; font-style: normal; font-weight: 800; }.share-control { display: grid; gap: .75rem; padding: .85rem; border: 1px solid #e0e8e3; border-radius: .8rem; }.share-control .form-check { display: flex; gap: .65rem; margin: 0; }.share-control .form-check-input { flex: 0 0 auto; margin-left: 0; }.share-control strong,.share-control small { display: block; }.share-control strong { color: #385448; font-size: .69rem; }.share-control small { margin-top: .15rem; color: #819089; font-size: .59rem; line-height: 1.4; }.share-role { display: flex; gap: .6rem; align-items: center; }.share-role > span { color: #6d8078; font-size: .61rem; font-weight: 700; }.share-role select { flex: 1; font-size: .64rem; }.policy-note { display: flex; gap: .6rem; padding: .7rem; border-radius: .7rem; color: #396551; background: #edf6f0; }.policy-note > i { font-size: 1rem; }.policy-note p { margin: 0; }.policy-note strong,.policy-note span { display: block; }.policy-note strong { font-size: .65rem; }.policy-note span { margin-top: .12rem; color: #6e8479; font-size: .58rem; line-height: 1.4; }.upload-progress > div:first-child { display: flex; justify-content: space-between; margin-bottom: .35rem; color: #647a70; font-size: .61rem; }.upload-progress .progress { height: .38rem; background: #e6eee9; }.upload-progress .progress-bar { background: #477d66; }.upload-error { display: flex; gap: .4rem; margin: 0; padding: .65rem; border: 1px solid #edd2c9; border-radius: .65rem; color: #8d4637; background: #fff7f5; font-size: .62rem; line-height: 1.45; }.upload-panel > footer { display: flex; gap: .6rem; justify-content: flex-end; padding: 1rem 1.2rem; border-top: 1px solid #e8eeea; }
.detail-dialog { width: min(680px,calc(100% - 2rem)); max-width: none; max-height: calc(100vh - 2rem); padding: 0; border: 0; border-radius: 1rem; background: transparent; box-shadow: 0 24px 70px rgba(12,34,26,.22); }.detail-dialog::backdrop { background: rgba(18,39,32,.42); backdrop-filter: blur(2px); }.detail-dialog__panel { overflow: hidden; border-radius: 1rem; background: white; }.detail-summary { display: flex; gap: .75rem; align-items: center; padding: 1rem 1.2rem; border-bottom: 1px solid #e9efeb; background: #f8fbf9; }.detail-file-icon { display: grid; place-items: center; width: 2.8rem; height: 2.8rem; border-radius: .8rem; color: #3e725d; background: #e5f1e9; font-size: 1.2rem; }.detail-summary > div { flex: 1; }.detail-summary p { margin: .3rem 0 0; color: #829088; font-size: .6rem; }.detail-summary > strong { color: #3b5d50; font-size: .72rem; }.version-section { max-height: 52vh; overflow-y: auto; padding: 1rem 1.2rem; }.version-section > header { display: flex; align-items: center; justify-content: space-between; }.version-section h3 { margin: .15rem 0 0; color: #315044; font-size: .84rem; }.version-section ol { display: grid; margin: .8rem 0 0; padding: 0; list-style: none; }.version-section li { display: grid; grid-template-columns: auto 1fr auto auto; gap: .6rem; align-items: center; padding: .72rem 0; border-top: 1px solid #edf1ef; }.version-number { display: grid; place-items: center; width: 2rem; height: 2rem; border-radius: .55rem; color: #426a59; background: #edf4ef; font-size: .58rem; font-weight: 800; }.version-section li > div { min-width: 0; }.version-section li strong,.version-section li small,.version-section li em { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.version-section li strong { color: #3b594d; font-size: .65rem; }.version-section li small,.version-section li em { margin-top: .13rem; color: #87958f; font-size: .55rem; font-style: normal; }.detail-dialog__panel > footer { display: flex; gap: .6rem; justify-content: space-between; padding: .9rem 1.2rem; border-top: 1px solid #e8eeea; }
@keyframes slide-in { from { transform: translateX(30px); opacity: .6; } }
@media (max-width: 1199.98px) { .summary-grid { grid-template-columns: repeat(2,1fr); } }
@media (max-width: 767.98px) { .files-page { gap: 1rem; }.summary-grid { grid-template-columns: 1fr; }.summary-card { min-height: 74px; }.security-strip { grid-template-columns: auto 1fr; }.security-strip > small { grid-column: 2; justify-self: start; }.file-toolbar { align-items: stretch; flex-direction: column; }.search-control { width: 100%; }.filter-controls { display: grid; grid-template-columns: repeat(2,1fr); }.filter-controls label:first-child { grid-column: 1 / -1; }.filter-controls .form-select { width: 100%; min-width: 0; }.filter-controls > button { grid-row: 2; grid-column: 2; justify-self: end; }.upload-panel { width: 100%; }.version-section li { grid-template-columns: auto 1fr auto; }.version-section li > button { grid-column: 3; }.detail-dialog__panel > footer { align-items: stretch; flex-direction: column-reverse; }.detail-dialog__panel > footer .btn { width: 100%; }.drop-zone { min-height: 180px; } }
@media (prefers-reduced-motion: reduce) { .upload-panel { animation: none; } }
</style>
