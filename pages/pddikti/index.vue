<script setup lang="ts">
import type {
  AcademicAdministrationWorkspace,
  AcademicPeriodDefinition,
  AcademicProgramStudy,
} from '~/server/types/academic-administration'
import type { PddiktiEntityType, PddiktiJobStatus } from '~/server/types/domain'
import { PDDIKTI_ENTITY_TYPES } from '~/server/types/domain'
import type {
  PddiktiBatchResultHistory,
  PddiktiEntityMapping,
  PddiktiReadinessSummary,
  PddiktiReconciliation,
  PddiktiWorkerJob,
  PddiktiWorkerStatus,
} from '~/server/types/pddikti'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Pelaporan PDDIKTI' })

const config = useRuntimeConfig()
const { $api } = useNuxtApp()
const { user, can } = useAuth()
const activeTab = ref<'readiness' | 'queue' | 'reconciliation'>('readiness')
const loading = ref(false)
const mutating = ref(false)
const errorMessage = ref('')
const noticeMessage = ref('')
const programs = ref<AcademicProgramStudy[]>([])
const periods = ref<AcademicPeriodDefinition[]>([])
const programStudyId = ref(config.public.demoMode ? 'management-s1' : user.value?.programStudyId || '')
const periodId = ref(config.public.demoMode ? '2025-2026-2' : '')
const queueForm = reactive({ entityType: 'grade' as PddiktiEntityType, entityIds: config.public.demoMode ? 'grade-101, grade-102' : '' })
const compareEntity = ref<PddiktiEntityType>('grade')
const selectedReconciliationId = ref('')
const selectedRows = ref<string[]>([])
const jobDetail = ref<{ job: PddiktiWorkerJob; results: PddiktiBatchResultHistory[]; mappings: PddiktiEntityMapping[] } | null>(null)

const demoJob = (overrides: Partial<PddiktiWorkerJob>): PddiktiWorkerJob => ({
  id: 'sync-demo-001', entityType: 'grade', entityIds: ['grade-101', 'grade-102'], programStudyId: 'management-s1', periodId: '2025-2026-2',
  status: 'SUCCEEDED', attempts: 1, maxAttempts: 5, createdAt: '2026-07-20T17:38:00.000Z', createdBy: 'academic-001', updatedAt: '2026-07-20T17:40:00.000Z', nextAttemptAt: '2026-07-20T17:38:00.000Z',
  contractVersion: 'campus-pddikti-gateway/2026-01', mappingVersion: 'grade-mapping-v1', payloadFingerprint: 'd3fd9d61885b54aa799ed83c41c746ddabc319629477368664a9f5f71be47c03',
  recordCount: 2, leaseRecoveries: 0, acceptedCount: 2, rejectedCount: 0,
  history: [{ id: 'event-demo-1', type: 'QUEUED', occurredAt: '2026-07-20T17:38:00.000Z', actor: 'academic-001', attempt: 0 }, { id: 'event-demo-2', type: 'SUCCEEDED', occurredAt: '2026-07-20T17:40:00.000Z', actor: 'worker-01', attempt: 1, accepted: 2, rejected: 0 }],
  ...overrides,
})

const demoReadiness: PddiktiReadinessSummary = {
  programStudyId: 'management-s1', periodId: '2025-2026-2', generatedAt: '2026-07-21T03:14:00.000Z', total: 982, eligible: 951, blocked: 31, completenessPercent: 96.84,
  entities: PDDIKTI_ENTITY_TYPES.map((entityType, index): PddiktiReadinessSummary['entities'][number] => ({ entityType, total: [210, 48, 64, 86, 520, 38, 16][index]!, eligible: [205, 48, 64, 82, 500, 36, 16][index]!, blocked: [5, 0, 0, 4, 20, 2, 0][index]!, queued: index === 4 ? 12 : 0, synced: [198, 48, 64, 80, 486, 34, 14][index]!, completenessPercent: [97.62, 100, 100, 95.35, 96.15, 94.74, 100][index]!, blockerCounts: index === 4 ? { FINAL_GRADE_MISSING: 20 } : {}, mappingVersion: `${entityType}-mapping-v1` })),
}
const demoWorkerStatus: PddiktiWorkerStatus = {
  contract: { name: 'campus-pddikti-gateway', version: 'campus-pddikti-gateway/2026-01', operationKeys: {}, maxBatchSize: 50, timeoutMs: 20_000 },
  adapter: { configured: false, reachable: false, contractVersion: 'campus-pddikti-gateway/2026-01', checkedAt: '2026-07-21T03:14:00.000Z', message: 'Mode demo tidak membuat klaim koneksi Neo Feeder.' },
  queue: { QUEUED: 1, PROCESSING: 0, SUCCEEDED: 1, FAILED: 1, DEAD_LETTER: 0 },
}
const demoReconciliation: PddiktiReconciliation = {
  id: 'pddikti-reconciliation-demo-001', entityType: 'grade', programStudyId: 'management-s1', periodId: '2025-2026-2', contractVersion: 'campus-pddikti-gateway/2026-01', mappingVersion: 'grade-mapping-v1', status: 'OPEN', version: 1,
  createdAt: '2026-07-21T03:00:00.000Z', createdBy: 'academic-001', updatedAt: '2026-07-21T03:00:00.000Z', summary: { MATCH: 1, DIFFERENT: 1, MISSING_REMOTE: 1, MISSING_INTERNAL: 1 },
  rows: [
    { key: 'row-demo-1', internalId: 'grade-101', remoteId: 'remote-grade-101', state: 'MATCH', differingFields: [], internalFingerprint: 'internal-a', remoteFingerprint: 'remote-a' },
    { key: 'row-demo-2', internalId: 'grade-102', remoteId: 'remote-grade-102', state: 'DIFFERENT', differingFields: ['finalGrade', 'letterGrade'], internalFingerprint: 'internal-b', remoteFingerprint: 'remote-b' },
    { key: 'row-demo-3', internalId: 'grade-103', state: 'MISSING_REMOTE', differingFields: [], internalFingerprint: 'internal-c' },
    { key: 'row-demo-4', remoteId: 'remote-grade-999', state: 'MISSING_INTERNAL', differingFields: [], remoteFingerprint: 'remote-d' },
  ],
}

