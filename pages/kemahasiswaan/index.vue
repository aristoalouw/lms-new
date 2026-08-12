<script setup lang="ts">
type EvidenceRef = { fileId: string; fileName: string; mimeType: string; sizeBytes: number; checksumSha256?: string }
type Portfolio = { id: string; studentId: string; kind: 'ACTIVITY' | 'ACHIEVEMENT'; title: string; category: string; level: string; organization: string; occurredAt: string; evidence: EvidenceRef[]; status: string; reviewNote?: string; awardedPoints: number; version: number }
type LedgerEntry = { id: string; sourceType: string; points: number; reason: string; createdAt: string; immutable: true }
type Ledger = { studentId: string; totalPoints: number; entries: LedgerEntry[] }
type ViolationCase = { id: string; studentId: string; title: string; allegation: string; severity: string; status: string; responseDueAt: string; studentResponse?: string; staffNotes?: Array<{ id: string; body: string }>; resolution?: { outcome: string; summary: string; pointAdjustment: number }; version: number }
type EligibilityCheck = { id: string; label: string; passed: boolean; detail: string }
type ScholarshipProgram = { id: string; name: string; description: string; status: string; applicationClosesAt: string; minGpa: number; minCredits: number; quota: number; awardedCount: number; checklist: Array<{ id: string; label: string }> }
type ScholarshipApplication = { id: string; programId: string; studentId: string; status: string; statement: string; eligibilitySnapshot: { eligible: boolean; checks: EligibilityCheck[] }; decisionReason?: string; internalReviewNotes?: string; version: number }
type RequirementDocument = { id: string; studentId: string; documentType: string; label: string; file: EvidenceRef; status: string; rejectionReason?: string; version: number }
type LetterRequest = { id: string; studentId: string; purpose: string; status: string; eligibilitySnapshot: { eligible: boolean; reasons: string[]; evaluatedAt: string }; rejectionReason?: string; verificationNumber?: string; issuanceId?: string; version: number; submittedAt: string }
type Issuance = { verificationNumber: string; recordHash: string; file: EvidenceRef }
type Paginated<T> = { items: T[]; page: number; pageSize: number; total: number; totalPages: number }

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Kemahasiswaan' })

const { user } = useAuth()
const activeTab = ref<'portfolio' | 'points' | 'cases' | 'scholarships' | 'documents' | 'letters'>('portfolio')
const loading = ref(false)
const submitting = ref(false)
const errorMessage = ref('')
const noticeMessage = ref('')
const search = ref('')
const statusFilter = ref('')
const portfolio = ref<Portfolio[]>([])
const ledger = ref<Ledger | null>(null)
const cases = ref<ViolationCase[]>([])
const programs = ref<ScholarshipProgram[]>([])
const applications = ref<ScholarshipApplication[]>([])
const documents = ref<RequirementDocument[]>([])
const letters = ref<LetterRequest[]>([])
const selectedStudentId = ref('')
const responseDrafts = reactive<Record<string, string>>({})
const ruleDrafts = reactive<Record<string, string>>({})
const issuanceDrafts = reactive<Record<string, EvidenceRef>>({})

const isStudent = computed(() => user.value?.roles.includes('student') ?? false)
const canManage = computed(() => user.value?.roles.includes('student_affairs_staff') ?? false)
const ownStudentId = computed(() => user.value?.studentId || user.value?.id || '')
const tabs = [
  { id: 'portfolio', label: 'Portofolio', icon: 'uil-award' },
  { id: 'points', label: 'Poin', icon: 'uil-chart-line' },
  { id: 'cases', label: 'Kasus', icon: 'uil-shield-exclamation' },
  { id: 'scholarships', label: 'Beasiswa', icon: 'uil-graduation-cap' },
  { id: 'documents', label: 'Dokumen', icon: 'uil-file-check-alt' },
  { id: 'letters', label: 'Surat aktif', icon: 'uil-file-contract' },
] as const

const portfolioForm = reactive({ kind: 'ACTIVITY' as 'ACTIVITY' | 'ACHIEVEMENT', title: '', category: 'ORGANIZATION', level: 'CAMPUS', roleOrRank: '', organization: '', occurredAt: '', description: '', fileId: '', fileName: '', checksumSha256: '' })
const documentForm = reactive({ documentType: 'RECOMMENDATION', label: '', fileId: '', fileName: '', checksumSha256: '' })
const scholarshipForm = reactive({ programId: '', statement: '' })
const letterPurpose = ref('')

