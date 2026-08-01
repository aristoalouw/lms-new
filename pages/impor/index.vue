<script setup lang="ts">
import type { ImportDataset, ImportIssue, ImportPreviewResult, ImportRun, ImportStagedRow } from '~/server/types/imports'
import type { AcademicAdministrationWorkspace, AcademicProgramStudy } from '~/server/types/academic-administration'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Impor Data Bertahap' })

const { $api } = useNuxtApp()
const config = useRuntimeConfig()
const dataset = ref<ImportDataset>('students')
const format = ref<'csv' | 'tsv'>('csv')
const sourceName = ref('mahasiswa-2026.csv')
const programStudyId = ref('')
const programs = ref<AcademicProgramStudy[]>([])
const content = ref('')
const current = ref<ImportPreviewResult | null>(null)
const history = ref<ImportRun[]>([])
const busy = ref('')
const message = ref('')
const errorMessage = ref('')
const sessionReady = ref(false)
const compensationReason = ref('Dataset sumber salah periode dan perlu dipulihkan secara terkontrol.')
const showCompensation = ref(false)
const operationKeys = reactive<Record<string, string>>({})

const samples: Record<ImportDataset, string> = {
  students: [
    'student_id,full_name,email,program_study_id,cohort_year,status',
    '261011001,Nadia Pratama,nadia@example.test,management-s1,2026,ACTIVE',
    '261011002,Bima Santoso,bima@example.test,management-s1,2026,ACTIVE',
    '261011003,Salsa Aulia,salsa@example.test,management-s1,2026,ACTIVE',
  ].join('\n'),
  courses: [
    'course_id,title,credits,program_study_id,active',
    'MN101,Pengantar Manajemen,3,management-s1,true',
    'MN102,Statistika Bisnis,3,management-s1,true',
  ].join('\n'),
  grades: [
    'grade_id,student_id,course_id,program_study_id,period_id,score',
    'GR-261011001-MN101,261011001,MN101,management-s1,2025-2026-2,88.5',
    'GR-261011002-MN101,261011002,MN101,management-s1,2025-2026-2,82',
  ].join('\n'),
}

content.value = samples.students
const sampleFor = (value: ImportDataset) => samples[value].replaceAll('management-s1', programStudyId.value || 'program-studi-id')