const readiness = ref<PddiktiReadinessSummary | null>(config.public.demoMode ? demoReadiness : null)
const workerStatus = ref<PddiktiWorkerStatus | null>(config.public.demoMode ? demoWorkerStatus : null)
const jobs = ref<PddiktiWorkerJob[]>(config.public.demoMode ? [demoJob({}), demoJob({ id: 'sync-demo-002', entityType: 'student', entityIds: ['student-009'], recordCount: 1, status: 'FAILED', attempts: 2, acceptedCount: 0, rejectedCount: 0, updatedAt: '2026-07-21T00:09:00.000Z', lastError: { code: 'ADAPTER_TIMEOUT', message: 'Gateway tidak merespons dalam batas waktu.', occurredAt: '2026-07-21T00:09:00.000Z' } })] : [])
const reconciliations = ref<PddiktiReconciliation[]>(config.public.demoMode ? [demoReconciliation] : [])
const selectedReconciliation = computed(() => reconciliations.value.find(item => item.id === selectedReconciliationId.value) ?? reconciliations.value[0])
const canMutate = computed(() => can('pddikti:queue') || can('pddikti:retry'))

const entityLabels: Record<PddiktiEntityType, string> = { student: 'Mahasiswa', lecturer: 'Dosen', course: 'Mata kuliah', class: 'Kelas kuliah', grade: 'Nilai', student_activity: 'Aktivitas mahasiswa', graduation: 'Kelulusan' }
const statusLabels: Record<PddiktiJobStatus, string> = { QUEUED: 'Menunggu', PROCESSING: 'Diproses', SUCCEEDED: 'Berhasil', FAILED: 'Gagal', DEAD_LETTER: 'Dead letter' }
const statusTones: Record<PddiktiJobStatus, string> = { QUEUED: 'pending', PROCESSING: 'processing', SUCCEEDED: 'success', FAILED: 'blocked', DEAD_LETTER: 'blocked' }
const differenceLabels = { MATCH: 'Sama', DIFFERENT: 'Berbeda', MISSING_REMOTE: 'Belum ada di remote', MISSING_INTERNAL: 'Tidak ada di internal' }
const differenceTones = { MATCH: 'success', DIFFERENT: 'review', MISSING_REMOTE: 'pending', MISSING_INTERNAL: 'blocked' }
const dateLabel = (value?: string) => value ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(value)) : '-'
const errorText = (error: unknown) => {
  const candidate = error as { response?: { data?: { statusMessage?: string; message?: string } }; message?: string }
  return candidate.response?.data?.statusMessage || candidate.response?.data?.message || candidate.message || 'Permintaan tidak dapat diselesaikan.'
}
const mutationKey = (action: string) => `${action}:${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`

const loadCatalog = async () => {
  if (config.public.demoMode) return
  const { data } = await $api.get<AcademicAdministrationWorkspace>('/academic/administration')
  programs.value = data.programs.filter(program => program.active)
  periods.value = data.periods.filter(period => period.active)
  if (!programs.value.some(program => program.id === programStudyId.value)) {
    const scopedProgram = user.value?.programStudyId
    programStudyId.value = programs.value.find(program => program.id === scopedProgram)?.id
      || (programs.value.length === 1 ? programs.value[0]!.id : '')
  }
  if (!periods.value.some(period => period.id === periodId.value)) periodId.value = periods.value[0]?.id || ''
}