const idempotencyKey = (purpose: string) => `${purpose}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`
const errorText = (error: unknown) => {
  if (!error || typeof error !== 'object') return 'Permintaan tidak dapat diproses.'
  const candidate = error as { response?: { data?: { statusMessage?: string; message?: string } }; message?: string }
  return candidate.response?.data?.statusMessage || candidate.response?.data?.message || candidate.message || 'Permintaan tidak dapat diproses.'
}
const formatDate = (value?: string) => value ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(value)) : '—'
const queryString = () => {
  const params = new URLSearchParams({ page: '1', pageSize: '50' })
  if (search.value.trim()) params.set('search', search.value.trim())
  if (statusFilter.value) params.set('status', statusFilter.value)
  return params.toString()
}
const defaultRule = (item: Portfolio) => item.kind === 'ACTIVITY' ? 'activity-campus' : item.level === 'INTERNATIONAL' ? 'achievement-international' : 'achievement-national'
const ensureDrafts = () => {
  for (const item of portfolio.value) ruleDrafts[item.id] ||= defaultRule(item)
  for (const item of letters.value) issuanceDrafts[item.id] ||= { fileId: '', fileName: '', mimeType: 'application/pdf', sizeBytes: 1, checksumSha256: '' }
  scholarshipForm.programId ||= programs.value.find(item => item.status === 'OPEN')?.id || ''
  selectedStudentId.value ||= isStudent.value ? ownStudentId.value : portfolio.value[0]?.studentId || cases.value[0]?.studentId || ''
}
const issuanceFile = (requestId: string): EvidenceRef => {
  issuanceDrafts[requestId] ||= { fileId: '', fileName: '', mimeType: 'application/pdf', sizeBytes: 1, checksumSha256: '' }
  return issuanceDrafts[requestId]!
}

const loadAll = async () => {
  loading.value = true
  errorMessage.value = ''
  try {
    const api = useNuxtApp().$api
    const qs = queryString()
    const [portfolioResponse, caseResponse, programResponse, applicationResponse, documentResponse, letterResponse] = await Promise.all([
      api.get<Paginated<Portfolio>>(`/student-affairs/portfolio?${qs}`),
      api.get<Paginated<ViolationCase>>(`/student-affairs/cases?${qs}`),
      api.get<Paginated<ScholarshipProgram>>(`/student-affairs/scholarships/programs?${qs}`),
      api.get<Paginated<ScholarshipApplication>>(`/student-affairs/scholarships/applications?${qs}`),
      api.get<Paginated<RequirementDocument>>(`/student-affairs/documents?${qs}`),
      api.get<Paginated<LetterRequest>>(`/student-affairs/letters?${qs}`),
    ])
    portfolio.value = portfolioResponse.data.items
    cases.value = caseResponse.data.items
    programs.value = programResponse.data.items
    applications.value = applicationResponse.data.items
    documents.value = documentResponse.data.items
    letters.value = letterResponse.data.items
    ensureDrafts()
    if (selectedStudentId.value) await loadLedger()
  } catch (error) {
    errorMessage.value = errorText(error)
  } finally {
    loading.value = false
  }
}

const loadLedger = async () => {
  if (!selectedStudentId.value) return
  try {
    const { data } = await useNuxtApp().$api.get<Ledger>(`/student-affairs/points/${encodeURIComponent(selectedStudentId.value)}`)
    ledger.value = data
  } catch (error) {
    ledger.value = null
    errorMessage.value = errorText(error)
  }
}

const runAction = async (action: () => Promise<void>, success: string) => {
  submitting.value = true
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    await action()
    noticeMessage.value = success
    await loadAll()
  } catch (error) {
    errorMessage.value = errorText(error)
  } finally {
    submitting.value = false
  }
}
const post = (url: string, body: unknown, purpose: string) => useNuxtApp().$api.post(url, body, { headers: { 'Idempotency-Key': idempotencyKey(purpose) } })

const submitPortfolio = () => runAction(async () => {
  await post('/student-affairs/portfolio', {
    kind: portfolioForm.kind, title: portfolioForm.title, category: portfolioForm.category, level: portfolioForm.level,
    roleOrRank: portfolioForm.roleOrRank, organization: portfolioForm.organization,
    occurredAt: new Date(`${portfolioForm.occurredAt}:00+07:00`).toISOString(), description: portfolioForm.description || undefined,
    evidence: [{ fileId: portfolioForm.fileId, fileName: portfolioForm.fileName, mimeType: 'application/pdf', sizeBytes: 1, ...(portfolioForm.checksumSha256 ? { checksumSha256: portfolioForm.checksumSha256 } : {}) }],
  }, 'portfolio-submit')
  Object.assign(portfolioForm, { title: '', roleOrRank: '', organization: '', occurredAt: '', description: '', fileId: '', fileName: '', checksumSha256: '' })
}, 'Portofolio dikirim untuk verifikasi.')