const randomKey = (prefix: string) => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`
const keyFor = (operation: string) => operationKeys[operation] ||= randomKey(operation)

const readableError = (error: unknown) => {
  const candidate = error as { response?: { data?: { statusMessage?: string; message?: string } }; message?: string }
  return candidate.response?.data?.statusMessage || candidate.response?.data?.message || candidate.message || 'Permintaan tidak dapat diselesaikan.'
}

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

const loadHistory = async () => {
  try {
    await ensureSession()
    const [historyResponse, academicResponse] = await Promise.all([
      $api.get<{ items: ImportRun[] }>('/imports', { params: { limit: 12 } }),
      $api.get<AcademicAdministrationWorkspace>('/academic/administration'),
    ])
    history.value = historyResponse.data.items
    programs.value = academicResponse.data.programs.filter(item => item.active)
    if (!programs.value.some(item => item.id === programStudyId.value)) programStudyId.value = programs.value[0]?.id || ''
    if (content.value === samples.students) content.value = sampleFor('students')
  } catch (error) {
    errorMessage.value = readableError(error)
  }
}

const createPreview = async () => {
  busy.value = 'preview'
  message.value = ''
  errorMessage.value = ''
  try {
    await ensureSession()
    const { data } = await $api.post<ImportPreviewResult>('/imports/preview', {
      dataset: dataset.value,
      format: format.value,
      sourceName: sourceName.value,
      programStudyId: programStudyId.value,
      content: content.value,
    }, { headers: { 'Idempotency-Key': keyFor('preview') } })
    current.value = data
    message.value = data.replayed ? 'Preview sebelumnya dimuat kembali tanpa membuat staging ganda.' : 'Preview selesai. Belum ada data master yang diubah.'
    await loadHistory()
  } catch (error) {
    errorMessage.value = readableError(error)
  } finally {
    busy.value = ''
  }
}

const approve = async () => {
  if (!current.value) return
  busy.value = 'approve'
  message.value = ''
  errorMessage.value = ''
  try {
    const run = current.value.run
    const { data } = await $api.post<{ run: ImportRun; replayed: boolean }>(`/imports/${run.id}/approve`, {
      expectedVersion: run.version,
      expectedChecksum: run.checksum,
    }, { headers: { 'Idempotency-Key': keyFor(`approve-${run.id}`) } })
    current.value.run = data.run
    message.value = 'Preview disetujui. Commit tetap membutuhkan tindakan eksplisit.'
    await loadHistory()
  } catch (error) {
    errorMessage.value = readableError(error)
  } finally {
    busy.value = ''
  }
}

const commit = async () => {
  if (!current.value) return
  busy.value = 'commit'
  message.value = ''
  errorMessage.value = ''
  try {
    const run = current.value.run
    const { data } = await $api.post<{ run: ImportRun; replayed: boolean }>(`/imports/${run.id}/commit`, {
      expectedVersion: run.version,
    }, { headers: { 'Idempotency-Key': keyFor(`commit-${run.id}`) } })
    current.value.run = data.run
    message.value = data.replayed ? 'Hasil commit idempoten dimuat kembali.' : `${data.run.counts.committed} perubahan berhasil diterapkan.${data.run.dataset === 'students' ? ' Lanjutkan data mahasiswa ke Onboarding Mahasiswa agar profil akademik, KRS, dan billing aktif.' : ''}`
    await loadHistory()
  } catch (error) {
    errorMessage.value = readableError(error)
  } finally {
    busy.value = ''
  }
}

const compensate = async () => {
  if (!current.value) return
  busy.value = 'compensate'
  message.value = ''
  errorMessage.value = ''
  try {
    const run = current.value.run
    const { data } = await $api.post<{ run: ImportRun; replayed: boolean }>(`/imports/${run.id}/compensate`, {
      expectedVersion: run.version,
      reason: compensationReason.value,
    }, { headers: { 'Idempotency-Key': keyFor(`compensate-${run.id}`) } })
    current.value.run = data.run
    showCompensation.value = false
    message.value = data.run.status === 'COMPENSATED'
      ? 'Seluruh perubahan impor berhasil dipulihkan.'
      : `${data.run.counts.compensationConflicts} record tidak ditimpa karena telah berubah setelah impor.`
    await loadHistory()
  } catch (error) {
    errorMessage.value = readableError(error)
  } finally {
    busy.value = ''
  }
}

const selectRun = async (run: ImportRun) => {
  busy.value = 'detail'
  errorMessage.value = ''
  try {
    const { data } = await $api.get<Omit<ImportPreviewResult, 'replayed'>>(`/imports/${run.id}`)
    current.value = { ...data, replayed: false }
  } catch (error) {
    errorMessage.value = readableError(error)
  } finally {
    busy.value = ''
  }
}

const onFile = async (event: Event) => {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  const extension = file.name.split('.').at(-1)?.toLowerCase()
  if (extension !== 'csv' && extension !== 'tsv') {
    errorMessage.value = 'Pilih berkas .csv atau .tsv.'
    return
  }
  if (file.size > 5 * 1024 * 1024) {
    errorMessage.value = 'Ukuran berkas melebihi 5 MB.'
    return
  }
  format.value = extension
  sourceName.value = file.name
  content.value = await file.text()
  current.value = null
  delete operationKeys.preview
}

const actionTone = (action: string) => ({ CREATE: 'success', UPDATE: 'review', SKIP: 'synced', INVALID: 'blocked' }[action] || 'pending')
const statusTone = (status: string) => ({
  PREVIEWED: 'review', APPROVED: 'active', COMMITTED: 'success', COMPENSATED: 'synced',
  PARTIALLY_COMPENSATED: 'blocked', FAILED: 'blocked', STAGING: 'processing', COMMITTING: 'processing', COMPENSATING: 'processing',
}[status] || 'pending')

const sampleRows = computed<Record<string, unknown>[]>(() => (current.value?.sampleRows || []).map((row: ImportStagedRow) => ({
  id: row.rowNumber,
  rowNumber: row.rowNumber,
  stableId: row.stableId || '—',
  label: String(row.data.fullName || row.data.title || row.data.courseId || row.data.studentId || '—'),
  programStudyId: row.data.programStudyId || '—',
  action: row.action,
})))
const issueRows = computed<Record<string, unknown>[]>(() => (current.value?.issues || []).map((item: ImportIssue, index) => ({
  id: `${item.rowNumber}-${item.code}-${index}`,
  rowNumber: item.rowNumber,
  field: item.field || '—',
  code: item.code,
  message: item.message,
  severity: item.severity,
})))
const historyRows = computed<Record<string, unknown>[]>(() => history.value.map(run => ({
  id: run.id,
  sourceName: run.sourceName,
  dataset: run.dataset,
  counts: `${run.counts.valid}/${run.counts.total}`,
  createdAt: new Date(run.createdAt).toLocaleString('id-ID'),
  status: run.status,
  run,
})))

const sampleColumns = [
  { key: 'rowNumber', label: 'Baris' }, { key: 'stableId', label: 'ID stabil' }, { key: 'label', label: 'Ringkasan' },
  { key: 'programStudyId', label: 'Program studi' }, { key: 'action', label: 'Rencana' },
]
const issueColumns = [
  { key: 'rowNumber', label: 'Baris' }, { key: 'field', label: 'Field' }, { key: 'code', label: 'Kode' },
  { key: 'message', label: 'Masalah' }, { key: 'severity', label: 'Tingkat' },
]
const historyColumns = [
  { key: 'sourceName', label: 'Sumber' }, { key: 'dataset', label: 'Dataset' }, { key: 'counts', label: 'Valid' },
  { key: 'createdAt', label: 'Dibuat' }, { key: 'status', label: 'Status' }, { key: 'action', label: '' },
]

watch(dataset, (value) => {
  content.value = sampleFor(value)
  sourceName.value = `${value}-2026.${format.value}`
  current.value = null
  delete operationKeys.preview
})
watch(format, (value) => {
  sourceName.value = sourceName.value.replace(/\.(csv|tsv)$/i, `.${value}`)
  if (value === 'tsv') content.value = content.value.replace(/,/g, '\t')
  else content.value = content.value.replace(/\t/g, ',')
  current.value = null
  delete operationKeys.preview
})
watch([content, programStudyId], () => { delete operationKeys.preview })

onMounted(loadHistory)
</script>

<template>
  <div class="page-stack" data-clarity-mask="true">
    <AppPageHeader
      eyebrow="Migrasi terkontrol"
      title="Impor Data Bertahap"
      description="Validasi sumber spreadsheet, tinjau rencana perubahan, minta persetujuan, lalu commit dengan jejak audit dan kompensasi."
      status="active"
      status-label="Tidak mengubah data saat preview"
    >
      <template #actions>
        <label class="btn btn-outline-secondary mb-0">
          <i class="uil uil-file-upload me-2" aria-hidden="true" />Pilih CSV/TSV
          <input class="visually-hidden" type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" @change="onFile">
        </label>
        <button class="btn btn-primary" type="button" :disabled="Boolean(busy)" @click="createPreview">
          <span v-if="busy === 'preview'" class="spinner-border spinner-border-sm me-2" aria-hidden="true" />
          <i v-else class="uil uil-search-alt me-2" aria-hidden="true" />Buat preview
        </button>
      </template>
    </AppPageHeader>

    <div v-if="message" class="alert alert-success d-flex align-items-start gap-2 mb-0" role="status"><i class="uil uil-check-circle" aria-hidden="true" /><span>{{ message }}</span></div>
    <div v-if="errorMessage" class="alert alert-danger d-flex align-items-start gap-2 mb-0" role="alert"><i class="uil uil-exclamation-triangle" aria-hidden="true" /><span>{{ errorMessage }}</span></div>

    <section class="workflow-surface">
      <header class="workflow-surface__header"><div><span class="section-kicker">Langkah 1</span><h2>Sumber dan ruang lingkup</h2><p>Isi data tidak disimpan mentah; staging hanya menyimpan nilai yang telah dinormalisasi.</p></div><span class="format-chip">Maks. 5 MB · 5.000 baris</span></header>
      <div class="workflow-surface__body">
        <div class="row g-3">
          <label class="col-sm-6 col-lg-3 form-label"><span>Dataset</span><select v-model="dataset" class="form-select"><option value="students">Mahasiswa</option><option value="courses">Mata kuliah</option><option value="grades">Nilai</option></select></label>
          <label class="col-sm-6 col-lg-3 form-label"><span>Program studi</span><select v-model="programStudyId" class="form-select" required><option value="" disabled>Pilih program nyata</option><option v-for="program in programs" :key="program.id" :value="program.id">{{ program.code }} · {{ program.name }}</option></select></label>
          <label class="col-sm-6 col-lg-3 form-label"><span>Format</span><select v-model="format" class="form-select"><option value="csv">CSV</option><option value="tsv">TSV</option></select></label>
          <label class="col-sm-6 col-lg-3 form-label"><span>Nama sumber</span><input v-model="sourceName" class="form-control" maxlength="120"></label>
          <label class="col-12 form-label"><span>Isi sumber</span><textarea v-model="content" class="form-control import-source" rows="9" spellcheck="false" aria-describedby="source-help" /></label>
          <p id="source-help" class="source-help mb-0"><i class="uil uil-shield-check" aria-hidden="true" /> Formula spreadsheet ditolak, identifier dideduplikasi, dan program studi diverifikasi terhadap scope akun.</p>
          <p v-if="dataset === 'students'" class="source-help mb-0"><i class="uil uil-link" aria-hidden="true" /> Commit impor membentuk registry dan provenance migrasi. Aktivasi profil akademik/KRS/billing dilakukan melalui <NuxtLink to="/akademik/mahasiswa">Onboarding Mahasiswa</NuxtLink> setelah akun student, dosen wali, periode, dan kurikulum nyata tersedia.</p>
        </div>
      </div>
    </section>

    <template v-if="current">
      <section class="row g-3" aria-label="Ringkasan preview">
        <div class="col-6 col-xl-3"><StatCard label="Total baris" :value="String(current.run.counts.total)" detail="Tidak termasuk header" trend="Sumber tervalidasi" tone="forest" /></div>
        <div class="col-6 col-xl-3"><StatCard label="Create / update" :value="`${current.run.counts.creates} / ${current.run.counts.updates}`" detail="Rencana perubahan" trend="Belum di-commit" tone="blue" /></div>
        <div class="col-6 col-xl-3"><StatCard label="Tanpa perubahan" :value="String(current.run.counts.skips)" detail="Fingerprint identik" trend="Akan dilewati" tone="slate" /></div>
        <div class="col-6 col-xl-3"><StatCard label="Error / peringatan" :value="`${current.run.counts.errors} / ${current.run.counts.warnings}`" detail="Hasil validasi" :trend="current.run.counts.errors ? 'Commit diblokir' : 'Siap ditinjau'" :tone="current.run.counts.errors ? 'coral' : 'amber'" /></div>
      </section>

      <section class="workflow-surface">
        <header class="workflow-surface__header import-review-head">
          <div><span class="section-kicker">Langkah 2</span><h2>Preview dan persetujuan</h2><p>Checksum {{ current.run.checksum.slice(0, 16) }}… · mapping {{ current.run.mappingVersion }}</p></div>
          <div class="review-actions">
            <StatusBadge :status="statusTone(current.run.status)" :label="current.run.status" />
            <button v-if="current.run.status === 'PREVIEWED'" class="btn btn-sm btn-outline-primary" type="button" :disabled="current.run.counts.errors > 0 || Boolean(busy)" @click="approve">Setujui preview</button>
            <button v-if="current.run.status === 'APPROVED'" class="btn btn-sm btn-primary" type="button" :disabled="Boolean(busy)" @click="commit">Commit perubahan</button>
            <button v-if="current.run.status === 'COMMITTED' || (current.run.status === 'FAILED' && current.run.counts.committed > 0)" class="btn btn-sm btn-outline-danger" type="button" :disabled="Boolean(busy)" @click="showCompensation = !showCompensation">Ajukan kompensasi</button>
          </div>
        </header>
        <DataTable :columns="sampleColumns" :rows="sampleRows" :page-size="8" search-placeholder="Cari ID atau ringkasan baris…" empty-title="Tidak ada baris valid" empty-description="Perbaiki sumber lalu buat preview baru.">
          <template #cell-stableId="{ value }"><code>{{ value }}</code></template>
          <template #cell-action="{ value }"><StatusBadge :status="actionTone(String(value))" :label="String(value)" /></template>
        </DataTable>
      </section>

      <section v-if="showCompensation" class="workflow-surface compensation-panel">
        <header class="workflow-surface__header"><div><span class="section-kicker">Tindakan berisiko</span><h2>Kompensasi perubahan</h2><p>Record yang telah berubah lagi setelah impor tidak akan ditimpa.</p></div></header>
        <div class="workflow-surface__body"><label class="form-label w-100"><span>Alasan audit</span><textarea v-model="compensationReason" class="form-control" rows="3" minlength="10" maxlength="500" /></label><div class="d-flex justify-content-end gap-2 mt-3"><button class="btn btn-sm btn-outline-secondary" type="button" @click="showCompensation = false">Batal</button><button class="btn btn-sm btn-danger" type="button" :disabled="compensationReason.trim().length < 10 || Boolean(busy)" @click="compensate">Jalankan kompensasi</button></div></div>
      </section>

      <section v-if="issueRows.length" class="workflow-surface">
        <header class="workflow-surface__header"><div><span class="section-kicker">Laporan validasi</span><h2>Masalah yang harus ditinjau</h2><p>Maksimal 100 masalah pertama ditampilkan tanpa mengekspose sumber mentah.</p></div></header>
        <DataTable :columns="issueColumns" :rows="issueRows" :page-size="8" search-placeholder="Cari kode atau field masalah…">
          <template #cell-code="{ value }"><code>{{ value }}</code></template>
          <template #cell-severity="{ value }"><StatusBadge :status="String(value) === 'ERROR' ? 'blocked' : 'review'" :label="String(value)" /></template>
        </DataTable>
      </section>
    </template>

    <section class="workflow-surface">
      <header class="workflow-surface__header"><div><span class="section-kicker">Jejak proses</span><h2>Riwayat staging dan commit</h2><p>Setiap langkah memiliki versi, checksum, pelaku, dan audit log terpisah.</p></div><button class="btn btn-sm btn-outline-secondary" type="button" :disabled="Boolean(busy)" @click="loadHistory"><i class="uil uil-refresh me-1" />Muat ulang</button></header>
      <DataTable :columns="historyColumns" :rows="historyRows" :page-size="8" search-placeholder="Cari sumber atau status impor…" empty-title="Belum ada riwayat impor" empty-description="Buat preview pertama untuk memulai staging.">
        <template #cell-status="{ value }"><StatusBadge :status="statusTone(String(value))" :label="String(value)" /></template>
        <template #cell-action="{ row }"><button class="btn btn-sm btn-link p-0" type="button" @click="selectRun(row.run as ImportRun)">Buka</button></template>
      </DataTable>
    </section>
  </div>
</template>

<style scoped src="~/pages/_workflow.css"></style>
<style scoped>
.form-label { display: grid; gap: .42rem; margin: 0; color: #526860; font-size: .72rem; font-weight: 750; }
.form-control, .form-select { border-color: #dce5e0; color: #29483e; font-size: .78rem; }
.import-source { min-height: 13rem; resize: vertical; font: 500 .72rem/1.65 ui-monospace, SFMono-Regular, Consolas, monospace; }
.source-help { display: flex; align-items: center; gap: .45rem; color: #74877f; font-size: .68rem; }
.source-help i { color: #3e7964; font-size: 1rem; }
.format-chip { padding: .4rem .65rem; border-radius: 999px; color: #587368; background: #edf4ef; font-size: .65rem; font-weight: 750; white-space: nowrap; }
.import-review-head { align-items: center; }
.review-actions { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: .55rem; }
code { color: #28624f; font-size: .68rem; }
.compensation-panel { border-color: #e8c8c4; }
.compensation-panel .workflow-surface__header { background: #fff9f8; }
@media (max-width: 767.98px) {
  .import-review-head { align-items: flex-start; }
  .review-actions { justify-content: flex-start; width: 100%; }
  .format-chip { display: none; }
}
</style>
