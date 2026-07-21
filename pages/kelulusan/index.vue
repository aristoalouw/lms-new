<script setup lang="ts">
import type {
  EligibilityArea,
  GraduationApplication,
  GraduationApplicationStatus,
  GraduationDocumentType,
  GraduationPeriod,
  IssuedGraduationDocument,
} from '~/server/types/graduation'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Kelulusan & Yudisium' })

const { $api } = useNuxtApp()
const config = useRuntimeConfig()
const { user } = useAuth()
const loading = ref(false)
const mutating = ref(false)
const errorMessage = ref('')
const noticeMessage = ref('')
const issueType = ref<GraduationDocumentType>('SKPI')

const demoPeriod: GraduationPeriod = {
  id: 'period-yudisium-2026-02', code: 'YUD-2026-02', name: 'Yudisium Semester Genap 2025/2026',
  programStudyIds: ['management-s1', 'informatics-s1'], status: 'OPEN',
  registrationOpensAt: '2026-07-01T00:00:00.000Z', registrationClosesAt: '2026-08-15T16:59:59.000Z',
  yudisiumDate: '2026-08-28', graduationDate: '2026-10-17', version: 1,
  currentRequirements: {
    version: 1,
    academic: { minimumCredits: 144, minimumGpa: 2, maximumGradeD: 4, requireNoGradeE: true, requireThesisPassed: true },
    finance: { maximumOutstandingAmount: 0 }, library: { requireClearance: true, maximumUnreturnedItems: 0 },
    studentAffairs: { minimumPoints: 100, maximumActiveSanctions: 0 },
    effectiveAt: '2026-06-01T00:00:00.000Z', updatedBy: 'admin-001',
  },
  requirementHistory: [], createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z',
}
demoPeriod.requirementHistory = [structuredClone(demoPeriod.currentRequirements)]

const demoApplication: GraduationApplication = {
  id: 'grad-app-demo-001', periodId: demoPeriod.id, studentId: 'student-001', studentUid: 'student-001',
  studentName: 'Nabila Putri', studentNumber: '23011001', programStudyId: 'management-s1', programStudyName: 'S1 Manajemen',
  status: 'FINAL_APPROVED', version: 4, submittedAt: '2026-07-14T03:10:00.000Z', updatedAt: '2026-07-20T08:25:00.000Z',
  firstApprovedBy: 'reviewer-akademik-001', firstApprovedAt: '2026-07-18T06:20:00.000Z',
  finalApprovedBy: 'reviewer-akademik-002', finalApprovedAt: '2026-07-20T08:25:00.000Z',
  eligibilitySnapshot: {
    id: 'eligibility-student-001-v7', studentId: 'student-001', programStudyId: 'management-s1', capturedAt: '2026-07-20T02:00:00.000Z',
    sourceVersions: { academic: 18, finance: 9, library: 4, studentAffairs: 6 },
    academic: { earnedCredits: 146, gpa: 3.61, gradeDCount: 1, gradeECount: 0, thesisPassed: true },
    finance: { outstandingAmount: 0 }, library: { cleared: true, unreturnedItems: 0 }, studentAffairs: { points: 128, activeSanctions: 0 },
  },
  eligibilityEvaluation: {
    eligible: true, requirementsVersion: 1, evaluatedAt: '2026-07-20T08:25:00.000Z', snapshotId: 'eligibility-student-001-v7', blockerCodes: [],
    checks: [
      { code: 'ACADEMIC_CREDITS', area: 'ACADEMIC', label: 'Jumlah SKS lulus', passed: true, actual: 146, required: 144 },
      { code: 'ACADEMIC_GPA', area: 'ACADEMIC', label: 'IPK minimum', passed: true, actual: 3.61, required: 2 },
      { code: 'ACADEMIC_GRADE_D', area: 'ACADEMIC', label: 'Batas nilai D', passed: true, actual: 1, required: 4 },
      { code: 'ACADEMIC_NO_E', area: 'ACADEMIC', label: 'Tidak memiliki nilai E', passed: true, actual: 0, required: 0 },
      { code: 'ACADEMIC_THESIS', area: 'ACADEMIC', label: 'Tugas akhir lulus', passed: true, actual: true, required: true },
      { code: 'FINANCE_CLEARANCE', area: 'FINANCE', label: 'Bebas tunggakan', passed: true, actual: 0, required: 0 },
      { code: 'LIBRARY_CLEARANCE', area: 'LIBRARY', label: 'Bebas perpustakaan', passed: true, actual: true, required: true },
      { code: 'LIBRARY_ITEMS', area: 'LIBRARY', label: 'Pengembalian koleksi', passed: true, actual: 0, required: 0 },
      { code: 'AFFAIRS_POINTS', area: 'STUDENT_AFFAIRS', label: 'Poin kemahasiswaan', passed: true, actual: 128, required: 100 },
      { code: 'AFFAIRS_SANCTIONS', area: 'STUDENT_AFFAIRS', label: 'Sanksi aktif', passed: true, actual: 0, required: 0 },
    ],
  },
  history: [
    { id: 'event-demo-1', to: 'SUBMITTED', actorUid: 'student-001', actorName: 'Nabila Putri', occurredAt: '2026-07-14T03:10:00.000Z' },
    { id: 'event-demo-2', from: 'SUBMITTED', to: 'UNDER_REVIEW', actorUid: 'reviewer-akademik-001', actorName: 'Reviewer Akademik', occurredAt: '2026-07-17T04:00:00.000Z' },
    { id: 'event-demo-3', from: 'UNDER_REVIEW', to: 'FIRST_APPROVED', actorUid: 'reviewer-akademik-001', actorName: 'Reviewer Akademik', occurredAt: '2026-07-18T06:20:00.000Z' },
    { id: 'event-demo-4', from: 'FIRST_APPROVED', to: 'FINAL_APPROVED', actorUid: 'reviewer-akademik-002', actorName: 'Pejabat Akademik', occurredAt: '2026-07-20T08:25:00.000Z' },
  ],
}