const reviewPortfolio = (item: Portfolio, decision: 'VERIFY' | 'REJECT') => runAction(async () => {
  await post(`/student-affairs/portfolio/${encodeURIComponent(item.id)}/review`, {
    decision, ...(decision === 'VERIFY' ? { ruleId: ruleDrafts[item.id] } : {}),
    reviewNote: decision === 'VERIFY' ? 'Bukti dan informasi portofolio telah diverifikasi.' : 'Bukti portofolio perlu diperbaiki.', expectedVersion: item.version,
  }, `portfolio-${decision.toLowerCase()}`)
}, decision === 'VERIFY' ? 'Portofolio terverifikasi dan poin dibukukan.' : 'Portofolio ditolak dengan catatan.')

const submitCaseResponse = (item: ViolationCase) => runAction(async () => {
  await post(`/student-affairs/cases/${encodeURIComponent(item.id)}/response`, { response: responseDrafts[item.id], expectedVersion: item.version }, 'case-response')
  responseDrafts[item.id] = ''
}, 'Tanggapan kasus berhasil disimpan.')

const transitionCase = (item: ViolationCase, targetStatus: string) => runAction(async () => {
  await post(`/student-affairs/cases/${encodeURIComponent(item.id)}/transition`, {
    targetStatus, expectedVersion: item.version, pointAdjustment: 0,
    ...(targetStatus === 'RESOLVED' ? { outcome: 'COACHING_COMPLETED', resolutionSummary: 'Pembinaan dan pemeriksaan kasus telah diselesaikan.' } : {}),
    ...(targetStatus === 'DISMISSED' ? { publicReason: 'Laporan dihentikan berdasarkan hasil pemeriksaan.' } : {}),
  }, `case-${targetStatus.toLowerCase()}`)
}, `Status kasus diperbarui menjadi ${targetStatus}.`)

const applyScholarship = () => runAction(async () => {
  await post('/student-affairs/scholarships/applications', {
    programId: scholarshipForm.programId, statement: scholarshipForm.statement,
    submittedDocumentIds: documents.value.filter(item => item.status === 'VERIFIED').map(item => item.id),
  }, 'scholarship-apply')
  scholarshipForm.statement = ''
}, 'Aplikasi beasiswa berhasil dikirim.')

const transitionApplication = (item: ScholarshipApplication, targetStatus: string) => runAction(async () => {
  await post(`/student-affairs/scholarships/applications/${encodeURIComponent(item.id)}/transition`, {
    targetStatus, expectedVersion: item.version,
    ...(targetStatus === 'UNDER_REVIEW' ? { internalReviewNotes: 'Aplikasi masuk pemeriksaan berkas dan pemeringkatan.' } : {}),
    ...(['AWARDED', 'REJECTED'].includes(targetStatus) ? { decisionReason: targetStatus === 'AWARDED' ? 'Memenuhi kriteria dan peringkat seleksi.' : 'Belum memenuhi peringkat seleksi.' } : {}),
  }, `scholarship-${targetStatus.toLowerCase()}`)
}, `Status aplikasi diperbarui menjadi ${targetStatus}.`)

const submitDocument = () => runAction(async () => {
  await post('/student-affairs/documents', {
    documentType: documentForm.documentType, label: documentForm.label,
    file: { fileId: documentForm.fileId, fileName: documentForm.fileName, mimeType: 'application/pdf', sizeBytes: 1, ...(documentForm.checksumSha256 ? { checksumSha256: documentForm.checksumSha256 } : {}) },
  }, 'document-submit')
  Object.assign(documentForm, { label: '', fileId: '', fileName: '', checksumSha256: '' })
}, 'Referensi dokumen berhasil dikirim.')

const reviewDocument = (item: RequirementDocument, status: 'VERIFIED' | 'REJECTED') => runAction(async () => {
  await post(`/student-affairs/documents/${encodeURIComponent(item.id)}/review`, { status, expectedVersion: item.version, ...(status === 'REJECTED' ? { rejectionReason: 'Dokumen perlu diperbaiki atau diperbarui.' } : {}) }, `document-${status.toLowerCase()}`)
}, status === 'VERIFIED' ? 'Dokumen terverifikasi.' : 'Dokumen ditolak dengan alasan.')

const requestLetter = () => runAction(async () => {
  await post('/student-affairs/letters', { purpose: letterPurpose.value }, 'letter-request')
  letterPurpose.value = ''
}, 'Permohonan surat aktif berhasil dikirim.')

const transitionLetter = (item: LetterRequest, targetStatus: 'VERIFIED' | 'REJECTED') => runAction(async () => {
  await post(`/student-affairs/letters/${encodeURIComponent(item.id)}/transition`, { targetStatus, expectedVersion: item.version, ...(targetStatus === 'REJECTED' ? { rejectionReason: 'Permohonan perlu dilengkapi.' } : {}) }, `letter-${targetStatus.toLowerCase()}`)
}, targetStatus === 'VERIFIED' ? 'Permohonan surat terverifikasi.' : 'Permohonan surat ditolak.')