const loadWorkspace = async () => {
  if (config.public.demoMode) return
  if (!programStudyId.value || !periodId.value) {
    readiness.value = null
    workerStatus.value = null
    jobs.value = []
    reconciliations.value = []
    errorMessage.value = 'Pilih program studi dan periode akademik dari master resmi.'
    return
  }
  loading.value = true
  errorMessage.value = ''
  try {
    const query = `programStudyId=${encodeURIComponent(programStudyId.value)}&periodId=${encodeURIComponent(periodId.value)}`
    const [readinessResponse, workerResponse, jobsResponse, reconciliationResponse] = await Promise.all([
      $api.get<PddiktiReadinessSummary>(`/pddikti/readiness?${query}`),
      $api.get<PddiktiWorkerStatus>(`/pddikti/worker/status?programStudyId=${encodeURIComponent(programStudyId.value)}`),
      $api.get<{ jobs: PddiktiWorkerJob[] }>(`/pddikti/jobs?programStudyId=${encodeURIComponent(programStudyId.value)}`),
      $api.get<{ reconciliations: PddiktiReconciliation[] }>(`/pddikti/reconciliations?programStudyId=${encodeURIComponent(programStudyId.value)}`),
    ])
    readiness.value = readinessResponse.data
    workerStatus.value = workerResponse.data
    jobs.value = jobsResponse.data.jobs
    reconciliations.value = reconciliationResponse.data.reconciliations
    selectedReconciliationId.value = reconciliations.value[0]?.id ?? ''
  } catch (error) {
    errorMessage.value = errorText(error)
  } finally {
    loading.value = false
  }
}

const queueSync = async () => {
  const entityIds = [...new Set(queueForm.entityIds.split(/[\s,]+/).map(value => value.trim()).filter(Boolean))]
  if (!programStudyId.value || !periodId.value || !entityIds.length) {
    errorMessage.value = 'Pilih konteks akademik dan isi identifier internal yang nyata.'
    return
  }
  mutating.value = true
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    if (config.public.demoMode) {
      jobs.value.unshift(demoJob({ id: `sync-demo-${Date.now()}`, entityType: queueForm.entityType, entityIds, recordCount: entityIds.length, status: 'QUEUED', attempts: 0, acceptedCount: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), nextAttemptAt: new Date().toISOString() }))
    } else {
      const { data } = await $api.post<{ job: PddiktiWorkerJob }>('/pddikti/sync', { entityType: queueForm.entityType, entityIds, programStudyId: programStudyId.value, periodId: periodId.value }, { headers: { 'Idempotency-Key': mutationKey('pddikti-queue') } })
      jobs.value.unshift(data.job)
    }
    noticeMessage.value = `${entityIds.length} record masuk antrean dengan snapshot payload tetap.`
    activeTab.value = 'queue'
  } catch (error) { errorMessage.value = errorText(error) } finally { mutating.value = false }
}