const demoDocument: IssuedGraduationDocument = {
  id: 'grad-document-demo-001', applicationId: demoApplication.id, studentId: 'student-001', studentUid: 'student-001',
  programStudyId: 'management-s1', type: 'DECREE', documentNumber: 'SK-YUD/MANAGEMENT-S1/2026/00001',
  verificationCode: '8A2F0C19B5549D1267CE', status: 'ISSUED', version: 1,
  templateSnapshot: {
    id: 'template-decree-default', type: 'DECREE', name: 'Keputusan Yudisium standar', version: 1, status: 'ACTIVE',
    layout: { title: 'Keputusan Yudisium', subtitle: 'Universitas Siber Nusantara', fields: [], footerText: 'Verifikasi dengan kode resmi kampus.' },
    createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z', updatedBy: 'admin-001',
  },
  renderPayload: {
    documentType: 'DECREE', documentNumber: 'SK-YUD/MANAGEMENT-S1/2026/00001', verificationCode: '8A2F0C19B5549D1267CE',
    issuedAt: '2026-07-20T09:00:00.000Z', title: 'Keputusan Yudisium', subtitle: 'Universitas Siber Nusantara',
    subject: { studentName: 'Nabila Putri', studentNumber: '23011001', programStudyName: 'S1 Manajemen', periodName: demoPeriod.name },
    fields: [], footerText: 'Verifikasi dengan kode resmi kampus.', limitation: 'DETERMINISTIC_RENDER_PAYLOAD_ONLY_NO_CREDENTIAL_PDF',
  },
  contentHash: '9f65d95517b7c960682b80bff4b31cb8f742640d959e5e18c07cb7808f173182',
  issuedAt: '2026-07-20T09:00:00.000Z', issuedBy: 'academic-issuer-001',
  history: [{ action: 'ISSUED', actorUid: 'academic-issuer-001', occurredAt: '2026-07-20T09:00:00.000Z' }],
}

const periods = ref<GraduationPeriod[]>(config.public.demoMode ? [demoPeriod] : [])
const applications = ref<GraduationApplication[]>(config.public.demoMode ? [demoApplication] : [])
const documents = ref<IssuedGraduationDocument[]>(config.public.demoMode ? [demoDocument] : [])
const selectedApplicationId = ref(applications.value[0]?.id ?? '')

const selectedApplication = computed(() => applications.value.find(item => item.id === selectedApplicationId.value) ?? applications.value[0])
const activePeriod = computed(() => periods.value.find(period => period.status === 'OPEN') ?? periods.value[0])
const activeRole = computed(() => user.value?.activeRole ?? 'student')
const isStudent = computed(() => activeRole.value === 'student')
const canManage = computed(() => ['administrator', 'academic_staff'].includes(activeRole.value))
const selectedDocuments = computed(() => documents.value.filter(document => document.applicationId === selectedApplication.value?.id))