const issueLetter = (item: LetterRequest) => runAction(async () => {
  await post(`/student-affairs/letters/${encodeURIComponent(item.id)}/issue`, { expectedVersion: item.version, file: issuanceFile(item.id) }, 'letter-issue')
}, 'Surat aktif diterbitkan dengan nomor verifikasi dan hash tetap.')

const downloadLetter = async (item: LetterRequest) => {
  errorMessage.value = ''
  try {
    const { data } = await useNuxtApp().$api.get<Issuance>(`/student-affairs/letters/${encodeURIComponent(item.id)}/download`)
    noticeMessage.value = `Referensi ${data.file.fileName} · ${data.verificationNumber} · hash ${data.recordHash.slice(0, 12)}…`
  } catch (error) { errorMessage.value = errorText(error) }
}

watch(selectedStudentId, loadLedger)
onMounted(loadAll)
</script>

<template>
  <div class="page-stack student-affairs-page">
    <AppPageHeader eyebrow="Layanan mahasiswa" title="Kemahasiswaan" description="Satu ruang kerja untuk portofolio, poin, disiplin, beasiswa, dokumen persyaratan, dan surat aktif yang dapat diaudit.">
      <template #actions><button class="btn btn-outline-secondary" type="button" :disabled="loading" @click="loadAll"><i class="uil uil-refresh me-2" />Muat ulang</button></template>
    </AppPageHeader>

    <div v-if="noticeMessage" class="alert alert-success d-flex gap-2 align-items-start mb-0" role="status"><i class="uil uil-check-circle mt-1" /><span>{{ noticeMessage }}</span><button class="btn-close ms-auto" type="button" aria-label="Tutup" @click="noticeMessage = ''" /></div>
    <div v-if="errorMessage" class="alert alert-danger d-flex gap-2 align-items-start mb-0" role="alert"><i class="uil uil-exclamation-triangle mt-1" /><span>{{ errorMessage }}</span></div>

    <section class="row g-3" aria-label="Ringkasan kemahasiswaan">
      <div class="col-6 col-xl-3"><StatCard label="Portofolio" :value="portfolio.length" detail="Dalam lingkup akun" tone="forest" icon="uil-award" /></div>
      <div class="col-6 col-xl-3"><StatCard label="Poin mahasiswa" :value="ledger?.totalPoints ?? '—'" detail="Ledger tidak dapat diubah" tone="blue" icon="uil-chart-line" /></div>
      <div class="col-6 col-xl-3"><StatCard label="Kasus terbuka" :value="cases.filter(item => !['RESOLVED', 'DISMISSED'].includes(item.status)).length" detail="Dengan proses tanggapan" tone="coral" icon="uil-shield-exclamation" /></div>
      <div class="col-6 col-xl-3"><StatCard label="Surat terbit" :value="letters.filter(item => item.status === 'ISSUED').length" detail="Bernomor & ber-hash" tone="amber" icon="uil-file-contract" /></div>
    </section>

    <section class="affairs-shell">
      <nav class="affairs-tabs" aria-label="Bagian kemahasiswaan">
        <button v-for="tab in tabs" :key="tab.id" type="button" :class="{ active: activeTab === tab.id }" @click="activeTab = tab.id"><i class="uil" :class="tab.icon" />{{ tab.label }}</button>
      </nav>
      <div class="affairs-toolbar">
        <label><span class="visually-hidden">Cari</span><i class="uil uil-search" /><input v-model="search" class="form-control" placeholder="Cari data dalam lingkup…" @keyup.enter="loadAll"></label>
        <select v-model="statusFilter" class="form-select" aria-label="Filter status" @change="loadAll"><option value="">Semua status</option><option>SUBMITTED</option><option>VERIFIED</option><option>UNDER_REVIEW</option><option>REJECTED</option><option>RESOLVED</option><option>ISSUED</option></select>
        <button class="btn btn-primary" type="button" @click="loadAll">Terapkan</button>
      </div>

      <div v-if="loading" class="loading-state" role="status"><span class="spinner-border spinner-border-sm" />Memuat data kemahasiswaan…</div>

      <div v-else-if="activeTab === 'portfolio'" class="content-grid">
        <article v-if="isStudent" class="panel-card">
          <header><div><span class="section-kicker">Catatan capaian</span><h2>Ajukan portofolio</h2></div></header>
          <form class="form-stack" @submit.prevent="submitPortfolio">
            <div class="two-fields"><label><span>Jenis</span><select v-model="portfolioForm.kind" class="form-select"><option>ACTIVITY</option><option>ACHIEVEMENT</option></select></label><label><span>Tingkat</span><select v-model="portfolioForm.level" class="form-select"><option>CAMPUS</option><option>REGIONAL</option><option>NATIONAL</option><option>INTERNATIONAL</option></select></label></div>
            <label><span>Judul</span><input v-model="portfolioForm.title" class="form-control" minlength="3" required></label>
            <div class="two-fields"><label><span>Kategori</span><input v-model="portfolioForm.category" class="form-control" pattern="[A-Z][A-Z0-9_-]*" required></label><label><span>Waktu kegiatan</span><input v-model="portfolioForm.occurredAt" class="form-control" type="datetime-local" required></label></div>
            <div class="two-fields"><label><span>Peran / peringkat</span><input v-model="portfolioForm.roleOrRank" class="form-control" required></label><label><span>Organisasi</span><input v-model="portfolioForm.organization" class="form-control" required></label></div>
            <label><span>File ID bukti</span><input v-model="portfolioForm.fileId" class="form-control" required placeholder="Referensi dari modul Berkas"></label>
            <div class="two-fields"><label><span>Nama file</span><input v-model="portfolioForm.fileName" class="form-control" required></label><label><span>Checksum SHA-256 (opsional)</span><input v-model="portfolioForm.checksumSha256" class="form-control" maxlength="64"></label></div>
            <button class="btn btn-primary" type="submit" :disabled="submitting">Kirim untuk verifikasi</button>
          </form>
        </article>
        <article class="panel-card" :class="{ 'panel-card--wide': !isStudent }">
          <header><div><span class="section-kicker">Aktivitas & prestasi</span><h2>Portofolio terjangkau</h2></div><span>{{ portfolio.length }} item</span></header>
          <div v-if="portfolio.length" class="record-list"><article v-for="item in portfolio" :key="item.id"><div class="record-main"><div class="record-title"><strong>{{ item.title }}</strong><StatusBadge :status="item.status.toLowerCase()" :label="item.status" /></div><p>{{ item.kind }} · {{ item.level }} · {{ item.organization }}</p><small>{{ formatDate(item.occurredAt) }} · {{ item.evidence.length }} bukti metadata · v{{ item.version }}</small></div><div v-if="canManage && item.status === 'SUBMITTED'" class="record-actions"><input v-model="ruleDrafts[item.id]" class="form-control form-control-sm" aria-label="Aturan poin"><button class="btn btn-sm btn-success" :disabled="submitting" @click="reviewPortfolio(item, 'VERIFY')">Verifikasi</button><button class="btn btn-sm btn-outline-danger" :disabled="submitting" @click="reviewPortfolio(item, 'REJECT')">Tolak</button></div><strong v-else class="point-value">{{ item.awardedPoints }} poin</strong></article></div>
          <EmptyState v-else title="Belum ada portofolio" description="Aktivitas dan prestasi dalam lingkup akun akan muncul di sini." />
        </article>
      </div>

      <div v-else-if="activeTab === 'points'" class="content-grid">
        <article class="panel-card panel-card--wide"><header><div><span class="section-kicker">Ledger poin</span><h2>Riwayat poin yang tidak dapat diubah</h2></div><strong class="total-points">{{ ledger?.totalPoints ?? 0 }} poin</strong></header><div class="student-picker"><label><span>Student ID</span><input v-model="selectedStudentId" class="form-control" :readonly="isStudent"></label><button class="btn btn-outline-primary" @click="loadLedger">Muat ledger</button></div><div v-if="ledger?.entries.length" class="record-list"><article v-for="entry in ledger.entries" :key="entry.id"><div class="record-main"><div class="record-title"><strong>{{ entry.reason }}</strong><StatusBadge status="verified" label="Immutable" /></div><small>{{ entry.sourceType }} · {{ formatDate(entry.createdAt) }}</small></div><strong class="point-value" :class="{ negative: entry.points < 0 }">{{ entry.points > 0 ? '+' : '' }}{{ entry.points }}</strong></article></div><EmptyState v-else title="Ledger belum dipilih atau masih kosong" description="Mahasiswa melihat ledger miliknya; petugas memasukkan Student ID dalam lingkup program studi." /></article>
      </div>

      <div v-else-if="activeTab === 'cases'" class="content-grid">
        <article class="panel-card panel-card--wide"><header><div><span class="section-kicker">Proses yang adil</span><h2>Kasus & pelanggaran</h2></div><span>{{ cases.length }} kasus</span></header><div v-if="cases.length" class="record-list"><article v-for="item in cases" :key="item.id"><div class="record-main"><div class="record-title"><strong>{{ item.title }}</strong><StatusBadge :status="item.status.toLowerCase()" :label="item.status" /></div><p>{{ item.allegation }}</p><small>{{ item.severity }} · Batas tanggapan {{ formatDate(item.responseDueAt) }} · v{{ item.version }}</small><div v-if="item.resolution" class="resolution-box">{{ item.resolution.outcome }} · {{ item.resolution.summary }} · {{ item.resolution.pointAdjustment }} poin</div><div v-if="isStudent && item.status === 'NOTIFIED'" class="response-box"><textarea v-model="responseDrafts[item.id]" class="form-control" rows="3" minlength="20" placeholder="Tulis tanggapan dan kronologi Anda…" /><button class="btn btn-primary btn-sm" :disabled="submitting || (responseDrafts[item.id]?.length || 0) < 20" @click="submitCaseResponse(item)">Kirim tanggapan</button></div></div><div v-if="canManage" class="record-actions"><button v-if="item.status === 'REPORTED'" class="btn btn-sm btn-primary" @click="transitionCase(item, 'NOTIFIED')">Beritahukan</button><button v-if="['NOTIFIED', 'STUDENT_RESPONSE'].includes(item.status)" class="btn btn-sm btn-primary" @click="transitionCase(item, 'UNDER_REVIEW')">Tinjau</button><button v-if="item.status === 'UNDER_REVIEW'" class="btn btn-sm btn-success" @click="transitionCase(item, 'RESOLVED')">Selesaikan</button><button v-if="!['RESOLVED', 'DISMISSED'].includes(item.status)" class="btn btn-sm btn-outline-secondary" @click="transitionCase(item, 'DISMISSED')">Hentikan</button></div></article></div><EmptyState v-else title="Tidak ada kasus" description="Kasus hanya terlihat sesuai kepemilikan dan lingkup program studi." /></article>
      </div>

      <div v-else-if="activeTab === 'scholarships'" class="content-grid">
        <article class="panel-card"><header><div><span class="section-kicker">Program tersedia</span><h2>Beasiswa</h2></div></header><div class="record-list"><article v-for="program in programs" :key="program.id"><div class="record-main"><div class="record-title"><strong>{{ program.name }}</strong><StatusBadge :status="program.status.toLowerCase()" :label="program.status" /></div><p>{{ program.description }}</p><small>IPK ≥ {{ program.minGpa }} · {{ program.minCredits }} SKS · {{ program.awardedCount }}/{{ program.quota }} penerima · tutup {{ formatDate(program.applicationClosesAt) }}</small></div></article></div><form v-if="isStudent && programs.some(item => item.status === 'OPEN')" class="form-stack scholarship-form" @submit.prevent="applyScholarship"><label><span>Program</span><select v-model="scholarshipForm.programId" class="form-select"><option v-for="program in programs.filter(item => item.status === 'OPEN')" :key="program.id" :value="program.id">{{ program.name }}</option></select></label><label><span>Pernyataan pengajuan</span><textarea v-model="scholarshipForm.statement" class="form-control" minlength="30" maxlength="3000" rows="4" required /></label><small>Dokumen terverifikasi Anda akan dilampirkan sebagai referensi.</small><button class="btn btn-primary" type="submit" :disabled="submitting">Ajukan beasiswa</button></form></article>
        <article class="panel-card"><header><div><span class="section-kicker">State machine review</span><h2>Aplikasi</h2></div><span>{{ applications.length }}</span></header><div v-if="applications.length" class="record-list"><article v-for="item in applications" :key="item.id"><div class="record-main"><div class="record-title"><strong>{{ programs.find(program => program.id === item.programId)?.name || item.programId }}</strong><StatusBadge :status="item.status.toLowerCase()" :label="item.status" /></div><small>{{ item.studentId }} · {{ item.eligibilitySnapshot.checks.filter(check => check.passed).length }}/{{ item.eligibilitySnapshot.checks.length }} syarat · v{{ item.version }}</small><p v-if="item.decisionReason">{{ item.decisionReason }}</p></div><div v-if="canManage" class="record-actions"><button v-if="item.status === 'SUBMITTED'" class="btn btn-sm btn-primary" @click="transitionApplication(item, 'UNDER_REVIEW')">Mulai review</button><button v-if="item.status === 'UNDER_REVIEW'" class="btn btn-sm btn-success" @click="transitionApplication(item, 'AWARDED')">Tetapkan</button><button v-if="item.status === 'UNDER_REVIEW'" class="btn btn-sm btn-outline-danger" @click="transitionApplication(item, 'REJECTED')">Tolak</button></div></article></div><EmptyState v-else title="Belum ada aplikasi" description="Aplikasi yang lolos pemeriksaan awal akan muncul di sini." /></article>
      </div>

      <div v-else-if="activeTab === 'documents'" class="content-grid">
        <article v-if="isStudent" class="panel-card"><header><div><span class="section-kicker">Referensi privat</span><h2>Kirim dokumen persyaratan</h2></div></header><form class="form-stack" @submit.prevent="submitDocument"><div class="two-fields"><label><span>Jenis dokumen</span><input v-model="documentForm.documentType" class="form-control" pattern="[A-Z][A-Z0-9_-]*" required></label><label><span>Label</span><input v-model="documentForm.label" class="form-control" required></label></div><label><span>File ID</span><input v-model="documentForm.fileId" class="form-control" required></label><div class="two-fields"><label><span>Nama file</span><input v-model="documentForm.fileName" class="form-control" required></label><label><span>Checksum SHA-256</span><input v-model="documentForm.checksumSha256" class="form-control" maxlength="64"></label></div><small>Halaman ini hanya menyimpan metadata; isi file tetap berada di penyimpanan privat.</small><button class="btn btn-primary" type="submit" :disabled="submitting">Kirim dokumen</button></form></article>
        <article class="panel-card" :class="{ 'panel-card--wide': !isStudent }"><header><div><span class="section-kicker">Checklist persyaratan</span><h2>Dokumen</h2></div><span>{{ documents.length }}</span></header><div v-if="documents.length" class="record-list"><article v-for="item in documents" :key="item.id"><div class="record-main"><div class="record-title"><strong>{{ item.label }}</strong><StatusBadge :status="item.status.toLowerCase()" :label="item.status" /></div><small>{{ item.studentId }} · {{ item.documentType }} · {{ item.file.fileName }} · v{{ item.version }}</small><p v-if="item.rejectionReason">{{ item.rejectionReason }}</p></div><div v-if="canManage && item.status === 'PENDING'" class="record-actions"><button class="btn btn-sm btn-success" @click="reviewDocument(item, 'VERIFIED')">Verifikasi</button><button class="btn btn-sm btn-outline-danger" @click="reviewDocument(item, 'REJECTED')">Tolak</button></div></article></div><EmptyState v-else title="Belum ada dokumen" description="Referensi dokumen persyaratan akan muncul di sini." /></article>
      </div>

      <div v-else class="content-grid">
        <article v-if="isStudent" class="panel-card"><header><div><span class="section-kicker">Layanan administrasi</span><h2>Mohon surat aktif</h2></div></header><form class="form-stack" @submit.prevent="requestLetter"><label><span>Tujuan penggunaan</span><textarea v-model="letterPurpose" class="form-control" rows="4" minlength="5" maxlength="500" required placeholder="Contoh: persyaratan administrasi program magang" /></label><div class="eligibility-note"><i class="uil uil-shield-check" /><span>Status aktif, financial hold, dan kasus berat akan disnapshot saat pengajuan dan diperiksa lagi saat penerbitan.</span></div><button class="btn btn-primary" type="submit" :disabled="submitting">Kirim permohonan</button></form></article>
        <article class="panel-card" :class="{ 'panel-card--wide': !isStudent }"><header><div><span class="section-kicker">Nomor berurutan & hash</span><h2>Permohonan surat aktif</h2></div><span>{{ letters.length }}</span></header><div v-if="letters.length" class="record-list"><article v-for="item in letters" :key="item.id"><div class="record-main"><div class="record-title"><strong>{{ item.purpose }}</strong><StatusBadge :status="item.status.toLowerCase()" :label="item.status" /></div><small>{{ item.studentId }} · diajukan {{ formatDate(item.submittedAt) }} · snapshot {{ item.eligibilitySnapshot.eligible ? 'layak' : 'tidak layak' }} · v{{ item.version }}</small><p v-if="item.rejectionReason">{{ item.rejectionReason }}</p><div v-if="canManage && item.status === 'VERIFIED'" class="issue-fields"><input v-model="issuanceFile(item.id).fileId" class="form-control form-control-sm" placeholder="File ID surat PDF"><input v-model="issuanceFile(item.id).fileName" class="form-control form-control-sm" placeholder="Nama file PDF"><input v-model="issuanceFile(item.id).checksumSha256" class="form-control form-control-sm" maxlength="64" placeholder="SHA-256 (64 hex)"></div></div><div class="record-actions"><template v-if="canManage && item.status === 'SUBMITTED'"><button class="btn btn-sm btn-success" @click="transitionLetter(item, 'VERIFIED')">Verifikasi</button><button class="btn btn-sm btn-outline-danger" @click="transitionLetter(item, 'REJECTED')">Tolak</button></template><button v-if="canManage && item.status === 'VERIFIED'" class="btn btn-sm btn-primary" :disabled="!issuanceFile(item.id).fileId || issuanceFile(item.id).checksumSha256?.length !== 64" @click="issueLetter(item)">Terbitkan</button><button v-if="item.status === 'ISSUED'" class="btn btn-sm btn-outline-primary" @click="downloadLetter(item)">Referensi unduh</button></div></article></div><EmptyState v-else title="Belum ada permohonan surat" description="Permohonan yang dapat Anda akses akan muncul di sini." /></article>
      </div>
    </section>
  </div>