const retryJob = async (job: PddiktiWorkerJob) => {
  mutating.value = true
  errorMessage.value = ''
  try {
    if (config.public.demoMode) {
      Object.assign(job, { status: 'QUEUED', nextAttemptAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
    } else {
      const { data } = await $api.post<{ job: PddiktiWorkerJob }>(`/pddikti/jobs/${job.id}/retry`, {}, { headers: { 'Idempotency-Key': mutationKey('pddikti-retry') } })
      jobs.value.splice(jobs.value.findIndex(item => item.id === job.id), 1, data.job)
    }
    noticeMessage.value = 'Job dikembalikan ke antrean secara auditable.'
  } catch (error) { errorMessage.value = errorText(error) } finally { mutating.value = false }
}

const openJob = async (job: PddiktiWorkerJob) => {
  if (config.public.demoMode) { jobDetail.value = { job, results: [], mappings: [] }; return }
  try { jobDetail.value = (await $api.get(`/pddikti/jobs/${job.id}`)).data } catch (error) { errorMessage.value = errorText(error) }
}

const compareSnapshots = async () => {
  if (!programStudyId.value || !periodId.value) {
    errorMessage.value = 'Pilih program studi dan periode akademik sebelum membandingkan snapshot.'
    return
  }
  mutating.value = true
  errorMessage.value = ''
  try {
    let reconciliation: PddiktiReconciliation
    if (config.public.demoMode) reconciliation = structuredClone(demoReconciliation)
    else reconciliation = (await $api.post<{ reconciliation: PddiktiReconciliation }>('/pddikti/reconciliations', { entityType: compareEntity.value, programStudyId: programStudyId.value, periodId: periodId.value }, { headers: { 'Idempotency-Key': mutationKey('pddikti-compare') } })).data.reconciliation
    const index = reconciliations.value.findIndex(item => item.id === reconciliation.id)
    if (index >= 0) reconciliations.value.splice(index, 1, reconciliation); else reconciliations.value.unshift(reconciliation)
    selectedReconciliationId.value = reconciliation.id
    selectedRows.value = []
    noticeMessage.value = 'Snapshot dibandingkan tanpa mengubah data internal maupun remote.'
  } catch (error) { errorMessage.value = errorText(error) } finally { mutating.value = false }
}

const decideRows = async (decision: 'QUEUE_INTERNAL' | 'ACKNOWLEDGE_REMOTE') => {
  const reconciliation = selectedReconciliation.value
  if (!reconciliation || !selectedRows.value.length) return
  mutating.value = true
  errorMessage.value = ''
  try {
    if (config.public.demoMode) {
      reconciliation.rows = reconciliation.rows.map(row => selectedRows.value.includes(row.key) ? { ...row, decision, decidedAt: new Date().toISOString(), decidedBy: user.value?.id || 'demo' } : row)
      reconciliation.version += 1
    } else {
      const { data } = await $api.post<{ reconciliation: PddiktiReconciliation; queuedJob?: PddiktiWorkerJob }>(`/pddikti/reconciliations/${reconciliation.id}/decision`, { expectedVersion: reconciliation.version, rowKeys: selectedRows.value, decision }, { headers: { 'Idempotency-Key': mutationKey('pddikti-reconcile-decision') } })
      reconciliations.value.splice(reconciliations.value.findIndex(item => item.id === reconciliation.id), 1, data.reconciliation)
      if (data.queuedJob) jobs.value.unshift(data.queuedJob)
    }
    selectedRows.value = []
    noticeMessage.value = decision === 'QUEUE_INTERNAL' ? 'Kebenaran internal masuk antrean; snapshot tidak ditimpa.' : 'Keputusan review dicatat tanpa menyalin nilai remote.'
  } catch (error) { errorMessage.value = errorText(error) } finally { mutating.value = false }
}

const initialize = async () => {
  if (config.public.demoMode) return
  loading.value = true
  errorMessage.value = ''
  try {
    await loadCatalog()
    if (programStudyId.value && periodId.value) await loadWorkspace()
    else errorMessage.value = 'Master program studi atau periode aktif belum tersedia.'
  } catch (error) {
    errorMessage.value = errorText(error)
  } finally {
    loading.value = false
  }
}

onMounted(initialize)
</script>

<template>
  <div class="page-stack pddikti-page">
    <AppPageHeader eyebrow="Pelaporan eksternal" title="PDDIKTI Neo Feeder" description="Validasi sumber internal, kelola worker berlease, dan rekonsiliasi snapshot tanpa penimpaan tersembunyi.">
      <template #actions><NuxtLink v-if="can('pddikti.read')" class="btn btn-outline-secondary" to="/pddikti/data-mahasiswa"><i class="uil uil-user-square me-2" />PDM & ijazah</NuxtLink><button class="btn btn-outline-secondary" type="button" :disabled="loading" @click="initialize"><i class="uil uil-refresh me-2" />Muat ulang</button><button v-if="canMutate" class="btn btn-primary" type="button" @click="activeTab = 'queue'"><i class="uil uil-cloud-upload me-2" />Buat antrean</button></template>
    </AppPageHeader>
    <div v-if="noticeMessage" class="alert alert-success mb-0" role="status">{{ noticeMessage }}</div><div v-if="errorMessage" class="alert alert-danger mb-0" role="alert">{{ errorMessage }}</div>

    <section class="worker-banner" :class="{ online: workerStatus?.adapter.reachable }">
      <div class="worker-banner__status"><span><i class="uil" :class="workerStatus?.adapter.reachable ? 'uil-link' : 'uil-unlink'" /></span><div><small>Gateway adapter</small><strong>{{ !workerStatus ? 'Menunggu konteks' : workerStatus.adapter.reachable ? 'Terjangkau' : workerStatus.adapter.configured ? 'Tidak terjangkau' : 'Belum dikonfigurasi' }}</strong><p>{{ workerStatus?.adapter.message || (workerStatus ? `Kontrak ${workerStatus.contract.version}` : 'Pilih program studi dan periode akademik untuk memuat status nyata.') }}</p></div></div>
      <div class="worker-metrics"><div><strong>{{ workerStatus?.queue.QUEUED ?? 0 }}</strong><span>Menunggu</span></div><div><strong>{{ workerStatus?.queue.PROCESSING ?? 0 }}</strong><span>Diproses</span></div><div><strong>{{ workerStatus?.queue.DEAD_LETTER ?? 0 }}</strong><span>Dead letter</span></div><div><strong>{{ workerStatus?.contract.maxBatchSize ?? '-' }}</strong><span>Batas batch</span></div></div>
    </section>

    <section class="workflow-toolbar"><div class="tab-strip" role="tablist"><button type="button" :class="{ active: activeTab === 'readiness' }" @click="activeTab = 'readiness'">Kesiapan</button><button type="button" :class="{ active: activeTab === 'queue' }" @click="activeTab = 'queue'">Antrean & riwayat</button><button type="button" :class="{ active: activeTab === 'reconciliation' }" @click="activeTab = 'reconciliation'">Rekonsiliasi</button></div><div class="workflow-toolbar__filters"><label><span>Program studi</span><input v-if="config.public.demoMode" v-model="programStudyId" class="form-control form-control-sm" maxlength="80"><select v-else v-model="programStudyId" class="form-select form-select-sm" required @change="loadWorkspace"><option value="" disabled>Pilih program resmi</option><option v-for="program in programs" :key="program.id" :value="program.id">{{ program.code }} · {{ program.name }}</option></select></label><label><span>Periode</span><input v-if="config.public.demoMode" v-model="periodId" class="form-control form-control-sm" maxlength="40"><select v-else v-model="periodId" class="form-select form-select-sm" required @change="loadWorkspace"><option value="" disabled>Pilih periode resmi</option><option v-for="period in periods" :key="period.id" :value="period.id">{{ period.academicYear }} · {{ period.term }}</option></select></label></div></section>
    <div v-if="loading" class="workspace-loading"><span class="spinner-border spinner-border-sm" />Memuat data pelaporan...</div>

    <template v-else-if="activeTab === 'readiness'">
      <EmptyState v-if="!readiness" icon="uil-database" title="Konteks pelaporan belum dipilih" description="Pilih program studi dan periode akademik dari master resmi untuk memuat kesiapan PDDIKTI." />
      <template v-else>
        <section class="readiness-summary"><div><span>Kelengkapan eligible</span><strong>{{ readiness.completenessPercent.toLocaleString('id-ID') }}%</strong><small>{{ readiness.eligible }} dari {{ readiness.total }} record</small></div><div class="readiness-bar"><span :style="{ width: `${readiness.completenessPercent}%` }" /></div><StatusBadge :status="readiness.blocked ? 'review' : 'success'" :label="`${readiness.blocked} blocker`" /></section>
        <section class="entity-grid"><article v-for="entity in readiness.entities" :key="entity.entityType" class="entity-card"><header><span><i class="uil uil-database" /></span><div><h2>{{ entityLabels[entity.entityType] }}</h2><small>{{ entity.mappingVersion }}</small></div><strong>{{ entity.completenessPercent.toLocaleString('id-ID') }}%</strong></header><dl><div><dt>Total</dt><dd>{{ entity.total }}</dd></div><div><dt>Eligible</dt><dd>{{ entity.eligible }}</dd></div><div><dt>Antrean</dt><dd>{{ entity.queued }}</dd></div><div><dt>Terpetakan</dt><dd>{{ entity.synced }}</dd></div></dl><div v-if="Object.keys(entity.blockerCounts).length" class="blocker-list"><span v-for="(count, code) in entity.blockerCounts" :key="code">{{ code }} · {{ count }}</span></div><div v-else class="blocker-clear"><i class="uil uil-check-circle" />Tidak ada blocker</div></article></section>
      </template>
    </template>

    <template v-else-if="activeTab === 'queue'">
      <section v-if="canMutate" class="workflow-card queue-composer"><div><span class="section-kicker">Snapshot immutable</span><h2>Antrekan record eligible</h2><p>Identifier divalidasi terhadap sumber internal dan mapping aktif sebelum payload dibekukan.</p></div><form @submit.prevent="queueSync"><label><span>Entitas</span><select v-model="queueForm.entityType" class="form-select"><option v-for="entityType in PDDIKTI_ENTITY_TYPES" :key="entityType" :value="entityType">{{ entityLabels[entityType] }}</option></select></label><label class="ids-field"><span>Identifier internal, pisahkan koma</span><input v-model="queueForm.entityIds" class="form-control" maxlength="4000" required></label><button class="btn btn-primary" type="submit" :disabled="mutating || !programStudyId || !periodId || !queueForm.entityIds.trim()">Validasi & antrekan</button></form></section>
      <section class="workflow-card"><header class="section-heading"><div><span class="section-kicker">Lease, retry, hasil</span><h2>Antrean dan riwayat worker</h2><p>Payload akademik tidak dikirim pada daftar ini; buka detail untuk metadata hasil dan mapping.</p></div></header><div class="job-list"><article v-for="job in jobs" :key="job.id" class="job-row"><span class="job-icon"><i class="uil uil-process" /></span><div class="job-copy"><div><strong>{{ entityLabels[job.entityType] }}</strong><StatusBadge :status="statusTones[job.status]" :label="statusLabels[job.status]" /></div><p>{{ job.id }} · {{ job.recordCount }} record · percobaan {{ job.attempts }}/{{ job.maxAttempts }}</p><small>{{ job.mappingVersion }} · {{ dateLabel(job.updatedAt) }}<template v-if="job.leaseRecoveries"> · {{ job.leaseRecoveries }} lease dipulihkan</template></small><span v-if="job.lastError" class="job-error">{{ job.lastError.code }} · {{ job.lastError.message }}</span></div><div class="job-count"><strong>{{ job.acceptedCount }}</strong><small>diterima</small><strong>{{ job.rejectedCount }}</strong><small>ditolak</small></div><div class="job-actions"><button class="btn btn-sm btn-outline-secondary" type="button" @click="openJob(job)">Detail</button><button v-if="canMutate && ['FAILED','DEAD_LETTER'].includes(job.status)" class="btn btn-sm btn-primary" type="button" :disabled="mutating" @click="retryJob(job)">Retry</button></div></article><div v-if="!jobs.length" class="empty-list">Belum ada job dalam lingkup ini.</div></div></section>
    </template>

    <template v-else>
      <section class="workflow-card compare-card"><div><span class="section-kicker">Tidak menimpa sumber</span><h2>Bandingkan snapshot</h2><p>Hasil hanya mencatat fingerprint dan nama field berbeda. Nilai internal/remote tidak disalin otomatis.</p></div><div class="compare-controls"><select v-model="compareEntity" class="form-select"><option v-for="entityType in PDDIKTI_ENTITY_TYPES" :key="entityType" :value="entityType">{{ entityLabels[entityType] }}</option></select><button v-if="canMutate" class="btn btn-primary" type="button" :disabled="mutating || !programStudyId || !periodId" @click="compareSnapshots">Bandingkan sekarang</button></div></section>
      <section v-if="reconciliations.length" class="reconciliation-layout"><aside class="reconciliation-list"><button v-for="item in reconciliations" :key="item.id" type="button" :class="{ active: selectedReconciliation?.id === item.id }" @click="selectedReconciliationId = item.id; selectedRows = []"><strong>{{ entityLabels[item.entityType] }}</strong><span>{{ item.status }} · v{{ item.version }}</span><small>{{ dateLabel(item.updatedAt) }}</small></button></aside><article v-if="selectedReconciliation" class="workflow-card reconciliation-detail"><header class="section-heading"><div><span class="section-kicker">{{ selectedReconciliation.mappingVersion }}</span><h2>Hasil rekonsiliasi</h2><p>Kontrak {{ selectedReconciliation.contractVersion }}</p></div><StatusBadge :status="selectedReconciliation.status === 'REVIEWED' ? 'success' : 'review'" :label="selectedReconciliation.status" /></header><div class="recon-summary"><span v-for="(count, state) in selectedReconciliation.summary" :key="state"><strong>{{ count }}</strong>{{ differenceLabels[state] }}</span></div><div class="recon-actions" v-if="canMutate"><span>{{ selectedRows.length }} baris dipilih</span><button class="btn btn-sm btn-outline-secondary" type="button" :disabled="!selectedRows.length || mutating" @click="decideRows('ACKNOWLEDGE_REMOTE')">Catat sebagai ditinjau</button><button class="btn btn-sm btn-primary" type="button" :disabled="!selectedRows.length || mutating || selectedReconciliation.rows.filter(row => selectedRows.includes(row.key)).some(row => !row.internalId || row.state === 'MISSING_INTERNAL')" @click="decideRows('QUEUE_INTERNAL')">Antrekan internal</button></div><div class="recon-table"><div v-for="row in selectedReconciliation.rows" :key="row.key" class="recon-row"><input v-if="canMutate && row.state !== 'MATCH' && !row.decision" v-model="selectedRows" type="checkbox" :value="row.key" :aria-label="`Pilih ${row.key}`"><span v-else class="checkbox-space" /><div><strong>{{ row.internalId || row.remoteId }}</strong><small>Internal {{ row.internalId || '-' }} · Remote {{ row.remoteId || '-' }}</small><p v-if="row.differingFields.length">Field: {{ row.differingFields.join(', ') }}</p><p v-if="row.decision">Keputusan {{ row.decision }} oleh {{ row.decidedBy }}</p></div><StatusBadge :status="differenceTones[row.state]" :label="differenceLabels[row.state]" /></div></div></article></section><div v-else class="workflow-card empty-list">Belum ada snapshot rekonsiliasi pada lingkup ini.</div>
    </template>

    <div v-if="jobDetail" class="detail-overlay" role="dialog" aria-modal="true" @click.self="jobDetail = null"><article class="job-dialog"><button type="button" class="dialog-close" aria-label="Tutup" @click="jobDetail = null"><i class="uil uil-times" /></button><span class="section-kicker">{{ jobDetail.job.id }}</span><h2>Riwayat job {{ entityLabels[jobDetail.job.entityType] }}</h2><dl><div><dt>Fingerprint payload</dt><dd><code>{{ jobDetail.job.payloadFingerprint }}</code></dd></div><div><dt>Kontrak</dt><dd>{{ jobDetail.job.contractVersion }}</dd></div><div><dt>Mapping</dt><dd>{{ jobDetail.job.mappingVersion }}</dd></div><div><dt>Hasil batch</dt><dd>{{ jobDetail.results.length }}</dd></div><div><dt>Entity mapping</dt><dd>{{ jobDetail.mappings.length }}</dd></div></dl><ol><li v-for="event in [...jobDetail.job.history].reverse()" :key="event.id"><span>{{ event.type }}</span><small>{{ dateLabel(event.occurredAt) }} · {{ event.actor }} · attempt {{ event.attempt }}</small></li></ol></article></div>
  </div>
</template>

<style scoped src="~/pages/_workflow.css"></style>
<style scoped>
.pddikti-page{--pddikti:#245f4b}.worker-banner{display:flex;align-items:center;justify-content:space-between;gap:1.5rem;padding:1rem 1.15rem;border:1px solid #eadfc5;border-radius:1rem;background:linear-gradient(120deg,#fffaf0,#fff);box-shadow:0 10px 28px rgba(55,65,49,.05)}.worker-banner.online{border-color:#cfe4d8;background:linear-gradient(120deg,#eef8f2,#fff)}.worker-banner__status{display:flex;align-items:center;gap:.7rem}.worker-banner__status>span{display:grid;place-items:center;width:2.7rem;height:2.7rem;border-radius:.75rem;color:#9a7026;background:#f5e8c9;font-size:1.1rem}.worker-banner.online .worker-banner__status>span{color:#276d51;background:#dff0e7}.worker-banner__status small,.worker-banner__status strong,.worker-banner__status p{display:block;margin:0}.worker-banner__status small{color:#8b978f;font-size:.53rem;text-transform:uppercase;letter-spacing:.08em}.worker-banner__status strong{color:#37564b;font-size:.73rem}.worker-banner__status p{max-width:500px;margin-top:.1rem;color:#7d8c85;font-size:.55rem}.worker-metrics{display:grid;grid-template-columns:repeat(4,minmax(75px,1fr));min-width:360px}.worker-metrics div{text-align:center}.worker-metrics div+div{border-left:1px solid #e2e9e5}.worker-metrics strong,.worker-metrics span{display:block}.worker-metrics strong{color:#32594a;font-size:.9rem}.worker-metrics span{color:#87958f;font-size:.52rem}.workspace-loading{display:flex;justify-content:center;gap:.6rem;padding:3rem;color:#74877f;font-size:.68rem}.readiness-summary,.workflow-card{padding:1rem;border:1px solid #dfe8e4;border-radius:1rem;background:#fff;box-shadow:0 10px 28px rgba(25,62,50,.045)}.readiness-summary{display:grid;grid-template-columns:auto minmax(180px,1fr) auto;align-items:center;gap:1rem}.readiness-summary span,.readiness-summary strong,.readiness-summary small{display:block}.readiness-summary>div:first-child>span{color:#809089;font-size:.55rem}.readiness-summary strong{color:#285c49;font-size:1.25rem}.readiness-summary small{color:#87958f;font-size:.53rem}.readiness-bar{height:.45rem;overflow:hidden;border-radius:999px;background:#e6eeea}.readiness-bar span{height:100%;border-radius:inherit;background:linear-gradient(90deg,#2a6b53,#80ae91)}.entity-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.8rem}.entity-card{padding:.9rem;border:1px solid #e0e9e4;border-radius:.85rem;background:#fff}.entity-card header{display:flex;align-items:center;gap:.55rem}.entity-card header>span{display:grid;place-items:center;width:2.2rem;height:2.2rem;border-radius:.6rem;color:#2d7158;background:#e6f2ec}.entity-card h2,.entity-card small{display:block;margin:0}.entity-card h2{color:#35584b;font-size:.68rem}.entity-card header small{color:#87958f;font-size:.49rem}.entity-card header>strong{margin-left:auto;color:#2c6852;font-size:.8rem}.entity-card dl{display:grid;grid-template-columns:repeat(4,1fr);margin:.75rem 0}.entity-card dl div{text-align:center}.entity-card dl div+div{border-left:1px solid #e8eeeb}.entity-card dt{color:#8b9892;font-size:.48rem}.entity-card dd{margin:.1rem 0 0;color:#405f53;font-size:.61rem;font-weight:750}.blocker-list,.blocker-clear{display:flex;flex-wrap:wrap;gap:.3rem;padding-top:.55rem;border-top:1px solid #e8eeeb;color:#70837a;font-size:.49rem}.blocker-list span{padding:.22rem .35rem;border-radius:.3rem;color:#9a5c2d;background:#fff2e5}.blocker-clear{color:#39805f}.queue-composer,.compare-card{display:flex;align-items:end;justify-content:space-between;gap:1rem}.queue-composer h2,.compare-card h2,.section-heading h2{margin:.15rem 0 .25rem;color:#315348;font-size:.92rem}.queue-composer p,.compare-card p,.section-heading p{max-width:640px;margin:0;color:#778a82;font-size:.61rem}.queue-composer form{display:grid;grid-template-columns:150px minmax(240px,1fr) auto;gap:.55rem;align-items:end;min-width:min(100%,680px)}.queue-composer label{display:grid;gap:.25rem;color:#71847b;font-size:.53rem}.section-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;margin-bottom:.8rem}.job-list{display:grid}.job-row{display:grid;grid-template-columns:auto minmax(0,1fr) auto auto;gap:.75rem;align-items:center;padding:.8rem 0}.job-row+.job-row{border-top:1px solid #e8eeeb}.job-icon{display:grid;place-items:center;width:2.4rem;height:2.4rem;border-radius:.65rem;color:#2e7158;background:#e7f2ec}.job-copy>div{display:flex;align-items:center;gap:.45rem}.job-copy strong{color:#36574b;font-size:.65rem}.job-copy p{margin:.18rem 0;color:#61766d;font-size:.56rem}.job-copy small{display:block;color:#89968f;font-size:.49rem}.job-error{display:block;margin-top:.2rem;color:#a14545;font-size:.5rem}.job-count{display:grid;grid-template-columns:auto auto;gap:.1rem .35rem}.job-count strong{color:#335e4d;font-size:.65rem}.job-count small{color:#87948e;font-size:.5rem}.job-actions{display:flex;gap:.35rem}.empty-list{padding:2rem;color:#7d8e87;text-align:center;font-size:.65rem}.compare-controls{display:flex;gap:.5rem;min-width:310px}.reconciliation-layout{display:grid;grid-template-columns:230px minmax(0,1fr);gap:.8rem;align-items:start}.reconciliation-list{display:grid;gap:.45rem}.reconciliation-list button{display:grid;padding:.7rem;border:1px solid #dfe8e3;border-radius:.7rem;color:#536e63;background:#fff;text-align:left}.reconciliation-list button.active{border-color:#70a48c;background:#edf6f1}.reconciliation-list strong{font-size:.62rem}.reconciliation-list span,.reconciliation-list small{margin-top:.12rem;color:#84928c;font-size:.5rem}.recon-summary{display:grid;grid-template-columns:repeat(4,1fr);margin-bottom:.7rem;padding:.65rem;border-radius:.65rem;background:#f5f8f6}.recon-summary span{color:#7d8e87;font-size:.5rem;text-align:center}.recon-summary strong{display:block;color:#345d4d;font-size:.78rem}.recon-actions{display:flex;align-items:center;justify-content:flex-end;gap:.4rem;margin-bottom:.55rem}.recon-actions>span{margin-right:auto;color:#7b8d85;font-size:.55rem}.recon-table{display:grid}.recon-row{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:.55rem;align-items:center;padding:.65rem 0}.recon-row+.recon-row{border-top:1px solid #e8eeeb}.checkbox-space{width:.8rem}.recon-row strong,.recon-row small{display:block}.recon-row strong{color:#3a5a4f;font-size:.61rem}.recon-row small{margin-top:.12rem;color:#86948e;font-size:.5rem}.recon-row p{margin:.15rem 0 0;color:#6e8379;font-size:.5rem}.detail-overlay{position:fixed;z-index:1080;inset:0;display:grid;place-items:center;padding:1rem;background:rgba(12,35,28,.6);backdrop-filter:blur(4px)}.job-dialog{position:relative;width:min(100%,650px);max-height:calc(100vh - 2rem);overflow:auto;padding:1.25rem;border-radius:1rem;background:#fff}.dialog-close{position:absolute;top:.7rem;right:.7rem;display:grid;place-items:center;width:2rem;height:2rem;border:0;border-radius:.5rem;color:#6f8179;background:#eef3f0}.job-dialog h2{color:#2f5145;font-size:1rem}.job-dialog dl{display:grid;grid-template-columns:repeat(2,1fr);gap:.55rem}.job-dialog dl div{min-width:0;padding:.55rem;border-radius:.5rem;background:#f6f8f7}.job-dialog dt{color:#87958f;font-size:.5rem}.job-dialog dd{margin:.15rem 0 0;overflow-wrap:anywhere;color:#3e5d52;font-size:.59rem}.job-dialog ol{display:grid;gap:.4rem;margin:1rem 0 0;padding:0;list-style:none}.job-dialog li{display:grid;padding:.5rem;border-left:2px solid #4c8b70;background:#f6f9f7}.job-dialog li span{color:#385b4e;font-size:.59rem;font-weight:750}.job-dialog li small{color:#86938e;font-size:.5rem}
@media(max-width:1199.98px){.entity-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.queue-composer{align-items:stretch;flex-direction:column}.queue-composer form{width:100%}}
@media(max-width:991.98px){.worker-banner{align-items:flex-start;flex-direction:column}.worker-metrics{width:100%;min-width:0}.reconciliation-layout{grid-template-columns:1fr}.reconciliation-list{display:flex;overflow:auto}.reconciliation-list button{min-width:190px}.job-row{grid-template-columns:auto minmax(0,1fr) auto}.job-count{display:none}.job-actions{grid-column:2/4}}
@media(max-width:767.98px){.entity-grid{grid-template-columns:1fr}.queue-composer form{grid-template-columns:1fr}.compare-card{align-items:stretch;flex-direction:column}.compare-controls{width:100%;min-width:0}.readiness-summary{grid-template-columns:1fr auto}.readiness-bar{grid-column:1/-1;grid-row:2}.recon-summary{grid-template-columns:repeat(2,1fr)}.recon-actions{align-items:stretch;flex-direction:column}.recon-actions>span{margin:0}.job-dialog dl{grid-template-columns:1fr}}
@media(max-width:575.98px){.worker-metrics{grid-template-columns:repeat(2,1fr);gap:.6rem}.worker-metrics div:nth-child(3){border-left:0}.job-row{grid-template-columns:auto minmax(0,1fr)}.job-actions{grid-column:2}.recon-row{align-items:start}}
</style>