const areaMeta: Record<EligibilityArea, { label: string; icon: string }> = {
  ACADEMIC: { label: 'Akademik', icon: 'uil-graduation-cap' },
  FINANCE: { label: 'Keuangan', icon: 'uil-wallet' },
  LIBRARY: { label: 'Perpustakaan', icon: 'uil-books' },
  STUDENT_AFFAIRS: { label: 'Kemahasiswaan', icon: 'uil-users-alt' },
}
const groupedChecks = computed(() => Object.entries(areaMeta).map(([area, meta]) => ({
  area: area as EligibilityArea,
  ...meta,
  checks: selectedApplication.value?.eligibilityEvaluation.checks.filter(check => check.area === area) ?? [],
})))

const statusLabels: Record<GraduationApplicationStatus, string> = {
  BLOCKED: 'Belum memenuhi syarat', SUBMITTED: 'Diajukan', UNDER_REVIEW: 'Sedang ditinjau', FIRST_APPROVED: 'Persetujuan pertama',
  FINAL_APPROVED: 'Lulus yudisium', REJECTED: 'Ditolak', GRADUATED: 'Lulus & diwisuda', CANCELLED: 'Dibatalkan',
}
const statusTones: Record<GraduationApplicationStatus, string> = {
  BLOCKED: 'blocked', SUBMITTED: 'pending', UNDER_REVIEW: 'processing', FIRST_APPROVED: 'review',
  FINAL_APPROVED: 'verified', REJECTED: 'blocked', GRADUATED: 'active', CANCELLED: 'inactive',
}
const documentLabels: Record<GraduationDocumentType, string> = { DECREE: 'SK Yudisium', DIPLOMA: 'Ijazah', TRANSCRIPT: 'Transkrip', SKPI: 'SKPI' }
const transitionMeta: Partial<Record<GraduationApplicationStatus, { transition: 'START_REVIEW' | 'FIRST_APPROVE' | 'FINAL_APPROVE'; label: string }>> = {
  SUBMITTED: { transition: 'START_REVIEW', label: 'Mulai peninjauan' },
  UNDER_REVIEW: { transition: 'FIRST_APPROVE', label: 'Berikan persetujuan pertama' },
  FIRST_APPROVED: { transition: 'FINAL_APPROVE', label: 'Berikan persetujuan final' },
}

const dateLabel = (value?: string) => value
  ? new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta' }).format(new Date(value))
  : '-'
const valueLabel = (value: string | number | boolean) => typeof value === 'boolean' ? (value ? 'Ya' : 'Tidak') : String(value)
const errorText = (error: unknown) => {
  const candidate = error as { response?: { data?: { statusMessage?: string; message?: string } }; message?: string }
  return candidate.response?.data?.statusMessage || candidate.response?.data?.message || candidate.message || 'Permintaan tidak dapat diselesaikan.'
}
const idempotencyKey = (action: string) => `${action}:${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`

const replaceApplication = (application: GraduationApplication) => {
  const index = applications.value.findIndex(item => item.id === application.id)
  if (index >= 0) applications.value.splice(index, 1, application)
  else applications.value.unshift(application)
  selectedApplicationId.value = application.id
}

const loadWorkspace = async () => {
  if (config.public.demoMode) return
  loading.value = true
  errorMessage.value = ''
  try {
    const [periodResponse, applicationResponse, documentResponse] = await Promise.all([
      $api.get<{ periods: GraduationPeriod[] }>('/graduation/periods'),
      $api.get<{ applications: GraduationApplication[] }>('/graduation/applications'),
      $api.get<{ documents: IssuedGraduationDocument[] }>('/graduation/documents'),
    ])
    periods.value = periodResponse.data.periods
    applications.value = applicationResponse.data.applications
    documents.value = documentResponse.data.documents
    selectedApplicationId.value = applications.value[0]?.id ?? ''
  } catch (error) {
    errorMessage.value = errorText(error)
  } finally {
    loading.value = false
  }
}