</template>

<style scoped>
.student-affairs-page { padding-bottom: 2rem; }
.affairs-shell { border: 1px solid var(--color-border, #dfe7e3); border-radius: 1.25rem; background: #fff; overflow: hidden; box-shadow: 0 12px 32px rgba(28, 54, 45, .06); }
.affairs-tabs { display: flex; gap: .35rem; overflow-x: auto; padding: .75rem; border-bottom: 1px solid #e8eeeb; background: #f8fbf9; scrollbar-width: thin; }
.affairs-tabs button { display: inline-flex; align-items: center; gap: .45rem; flex: 0 0 auto; border: 0; border-radius: .75rem; padding: .7rem .9rem; background: transparent; color: #52615b; font-weight: 700; }
.affairs-tabs button:hover, .affairs-tabs button.active { color: #fff; background: #176b52; }
.affairs-toolbar { display: grid; grid-template-columns: minmax(220px, 1fr) minmax(150px, 220px) auto; gap: .75rem; padding: 1rem; border-bottom: 1px solid #e8eeeb; }
.affairs-toolbar label { position: relative; }
.affairs-toolbar label i { position: absolute; left: .8rem; top: 50%; transform: translateY(-50%); color: #72807b; }
.affairs-toolbar label input { padding-left: 2.25rem; }
.loading-state { display: flex; align-items: center; justify-content: center; gap: .65rem; min-height: 220px; color: #5c6b65; }
.content-grid { display: grid; grid-template-columns: minmax(280px, .8fr) minmax(360px, 1.2fr); gap: 1rem; padding: 1rem; align-items: start; }
.panel-card { min-width: 0; border: 1px solid #e2eae6; border-radius: 1rem; background: #fff; padding: 1rem; }
.panel-card--wide { grid-column: 1 / -1; }
.panel-card > header { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; margin-bottom: 1rem; }
.panel-card h2 { margin: .15rem 0 0; font-size: 1.05rem; }
.panel-card > header > span { border-radius: 999px; background: #eef5f1; color: #176b52; padding: .35rem .65rem; font-weight: 800; font-size: .8rem; }
.form-stack { display: grid; gap: .8rem; }
.form-stack label, .two-fields label, .student-picker label { display: grid; gap: .35rem; font-size: .82rem; font-weight: 700; color: #4d5d57; }
.two-fields { display: grid; grid-template-columns: 1fr 1fr; gap: .75rem; }
.record-list { display: grid; gap: .7rem; }
.record-list > article { display: flex; gap: .85rem; align-items: center; justify-content: space-between; padding: .9rem; border: 1px solid #e5ece8; border-radius: .85rem; background: #fbfdfc; }
.record-main { min-width: 0; flex: 1; }
.record-title { display: flex; flex-wrap: wrap; align-items: center; gap: .55rem; }
.record-main p { margin: .35rem 0; color: #5c6b65; font-size: .88rem; }
.record-main small { color: #72807b; }
.record-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: center; gap: .45rem; }
.record-actions input { width: 180px; }
.point-value, .total-points { color: #176b52; white-space: nowrap; }
.point-value.negative { color: #b0443d; }
.student-picker { display: flex; align-items: end; gap: .65rem; max-width: 540px; margin-bottom: 1rem; }
.student-picker label { flex: 1; }
.response-box, .issue-fields { display: grid; gap: .5rem; margin-top: .75rem; }
.response-box .btn { justify-self: start; }
.resolution-box, .eligibility-note { display: flex; gap: .55rem; margin-top: .7rem; padding: .7rem; border-radius: .65rem; background: #eef7f3; color: #315e50; font-size: .82rem; }
.scholarship-form { margin-top: 1rem; padding-top: 1rem; border-top: 1px solid #e5ece8; }

@media (max-width: 991.98px) {
  .content-grid { grid-template-columns: 1fr; }
  .panel-card--wide { grid-column: auto; }
}
@media (max-width: 575.98px) {
  .affairs-toolbar { grid-template-columns: 1fr; }
  .content-grid { padding: .75rem; }
  .two-fields { grid-template-columns: 1fr; }
  .record-list > article { align-items: flex-start; flex-direction: column; }
  .record-actions { justify-content: flex-start; width: 100%; }
  .record-actions input { width: 100%; }
  .student-picker { align-items: stretch; flex-direction: column; }
  .affairs-tabs button { padding: .65rem .75rem; }
}
</style>