const submitApplication = async () => {
  if (!activePeriod.value || !user.value?.studentId) return
  mutating.value = true
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    if (config.public.demoMode) {
      noticeMessage.value = 'Mode demo menampilkan pengajuan yang sudah melalui persetujuan final.'
      return
    }
    const { data } = await $api.post<{ application: GraduationApplication }>('/graduation/applications', {
      periodId: activePeriod.value.id,
      studentId: user.value.studentId,
    }, { headers: { 'Idempotency-Key': idempotencyKey('graduation-submit') } })
    replaceApplication(data.application)
    noticeMessage.value = data.application.status === 'BLOCKED'
      ? 'Pengajuan tersimpan, tetapi masih memiliki persyaratan yang harus diselesaikan.'
      : 'Pengajuan yudisium berhasil dikirim.'
  } catch (error) {
    errorMessage.value = errorText(error)
  } finally {
    mutating.value = false
  }
}

const advanceReview = async (application: GraduationApplication) => {
  const action = transitionMeta[application.status]
  if (!action) return
  mutating.value = true
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    if (config.public.demoMode) {
      const targets = { START_REVIEW: 'UNDER_REVIEW', FIRST_APPROVE: 'FIRST_APPROVED', FINAL_APPROVE: 'FINAL_APPROVED' } as const
      replaceApplication({ ...application, status: targets[action.transition], version: application.version + 1, updatedAt: new Date().toISOString() })
      noticeMessage.value = 'Transisi demo berhasil diterapkan.'
      return
    }
    const { data } = await $api.post<{ application: GraduationApplication }>(`/graduation/applications/${application.id}/transition`, {
      transition: action.transition,
      expectedVersion: application.version,
    }, { headers: { 'Idempotency-Key': idempotencyKey(`graduation-${action.transition.toLowerCase()}`) } })
    replaceApplication(data.application)
    noticeMessage.value = 'Status peninjauan berhasil diperbarui.'
  } catch (error) {
    errorMessage.value = errorText(error)
  } finally {
    mutating.value = false
  }
}

const issueDocument = async (application: GraduationApplication) => {
  mutating.value = true
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    if (config.public.demoMode) {
      noticeMessage.value = 'Mode demo tidak menerbitkan nomor resmi baru.'
      return
    }
    const { data } = await $api.post<{ document: IssuedGraduationDocument }>('/graduation/documents', {
      applicationId: application.id,
      type: issueType.value,
    }, { headers: { 'Idempotency-Key': idempotencyKey(`graduation-issue-${issueType.value.toLowerCase()}`) } })
    documents.value.unshift(data.document)
    noticeMessage.value = `${documentLabels[data.document.type]} diterbitkan dengan nomor ${data.document.documentNumber}.`
  } catch (error) {
    errorMessage.value = errorText(error)
  } finally {
    mutating.value = false
  }
}

onMounted(loadWorkspace)
</script>

<template>
  <div class="page-stack graduation-page">
    <AppPageHeader eyebrow="Gerbang akhir studi" title="Kelulusan & Yudisium" description="Pantau kelayakan lintas unit, alur persetujuan berlapis, dan dokumen kelulusan bernomor resmi.">
      <template #actions>
        <button class="btn btn-outline-secondary" type="button" :disabled="loading" @click="loadWorkspace"><i class="uil uil-refresh me-2" />Muat ulang</button>
        <button v-if="isStudent && !applications.length && activePeriod" class="btn btn-primary" type="button" :disabled="mutating" @click="submitApplication"><i class="uil uil-file-check-alt me-2" />Ajukan yudisium</button>
      </template>
    </AppPageHeader>

    <div v-if="noticeMessage" class="alert alert-success mb-0" role="status">{{ noticeMessage }}</div>
    <div v-if="errorMessage" class="alert alert-danger mb-0" role="alert">{{ errorMessage }}</div>

    <section class="graduation-hero">
      <div class="graduation-hero__copy">
        <span class="section-kicker">{{ activePeriod?.code || 'Belum ada periode aktif' }}</span>
        <h2>{{ activePeriod?.name || 'Periode yudisium belum tersedia' }}</h2>
        <p v-if="activePeriod">Pendaftaran {{ dateLabel(activePeriod.registrationOpensAt) }} - {{ dateLabel(activePeriod.registrationClosesAt) }}. Sidang yudisium dijadwalkan {{ dateLabel(activePeriod.yudisiumDate) }}.</p>
      </div>
      <div class="graduation-hero__status">
        <span class="hero-seal"><i class="uil uil-award" /></span>
        <div><small>Status pengajuan</small><strong>{{ selectedApplication ? statusLabels[selectedApplication.status] : 'Belum diajukan' }}</strong><span v-if="selectedApplication">Versi {{ selectedApplication.version }} · syarat v{{ selectedApplication.eligibilityEvaluation.requirementsVersion }}</span></div>
      </div>
    </section>

    <div v-if="loading" class="workflow-loading"><span class="spinner-border spinner-border-sm" /><span>Memuat ruang kerja kelulusan...</span></div>
    <template v-else-if="selectedApplication">
      <section v-if="applications.length > 1" class="application-switcher" aria-label="Pilih pengajuan">
        <button v-for="application in applications" :key="application.id" type="button" :class="{ active: selectedApplication.id === application.id }" @click="selectedApplicationId = application.id">
          <span>{{ application.studentName }}</span><small>{{ application.studentNumber }} · {{ application.programStudyName }}</small>
        </button>
      </section>

      <section class="eligibility-section">
        <header class="section-heading">
          <div><span class="section-kicker">Snapshot sumber resmi</span><h2>Kelayakan lintas unit</h2><p>Hasil ini dihitung server dari versi sumber akademik, keuangan, perpustakaan, dan kemahasiswaan.</p></div>
          <StatusBadge :status="selectedApplication.eligibilityEvaluation.eligible ? 'verified' : 'blocked'" :label="selectedApplication.eligibilityEvaluation.eligible ? 'Semua syarat terpenuhi' : `${selectedApplication.eligibilityEvaluation.blockerCodes.length} penghambat`" />
        </header>
        <div class="eligibility-grid">
          <article v-for="group in groupedChecks" :key="group.area" class="eligibility-card">
            <header><span><i class="uil" :class="group.icon" /></span><div><h3>{{ group.label }}</h3><small>{{ group.checks.filter(check => check.passed).length }}/{{ group.checks.length }} terpenuhi</small></div></header>
            <ul>
              <li v-for="check in group.checks" :key="check.code" :class="{ failed: !check.passed }">
                <i class="uil" :class="check.passed ? 'uil-check-circle' : 'uil-times-circle'" />
                <div><strong>{{ check.label }}</strong><small>Aktual {{ valueLabel(check.actual) }} · Syarat {{ valueLabel(check.required) }}</small></div>
              </li>
            </ul>
          </article>
        </div>
      </section>

      <section class="graduation-grid">
        <article class="workflow-card review-card">
          <header class="section-heading compact"><div><span class="section-kicker">Jejak keputusan</span><h2>Linimasa pengajuan</h2></div><StatusBadge :status="statusTones[selectedApplication.status]" :label="statusLabels[selectedApplication.status]" /></header>
          <ol class="status-timeline">
            <li v-for="event in [...selectedApplication.history].reverse()" :key="event.id">
              <span><i class="uil uil-check" /></span>
              <div><strong>{{ statusLabels[event.to] }}</strong><p>{{ event.actorName }}</p><small>{{ dateLabel(event.occurredAt) }}<template v-if="event.reason"> · {{ event.reason }}</template></small></div>
            </li>
          </ol>
          <div v-if="canManage && transitionMeta[selectedApplication.status]" class="review-action">
            <div><strong>Langkah peninjauan berikutnya</strong><p>Versi saat ini akan divalidasi ulang. Persetujuan final wajib dilakukan pengguna yang berbeda.</p></div>
            <button class="btn btn-primary btn-sm" type="button" :disabled="mutating" @click="advanceReview(selectedApplication)">{{ transitionMeta[selectedApplication.status]?.label }}</button>
          </div>
        </article>

        <article class="workflow-card period-card">
          <header class="section-heading compact"><div><span class="section-kicker">Periode & versi</span><h2>Rincian yudisium</h2></div></header>
          <dl v-if="activePeriod" class="period-details">
            <div><dt>Program studi</dt><dd>{{ activePeriod.programStudyIds.length }} lingkup</dd></div>
            <div><dt>Penutupan</dt><dd>{{ dateLabel(activePeriod.registrationClosesAt) }}</dd></div>
            <div><dt>Yudisium</dt><dd>{{ dateLabel(activePeriod.yudisiumDate) }}</dd></div>
            <div><dt>Wisuda</dt><dd>{{ dateLabel(activePeriod.graduationDate) }}</dd></div>
            <div><dt>Versi periode</dt><dd>v{{ activePeriod.version }}</dd></div>
            <div><dt>Versi syarat</dt><dd>v{{ activePeriod.currentRequirements.version }}</dd></div>
          </dl>
          <div class="source-versions">
            <span>Versi sumber</span>
            <small>Akademik v{{ selectedApplication.eligibilitySnapshot.sourceVersions.academic }}</small>
            <small>Keuangan v{{ selectedApplication.eligibilitySnapshot.sourceVersions.finance }}</small>
            <small>Perpustakaan v{{ selectedApplication.eligibilitySnapshot.sourceVersions.library }}</small>
            <small>Kemahasiswaan v{{ selectedApplication.eligibilitySnapshot.sourceVersions.studentAffairs }}</small>
          </div>
        </article>
      </section>

      <section class="workflow-card documents-card">
        <header class="section-heading">
          <div><span class="section-kicker">Penerbitan terkendali</span><h2>Dokumen kelulusan</h2><p>Setiap versi yang terbit memiliki nomor unik, snapshot template, hash konten, kode verifikasi, dan riwayat pencabutan.</p></div>
          <div v-if="canManage && ['FINAL_APPROVED', 'GRADUATED'].includes(selectedApplication.status)" class="issue-controls">
            <select v-model="issueType" class="form-select form-select-sm" aria-label="Jenis dokumen"><option v-for="(label, type) in documentLabels" :key="type" :value="type">{{ label }}</option></select>
            <button class="btn btn-primary btn-sm" type="button" :disabled="mutating" @click="issueDocument(selectedApplication)">Terbitkan</button>
          </div>
        </header>
        <div class="render-limitation"><i class="uil uil-info-circle" /><div><strong>Pratinjau cetak deterministik</strong><p>Fase ini menghasilkan payload render dan tampilan cetak yang dapat diverifikasi; PDF kredensial belum dibuat.</p></div></div>
        <div v-if="selectedDocuments.length" class="document-list">
          <article v-for="document in selectedDocuments" :key="document.id" class="document-row">
            <span class="document-icon"><i class="uil uil-file-shield-alt" /></span>
            <div class="document-copy"><div><strong>{{ documentLabels[document.type] }}</strong><StatusBadge :status="document.status === 'ISSUED' ? 'verified' : 'blocked'" :label="document.status === 'ISSUED' ? 'Aktif' : 'Dicabut'" /></div><p>{{ document.documentNumber }}</p><small>Terbit {{ dateLabel(document.issuedAt) }} · kode {{ document.verificationCode }}</small></div>
            <div class="document-hash"><small>SHA-256</small><code>{{ document.contentHash }}</code></div>
            <NuxtLink class="btn btn-outline-secondary btn-sm" :to="`/kelulusan/dokumen/${document.id}`"><i class="uil uil-print me-1" />Pratinjau</NuxtLink>
          </article>
        </div>
        <div v-else class="documents-empty"><i class="uil uil-file-question-alt" /><div><strong>Belum ada dokumen diterbitkan</strong><p>Dokumen dapat diterbitkan setelah pengajuan memperoleh persetujuan final.</p></div></div>
      </section>
    </template>

    <section v-else class="workflow-card empty-workspace">
      <span><i class="uil uil-graduation-cap" /></span><h2>Belum ada pengajuan yudisium</h2><p v-if="isStudent">Ajukan pada periode aktif. Server akan menghitung seluruh persyaratan dari snapshot sumber resmi.</p><p v-else>Belum ada pengajuan yang terlihat dalam lingkup akses Anda.</p>
      <button v-if="isStudent && activePeriod" class="btn btn-primary" type="button" :disabled="mutating" @click="submitApplication">Ajukan sekarang</button>
    </section>
  </div>
</template>

<style scoped src="~/pages/_workflow.css"></style>
<style scoped>
.graduation-page{--grad-green:#205b49}.graduation-hero{display:flex;align-items:center;justify-content:space-between;gap:2rem;padding:1.5rem;border:1px solid #d7e6df;border-radius:1rem;color:#fff;background:radial-gradient(circle at 78% 18%,rgba(255,255,255,.12),transparent 25%),linear-gradient(125deg,#173d33,#2e735a);box-shadow:0 18px 44px rgba(25,72,56,.15)}.graduation-hero__copy{max-width:680px}.graduation-hero .section-kicker{color:#a8d7c0}.graduation-hero h2{margin:.2rem 0 .4rem;font-size:1.35rem}.graduation-hero p{margin:0;color:#d2e6dc;font-size:.7rem;line-height:1.6}.graduation-hero__status{display:flex;align-items:center;gap:.85rem;min-width:280px;padding:.9rem 1rem;border:1px solid rgba(255,255,255,.14);border-radius:.85rem;background:rgba(255,255,255,.08)}.hero-seal{display:grid;place-items:center;width:2.8rem;height:2.8rem;border-radius:.8rem;color:#174b39;background:#ccebdc;font-size:1.3rem}.graduation-hero__status small,.graduation-hero__status strong,.graduation-hero__status span{display:block}.graduation-hero__status small{color:#b9d7ca;font-size:.56rem;text-transform:uppercase;letter-spacing:.08em}.graduation-hero__status strong{margin:.12rem 0;color:#fff;font-size:.78rem}.graduation-hero__status span{color:#cce0d7;font-size:.58rem}.workflow-loading{display:flex;justify-content:center;gap:.6rem;padding:3rem;color:#71877d;font-size:.7rem}.application-switcher{display:flex;gap:.55rem;overflow:auto;padding:.2rem}.application-switcher button{display:grid;flex:0 0 auto;min-width:210px;padding:.65rem .8rem;border:1px solid #dfe9e4;border-radius:.75rem;color:#47675b;background:#fff;text-align:left}.application-switcher button.active{border-color:#5c9a80;background:#edf6f1}.application-switcher span{font-size:.68rem;font-weight:750}.application-switcher small{margin-top:.12rem;color:#7c8f87;font-size:.56rem}.eligibility-section,.workflow-card{padding:1.15rem;border:1px solid #dfe8e4;border-radius:1rem;background:#fff;box-shadow:0 10px 28px rgba(25,62,50,.045)}.section-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;margin-bottom:1rem}.section-heading.compact{margin-bottom:.8rem}.section-heading h2{margin:.14rem 0 .28rem;color:#294b40;font-size:1rem}.section-heading p{max-width:720px;margin:0;color:#758980;font-size:.64rem;line-height:1.5}.eligibility-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.75rem}.eligibility-card{overflow:hidden;border:1px solid #e2ebe6;border-radius:.8rem}.eligibility-card>header{display:flex;align-items:center;gap:.6rem;padding:.75rem;background:#f7faf8}.eligibility-card>header>span{display:grid;place-items:center;width:2.15rem;height:2.15rem;border-radius:.6rem;color:#2a7258;background:#e2f1e9}.eligibility-card h3,.eligibility-card small{display:block;margin:0}.eligibility-card h3{color:#35594c;font-size:.7rem}.eligibility-card header small{margin-top:.1rem;color:#82938c;font-size:.55rem}.eligibility-card ul{display:grid;gap:0;margin:0;padding:0;list-style:none}.eligibility-card li{display:flex;gap:.45rem;padding:.6rem .7rem;border-top:1px solid #edf2ef;color:#2b785a}.eligibility-card li.failed{color:#b84949;background:#fff8f8}.eligibility-card li>i{margin-top:.05rem}.eligibility-card li strong{display:block;color:#476258;font-size:.59rem}.eligibility-card li.failed strong{color:#8f3c3c}.eligibility-card li small{margin-top:.1rem;color:#87958f;font-size:.51rem}.graduation-grid{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(280px,.75fr);gap:1rem}.status-timeline{position:relative;display:grid;gap:.1rem;margin:0;padding:0;list-style:none}.status-timeline:before{position:absolute;top:1rem;bottom:1rem;left:.82rem;width:1px;background:#dce8e2;content:''}.status-timeline li{position:relative;display:grid;grid-template-columns:1.65rem minmax(0,1fr);gap:.6rem;padding:.55rem 0}.status-timeline li>span{z-index:1;display:grid;place-items:center;width:1.65rem;height:1.65rem;border:4px solid #fff;border-radius:50%;color:#fff;background:#33795d;font-size:.62rem}.status-timeline strong{display:block;color:#37594d;font-size:.65rem}.status-timeline p,.status-timeline small{margin:0;color:#809089;font-size:.56rem}.review-action{display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-top:.75rem;padding:.75rem;border-radius:.7rem;background:#edf6f1}.review-action strong{display:block;color:#315f4e;font-size:.64rem}.review-action p{max-width:500px;margin:.15rem 0 0;color:#71877e;font-size:.56rem}.period-details{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.6rem;margin:0}.period-details div{padding:.55rem;border-radius:.6rem;background:#f7f9f8}.period-details dt{color:#899891;font-size:.53rem}.period-details dd{margin:.15rem 0 0;color:#385a4e;font-size:.64rem;font-weight:750}.source-versions{display:flex;flex-wrap:wrap;gap:.35rem;margin-top:.8rem;padding-top:.7rem;border-top:1px solid #e7edea}.source-versions span{width:100%;color:#6f847b;font-size:.56rem;font-weight:750}.source-versions small{padding:.25rem .4rem;border-radius:.35rem;color:#527064;background:#eef4f1;font-size:.5rem}.issue-controls{display:flex;gap:.45rem}.issue-controls select{min-width:140px}.render-limitation{display:flex;gap:.65rem;margin-bottom:.85rem;padding:.7rem .8rem;border:1px solid #dce7f1;border-radius:.7rem;color:#315e78;background:#f1f7fb}.render-limitation i{font-size:1rem}.render-limitation strong{display:block;font-size:.63rem}.render-limitation p{margin:.12rem 0 0;color:#6f8795;font-size:.56rem}.document-list{display:grid}.document-row{display:grid;grid-template-columns:auto minmax(220px,1fr) minmax(180px,.8fr) auto;gap:.8rem;align-items:center;padding:.8rem 0}.document-row+.document-row{border-top:1px solid #e8eeeb}.document-icon{display:grid;place-items:center;width:2.55rem;height:2.55rem;border-radius:.7rem;color:#2d7259;background:#e7f3ed;font-size:1.1rem}.document-copy>div{display:flex;align-items:center;gap:.45rem}.document-copy strong{color:#35564b;font-size:.68rem}.document-copy p{margin:.18rem 0;color:#456b5d;font-size:.61rem;font-weight:650}.document-copy small,.document-hash small{display:block;color:#85958e;font-size:.52rem}.document-hash{min-width:0}.document-hash code{display:block;overflow:hidden;margin-top:.15rem;color:#60746b;font-size:.5rem;text-overflow:ellipsis;white-space:nowrap}.documents-empty{display:flex;justify-content:center;gap:.65rem;padding:1.4rem;color:#72877e;background:#f8faf9}.documents-empty i{font-size:1.4rem}.documents-empty strong{display:block;color:#47665a;font-size:.66rem}.documents-empty p{margin:.15rem 0 0;font-size:.57rem}.empty-workspace{text-align:center;padding:3rem}.empty-workspace>span{display:grid;place-items:center;width:3.6rem;height:3.6rem;margin:0 auto .8rem;border-radius:1rem;color:#2e7359;background:#e6f2ec;font-size:1.6rem}.empty-workspace h2{color:#315348;font-size:1rem}.empty-workspace p{max-width:520px;margin:.35rem auto 1rem;color:#788a83;font-size:.67rem}
@media(max-width:1199.98px){.eligibility-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.document-row{grid-template-columns:auto minmax(0,1fr) auto}.document-hash{grid-column:2/4}}
@media(max-width:991.98px){.graduation-hero{align-items:flex-start;flex-direction:column}.graduation-hero__status{width:100%;min-width:0}.graduation-grid{grid-template-columns:1fr}}
@media(max-width:767.98px){.eligibility-grid{grid-template-columns:1fr}.section-heading{align-items:flex-start;flex-direction:column}.issue-controls{width:100%}.issue-controls select{flex:1}.document-row{grid-template-columns:auto minmax(0,1fr)}.document-row>.btn{grid-column:2;justify-self:start}.document-hash{grid-column:2}.review-action{align-items:flex-start;flex-direction:column}.period-details{grid-template-columns:1fr 1fr}}
@media(max-width:575.98px){.graduation-hero{padding:1rem}.graduation-hero h2{font-size:1.1rem}.eligibility-section,.workflow-card{padding:.9rem}.document-hash{display:none}.period-details{grid-template-columns:1fr}}
</style>
