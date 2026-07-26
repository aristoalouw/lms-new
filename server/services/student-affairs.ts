import type { H3Event } from 'h3'
import type { AuthContext } from '../types/auth'
import type {
  ActiveStudentEligibilitySnapshot,
  ActiveStudentLetterIssuance,
  ActiveStudentLetterRequest,
  CaseNote,
  CaseSeverity,
  CaseStatus,
  EligibilityCheckResult,
  EvidenceFileReference,
  LetterRequestStatus,
  PaginatedResult,
  PointLedgerEntry,
  PointLedgerView,
  PointPolicy,
  PointRule,
  PortfolioKind,
  ScholarshipApplication,
  ScholarshipApplicationStatus,
  ScholarshipEligibilitySnapshot,
  ScholarshipProgram,
  ScholarshipProgramStatus,
  StudentAffairsProfile,
  StudentPortfolioRecord,
  StudentRequirementDocument,
  StudentViolationCase,
} from '../types/student-affairs'
import { appendAudit } from '../utils/audit'
import { conflict, forbidden, invalidInput, notFound, serviceUnavailable } from '../utils/errors'
import { dataMode, firestoreAdmin } from '../utils/firebase-admin'
import { hasRole } from '../utils/rbac'
import { opaqueId, requestHash } from '../utils/security'
import { normalizeIsoInstant, optionalString, requireInteger, requireRecord, requireString } from '../utils/validation'

export interface StudentAffairsListQuery {
  page: number
  pageSize: number
  status?: string
  studentId?: string
  programStudyId?: string
  search?: string
}

export interface StudentAffairsWriteResult<T> {
  value: T
  replayed: boolean
  auditId?: string
}

interface IdempotencyRecord<T = unknown> {
  requestHash: string
  response: StudentAffairsWriteResult<T>
  createdAt: string
}

export interface StudentAffairsMockState {
  profiles: Map<string, StudentAffairsProfile>
  portfolio: Map<string, StudentPortfolioRecord>
  pointPolicies: Map<string, PointPolicy>
  pointLedger: Map<string, PointLedgerEntry>
  cases: Map<string, StudentViolationCase>
  scholarshipPrograms: Map<string, ScholarshipProgram>
  scholarshipApplications: Map<string, ScholarshipApplication>
  documents: Map<string, StudentRequirementDocument>
  letterRequests: Map<string, ActiveStudentLetterRequest>
  letterIssuances: Map<string, ActiveStudentLetterIssuance>
  letterCounters: Map<number, number>
  idempotency: Map<string, IdempotencyRecord>
}

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000
const COLLECTION_LIMIT = 5_000
const PORTFOLIO_KINDS: PortfolioKind[] = ['ACTIVITY', 'ACHIEVEMENT']
const PORTFOLIO_LEVELS: StudentPortfolioRecord['level'][] = ['CAMPUS', 'REGIONAL', 'NATIONAL', 'INTERNATIONAL']
const CASE_SEVERITIES: CaseSeverity[] = ['MINOR', 'MODERATE', 'MAJOR', 'CRITICAL']
const CASE_STATUSES: CaseStatus[] = ['REPORTED', 'NOTIFIED', 'STUDENT_RESPONSE', 'UNDER_REVIEW', 'RESOLVED', 'DISMISSED']
const APPLICATION_STATUSES: ScholarshipApplicationStatus[] = ['SUBMITTED', 'UNDER_REVIEW', 'AWARDED', 'REJECTED', 'WITHDRAWN']
const LETTER_STATUSES: LetterRequestStatus[] = ['SUBMITTED', 'VERIFIED', 'REJECTED', 'ISSUED']

function clone<T>(value: T): T {
  return structuredClone(value)
}

const SEEDED_PROFILES: StudentAffairsProfile[] = [
  { studentId: 'student-001', studentNumber: '23011001', studentName: 'Nabila Putri', programStudyId: 'management-s1', unitId: 'faculty-economics', cohortYear: 2023, enrollmentStatus: 'ACTIVE', currentPeriodId: '2025-2026-2', gpa: 3.62, earnedCredits: 108, financialHold: false },
  { studentId: 'student-002', studentNumber: '23011002', studentName: 'Rafi Ramadhan', programStudyId: 'management-s1', unitId: 'faculty-economics', cohortYear: 2023, enrollmentStatus: 'ACTIVE', currentPeriodId: '2025-2026-2', gpa: 2.85, earnedCredits: 84, financialHold: false },
  { studentId: 'student-003', studentNumber: '23021001', studentName: 'Sinta Maharani', programStudyId: 'informatics-s1', unitId: 'faculty-engineering', cohortYear: 2023, enrollmentStatus: 'ACTIVE', currentPeriodId: '2025-2026-2', gpa: 3.78, earnedCredits: 112, financialHold: false },
]

const DEFAULT_POLICIES: PointPolicy[] = [
  {
    programStudyId: 'management-s1',
    version: 1,
    rules: [
      { id: 'activity-campus', label: 'Kegiatan tingkat kampus', portfolioKind: 'ACTIVITY', level: 'CAMPUS', points: 20 },
      { id: 'achievement-national', label: 'Prestasi tingkat nasional', portfolioKind: 'ACHIEVEMENT', level: 'NATIONAL', points: 50 },
      { id: 'achievement-international', label: 'Prestasi tingkat internasional', portfolioKind: 'ACHIEVEMENT', level: 'INTERNATIONAL', points: 80 },
    ],
    adjustmentLimit: 100,
    updatedAt: '2026-07-01T02:00:00.000Z',
    updatedBy: 'student-affairs-001',
  },
  {
    programStudyId: 'informatics-s1',
    version: 1,
    rules: [
      { id: 'activity-campus', label: 'Kegiatan tingkat kampus', portfolioKind: 'ACTIVITY', level: 'CAMPUS', points: 20 },
      { id: 'achievement-national', label: 'Prestasi tingkat nasional', portfolioKind: 'ACHIEVEMENT', level: 'NATIONAL', points: 50 },
    ],
    adjustmentLimit: 100,
    updatedAt: '2026-07-01T02:00:00.000Z',
    updatedBy: 'student-affairs-001',
  },
]

const SEEDED_PORTFOLIO: StudentPortfolioRecord[] = [
  {
    id: 'portfolio-activity-001', studentId: 'student-001', programStudyId: 'management-s1', kind: 'ACTIVITY', title: 'Panitia Pekan Orientasi Kampus', category: 'ORGANIZATION', level: 'CAMPUS', roleOrRank: 'Koordinator divisi acara', organization: 'BEM Universitas', occurredAt: '2026-06-15T02:00:00.000Z', description: 'Koordinasi kegiatan pengenalan kampus.', evidence: [{ fileId: 'file-evidence-activity-001', fileName: 'surat-tugas.pdf', mimeType: 'application/pdf', sizeBytes: 182_400, checksumSha256: 'a'.repeat(64) }], status: 'VERIFIED', reviewNote: 'Surat tugas terverifikasi.', awardedRuleId: 'activity-campus', awardedPoints: 20, version: 2, createdAt: '2026-06-16T02:00:00.000Z', createdBy: 'student-001', updatedAt: '2026-06-18T02:00:00.000Z', updatedBy: 'student-affairs-001',
  },
  {
    id: 'portfolio-achievement-001', studentId: 'student-001', programStudyId: 'management-s1', kind: 'ACHIEVEMENT', title: 'Finalis Kompetisi Business Plan Nasional', category: 'COMPETITION', level: 'NATIONAL', roleOrRank: 'Finalis', organization: 'Forum Bisnis Mahasiswa', occurredAt: '2026-07-10T02:00:00.000Z', evidence: [{ fileId: 'file-evidence-achievement-001', fileName: 'sertifikat-finalis.pdf', mimeType: 'application/pdf', sizeBytes: 225_100, checksumSha256: 'b'.repeat(64) }], status: 'SUBMITTED', awardedPoints: 0, version: 1, createdAt: '2026-07-11T03:00:00.000Z', createdBy: 'student-001', updatedAt: '2026-07-11T03:00:00.000Z', updatedBy: 'student-001',
  },
  {
    id: 'portfolio-achievement-003', studentId: 'student-003', programStudyId: 'informatics-s1', kind: 'ACHIEVEMENT', title: 'Juara Kompetisi Keamanan Siber', category: 'COMPETITION', level: 'NATIONAL', roleOrRank: 'Juara II', organization: 'Asosiasi Informatika', occurredAt: '2026-06-05T02:00:00.000Z', evidence: [{ fileId: 'file-evidence-achievement-003', fileName: 'sertifikat.pdf', mimeType: 'application/pdf', sizeBytes: 210_000, checksumSha256: 'c'.repeat(64) }], status: 'VERIFIED', awardedRuleId: 'achievement-national', awardedPoints: 50, version: 2, createdAt: '2026-06-06T03:00:00.000Z', createdBy: 'student-003', updatedAt: '2026-06-08T03:00:00.000Z', updatedBy: 'student-affairs-002',
  },
]

const SEEDED_LEDGER: PointLedgerEntry[] = [
  { id: 'ledger-portfolio-activity-001', studentId: 'student-001', programStudyId: 'management-s1', sourceType: 'PORTFOLIO', sourceId: 'portfolio-activity-001', points: 20, reason: 'Kegiatan tingkat kampus terverifikasi.', createdAt: '2026-06-18T02:00:00.000Z', createdBy: 'student-affairs-001', immutable: true },
  { id: 'ledger-portfolio-achievement-003', studentId: 'student-003', programStudyId: 'informatics-s1', sourceType: 'PORTFOLIO', sourceId: 'portfolio-achievement-003', points: 50, reason: 'Prestasi tingkat nasional terverifikasi.', createdAt: '2026-06-08T03:00:00.000Z', createdBy: 'student-affairs-002', immutable: true },
]

const SEEDED_CASES: StudentViolationCase[] = [
  {
    id: 'case-2026-001', studentId: 'student-001', programStudyId: 'management-s1', title: 'Pelanggaran tata tertib kegiatan', allegation: 'Keterlambatan pengembalian inventaris kegiatan selama tiga hari.', severity: 'MODERATE', status: 'NOTIFIED', occurredAt: '2026-07-10T03:00:00.000Z', reportedAt: '2026-07-11T03:00:00.000Z', responseDueAt: '2026-07-25T16:59:59.000Z', evidence: [{ fileId: 'file-case-001', fileName: 'berita-acara.pdf', mimeType: 'application/pdf', sizeBytes: 145_000, checksumSha256: 'd'.repeat(64) }], staffNotes: [{ id: 'note-case-001', body: 'Koordinasikan klarifikasi dengan pembina organisasi sebelum sidang.', createdAt: '2026-07-12T03:00:00.000Z', createdBy: 'student-affairs-001' }], version: 2, createdAt: '2026-07-11T03:00:00.000Z', createdBy: 'student-affairs-001', updatedAt: '2026-07-12T03:00:00.000Z', updatedBy: 'student-affairs-001',
  },
  {
    id: 'case-2026-002', studentId: 'student-002', programStudyId: 'management-s1', title: 'Peringatan administrasi kegiatan', allegation: 'Laporan kegiatan disampaikan melewati tenggat.', severity: 'MINOR', status: 'RESOLVED', occurredAt: '2026-05-10T03:00:00.000Z', reportedAt: '2026-05-12T03:00:00.000Z', responseDueAt: '2026-05-20T16:59:59.000Z', evidence: [], staffNotes: [], resolution: { outcome: 'WRITTEN_WARNING', summary: 'Mahasiswa menerima peringatan tertulis dan melengkapi laporan.', pointAdjustment: -5, resolvedAt: '2026-05-24T03:00:00.000Z', resolvedBy: 'student-affairs-001' }, version: 4, createdAt: '2026-05-12T03:00:00.000Z', createdBy: 'student-affairs-001', updatedAt: '2026-05-24T03:00:00.000Z', updatedBy: 'student-affairs-001',
  },
]

const SEEDED_PROGRAMS: ScholarshipProgram[] = [
  {
    id: 'scholarship-merit-2026', name: 'Beasiswa Prestasi Akademik 2026', description: 'Dukungan biaya studi bagi mahasiswa aktif dengan capaian akademik dan rekam kemahasiswaan baik.', periodId: '2025-2026-2', programStudyIds: ['management-s1', 'informatics-s1'], status: 'OPEN', applicationOpensAt: '2026-07-01T00:00:00.000Z', applicationClosesAt: '2026-08-31T16:59:59.000Z', minGpa: 3.25, minCredits: 60, quota: 25, awardedCount: 0, checklist: [
      { id: 'active', label: 'Berstatus mahasiswa aktif', kind: 'ACTIVE_STATUS' },
      { id: 'gpa', label: 'IPK memenuhi batas minimum', kind: 'MIN_GPA' },
      { id: 'credits', label: 'SKS lulus memenuhi batas minimum', kind: 'MIN_CREDITS' },
      { id: 'transcript', label: 'Transkrip sementara terverifikasi', kind: 'VERIFIED_DOCUMENT', documentType: 'TRANSCRIPT' },
      { id: 'case', label: 'Tidak memiliki kasus berat terbuka', kind: 'NO_OPEN_MAJOR_CASE' },
    ], version: 1, createdAt: '2026-06-15T02:00:00.000Z', createdBy: 'admin-001', updatedAt: '2026-06-20T02:00:00.000Z', updatedBy: 'student-affairs-001',
  },
]

const SEEDED_DOCUMENTS: StudentRequirementDocument[] = [
  { id: 'document-student-001-transcript', studentId: 'student-001', programStudyId: 'management-s1', documentType: 'TRANSCRIPT', label: 'Transkrip sementara', file: { fileId: 'file-transcript-student-001', fileName: 'transkrip-sementara.pdf', mimeType: 'application/pdf', sizeBytes: 310_000, checksumSha256: 'e'.repeat(64) }, status: 'VERIFIED', version: 2, createdAt: '2026-06-01T02:00:00.000Z', createdBy: 'student-001', updatedAt: '2026-06-03T02:00:00.000Z', updatedBy: 'student-affairs-001' },
  { id: 'document-student-002-transcript', studentId: 'student-002', programStudyId: 'management-s1', documentType: 'TRANSCRIPT', label: 'Transkrip sementara', file: { fileId: 'file-transcript-student-002', fileName: 'transkrip.pdf', mimeType: 'application/pdf', sizeBytes: 290_000, checksumSha256: 'f'.repeat(64) }, status: 'PENDING', version: 1, createdAt: '2026-07-10T02:00:00.000Z', createdBy: 'student-002', updatedAt: '2026-07-10T02:00:00.000Z', updatedBy: 'student-002' },
]

function initialState(): StudentAffairsMockState {
  return {
    profiles: new Map(SEEDED_PROFILES.map((item) => [item.studentId, clone(item)])),
    portfolio: new Map(SEEDED_PORTFOLIO.map((item) => [item.id, clone(item)])),
    pointPolicies: new Map(DEFAULT_POLICIES.map((item) => [item.programStudyId, clone(item)])),
    pointLedger: new Map(SEEDED_LEDGER.map((item) => [item.id, clone(item)])),
    cases: new Map(SEEDED_CASES.map((item) => [item.id, clone(item)])),
    scholarshipPrograms: new Map(SEEDED_PROGRAMS.map((item) => [item.id, clone(item)])),
    scholarshipApplications: new Map(),
    documents: new Map(SEEDED_DOCUMENTS.map((item) => [item.id, clone(item)])),
    letterRequests: new Map(),
    letterIssuances: new Map(),
    letterCounters: new Map(),
    idempotency: new Map(),
  }
}

let state = initialState()

function rejectUnknown(body: Record<string, unknown>, allowed: readonly string[]): void {
  const unknown = Object.keys(body).filter((key) => !allowed.includes(key))
  if (unknown.length) invalidInput(`Field tidak didukung: ${unknown.join(', ')}.`)
}

function safeId(value: unknown, label: string): string {
  return requireString(value, label, { max: 128, pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]*$/ })
}

function parseEvidence(value: unknown, label = 'evidence', maxItems = 10, minItems = 0): EvidenceFileReference[] {
  if (!Array.isArray(value) || value.length < minItems || value.length > maxItems) invalidInput(`${label} harus berupa array dengan ${minItems}-${maxItems} referensi file.`)
  return value.map((item, index) => {
    const file = requireRecord(item, `${label}[${index}]`)
    rejectUnknown(file, ['fileId', 'fileName', 'mimeType', 'sizeBytes', 'checksumSha256'])
    const sizeBytes = requireInteger(file.sizeBytes, `${label}[${index}].sizeBytes`, 1, 50 * 1024 * 1024)
    const checksumSha256 = optionalString(file.checksumSha256, `${label}[${index}].checksumSha256`, 64)
    if (checksumSha256 && !/^[a-f0-9]{64}$/i.test(checksumSha256)) invalidInput(`${label}[${index}].checksumSha256 tidak valid.`)
    return {
      fileId: safeId(file.fileId, `${label}[${index}].fileId`),
      fileName: requireString(file.fileName, `${label}[${index}].fileName`, { max: 180 }),
      mimeType: requireString(file.mimeType, `${label}[${index}].mimeType`, { max: 100, pattern: /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i }),
      sizeBytes,
      ...(checksumSha256 ? { checksumSha256: checksumSha256.toLowerCase() } : {}),
    }
  })
}

function studentCandidates(context: AuthContext): string[] {
  return [...new Set([context.uid, ...context.scope.studentIds])]
}

async function loadProfile(studentId: string): Promise<StudentAffairsProfile> {
  if (dataMode() === 'mock') {
    const profile = state.profiles.get(studentId)
    if (!profile) notFound('Profil mahasiswa')
    return clone(profile)
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan kemahasiswaan tidak tersedia.')
  const snapshot = await db.collection('studentAffairsProfiles').doc(studentId).get()
  if (!snapshot.exists) notFound('Profil mahasiswa')
  return { studentId: snapshot.id, ...snapshot.data() } as StudentAffairsProfile
}

async function ownProfile(context: AuthContext): Promise<StudentAffairsProfile> {
  if (!hasRole(context, 'student')) forbidden('Tindakan ini hanya tersedia untuk mahasiswa.')
  const profiles: StudentAffairsProfile[] = []
  for (const candidate of studentCandidates(context)) {
    try {
      profiles.push(await loadProfile(candidate))
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'NOT_FOUND')) throw error
    }
  }
  const unique = [...new Map(profiles.map((item) => [item.studentId, item])).values()]
  if (unique.length !== 1) forbidden('Identitas mahasiswa tidak dapat ditentukan secara unik.')
  return unique[0]!
}

function isScopedStaff(context: AuthContext, programStudyId: string): boolean {
  return hasRole(context, 'student_affairs_staff') && context.scope.programStudyIds.includes(programStudyId)
}

function canReadProfile(context: AuthContext, profile: StudentAffairsProfile): boolean {
  return hasRole(context, 'administrator', 'leader') || isScopedStaff(context, profile.programStudyId) || (hasRole(context, 'student') && studentCandidates(context).includes(profile.studentId))
}

function requireProfileRead(context: AuthContext, profile: StudentAffairsProfile): void {
  if (!canReadProfile(context, profile)) forbidden('Data mahasiswa berada di luar lingkup akses Anda.')
}

function requireStaffManage(context: AuthContext, programStudyId: string): void {
  if (!hasRole(context, 'administrator') && !isScopedStaff(context, programStudyId)) forbidden('Anda tidak berwenang mengelola data kemahasiswaan ini.')
}

function canReadStaffOnly(context: AuthContext, programStudyId: string): boolean {
  return hasRole(context, 'administrator', 'leader') || isScopedStaff(context, programStudyId)
}

async function loadCollection<T>(collection: string): Promise<T[]> {
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan kemahasiswaan tidak tersedia.')
  const snapshot = await db.collection(collection).limit(COLLECTION_LIMIT).get()
  return snapshot.docs.map((document) => ({ id: document.id, ...document.data() }) as T)
}

function mockReplay<T>(namespace: string, hash: string): StudentAffairsWriteResult<T> | undefined {
  const previous = state.idempotency.get(namespace)
  if (!previous) return undefined
  if (previous.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk payload berbeda.')
  return { ...(clone(previous.response) as StudentAffairsWriteResult<T>), replayed: true, auditId: undefined }
}

function saveMockReplay<T>(namespace: string, hash: string, response: StudentAffairsWriteResult<T>, now: string): void {
  state.idempotency.set(namespace, { requestHash: hash, response: clone(response), createdAt: now })
}

async function firebaseReplay<T>(namespace: string, hash: string): Promise<StudentAffairsWriteResult<T> | undefined> {
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan kemahasiswaan tidak tersedia.')
  const snapshot = await db.collection('idempotencyKeys').doc(opaqueId('idem', namespace)).get()
  if (!snapshot.exists) return undefined
  const data = snapshot.data() as IdempotencyRecord<T>
  if (data.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk payload berbeda.')
  return { ...data.response, replayed: true, auditId: undefined }
}

function idemDocument<T>(hash: string, response: StudentAffairsWriteResult<T>, now: string): Record<string, unknown> {
  return { requestHash: hash, response, createdAt: now, expiresAt: new Date(Date.parse(now) + IDEMPOTENCY_TTL_MS).toISOString() }
}

function paginate<T>(items: T[], query: StudentAffairsListQuery): PaginatedResult<T> {
  const total = items.length
  const totalPages = Math.max(1, Math.ceil(total / query.pageSize))
  const start = (query.page - 1) * query.pageSize
  return { items: items.slice(start, start + query.pageSize).map(clone), page: query.page, pageSize: query.pageSize, total, totalPages }
}

function matchesSearch(record: unknown, search?: string): boolean {
  if (!search) return true
  const needle = search.toLocaleLowerCase('id-ID')
  return Object.values(record as Record<string, unknown>).some((value) => typeof value === 'string' && value.toLocaleLowerCase('id-ID').includes(needle))
}

async function authorizeListQuery(context: AuthContext, query: StudentAffairsListQuery): Promise<void> {
  if (query.studentId) requireProfileRead(context, await loadProfile(query.studentId))
  if (query.programStudyId && !hasRole(context, 'administrator', 'leader') && !isScopedStaff(context, query.programStudyId)) {
    if (!hasRole(context, 'student')) forbidden('Program studi berada di luar lingkup akses Anda.')
    const profile = await ownProfile(context)
    if (profile.programStudyId !== query.programStudyId) forbidden('Program studi berada di luar lingkup akses Anda.')
  }
}

export function parseStudentAffairsListQuery(value: Record<string, unknown>): StudentAffairsListQuery {
  const scalar = (item: unknown, label: string): string | undefined => {
    if (item === undefined || item === '') return undefined
    if (Array.isArray(item)) invalidInput(`${label} hanya boleh memiliki satu nilai.`)
    return String(item)
  }
  const page = requireInteger(Number(scalar(value.page, 'page') ?? 1), 'page', 1, 100_000)
  const pageSize = requireInteger(Number(scalar(value.pageSize, 'pageSize') ?? 20), 'pageSize', 1, 100)
  const status = scalar(value.status, 'status')
  const studentId = scalar(value.studentId, 'studentId')
  const programStudyId = scalar(value.programStudyId, 'programStudyId')
  const search = scalar(value.search, 'search')
  return {
    page,
    pageSize,
    ...(status ? { status: requireString(status, 'status', { max: 40 }) } : {}),
    ...(studentId ? { studentId: safeId(studentId, 'studentId') } : {}),
    ...(programStudyId ? { programStudyId: safeId(programStudyId, 'programStudyId') } : {}),
    ...(search ? { search: requireString(search, 'search', { max: 100 }) } : {}),
  }
}

function filterOwned<T extends { studentId: string; programStudyId: string }>(context: AuthContext, rows: T[], query: StudentAffairsListQuery): T[] {
  return rows.filter((row) => {
    const profile = state.profiles.get(row.studentId)
    const readable = hasRole(context, 'administrator', 'leader')
      || isScopedStaff(context, row.programStudyId)
      || (hasRole(context, 'student') && studentCandidates(context).includes(row.studentId))
    return readable
      && (!query.studentId || row.studentId === query.studentId)
      && (!query.programStudyId || row.programStudyId === query.programStudyId)
      && (!query.status || ('status' in row && String((row as T & { status?: string }).status) === query.status))
      && matchesSearch({ ...row, studentName: profile?.studentName, studentNumber: profile?.studentNumber }, query.search)
  })
}

export async function listPortfolio(context: AuthContext, query: StudentAffairsListQuery): Promise<PaginatedResult<StudentPortfolioRecord>> {
  await authorizeListQuery(context, query)
  const rows = dataMode() === 'mock' ? [...state.portfolio.values()].map(clone) : await loadCollection<StudentPortfolioRecord>('studentPortfolio')
  return paginate(filterOwned(context, rows, query).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), query)
}

function parsePortfolio(value: unknown, now: Date): Omit<StudentPortfolioRecord, 'id' | 'studentId' | 'programStudyId' | 'status' | 'awardedPoints' | 'version' | 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'> {
  const body = requireRecord(value)
  rejectUnknown(body, ['kind', 'title', 'category', 'level', 'roleOrRank', 'organization', 'occurredAt', 'description', 'evidence'])
  const kind = requireString(body.kind, 'kind', { max: 20 }) as PortfolioKind
  const level = requireString(body.level, 'level', { max: 20 }) as StudentPortfolioRecord['level']
  if (!PORTFOLIO_KINDS.includes(kind)) invalidInput('kind portofolio tidak valid.')
  if (!PORTFOLIO_LEVELS.includes(level)) invalidInput('level portofolio tidak valid.')
  return {
    kind,
    title: requireString(body.title, 'title', { min: 3, max: 180 }),
    category: requireString(body.category, 'category', { max: 60, pattern: /^[A-Z][A-Z0-9_-]*$/ }),
    level,
    roleOrRank: requireString(body.roleOrRank, 'roleOrRank', { min: 2, max: 120 }),
    organization: requireString(body.organization, 'organization', { min: 2, max: 160 }),
    occurredAt: normalizeIsoInstant(body.occurredAt, 'occurredAt', { now: now.getTime(), maxFutureMs: 0 }),
    description: optionalString(body.description, 'description', 1_000),
    evidence: parseEvidence(body.evidence, 'evidence', 10, 1),
  }
}

export async function createPortfolioRecord(context: AuthContext, value: unknown, idempotencyKey: string, event?: H3Event, clock = new Date()): Promise<StudentAffairsWriteResult<StudentPortfolioRecord>> {
  const profile = await ownProfile(context)
  const input = parsePortfolio(value, clock)
  const hash = requestHash({ studentId: profile.studentId, ...input })
  const namespace = `student-affairs:portfolio:create:${context.uid}:${idempotencyKey}`
  const now = clock.toISOString()
  const id = opaqueId('portfolio', `${profile.studentId}:${idempotencyKey}`)
  const record: StudentPortfolioRecord = { id, studentId: profile.studentId, programStudyId: profile.programStudyId, ...input, status: 'SUBMITTED', awardedPoints: 0, version: 1, createdAt: now, createdBy: context.uid, updatedAt: now, updatedBy: context.uid }
  let result: StudentAffairsWriteResult<StudentPortfolioRecord>
  if (dataMode() === 'mock') {
    const replay = mockReplay<StudentPortfolioRecord>(namespace, hash)
    if (replay) return replay
    state.portfolio.set(id, clone(record))
    result = { value: record, replayed: false }
    saveMockReplay(namespace, hash, result, now)
  } else {
    const replay = await firebaseReplay<StudentPortfolioRecord>(namespace, hash)
    if (replay) return replay
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan portofolio tidak tersedia.')
    const ref = db.collection('studentPortfolio').doc(id)
    const idemRef = db.collection('idempotencyKeys').doc(opaqueId('idem', namespace))
    result = await db.runTransaction(async (transaction) => {
      const previous = await transaction.get(idemRef)
      if (previous.exists) {
        const data = previous.data() as IdempotencyRecord<StudentPortfolioRecord>
        if (data.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk payload berbeda.')
        return { ...data.response, replayed: true, auditId: undefined }
      }
      const response: StudentAffairsWriteResult<StudentPortfolioRecord> = { value: record, replayed: false }
      transaction.create(ref, record)
      transaction.create(idemRef, idemDocument(hash, response, now))
      return response
    })
    if (result.replayed) return result
  }
  const audit = await appendAudit({ actor: context, action: 'STUDENT_PORTFOLIO_SUBMITTED', resourceType: 'student_portfolio', resourceId: id, after: { kind: record.kind, level: record.level, evidenceFileIds: record.evidence.map((item) => item.fileId), version: record.version }, event })
  result.auditId = audit.id
  return result
}

function parsePortfolioReview(value: unknown): { decision: 'VERIFY' | 'REJECT'; ruleId?: string; reviewNote: string; expectedVersion: number } {
  const body = requireRecord(value)
  rejectUnknown(body, ['decision', 'ruleId', 'reviewNote', 'expectedVersion'])
  const decision = requireString(body.decision, 'decision', { max: 10 })
  if (decision !== 'VERIFY' && decision !== 'REJECT') invalidInput('decision harus VERIFY atau REJECT.')
  const ruleId = optionalString(body.ruleId, 'ruleId', 80)
  if (decision === 'VERIFY' && !ruleId) invalidInput('ruleId wajib untuk verifikasi portofolio.')
  return { decision, ruleId, reviewNote: requireString(body.reviewNote, 'reviewNote', { min: 5, max: 500 }), expectedVersion: requireInteger(body.expectedVersion, 'expectedVersion', 1) }
}

export async function reviewPortfolioRecord(context: AuthContext, portfolioId: string, value: unknown, idempotencyKey: string, event?: H3Event, clock = new Date()): Promise<StudentAffairsWriteResult<StudentPortfolioRecord>> {
  const id = safeId(portfolioId, 'portfolioId')
  const input = parsePortfolioReview(value)
  const hash = requestHash({ id, ...input })
  const namespace = `student-affairs:portfolio:review:${context.uid}:${idempotencyKey}`
  const now = clock.toISOString()
  let before: StudentPortfolioRecord | undefined
  let ledgerEntry: PointLedgerEntry | undefined
  let result: StudentAffairsWriteResult<StudentPortfolioRecord>
  if (dataMode() === 'mock') {
    const replay = mockReplay<StudentPortfolioRecord>(namespace, hash)
    if (replay) return replay
    const stored = state.portfolio.get(id)
    if (!stored) notFound('Portofolio')
    before = clone(stored)
    requireStaffManage(context, before.programStudyId)
    if (before.status !== 'SUBMITTED') conflict('PORTFOLIO_NOT_REVIEWABLE', 'Portofolio tidak berada pada status SUBMITTED.')
    if (before.version !== input.expectedVersion) conflict('VERSION_CONFLICT', 'Portofolio telah berubah.', { currentVersion: before.version })
    let points = 0
    if (input.decision === 'VERIFY') {
      const policy = state.pointPolicies.get(before.programStudyId)
      if (!policy) notFound('Kebijakan poin')
      const portfolioKind = before.kind
      const portfolioLevel = before.level
      const rule = policy.rules.find((item) => item.id === input.ruleId && item.portfolioKind === portfolioKind && item.level === portfolioLevel)
      if (!rule) invalidInput('Aturan poin tidak sesuai jenis atau tingkat portofolio.')
      points = rule.points
      ledgerEntry = { id: `ledger-${id}`, studentId: before.studentId, programStudyId: before.programStudyId, sourceType: 'PORTFOLIO', sourceId: id, points, reason: `${rule.label} terverifikasi.`, createdAt: now, createdBy: context.uid, immutable: true }
      if (state.pointLedger.has(ledgerEntry.id)) conflict('LEDGER_SOURCE_ALREADY_POSTED', 'Poin sumber ini telah dibukukan.')
      state.pointLedger.set(ledgerEntry.id, clone(ledgerEntry))
    }
    const after: StudentPortfolioRecord = { ...before, status: input.decision === 'VERIFY' ? 'VERIFIED' : 'REJECTED', reviewNote: input.reviewNote, ...(input.ruleId ? { awardedRuleId: input.ruleId } : {}), awardedPoints: points, version: before.version + 1, updatedAt: now, updatedBy: context.uid }
    state.portfolio.set(id, clone(after))
    result = { value: after, replayed: false }
    saveMockReplay(namespace, hash, result, now)
  } else {
    const replay = await firebaseReplay<StudentPortfolioRecord>(namespace, hash)
    if (replay) return replay
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan portofolio tidak tersedia.')
    const ref = db.collection('studentPortfolio').doc(id)
    const idemRef = db.collection('idempotencyKeys').doc(opaqueId('idem', namespace))
    result = await db.runTransaction(async (transaction) => {
      const [previous, snapshot] = await Promise.all([transaction.get(idemRef), transaction.get(ref)])
      if (previous.exists) {
        const data = previous.data() as IdempotencyRecord<StudentPortfolioRecord>
        if (data.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk payload berbeda.')
        return { ...data.response, replayed: true, auditId: undefined }
      }
      if (!snapshot.exists) notFound('Portofolio')
      before = { id: snapshot.id, ...snapshot.data() } as StudentPortfolioRecord
      requireStaffManage(context, before.programStudyId)
      if (before.status !== 'SUBMITTED') conflict('PORTFOLIO_NOT_REVIEWABLE', 'Portofolio tidak berada pada status SUBMITTED.')
      if (before.version !== input.expectedVersion) conflict('VERSION_CONFLICT', 'Portofolio telah berubah.', { currentVersion: before.version })
      let points = 0
      if (input.decision === 'VERIFY') {
        const policyRef = db.collection('studentPointPolicies').doc(before.programStudyId)
        const policySnapshot = await transaction.get(policyRef)
        if (!policySnapshot.exists) notFound('Kebijakan poin')
        const policy = policySnapshot.data() as PointPolicy
        const portfolioKind = before.kind
        const portfolioLevel = before.level
        const rule = policy.rules.find((item) => item.id === input.ruleId && item.portfolioKind === portfolioKind && item.level === portfolioLevel)
        if (!rule) invalidInput('Aturan poin tidak sesuai jenis atau tingkat portofolio.')
        points = rule.points
        ledgerEntry = { id: `ledger-${id}`, studentId: before.studentId, programStudyId: before.programStudyId, sourceType: 'PORTFOLIO', sourceId: id, points, reason: `${rule.label} terverifikasi.`, createdAt: now, createdBy: context.uid, immutable: true }
        const ledgerRef = db.collection('studentPointLedger').doc(ledgerEntry.id)
        const ledgerSnapshot = await transaction.get(ledgerRef)
        if (ledgerSnapshot.exists) conflict('LEDGER_SOURCE_ALREADY_POSTED', 'Poin sumber ini telah dibukukan.')
        transaction.create(ledgerRef, ledgerEntry)
      }
      const after: StudentPortfolioRecord = { ...before, status: input.decision === 'VERIFY' ? 'VERIFIED' : 'REJECTED', reviewNote: input.reviewNote, ...(input.ruleId ? { awardedRuleId: input.ruleId } : {}), awardedPoints: points, version: before.version + 1, updatedAt: now, updatedBy: context.uid }
      const response: StudentAffairsWriteResult<StudentPortfolioRecord> = { value: after, replayed: false }
      transaction.update(ref, after)
      transaction.create(idemRef, idemDocument(hash, response, now))
      return response
    })
    if (result.replayed) return result
  }
  if (!before) serviceUnavailable('State portofolio tidak tersedia.')
  const audit = await appendAudit({ actor: context, action: input.decision === 'VERIFY' ? 'STUDENT_PORTFOLIO_VERIFIED' : 'STUDENT_PORTFOLIO_REJECTED', resourceType: 'student_portfolio', resourceId: id, before: { status: before.status, version: before.version }, after: { status: result.value.status, points: result.value.awardedPoints, version: result.value.version, ledgerEntryId: ledgerEntry?.id }, event })
  result.auditId = audit.id
  return result
}

export async function getPointLedger(context: AuthContext, studentId: string): Promise<PointLedgerView> {
  const profile = await loadProfile(safeId(studentId, 'studentId'))
  requireProfileRead(context, profile)
  const entries = dataMode() === 'mock'
    ? [...state.pointLedger.values()].filter((item) => item.studentId === profile.studentId).map(clone)
    : (await loadCollection<PointLedgerEntry>('studentPointLedger')).filter((item) => item.studentId === profile.studentId)
  entries.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  return { studentId: profile.studentId, totalPoints: entries.reduce((sum, item) => sum + item.points, 0), entries }
}

function parsePointPolicy(value: unknown): { expectedVersion: number; adjustmentLimit: number; rules: PointRule[] } {
  const body = requireRecord(value)
  rejectUnknown(body, ['expectedVersion', 'adjustmentLimit', 'rules'])
  if (!Array.isArray(body.rules) || body.rules.length < 1 || body.rules.length > 50) invalidInput('rules harus berisi 1-50 aturan poin.')
  const rules = body.rules.map((item, index) => {
    const rule = requireRecord(item, `rules[${index}]`)
    rejectUnknown(rule, ['id', 'label', 'portfolioKind', 'level', 'points'])
    const portfolioKind = requireString(rule.portfolioKind, `rules[${index}].portfolioKind`, { max: 20 }) as PortfolioKind
    const level = requireString(rule.level, `rules[${index}].level`, { max: 20 }) as StudentPortfolioRecord['level']
    if (!PORTFOLIO_KINDS.includes(portfolioKind) || !PORTFOLIO_LEVELS.includes(level)) invalidInput(`rules[${index}] tidak valid.`)
    return { id: safeId(rule.id, `rules[${index}].id`), label: requireString(rule.label, `rules[${index}].label`, { min: 3, max: 120 }), portfolioKind, level, points: requireInteger(rule.points, `rules[${index}].points`, 1, 1_000) }
  })
  if (new Set(rules.map((item) => item.id)).size !== rules.length) invalidInput('ID aturan poin harus unik.')
  return { expectedVersion: requireInteger(body.expectedVersion, 'expectedVersion', 0), adjustmentLimit: requireInteger(body.adjustmentLimit, 'adjustmentLimit', 1, 1_000), rules }
}

export async function configurePointPolicy(context: AuthContext, programStudyId: string, value: unknown, idempotencyKey: string, event?: H3Event, clock = new Date()): Promise<StudentAffairsWriteResult<PointPolicy>> {
  const programId = safeId(programStudyId, 'programStudyId')
  requireStaffManage(context, programId)
  const input = parsePointPolicy(value)
  const hash = requestHash({ programId, ...input })
  const namespace = `student-affairs:point-policy:${context.uid}:${idempotencyKey}`
  const now = clock.toISOString()
  let before: PointPolicy | undefined
  let result: StudentAffairsWriteResult<PointPolicy>
  if (dataMode() === 'mock') {
    const replay = mockReplay<PointPolicy>(namespace, hash)
    if (replay) return replay
    before = state.pointPolicies.get(programId)
    const version = before?.version ?? 0
    if (version !== input.expectedVersion) conflict('VERSION_CONFLICT', 'Kebijakan poin telah berubah.', { currentVersion: version })
    const policy: PointPolicy = { programStudyId: programId, version: version + 1, rules: clone(input.rules), adjustmentLimit: input.adjustmentLimit, updatedAt: now, updatedBy: context.uid }
    state.pointPolicies.set(programId, clone(policy))
    result = { value: policy, replayed: false }
    saveMockReplay(namespace, hash, result, now)
  } else {
    const replay = await firebaseReplay<PointPolicy>(namespace, hash)
    if (replay) return replay
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan poin tidak tersedia.')
    const ref = db.collection('studentPointPolicies').doc(programId)
    const idemRef = db.collection('idempotencyKeys').doc(opaqueId('idem', namespace))
    result = await db.runTransaction(async (transaction) => {
      const [previous, snapshot] = await Promise.all([transaction.get(idemRef), transaction.get(ref)])
      if (previous.exists) {
        const data = previous.data() as IdempotencyRecord<PointPolicy>
        if (data.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk payload berbeda.')
        return { ...data.response, replayed: true, auditId: undefined }
      }
      before = snapshot.exists ? snapshot.data() as PointPolicy : undefined
      const version = before?.version ?? 0
      if (version !== input.expectedVersion) conflict('VERSION_CONFLICT', 'Kebijakan poin telah berubah.', { currentVersion: version })
      const policy: PointPolicy = { programStudyId: programId, version: version + 1, rules: clone(input.rules), adjustmentLimit: input.adjustmentLimit, updatedAt: now, updatedBy: context.uid }
      const response: StudentAffairsWriteResult<PointPolicy> = { value: policy, replayed: false }
      transaction.set(ref, policy)
      transaction.create(idemRef, idemDocument(hash, response, now))
      return response
    })
    if (result.replayed) return result
  }
  const audit = await appendAudit({ actor: context, action: 'STUDENT_POINT_POLICY_CONFIGURED', resourceType: 'student_point_policy', resourceId: programId, before: before ? { version: before.version, ruleCount: before.rules.length } : { version: 0 }, after: { version: result.value.version, ruleCount: result.value.rules.length, adjustmentLimit: result.value.adjustmentLimit }, event })
  result.auditId = audit.id
  return result
}

function parsePointAdjustment(value: unknown): { studentId: string; points: number; reason: string; expectedPolicyVersion: number } {
  const body = requireRecord(value)
  rejectUnknown(body, ['studentId', 'points', 'reason', 'expectedPolicyVersion'])
  const points = requireInteger(body.points, 'points', -1_000, 1_000)
  if (points === 0) invalidInput('points tidak boleh nol.')
  return { studentId: safeId(body.studentId, 'studentId'), points, reason: requireString(body.reason, 'reason', { min: 10, max: 500 }), expectedPolicyVersion: requireInteger(body.expectedPolicyVersion, 'expectedPolicyVersion', 1) }
}

export async function appendPointAdjustment(context: AuthContext, value: unknown, idempotencyKey: string, event?: H3Event, clock = new Date()): Promise<StudentAffairsWriteResult<PointLedgerEntry>> {
  const input = parsePointAdjustment(value)
  const profile = await loadProfile(input.studentId)
  requireStaffManage(context, profile.programStudyId)
  const hash = requestHash(input)
  const namespace = `student-affairs:point-adjustment:${context.uid}:${idempotencyKey}`
  const now = clock.toISOString()
  const id = opaqueId('ledger', `${context.uid}:${idempotencyKey}`)
  const entry: PointLedgerEntry = { id, studentId: profile.studentId, programStudyId: profile.programStudyId, sourceType: 'ADJUSTMENT', sourceId: id, points: input.points, reason: input.reason, createdAt: now, createdBy: context.uid, immutable: true }
  let result: StudentAffairsWriteResult<PointLedgerEntry>
  if (dataMode() === 'mock') {
    const replay = mockReplay<PointLedgerEntry>(namespace, hash)
    if (replay) return replay
    const policy = state.pointPolicies.get(profile.programStudyId)
    if (!policy) notFound('Kebijakan poin')
    if (policy.version !== input.expectedPolicyVersion) conflict('VERSION_CONFLICT', 'Kebijakan poin telah berubah.', { currentVersion: policy.version })
    if (Math.abs(input.points) > policy.adjustmentLimit) invalidInput('Penyesuaian melampaui batas kebijakan poin.')
    state.pointLedger.set(id, clone(entry))
    result = { value: entry, replayed: false }
    saveMockReplay(namespace, hash, result, now)
  } else {
    const replay = await firebaseReplay<PointLedgerEntry>(namespace, hash)
    if (replay) return replay
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan poin tidak tersedia.')
    const policyRef = db.collection('studentPointPolicies').doc(profile.programStudyId)
    const ledgerRef = db.collection('studentPointLedger').doc(id)
    const idemRef = db.collection('idempotencyKeys').doc(opaqueId('idem', namespace))
    result = await db.runTransaction(async (transaction) => {
      const [previous, policySnapshot] = await Promise.all([transaction.get(idemRef), transaction.get(policyRef)])
      if (previous.exists) {
        const data = previous.data() as IdempotencyRecord<PointLedgerEntry>
        if (data.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk payload berbeda.')
        return { ...data.response, replayed: true, auditId: undefined }
      }
      if (!policySnapshot.exists) notFound('Kebijakan poin')
      const policy = policySnapshot.data() as PointPolicy
      if (policy.version !== input.expectedPolicyVersion) conflict('VERSION_CONFLICT', 'Kebijakan poin telah berubah.', { currentVersion: policy.version })
      if (Math.abs(input.points) > policy.adjustmentLimit) invalidInput('Penyesuaian melampaui batas kebijakan poin.')
      const response: StudentAffairsWriteResult<PointLedgerEntry> = { value: entry, replayed: false }
      transaction.create(ledgerRef, entry)
      transaction.create(idemRef, idemDocument(hash, response, now))
      return response
    })
    if (result.replayed) return result
  }
  const audit = await appendAudit({ actor: context, action: 'STUDENT_POINT_ADJUSTED', resourceType: 'student_point_ledger', resourceId: id, after: { studentId: profile.studentId, points: entry.points, reason: entry.reason, immutable: true }, event })
  result.auditId = audit.id
  return result
}

function redactCaseFor(context: AuthContext, record: StudentViolationCase): StudentViolationCase | Omit<StudentViolationCase, 'staffNotes'> {
  const copy = clone(record)
  if (canReadStaffOnly(context, record.programStudyId)) return copy
  const { staffNotes: _staffNotes, ...redacted } = copy
  return redacted
}

export async function listViolationCases(context: AuthContext, query: StudentAffairsListQuery): Promise<PaginatedResult<StudentViolationCase | Omit<StudentViolationCase, 'staffNotes'>>> {
  await authorizeListQuery(context, query)
  const rows = dataMode() === 'mock' ? [...state.cases.values()].map(clone) : await loadCollection<StudentViolationCase>('studentCases')
  const filtered = filterOwned(context, rows, query).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((item) => redactCaseFor(context, item))
  return paginate(filtered, query)
}

export async function getViolationCase(context: AuthContext, caseId: string): Promise<StudentViolationCase | Omit<StudentViolationCase, 'staffNotes'>> {
  const id = safeId(caseId, 'caseId')
  let record: StudentViolationCase | undefined
  if (dataMode() === 'mock') record = state.cases.get(id)
  else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan kasus tidak tersedia.')
    const snapshot = await db.collection('studentCases').doc(id).get()
    if (snapshot.exists) record = { id: snapshot.id, ...snapshot.data() } as StudentViolationCase
  }
  if (!record) notFound('Kasus')
  requireProfileRead(context, await loadProfile(record.studentId))
  return redactCaseFor(context, record)
}

function parseCase(value: unknown, clock: Date): { studentId: string; title: string; allegation: string; severity: CaseSeverity; occurredAt: string; responseDueAt: string; evidence: EvidenceFileReference[] } {
  const body = requireRecord(value)
  rejectUnknown(body, ['studentId', 'title', 'allegation', 'severity', 'occurredAt', 'responseDueAt', 'evidence'])
  const severity = requireString(body.severity, 'severity', { max: 20 }) as CaseSeverity
  if (!CASE_SEVERITIES.includes(severity)) invalidInput('severity kasus tidak valid.')
  const occurredAt = normalizeIsoInstant(body.occurredAt, 'occurredAt', { now: clock.getTime(), maxFutureMs: 0 })
  const responseDueAt = normalizeIsoInstant(body.responseDueAt, 'responseDueAt', { now: clock.getTime(), maxFutureMs: 180 * 24 * 60 * 60 * 1_000 })
  if (Date.parse(responseDueAt) <= clock.getTime() + 24 * 60 * 60 * 1_000) invalidInput('responseDueAt harus memberi waktu tanggapan minimal 24 jam.')
  return {
    studentId: safeId(body.studentId, 'studentId'),
    title: requireString(body.title, 'title', { min: 5, max: 180 }),
    allegation: requireString(body.allegation, 'allegation', { min: 10, max: 2_000 }),
    severity,
    occurredAt,
    responseDueAt,
    evidence: parseEvidence(body.evidence),
  }
}

export async function createViolationCase(context: AuthContext, value: unknown, idempotencyKey: string, event?: H3Event, clock = new Date()): Promise<StudentAffairsWriteResult<StudentViolationCase>> {
  const input = parseCase(value, clock)
  const profile = await loadProfile(input.studentId)
  requireStaffManage(context, profile.programStudyId)
  const hash = requestHash(input)
  const namespace = `student-affairs:case:create:${context.uid}:${idempotencyKey}`
  const now = clock.toISOString()
  const id = opaqueId('case', `${context.uid}:${idempotencyKey}`)
  const record: StudentViolationCase = { id, studentId: profile.studentId, programStudyId: profile.programStudyId, title: input.title, allegation: input.allegation, severity: input.severity, status: 'REPORTED', occurredAt: input.occurredAt, reportedAt: now, responseDueAt: input.responseDueAt, evidence: clone(input.evidence), staffNotes: [], version: 1, createdAt: now, createdBy: context.uid, updatedAt: now, updatedBy: context.uid }
  let result: StudentAffairsWriteResult<StudentViolationCase>
  if (dataMode() === 'mock') {
    const replay = mockReplay<StudentViolationCase>(namespace, hash)
    if (replay) return replay
    state.cases.set(id, clone(record))
    result = { value: record, replayed: false }
    saveMockReplay(namespace, hash, result, now)
  } else {
    const replay = await firebaseReplay<StudentViolationCase>(namespace, hash)
    if (replay) return replay
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan kasus tidak tersedia.')
    const ref = db.collection('studentCases').doc(id)
    const idemRef = db.collection('idempotencyKeys').doc(opaqueId('idem', namespace))
    result = await db.runTransaction(async (transaction) => {
      const previous = await transaction.get(idemRef)
      if (previous.exists) {
        const data = previous.data() as IdempotencyRecord<StudentViolationCase>
        if (data.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk payload berbeda.')
        return { ...data.response, replayed: true, auditId: undefined }
      }
      const response: StudentAffairsWriteResult<StudentViolationCase> = { value: record, replayed: false }
      transaction.create(ref, record)
      transaction.create(idemRef, idemDocument(hash, response, now))
      return response
    })
    if (result.replayed) return result
  }
  const audit = await appendAudit({ actor: context, action: 'STUDENT_CASE_REPORTED', resourceType: 'student_case', resourceId: id, after: { studentId: record.studentId, severity: record.severity, status: record.status, evidenceFileIds: record.evidence.map((item) => item.fileId), responseDueAt: record.responseDueAt }, event })
  result.auditId = audit.id
  return result
}

function parseCaseResponse(value: unknown): { response: string; expectedVersion: number } {
  const body = requireRecord(value)
  rejectUnknown(body, ['response', 'expectedVersion'])
  return { response: requireString(body.response, 'response', { min: 20, max: 4_000 }), expectedVersion: requireInteger(body.expectedVersion, 'expectedVersion', 1) }
}

export async function respondToViolationCase(context: AuthContext, caseId: string, value: unknown, idempotencyKey: string, event?: H3Event, clock = new Date()): Promise<StudentAffairsWriteResult<Omit<StudentViolationCase, 'staffNotes'>>> {
  const id = safeId(caseId, 'caseId')
  const profile = await ownProfile(context)
  const input = parseCaseResponse(value)
  const hash = requestHash({ id, studentId: profile.studentId, ...input })
  const namespace = `student-affairs:case:response:${context.uid}:${idempotencyKey}`
  const now = clock.toISOString()
  let result: StudentAffairsWriteResult<StudentViolationCase>
  if (dataMode() === 'mock') {
    const replay = mockReplay<StudentViolationCase>(namespace, hash)
    if (replay) return { ...replay, value: redactCaseFor(context, replay.value) as Omit<StudentViolationCase, 'staffNotes'> }
    const record = state.cases.get(id)
    if (!record) notFound('Kasus')
    if (record.studentId !== profile.studentId) forbidden('Kasus ini bukan milik mahasiswa yang sedang login.')
    if (record.status !== 'NOTIFIED') conflict('CASE_RESPONSE_NOT_ALLOWED', 'Tanggapan hanya dapat dikirim setelah kasus diberitahukan.')
    if (clock.getTime() > Date.parse(record.responseDueAt)) conflict('CASE_RESPONSE_DEADLINE_PASSED', 'Batas waktu tanggapan telah berakhir.')
    if (record.version !== input.expectedVersion) conflict('VERSION_CONFLICT', 'Kasus telah berubah.', { currentVersion: record.version })
    const after: StudentViolationCase = { ...record, studentResponse: input.response, studentRespondedAt: now, status: 'STUDENT_RESPONSE', version: record.version + 1, updatedAt: now, updatedBy: context.uid }
    state.cases.set(id, clone(after))
    result = { value: after, replayed: false }
    saveMockReplay(namespace, hash, result, now)
  } else {
    const replay = await firebaseReplay<StudentViolationCase>(namespace, hash)
    if (replay) return { ...replay, value: redactCaseFor(context, replay.value) as Omit<StudentViolationCase, 'staffNotes'> }
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan kasus tidak tersedia.')
    const ref = db.collection('studentCases').doc(id)
    const idemRef = db.collection('idempotencyKeys').doc(opaqueId('idem', namespace))
    result = await db.runTransaction(async (transaction) => {
      const [previous, snapshot] = await Promise.all([transaction.get(idemRef), transaction.get(ref)])
      if (previous.exists) {
        const data = previous.data() as IdempotencyRecord<StudentViolationCase>
        if (data.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk payload berbeda.')
        return { ...data.response, replayed: true, auditId: undefined }
      }
      if (!snapshot.exists) notFound('Kasus')
      const record = { id: snapshot.id, ...snapshot.data() } as StudentViolationCase
      if (record.studentId !== profile.studentId) forbidden('Kasus ini bukan milik mahasiswa yang sedang login.')
      if (record.status !== 'NOTIFIED') conflict('CASE_RESPONSE_NOT_ALLOWED', 'Tanggapan hanya dapat dikirim setelah kasus diberitahukan.')
      if (clock.getTime() > Date.parse(record.responseDueAt)) conflict('CASE_RESPONSE_DEADLINE_PASSED', 'Batas waktu tanggapan telah berakhir.')
      if (record.version !== input.expectedVersion) conflict('VERSION_CONFLICT', 'Kasus telah berubah.', { currentVersion: record.version })
      const after: StudentViolationCase = { ...record, studentResponse: input.response, studentRespondedAt: now, status: 'STUDENT_RESPONSE', version: record.version + 1, updatedAt: now, updatedBy: context.uid }
      const response: StudentAffairsWriteResult<StudentViolationCase> = { value: after, replayed: false }
      transaction.update(ref, after)
      transaction.create(idemRef, idemDocument(hash, response, now))
      return response
    })
    if (result.replayed) return { ...result, value: redactCaseFor(context, result.value) as Omit<StudentViolationCase, 'staffNotes'> }
  }
  const audit = await appendAudit({ actor: context, action: 'STUDENT_CASE_RESPONSE_SUBMITTED', resourceType: 'student_case', resourceId: id, before: { status: 'NOTIFIED', version: input.expectedVersion }, after: { status: result.value.status, version: result.value.version }, event })
  result.auditId = audit.id
  return { ...result, value: redactCaseFor(context, result.value) as Omit<StudentViolationCase, 'staffNotes'> }
}

function parseCaseNote(value: unknown): { body: string; expectedVersion: number } {
  const body = requireRecord(value)
  rejectUnknown(body, ['body', 'expectedVersion'])
  return { body: requireString(body.body, 'body', { min: 5, max: 2_000 }), expectedVersion: requireInteger(body.expectedVersion, 'expectedVersion', 1) }
}

export async function addCaseStaffNote(context: AuthContext, caseId: string, value: unknown, idempotencyKey: string, event?: H3Event, clock = new Date()): Promise<StudentAffairsWriteResult<StudentViolationCase>> {
  const id = safeId(caseId, 'caseId')
  const input = parseCaseNote(value)
  const hash = requestHash({ id, ...input })
  const namespace = `student-affairs:case:note:${context.uid}:${idempotencyKey}`
  const now = clock.toISOString()
  let result: StudentAffairsWriteResult<StudentViolationCase>
  if (dataMode() === 'mock') {
    const replay = mockReplay<StudentViolationCase>(namespace, hash)
    if (replay) return replay
    const record = state.cases.get(id)
    if (!record) notFound('Kasus')
    requireStaffManage(context, record.programStudyId)
    if (record.version !== input.expectedVersion) conflict('VERSION_CONFLICT', 'Kasus telah berubah.', { currentVersion: record.version })
    const note: CaseNote = { id: opaqueId('note', `${id}:${idempotencyKey}`), body: input.body, createdAt: now, createdBy: context.uid }
    const after = { ...record, staffNotes: [...record.staffNotes, note], version: record.version + 1, updatedAt: now, updatedBy: context.uid }
    state.cases.set(id, clone(after))
    result = { value: after, replayed: false }
    saveMockReplay(namespace, hash, result, now)
  } else {
    const replay = await firebaseReplay<StudentViolationCase>(namespace, hash)
    if (replay) return replay
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan kasus tidak tersedia.')
    const ref = db.collection('studentCases').doc(id)
    const idemRef = db.collection('idempotencyKeys').doc(opaqueId('idem', namespace))
    result = await db.runTransaction(async (transaction) => {
      const [previous, snapshot] = await Promise.all([transaction.get(idemRef), transaction.get(ref)])
      if (previous.exists) {
        const data = previous.data() as IdempotencyRecord<StudentViolationCase>
        if (data.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk payload berbeda.')
        return { ...data.response, replayed: true, auditId: undefined }
      }
      if (!snapshot.exists) notFound('Kasus')
      const record = { id: snapshot.id, ...snapshot.data() } as StudentViolationCase
      requireStaffManage(context, record.programStudyId)
      if (record.version !== input.expectedVersion) conflict('VERSION_CONFLICT', 'Kasus telah berubah.', { currentVersion: record.version })
      const note: CaseNote = { id: opaqueId('note', `${id}:${idempotencyKey}`), body: input.body, createdAt: now, createdBy: context.uid }
      const after = { ...record, staffNotes: [...record.staffNotes, note], version: record.version + 1, updatedAt: now, updatedBy: context.uid }
      const response: StudentAffairsWriteResult<StudentViolationCase> = { value: after, replayed: false }
      transaction.update(ref, after)
      transaction.create(idemRef, idemDocument(hash, response, now))
      return response
    })
    if (result.replayed) return result
  }
  const audit = await appendAudit({ actor: context, action: 'STUDENT_CASE_STAFF_NOTE_ADDED', resourceType: 'student_case', resourceId: id, after: { noteId: result.value.staffNotes.at(-1)?.id, version: result.value.version }, event })
  result.auditId = audit.id
  return result
}

interface CaseTransitionInput {
  targetStatus: CaseStatus
  expectedVersion: number
  publicReason?: string
  outcome?: string
  resolutionSummary?: string
  pointAdjustment: number
  expectedPolicyVersion?: number
}

function parseCaseTransition(value: unknown): CaseTransitionInput {
  const body = requireRecord(value)
  rejectUnknown(body, ['targetStatus', 'expectedVersion', 'publicReason', 'outcome', 'resolutionSummary', 'pointAdjustment', 'expectedPolicyVersion'])
  const targetStatus = requireString(body.targetStatus, 'targetStatus', { max: 30 }) as CaseStatus
  if (!CASE_STATUSES.includes(targetStatus)) invalidInput('targetStatus kasus tidak valid.')
  const pointAdjustment = body.pointAdjustment === undefined ? 0 : requireInteger(body.pointAdjustment, 'pointAdjustment', -1_000, 0)
  return {
    targetStatus,
    expectedVersion: requireInteger(body.expectedVersion, 'expectedVersion', 1),
    publicReason: optionalString(body.publicReason, 'publicReason', 500),
    outcome: optionalString(body.outcome, 'outcome', 120),
    resolutionSummary: optionalString(body.resolutionSummary, 'resolutionSummary', 1_000),
    pointAdjustment,
    expectedPolicyVersion: body.expectedPolicyVersion === undefined ? undefined : requireInteger(body.expectedPolicyVersion, 'expectedPolicyVersion', 1),
  }
}

function transitionCaseRecord(record: StudentViolationCase, input: CaseTransitionInput, context: AuthContext, now: string, clock: Date): StudentViolationCase {
  const allowed: Record<CaseStatus, CaseStatus[]> = {
    REPORTED: ['NOTIFIED', 'DISMISSED'],
    NOTIFIED: ['UNDER_REVIEW', 'DISMISSED'],
    STUDENT_RESPONSE: ['UNDER_REVIEW', 'DISMISSED'],
    UNDER_REVIEW: ['RESOLVED', 'DISMISSED'],
    RESOLVED: [],
    DISMISSED: [],
  }
  if (!allowed[record.status].includes(input.targetStatus)) conflict('INVALID_CASE_TRANSITION', `Transisi ${record.status} ke ${input.targetStatus} tidak valid.`)
  if (record.status === 'NOTIFIED' && input.targetStatus === 'UNDER_REVIEW' && !record.studentResponse && clock.getTime() <= Date.parse(record.responseDueAt)) {
    conflict('DUE_PROCESS_PENDING', 'Masa tanggapan mahasiswa belum berakhir.')
  }
  if (input.targetStatus === 'DISMISSED' && !input.publicReason) invalidInput('publicReason wajib saat kasus dihentikan.')
  if (input.targetStatus === 'RESOLVED' && (!input.outcome || !input.resolutionSummary)) invalidInput('outcome dan resolutionSummary wajib saat menyelesaikan kasus.')
  if (input.pointAdjustment !== 0 && input.targetStatus !== 'RESOLVED') invalidInput('pointAdjustment hanya boleh dicatat saat resolusi.')
  return {
    ...record,
    status: input.targetStatus,
    ...(input.targetStatus === 'DISMISSED' ? { resolution: { outcome: 'DISMISSED', summary: input.publicReason!, pointAdjustment: 0, resolvedAt: now, resolvedBy: context.uid } } : {}),
    ...(input.targetStatus === 'RESOLVED' ? { resolution: { outcome: input.outcome!, summary: input.resolutionSummary!, pointAdjustment: input.pointAdjustment, resolvedAt: now, resolvedBy: context.uid } } : {}),
    version: record.version + 1,
    updatedAt: now,
    updatedBy: context.uid,
  }
}

export async function transitionViolationCase(context: AuthContext, caseId: string, value: unknown, idempotencyKey: string, event?: H3Event, clock = new Date()): Promise<StudentAffairsWriteResult<StudentViolationCase>> {
  const id = safeId(caseId, 'caseId')
  const input = parseCaseTransition(value)
  const hash = requestHash({ id, ...input })
  const namespace = `student-affairs:case:transition:${context.uid}:${idempotencyKey}`
  const now = clock.toISOString()
  let before: StudentViolationCase | undefined
  let ledgerEntry: PointLedgerEntry | undefined
  let result: StudentAffairsWriteResult<StudentViolationCase>
  if (dataMode() === 'mock') {
    const replay = mockReplay<StudentViolationCase>(namespace, hash)
    if (replay) return replay
    const stored = state.cases.get(id)
    if (!stored) notFound('Kasus')
    before = clone(stored)
    requireStaffManage(context, before.programStudyId)
    if (before.version !== input.expectedVersion) conflict('VERSION_CONFLICT', 'Kasus telah berubah.', { currentVersion: before.version })
    if (input.pointAdjustment) {
      const policy = state.pointPolicies.get(before.programStudyId)
      if (!policy) notFound('Kebijakan poin')
      if (policy.version !== input.expectedPolicyVersion) conflict('VERSION_CONFLICT', 'Kebijakan poin telah berubah.', { currentVersion: policy.version })
      if (Math.abs(input.pointAdjustment) > policy.adjustmentLimit) invalidInput('Penyesuaian kasus melampaui batas kebijakan poin.')
      ledgerEntry = { id: `ledger-case-${id}`, studentId: before.studentId, programStudyId: before.programStudyId, sourceType: 'CASE', sourceId: id, points: input.pointAdjustment, reason: input.resolutionSummary!, createdAt: now, createdBy: context.uid, immutable: true }
      if (state.pointLedger.has(ledgerEntry.id)) conflict('LEDGER_SOURCE_ALREADY_POSTED', 'Penyesuaian kasus telah dibukukan.')
    }
    const after = transitionCaseRecord(before, input, context, now, clock)
    if (ledgerEntry) state.pointLedger.set(ledgerEntry.id, clone(ledgerEntry))
    state.cases.set(id, clone(after))
    result = { value: after, replayed: false }
    saveMockReplay(namespace, hash, result, now)
  } else {
    const replay = await firebaseReplay<StudentViolationCase>(namespace, hash)
    if (replay) return replay
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan kasus tidak tersedia.')
    const ref = db.collection('studentCases').doc(id)
    const idemRef = db.collection('idempotencyKeys').doc(opaqueId('idem', namespace))
    result = await db.runTransaction(async (transaction) => {
      const [previous, snapshot] = await Promise.all([transaction.get(idemRef), transaction.get(ref)])
      if (previous.exists) {
        const data = previous.data() as IdempotencyRecord<StudentViolationCase>
        if (data.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk payload berbeda.')
        return { ...data.response, replayed: true, auditId: undefined }
      }
      if (!snapshot.exists) notFound('Kasus')
      before = { id: snapshot.id, ...snapshot.data() } as StudentViolationCase
      requireStaffManage(context, before.programStudyId)
      if (before.version !== input.expectedVersion) conflict('VERSION_CONFLICT', 'Kasus telah berubah.', { currentVersion: before.version })
      if (input.pointAdjustment) {
        const policyRef = db.collection('studentPointPolicies').doc(before.programStudyId)
        const policySnapshot = await transaction.get(policyRef)
        if (!policySnapshot.exists) notFound('Kebijakan poin')
        const policy = policySnapshot.data() as PointPolicy
        if (policy.version !== input.expectedPolicyVersion) conflict('VERSION_CONFLICT', 'Kebijakan poin telah berubah.', { currentVersion: policy.version })
        if (Math.abs(input.pointAdjustment) > policy.adjustmentLimit) invalidInput('Penyesuaian kasus melampaui batas kebijakan poin.')
        ledgerEntry = { id: `ledger-case-${id}`, studentId: before.studentId, programStudyId: before.programStudyId, sourceType: 'CASE', sourceId: id, points: input.pointAdjustment, reason: input.resolutionSummary!, createdAt: now, createdBy: context.uid, immutable: true }
        const ledgerRef = db.collection('studentPointLedger').doc(ledgerEntry.id)
        const ledgerSnapshot = await transaction.get(ledgerRef)
        if (ledgerSnapshot.exists) conflict('LEDGER_SOURCE_ALREADY_POSTED', 'Penyesuaian kasus telah dibukukan.')
        transaction.create(ledgerRef, ledgerEntry)
      }
      const after = transitionCaseRecord(before, input, context, now, clock)
      const response: StudentAffairsWriteResult<StudentViolationCase> = { value: after, replayed: false }
      transaction.update(ref, after)
      transaction.create(idemRef, idemDocument(hash, response, now))
      return response
    })
    if (result.replayed) return result
  }
  if (!before) serviceUnavailable('State kasus mahasiswa tidak tersedia.')
  const audit = await appendAudit({ actor: context, action: 'STUDENT_CASE_TRANSITIONED', resourceType: 'student_case', resourceId: id, before: { status: before.status, version: before.version }, after: { status: result.value.status, version: result.value.version, outcome: result.value.resolution?.outcome, ledgerEntryId: ledgerEntry?.id }, event })
  result.auditId = audit.id
  return result
}

export async function listScholarshipPrograms(context: AuthContext, query: StudentAffairsListQuery): Promise<PaginatedResult<ScholarshipProgram>> {
  let profile: StudentAffairsProfile | undefined
  if (hasRole(context, 'student')) profile = await ownProfile(context)
  else if (!hasRole(context, 'administrator', 'leader', 'student_affairs_staff')) forbidden('Anda tidak memiliki akses ke program beasiswa.')
  const rows = dataMode() === 'mock' ? [...state.scholarshipPrograms.values()].map(clone) : await loadCollection<ScholarshipProgram>('scholarshipPrograms')
  const filtered = rows.filter((program) => {
    const inScope = hasRole(context, 'administrator', 'leader')
      || (hasRole(context, 'student_affairs_staff') && (program.programStudyIds.length === 0 || program.programStudyIds.some((id) => context.scope.programStudyIds.includes(id))))
      || (profile && (program.programStudyIds.length === 0 || program.programStudyIds.includes(profile.programStudyId)))
    return inScope && (!query.status || program.status === query.status) && matchesSearch(program, query.search)
  }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  return paginate(filtered, query)
}

function parseScholarshipProgram(value: unknown, clock: Date): Omit<ScholarshipProgram, 'id' | 'awardedCount' | 'version' | 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'> & { expectedVersion: number; id?: string } {
  const body = requireRecord(value)
  rejectUnknown(body, ['id', 'expectedVersion', 'name', 'description', 'periodId', 'programStudyIds', 'status', 'applicationOpensAt', 'applicationClosesAt', 'minGpa', 'minCredits', 'quota', 'checklist'])
  const status = requireString(body.status, 'status', { max: 20 }) as ScholarshipProgramStatus
  if (!(['DRAFT', 'OPEN', 'CLOSED'] as ScholarshipProgramStatus[]).includes(status)) invalidInput('status program beasiswa tidak valid.')
  if (!Array.isArray(body.programStudyIds) || body.programStudyIds.length > 20) invalidInput('programStudyIds harus berupa array maksimal 20 item.')
  const programStudyIds = body.programStudyIds.map((item, index) => safeId(item, `programStudyIds[${index}]`))
  if (!Array.isArray(body.checklist) || body.checklist.length < 1 || body.checklist.length > 20) invalidInput('checklist harus berisi 1-20 item.')
  const checklist = body.checklist.map((item, index) => {
    const check = requireRecord(item, `checklist[${index}]`)
    rejectUnknown(check, ['id', 'label', 'kind', 'documentType'])
    const kind = requireString(check.kind, `checklist[${index}].kind`, { max: 40 }) as ScholarshipProgram['checklist'][number]['kind']
    if (!['ACTIVE_STATUS', 'MIN_GPA', 'MIN_CREDITS', 'VERIFIED_DOCUMENT', 'NO_OPEN_MAJOR_CASE'].includes(kind)) invalidInput(`checklist[${index}].kind tidak valid.`)
    const documentType = optionalString(check.documentType, `checklist[${index}].documentType`, 80)
    if (kind === 'VERIFIED_DOCUMENT' && !documentType) invalidInput(`checklist[${index}].documentType wajib.`)
    return { id: safeId(check.id, `checklist[${index}].id`), label: requireString(check.label, `checklist[${index}].label`, { min: 3, max: 140 }), kind, ...(documentType ? { documentType } : {}) }
  })
  const opens = normalizeIsoInstant(body.applicationOpensAt, 'applicationOpensAt', { now: clock.getTime(), maxFutureMs: 365 * 24 * 60 * 60 * 1_000 })
  const closes = normalizeIsoInstant(body.applicationClosesAt, 'applicationClosesAt', { now: clock.getTime(), maxFutureMs: 730 * 24 * 60 * 60 * 1_000 })
  if (Date.parse(closes) <= Date.parse(opens)) invalidInput('applicationClosesAt harus setelah applicationOpensAt.')
  const minGpa = body.minGpa
  if (typeof minGpa !== 'number' || !Number.isFinite(minGpa) || minGpa < 0 || minGpa > 4) invalidInput('minGpa harus berada pada rentang 0-4.')
  return {
    id: body.id === undefined ? undefined : safeId(body.id, 'id'),
    expectedVersion: requireInteger(body.expectedVersion, 'expectedVersion', 0),
    name: requireString(body.name, 'name', { min: 5, max: 180 }),
    description: requireString(body.description, 'description', { min: 10, max: 2_000 }),
    periodId: safeId(body.periodId, 'periodId'),
    programStudyIds: [...new Set(programStudyIds)],
    status,
    applicationOpensAt: opens,
    applicationClosesAt: closes,
    minGpa,
    minCredits: requireInteger(body.minCredits, 'minCredits', 0, 300),
    quota: requireInteger(body.quota, 'quota', 1, 10_000),
    checklist,
  }
}

export async function saveScholarshipProgram(context: AuthContext, value: unknown, idempotencyKey: string, event?: H3Event, clock = new Date()): Promise<StudentAffairsWriteResult<ScholarshipProgram>> {
  const input = parseScholarshipProgram(value, clock)
  if (input.programStudyIds.length === 0) {
    if (!hasRole(context, 'administrator')) forbidden('Hanya administrator yang dapat membuat program lintas kampus.')
  } else if (!hasRole(context, 'administrator') && (!hasRole(context, 'student_affairs_staff') || input.programStudyIds.some((id) => !context.scope.programStudyIds.includes(id)))) {
    forbidden('Program studi beasiswa berada di luar lingkup akses Anda.')
  }
  const id = input.id ?? opaqueId('scholarship', `${context.uid}:${idempotencyKey}`)
  const hash = requestHash({ id, ...input })
  const namespace = `student-affairs:scholarship-program:${context.uid}:${idempotencyKey}`
  const now = clock.toISOString()
  let before: ScholarshipProgram | undefined
  let result: StudentAffairsWriteResult<ScholarshipProgram>
  if (dataMode() === 'mock') {
    const replay = mockReplay<ScholarshipProgram>(namespace, hash)
    if (replay) return replay
    before = state.scholarshipPrograms.get(id)
    const version = before?.version ?? 0
    if (version !== input.expectedVersion) conflict('VERSION_CONFLICT', 'Program beasiswa telah berubah.', { currentVersion: version })
    const program: ScholarshipProgram = { id, name: input.name, description: input.description, periodId: input.periodId, programStudyIds: input.programStudyIds, status: input.status, applicationOpensAt: input.applicationOpensAt, applicationClosesAt: input.applicationClosesAt, minGpa: input.minGpa, minCredits: input.minCredits, quota: input.quota, awardedCount: before?.awardedCount ?? 0, checklist: clone(input.checklist), version: version + 1, createdAt: before?.createdAt ?? now, createdBy: before?.createdBy ?? context.uid, updatedAt: now, updatedBy: context.uid }
    state.scholarshipPrograms.set(id, clone(program))
    result = { value: program, replayed: false }
    saveMockReplay(namespace, hash, result, now)
  } else {
    const replay = await firebaseReplay<ScholarshipProgram>(namespace, hash)
    if (replay) return replay
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan beasiswa tidak tersedia.')
    const ref = db.collection('scholarshipPrograms').doc(id)
    const idemRef = db.collection('idempotencyKeys').doc(opaqueId('idem', namespace))
    result = await db.runTransaction(async (transaction) => {
      const [previous, snapshot] = await Promise.all([transaction.get(idemRef), transaction.get(ref)])
      if (previous.exists) {
        const data = previous.data() as IdempotencyRecord<ScholarshipProgram>
        if (data.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk payload berbeda.')
        return { ...data.response, replayed: true, auditId: undefined }
      }
      before = snapshot.exists ? ({ id: snapshot.id, ...snapshot.data() } as ScholarshipProgram) : undefined
      const version = before?.version ?? 0
      if (version !== input.expectedVersion) conflict('VERSION_CONFLICT', 'Program beasiswa telah berubah.', { currentVersion: version })
      const program: ScholarshipProgram = { id, name: input.name, description: input.description, periodId: input.periodId, programStudyIds: input.programStudyIds, status: input.status, applicationOpensAt: input.applicationOpensAt, applicationClosesAt: input.applicationClosesAt, minGpa: input.minGpa, minCredits: input.minCredits, quota: input.quota, awardedCount: before?.awardedCount ?? 0, checklist: clone(input.checklist), version: version + 1, createdAt: before?.createdAt ?? now, createdBy: before?.createdBy ?? context.uid, updatedAt: now, updatedBy: context.uid }
      const response: StudentAffairsWriteResult<ScholarshipProgram> = { value: program, replayed: false }
      transaction.set(ref, program)
      transaction.create(idemRef, idemDocument(hash, response, now))
      return response
    })
    if (result.replayed) return result
  }
  const audit = await appendAudit({ actor: context, action: before ? 'SCHOLARSHIP_PROGRAM_UPDATED' : 'SCHOLARSHIP_PROGRAM_CREATED', resourceType: 'scholarship_program', resourceId: id, before: before ? { status: before.status, version: before.version } : undefined, after: { status: result.value.status, version: result.value.version, quota: result.value.quota }, event })
  result.auditId = audit.id
  return result
}

function redactApplicationFor(context: AuthContext, application: ScholarshipApplication): ScholarshipApplication | Omit<ScholarshipApplication, 'internalReviewNotes'> {
  const copy = clone(application) as ScholarshipApplication & { internalReviewNotes?: string }
  if (!canReadStaffOnly(context, application.programStudyId)) delete copy.internalReviewNotes
  return copy as ScholarshipApplication | Omit<ScholarshipApplication, 'internalReviewNotes'>
}

async function scholarshipEligibility(profile: StudentAffairsProfile, program: ScholarshipProgram, clock: Date): Promise<ScholarshipEligibilitySnapshot> {
  const documents = dataMode() === 'mock'
    ? [...state.documents.values()].filter((item) => item.studentId === profile.studentId)
    : (await loadCollection<StudentRequirementDocument>('studentRequirementDocuments')).filter((item) => item.studentId === profile.studentId)
  const cases = dataMode() === 'mock'
    ? [...state.cases.values()].filter((item) => item.studentId === profile.studentId)
    : (await loadCollection<StudentViolationCase>('studentCases')).filter((item) => item.studentId === profile.studentId)
  const checks: EligibilityCheckResult[] = program.checklist.map((item) => {
    if (item.kind === 'ACTIVE_STATUS') return { id: item.id, label: item.label, passed: profile.enrollmentStatus === 'ACTIVE', detail: `Status ${profile.enrollmentStatus}` }
    if (item.kind === 'MIN_GPA') return { id: item.id, label: item.label, passed: profile.gpa >= program.minGpa, detail: `IPK ${profile.gpa.toFixed(2)} / minimum ${program.minGpa.toFixed(2)}` }
    if (item.kind === 'MIN_CREDITS') return { id: item.id, label: item.label, passed: profile.earnedCredits >= program.minCredits, detail: `${profile.earnedCredits} / minimum ${program.minCredits} SKS` }
    if (item.kind === 'VERIFIED_DOCUMENT') {
      const matched = documents.find((document) => document.documentType === item.documentType && document.status === 'VERIFIED' && (!document.expiresAt || Date.parse(document.expiresAt) > clock.getTime()))
      return { id: item.id, label: item.label, passed: Boolean(matched), detail: matched ? `Dokumen ${matched.label} terverifikasi` : `Dokumen ${item.documentType} belum terverifikasi` }
    }
    const openMajor = cases.filter((record) => ['MAJOR', 'CRITICAL'].includes(record.severity) && !['RESOLVED', 'DISMISSED'].includes(record.status)).length
    return { id: item.id, label: item.label, passed: openMajor === 0, detail: openMajor ? `${openMajor} kasus berat masih terbuka` : 'Tidak ada kasus berat terbuka' }
  })
  return { evaluatedAt: clock.toISOString(), profileVersion: requestHash(profile), gpa: profile.gpa, earnedCredits: profile.earnedCredits, enrollmentStatus: profile.enrollmentStatus, checks, eligible: checks.every((item) => item.passed) }
}

function parseScholarshipApplication(value: unknown): { programId: string; statement: string; submittedDocumentIds: string[] } {
  const body = requireRecord(value)
  rejectUnknown(body, ['programId', 'statement', 'submittedDocumentIds'])
  if (!Array.isArray(body.submittedDocumentIds) || body.submittedDocumentIds.length > 20) invalidInput('submittedDocumentIds harus berupa array maksimal 20 item.')
  return { programId: safeId(body.programId, 'programId'), statement: requireString(body.statement, 'statement', { min: 30, max: 3_000 }), submittedDocumentIds: [...new Set(body.submittedDocumentIds.map((item, index) => safeId(item, `submittedDocumentIds[${index}]`)))] }
}

export async function applyForScholarship(context: AuthContext, value: unknown, idempotencyKey: string, event?: H3Event, clock = new Date()): Promise<StudentAffairsWriteResult<Omit<ScholarshipApplication, 'internalReviewNotes'>>> {
  const profile = await ownProfile(context)
  const input = parseScholarshipApplication(value)
  const hash = requestHash({ studentId: profile.studentId, ...input })
  const namespace = `student-affairs:scholarship-application:${context.uid}:${idempotencyKey}`
  const earlyReplay = dataMode() === 'mock'
    ? mockReplay<ScholarshipApplication>(namespace, hash)
    : await firebaseReplay<ScholarshipApplication>(namespace, hash)
  if (earlyReplay) return { ...earlyReplay, value: redactApplicationFor(context, earlyReplay.value) as Omit<ScholarshipApplication, 'internalReviewNotes'> }
  let program: ScholarshipProgram | undefined
  if (dataMode() === 'mock') program = state.scholarshipPrograms.get(input.programId)
  else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan beasiswa tidak tersedia.')
    const snapshot = await db.collection('scholarshipPrograms').doc(input.programId).get()
    if (snapshot.exists) program = { id: snapshot.id, ...snapshot.data() } as ScholarshipProgram
  }
  if (!program) notFound('Program beasiswa')
  if (program.status !== 'OPEN' || clock.getTime() < Date.parse(program.applicationOpensAt) || clock.getTime() > Date.parse(program.applicationClosesAt)) conflict('SCHOLARSHIP_NOT_OPEN', 'Program beasiswa tidak sedang menerima pendaftaran.')
  if (program.programStudyIds.length && !program.programStudyIds.includes(profile.programStudyId)) forbidden('Program beasiswa tidak tersedia untuk program studi Anda.')
  const eligibilitySnapshot = await scholarshipEligibility(profile, program, clock)
  if (!eligibilitySnapshot.eligible) conflict('SCHOLARSHIP_NOT_ELIGIBLE', 'Persyaratan beasiswa belum terpenuhi.', { failedChecks: eligibilitySnapshot.checks.filter((item) => !item.passed).map((item) => item.id) })
  const documents = dataMode() === 'mock' ? state.documents : new Map((await loadCollection<StudentRequirementDocument>('studentRequirementDocuments')).map((item) => [item.id, item]))
  if (input.submittedDocumentIds.some((id) => documents.get(id)?.studentId !== profile.studentId)) forbidden('Dokumen aplikasi harus dimiliki mahasiswa yang sedang login.')
  const now = clock.toISOString()
  const id = opaqueId('application', `${profile.studentId}:${input.programId}`)
  const application: ScholarshipApplication = { id, programId: input.programId, studentId: profile.studentId, programStudyId: profile.programStudyId, status: 'SUBMITTED', statement: input.statement, eligibilitySnapshot, submittedDocumentIds: input.submittedDocumentIds, version: 1, submittedAt: now, updatedAt: now, updatedBy: context.uid }
  let result: StudentAffairsWriteResult<ScholarshipApplication>
  if (dataMode() === 'mock') {
    const replay = mockReplay<ScholarshipApplication>(namespace, hash)
    if (replay) return { ...replay, value: redactApplicationFor(context, replay.value) as Omit<ScholarshipApplication, 'internalReviewNotes'> }
    if (state.scholarshipApplications.has(id)) conflict('SCHOLARSHIP_ALREADY_APPLIED', 'Mahasiswa telah mengajukan program beasiswa ini.')
    state.scholarshipApplications.set(id, clone(application))
    result = { value: application, replayed: false }
    saveMockReplay(namespace, hash, result, now)
  } else {
    const replay = await firebaseReplay<ScholarshipApplication>(namespace, hash)
    if (replay) return { ...replay, value: redactApplicationFor(context, replay.value) as Omit<ScholarshipApplication, 'internalReviewNotes'> }
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan beasiswa tidak tersedia.')
    const ref = db.collection('scholarshipApplications').doc(id)
    const idemRef = db.collection('idempotencyKeys').doc(opaqueId('idem', namespace))
    result = await db.runTransaction(async (transaction) => {
      const [previous, existing] = await Promise.all([transaction.get(idemRef), transaction.get(ref)])
      if (previous.exists) {
        const data = previous.data() as IdempotencyRecord<ScholarshipApplication>
        if (data.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk payload berbeda.')
        return { ...data.response, replayed: true, auditId: undefined }
      }
      if (existing.exists) conflict('SCHOLARSHIP_ALREADY_APPLIED', 'Mahasiswa telah mengajukan program beasiswa ini.')
      const response: StudentAffairsWriteResult<ScholarshipApplication> = { value: application, replayed: false }
      transaction.create(ref, application)
      transaction.create(idemRef, idemDocument(hash, response, now))
      return response
    })
    if (result.replayed) return { ...result, value: redactApplicationFor(context, result.value) as Omit<ScholarshipApplication, 'internalReviewNotes'> }
  }
  const audit = await appendAudit({ actor: context, action: 'SCHOLARSHIP_APPLICATION_SUBMITTED', resourceType: 'scholarship_application', resourceId: id, after: { programId: input.programId, eligibilitySnapshotHash: requestHash(eligibilitySnapshot), documentIds: input.submittedDocumentIds, version: 1 }, event })
  result.auditId = audit.id
  return { ...result, value: redactApplicationFor(context, result.value) as Omit<ScholarshipApplication, 'internalReviewNotes'> }
}

export async function listScholarshipApplications(context: AuthContext, query: StudentAffairsListQuery): Promise<PaginatedResult<ScholarshipApplication | Omit<ScholarshipApplication, 'internalReviewNotes'>>> {
  await authorizeListQuery(context, query)
  const rows = dataMode() === 'mock' ? [...state.scholarshipApplications.values()].map(clone) : await loadCollection<ScholarshipApplication>('scholarshipApplications')
  const filtered = filterOwned(context, rows, query).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((item) => redactApplicationFor(context, item))
  return paginate(filtered, query)
}

function parseApplicationTransition(value: unknown): { targetStatus: ScholarshipApplicationStatus; expectedVersion: number; decisionReason?: string; internalReviewNotes?: string } {
  const body = requireRecord(value)
  rejectUnknown(body, ['targetStatus', 'expectedVersion', 'decisionReason', 'internalReviewNotes'])
  const targetStatus = requireString(body.targetStatus, 'targetStatus', { max: 30 }) as ScholarshipApplicationStatus
  if (!APPLICATION_STATUSES.includes(targetStatus)) invalidInput('targetStatus aplikasi tidak valid.')
  return { targetStatus, expectedVersion: requireInteger(body.expectedVersion, 'expectedVersion', 1), decisionReason: optionalString(body.decisionReason, 'decisionReason', 1_000), internalReviewNotes: optionalString(body.internalReviewNotes, 'internalReviewNotes', 2_000) }
}

function transitionApplicationRecord(record: ScholarshipApplication, input: ReturnType<typeof parseApplicationTransition>, actor: AuthContext, now: string): ScholarshipApplication {
  const allowed: Record<ScholarshipApplicationStatus, ScholarshipApplicationStatus[]> = { SUBMITTED: ['UNDER_REVIEW', 'WITHDRAWN'], UNDER_REVIEW: ['AWARDED', 'REJECTED'], AWARDED: [], REJECTED: [], WITHDRAWN: [] }
  if (!allowed[record.status].includes(input.targetStatus)) conflict('INVALID_APPLICATION_TRANSITION', `Transisi ${record.status} ke ${input.targetStatus} tidak valid.`)
  if (['AWARDED', 'REJECTED'].includes(input.targetStatus) && !input.decisionReason) invalidInput('decisionReason wajib untuk keputusan akhir.')
  return { ...record, status: input.targetStatus, ...(input.decisionReason ? { decisionReason: input.decisionReason } : {}), ...(input.internalReviewNotes ? { internalReviewNotes: input.internalReviewNotes } : {}), version: record.version + 1, updatedAt: now, updatedBy: actor.uid }
}

export async function transitionScholarshipApplication(context: AuthContext, applicationId: string, value: unknown, idempotencyKey: string, event?: H3Event, clock = new Date()): Promise<StudentAffairsWriteResult<ScholarshipApplication | Omit<ScholarshipApplication, 'internalReviewNotes'>>> {
  const id = safeId(applicationId, 'applicationId')
  const input = parseApplicationTransition(value)
  const hash = requestHash({ id, ...input })
  const namespace = `student-affairs:scholarship-transition:${context.uid}:${idempotencyKey}`
  const now = clock.toISOString()
  let before: ScholarshipApplication | undefined
  let result: StudentAffairsWriteResult<ScholarshipApplication>
  if (dataMode() === 'mock') {
    const replay = mockReplay<ScholarshipApplication>(namespace, hash)
    if (replay) return { ...replay, value: redactApplicationFor(context, replay.value) }
    const stored = state.scholarshipApplications.get(id)
    if (!stored) notFound('Aplikasi beasiswa')
    before = clone(stored)
    if (input.targetStatus === 'WITHDRAWN') {
      const profile = await ownProfile(context)
      if (profile.studentId !== before.studentId) forbidden('Aplikasi bukan milik mahasiswa yang sedang login.')
    } else requireStaffManage(context, before.programStudyId)
    if (before.version !== input.expectedVersion) conflict('VERSION_CONFLICT', 'Aplikasi beasiswa telah berubah.', { currentVersion: before.version })
    const after = transitionApplicationRecord(before, input, context, now)
    if (after.status === 'AWARDED') {
      const program = state.scholarshipPrograms.get(after.programId)
      if (!program) notFound('Program beasiswa')
      if (program.awardedCount >= program.quota) conflict('SCHOLARSHIP_QUOTA_FULL', 'Kuota beasiswa telah terpenuhi.')
      state.scholarshipPrograms.set(program.id, { ...program, awardedCount: program.awardedCount + 1, updatedAt: now, updatedBy: context.uid })
    }
    state.scholarshipApplications.set(id, clone(after))
    result = { value: after, replayed: false }
    saveMockReplay(namespace, hash, result, now)
  } else {
    const replay = await firebaseReplay<ScholarshipApplication>(namespace, hash)
    if (replay) return { ...replay, value: redactApplicationFor(context, replay.value) }
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan beasiswa tidak tersedia.')
    const ref = db.collection('scholarshipApplications').doc(id)
    const idemRef = db.collection('idempotencyKeys').doc(opaqueId('idem', namespace))
    result = await db.runTransaction(async (transaction) => {
      const [previous, snapshot] = await Promise.all([transaction.get(idemRef), transaction.get(ref)])
      if (previous.exists) {
        const data = previous.data() as IdempotencyRecord<ScholarshipApplication>
        if (data.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk payload berbeda.')
        return { ...data.response, replayed: true, auditId: undefined }
      }
      if (!snapshot.exists) notFound('Aplikasi beasiswa')
      before = { id: snapshot.id, ...snapshot.data() } as ScholarshipApplication
      if (input.targetStatus === 'WITHDRAWN') {
        const profile = await ownProfile(context)
        if (profile.studentId !== before.studentId) forbidden('Aplikasi bukan milik mahasiswa yang sedang login.')
      } else requireStaffManage(context, before.programStudyId)
      if (before.version !== input.expectedVersion) conflict('VERSION_CONFLICT', 'Aplikasi beasiswa telah berubah.', { currentVersion: before.version })
      const after = transitionApplicationRecord(before, input, context, now)
      if (after.status === 'AWARDED') {
        const programRef = db.collection('scholarshipPrograms').doc(after.programId)
        const programSnapshot = await transaction.get(programRef)
        if (!programSnapshot.exists) notFound('Program beasiswa')
        const program = { id: programSnapshot.id, ...programSnapshot.data() } as ScholarshipProgram
        if (program.awardedCount >= program.quota) conflict('SCHOLARSHIP_QUOTA_FULL', 'Kuota beasiswa telah terpenuhi.')
        transaction.update(programRef, { awardedCount: program.awardedCount + 1, updatedAt: now, updatedBy: context.uid })
      }
      const response: StudentAffairsWriteResult<ScholarshipApplication> = { value: after, replayed: false }
      transaction.update(ref, after)
      transaction.create(idemRef, idemDocument(hash, response, now))
      return response
    })
    if (result.replayed) return { ...result, value: redactApplicationFor(context, result.value) }
  }
  if (!before) serviceUnavailable('State aplikasi beasiswa tidak tersedia.')
  const audit = await appendAudit({ actor: context, action: 'SCHOLARSHIP_APPLICATION_TRANSITIONED', resourceType: 'scholarship_application', resourceId: id, before: { status: before.status, version: before.version }, after: { status: result.value.status, version: result.value.version, decisionReason: result.value.decisionReason }, event })
  result.auditId = audit.id
  return { ...result, value: redactApplicationFor(context, result.value) }
}

export async function listRequirementDocuments(context: AuthContext, query: StudentAffairsListQuery): Promise<PaginatedResult<StudentRequirementDocument>> {
  await authorizeListQuery(context, query)
  const rows = dataMode() === 'mock' ? [...state.documents.values()].map(clone) : await loadCollection<StudentRequirementDocument>('studentRequirementDocuments')
  return paginate(filterOwned(context, rows, query).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), query)
}

function parseRequirementDocument(value: unknown): { documentType: string; label: string; file: EvidenceFileReference; expiresAt?: string } {
  const body = requireRecord(value)
  rejectUnknown(body, ['documentType', 'label', 'file', 'expiresAt'])
  const file = parseEvidence([body.file], 'file', 1)[0]!
  const expiresAt = optionalString(body.expiresAt, 'expiresAt', 48)
  if (expiresAt && Number.isNaN(Date.parse(expiresAt))) invalidInput('expiresAt tidak valid.')
  return { documentType: requireString(body.documentType, 'documentType', { max: 80, pattern: /^[A-Z][A-Z0-9_-]*$/ }), label: requireString(body.label, 'label', { min: 3, max: 140 }), file, ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}) }
}

export async function submitRequirementDocument(context: AuthContext, value: unknown, idempotencyKey: string, event?: H3Event, clock = new Date()): Promise<StudentAffairsWriteResult<StudentRequirementDocument>> {
  const profile = await ownProfile(context)
  const input = parseRequirementDocument(value)
  const hash = requestHash({ studentId: profile.studentId, ...input })
  const namespace = `student-affairs:document:submit:${context.uid}:${idempotencyKey}`
  const now = clock.toISOString()
  const id = opaqueId('document', `${profile.studentId}:${input.documentType}:${idempotencyKey}`)
  const document: StudentRequirementDocument = { id, studentId: profile.studentId, programStudyId: profile.programStudyId, documentType: input.documentType, label: input.label, file: input.file, status: 'PENDING', ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}), version: 1, createdAt: now, createdBy: context.uid, updatedAt: now, updatedBy: context.uid }
  let result: StudentAffairsWriteResult<StudentRequirementDocument>
  if (dataMode() === 'mock') {
    const replay = mockReplay<StudentRequirementDocument>(namespace, hash)
    if (replay) return replay
    state.documents.set(id, clone(document))
    result = { value: document, replayed: false }
    saveMockReplay(namespace, hash, result, now)
  } else {
    const replay = await firebaseReplay<StudentRequirementDocument>(namespace, hash)
    if (replay) return replay
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan dokumen tidak tersedia.')
    const ref = db.collection('studentRequirementDocuments').doc(id)
    const idemRef = db.collection('idempotencyKeys').doc(opaqueId('idem', namespace))
    result = await db.runTransaction(async (transaction) => {
      const previous = await transaction.get(idemRef)
      if (previous.exists) {
        const data = previous.data() as IdempotencyRecord<StudentRequirementDocument>
        if (data.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk payload berbeda.')
        return { ...data.response, replayed: true, auditId: undefined }
      }
      const response: StudentAffairsWriteResult<StudentRequirementDocument> = { value: document, replayed: false }
      transaction.create(ref, document)
      transaction.create(idemRef, idemDocument(hash, response, now))
      return response
    })
    if (result.replayed) return result
  }
  const audit = await appendAudit({ actor: context, action: 'STUDENT_REQUIREMENT_DOCUMENT_SUBMITTED', resourceType: 'student_requirement_document', resourceId: id, after: { documentType: document.documentType, fileId: document.file.fileId, status: document.status, version: 1 }, event })
  result.auditId = audit.id
  return result
}

function parseDocumentReview(value: unknown): { status: 'VERIFIED' | 'REJECTED'; rejectionReason?: string; expectedVersion: number } {
  const body = requireRecord(value)
  rejectUnknown(body, ['status', 'rejectionReason', 'expectedVersion'])
  const status = requireString(body.status, 'status', { max: 20 })
  if (!['VERIFIED', 'REJECTED'].includes(status)) invalidInput('status review dokumen tidak valid.')
  const rejectionReason = optionalString(body.rejectionReason, 'rejectionReason', 500)
  if (status === 'REJECTED' && !rejectionReason) invalidInput('rejectionReason wajib saat menolak dokumen.')
  return { status: status as 'VERIFIED' | 'REJECTED', rejectionReason, expectedVersion: requireInteger(body.expectedVersion, 'expectedVersion', 1) }
}

export async function reviewRequirementDocument(context: AuthContext, documentId: string, value: unknown, idempotencyKey: string, event?: H3Event, clock = new Date()): Promise<StudentAffairsWriteResult<StudentRequirementDocument>> {
  const id = safeId(documentId, 'documentId')
  const input = parseDocumentReview(value)
  const hash = requestHash({ id, ...input })
  const namespace = `student-affairs:document:review:${context.uid}:${idempotencyKey}`
  const now = clock.toISOString()
  let before: StudentRequirementDocument | undefined
  let result: StudentAffairsWriteResult<StudentRequirementDocument>
  if (dataMode() === 'mock') {
    const replay = mockReplay<StudentRequirementDocument>(namespace, hash)
    if (replay) return replay
    const stored = state.documents.get(id)
    if (!stored) notFound('Dokumen')
    before = clone(stored)
    requireStaffManage(context, before.programStudyId)
    if (before.version !== input.expectedVersion) conflict('VERSION_CONFLICT', 'Dokumen telah berubah.', { currentVersion: before.version })
    const { rejectionReason: _previousRejection, ...documentWithoutRejection } = before
    const after: StudentRequirementDocument = { ...documentWithoutRejection, status: input.status, ...(input.rejectionReason ? { rejectionReason: input.rejectionReason } : {}), version: before.version + 1, updatedAt: now, updatedBy: context.uid }
    state.documents.set(id, clone(after))
    result = { value: after, replayed: false }
    saveMockReplay(namespace, hash, result, now)
  } else {
    const replay = await firebaseReplay<StudentRequirementDocument>(namespace, hash)
    if (replay) return replay
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan dokumen tidak tersedia.')
    const ref = db.collection('studentRequirementDocuments').doc(id)
    const idemRef = db.collection('idempotencyKeys').doc(opaqueId('idem', namespace))
    result = await db.runTransaction(async (transaction) => {
      const [previous, snapshot] = await Promise.all([transaction.get(idemRef), transaction.get(ref)])
      if (previous.exists) {
        const data = previous.data() as IdempotencyRecord<StudentRequirementDocument>
        if (data.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk payload berbeda.')
        return { ...data.response, replayed: true, auditId: undefined }
      }
      if (!snapshot.exists) notFound('Dokumen')
      before = { id: snapshot.id, ...snapshot.data() } as StudentRequirementDocument
      requireStaffManage(context, before.programStudyId)
      if (before.version !== input.expectedVersion) conflict('VERSION_CONFLICT', 'Dokumen telah berubah.', { currentVersion: before.version })
      const { rejectionReason: _previousRejection, ...documentWithoutRejection } = before
      const after: StudentRequirementDocument = { ...documentWithoutRejection, status: input.status, ...(input.rejectionReason ? { rejectionReason: input.rejectionReason } : {}), version: before.version + 1, updatedAt: now, updatedBy: context.uid }
      const response: StudentAffairsWriteResult<StudentRequirementDocument> = { value: after, replayed: false }
      transaction.update(ref, after)
      transaction.create(idemRef, idemDocument(hash, response, now))
      return response
    })
    if (result.replayed) return result
  }
  if (!before) serviceUnavailable('State dokumen mahasiswa tidak tersedia.')
  const audit = await appendAudit({ actor: context, action: 'STUDENT_REQUIREMENT_DOCUMENT_REVIEWED', resourceType: 'student_requirement_document', resourceId: id, before: { status: before.status, version: before.version }, after: { status: result.value.status, version: result.value.version }, event })
  result.auditId = audit.id
  return result
}

function activeStudentEligibilityFrom(
  profile: StudentAffairsProfile,
  cases: StudentViolationCase[],
  clock: Date,
): ActiveStudentEligibilitySnapshot {
  const unresolvedMajorCaseCount = cases.filter((record) =>
    record.studentId === profile.studentId
    && ['MAJOR', 'CRITICAL'].includes(record.severity)
    && !['RESOLVED', 'DISMISSED'].includes(record.status),
  ).length
  const reasons: string[] = []
  if (profile.enrollmentStatus !== 'ACTIVE') reasons.push('Status akademik mahasiswa tidak aktif.')
  if (profile.financialHold) reasons.push('Terdapat penahanan layanan karena kewajiban keuangan.')
  if (unresolvedMajorCaseCount > 0) reasons.push('Terdapat kasus pelanggaran berat yang belum selesai.')
  return {
    evaluatedAt: clock.toISOString(),
    enrollmentStatus: profile.enrollmentStatus,
    currentPeriodId: profile.currentPeriodId,
    financialHold: profile.financialHold,
    unresolvedMajorCaseCount,
    eligible: reasons.length === 0,
    reasons,
  }
}

async function evaluateActiveStudentEligibility(studentId: string, clock: Date): Promise<ActiveStudentEligibilitySnapshot> {
  const profile = await loadProfile(studentId)
  const cases = dataMode() === 'mock'
    ? [...state.cases.values()].filter((record) => record.studentId === studentId).map(clone)
    : (await loadCollection<StudentViolationCase>('studentCases')).filter((record) => record.studentId === studentId)
  return activeStudentEligibilityFrom(profile, cases, clock)
}

export async function listLetterRequests(context: AuthContext, query: StudentAffairsListQuery): Promise<PaginatedResult<ActiveStudentLetterRequest>> {
  await authorizeListQuery(context, query)
  const rows = dataMode() === 'mock'
    ? [...state.letterRequests.values()].map(clone)
    : await loadCollection<ActiveStudentLetterRequest>('activeStudentLetterRequests')
  return paginate(filterOwned(context, rows, query).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), query)
}

function parseLetterRequest(value: unknown): { purpose: string } {
  const body = requireRecord(value)
  rejectUnknown(body, ['purpose'])
  return { purpose: requireString(body.purpose, 'purpose', { min: 5, max: 500 }) }
}

export async function requestActiveStudentLetter(
  context: AuthContext,
  value: unknown,
  idempotencyKey: string,
  event?: H3Event,
  clock = new Date(),
): Promise<StudentAffairsWriteResult<ActiveStudentLetterRequest>> {
  const profile = await ownProfile(context)
  const input = parseLetterRequest(value)
  const hash = requestHash({ studentId: profile.studentId, ...input })
  const namespace = `student-affairs:letter:request:${context.uid}:${idempotencyKey}`
  const earlyReplay = dataMode() === 'mock'
    ? mockReplay<ActiveStudentLetterRequest>(namespace, hash)
    : await firebaseReplay<ActiveStudentLetterRequest>(namespace, hash)
  if (earlyReplay) return earlyReplay
  const eligibilitySnapshot = await evaluateActiveStudentEligibility(profile.studentId, clock)
  if (!eligibilitySnapshot.eligible) conflict('ACTIVE_STUDENT_LETTER_INELIGIBLE', 'Mahasiswa belum memenuhi syarat penerbitan surat aktif.', { reasons: eligibilitySnapshot.reasons })
  const now = clock.toISOString()
  const id = opaqueId('letter_request', `${profile.studentId}:${idempotencyKey}`)
  const request: ActiveStudentLetterRequest = {
    id,
    studentId: profile.studentId,
    programStudyId: profile.programStudyId,
    purpose: input.purpose,
    status: 'SUBMITTED',
    eligibilitySnapshot,
    version: 1,
    submittedAt: now,
    updatedAt: now,
    updatedBy: context.uid,
  }
  let result: StudentAffairsWriteResult<ActiveStudentLetterRequest>
  if (dataMode() === 'mock') {
    const replay = mockReplay<ActiveStudentLetterRequest>(namespace, hash)
    if (replay) return replay
    state.letterRequests.set(id, clone(request))
    result = { value: request, replayed: false }
    saveMockReplay(namespace, hash, result, now)
  } else {
    const replay = await firebaseReplay<ActiveStudentLetterRequest>(namespace, hash)
    if (replay) return replay
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan surat aktif tidak tersedia.')
    const ref = db.collection('activeStudentLetterRequests').doc(id)
    const idemRef = db.collection('idempotencyKeys').doc(opaqueId('idem', namespace))
    result = await db.runTransaction(async (transaction) => {
      const [previous, existing] = await Promise.all([transaction.get(idemRef), transaction.get(ref)])
      if (previous.exists) {
        const data = previous.data() as IdempotencyRecord<ActiveStudentLetterRequest>
        if (data.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk payload berbeda.')
        return { ...data.response, replayed: true, auditId: undefined }
      }
      if (existing.exists) conflict('LETTER_REQUEST_ALREADY_EXISTS', 'Permohonan surat dengan kunci ini sudah tersimpan.')
      const response: StudentAffairsWriteResult<ActiveStudentLetterRequest> = { value: request, replayed: false }
      transaction.create(ref, request)
      transaction.create(idemRef, idemDocument(hash, response, now))
      return response
    })
    if (result.replayed) return result
  }
  const audit = await appendAudit({ actor: context, action: 'ACTIVE_STUDENT_LETTER_REQUESTED', resourceType: 'active_student_letter_request', resourceId: id, after: { status: request.status, eligibilitySnapshotHash: requestHash(eligibilitySnapshot), version: request.version }, event })
  result.auditId = audit.id
  return result
}

function parseLetterTransition(value: unknown): { targetStatus: 'VERIFIED' | 'REJECTED'; rejectionReason?: string; expectedVersion: number } {
  const body = requireRecord(value)
  rejectUnknown(body, ['targetStatus', 'rejectionReason', 'expectedVersion'])
  const targetStatus = requireString(body.targetStatus, 'targetStatus', { max: 20 })
  if (!LETTER_STATUSES.includes(targetStatus as LetterRequestStatus) || !['VERIFIED', 'REJECTED'].includes(targetStatus)) invalidInput('targetStatus surat harus VERIFIED atau REJECTED.')
  const rejectionReason = optionalString(body.rejectionReason, 'rejectionReason', 500)
  if (targetStatus === 'REJECTED' && !rejectionReason) invalidInput('rejectionReason wajib saat menolak permohonan surat.')
  return { targetStatus: targetStatus as 'VERIFIED' | 'REJECTED', ...(rejectionReason ? { rejectionReason } : {}), expectedVersion: requireInteger(body.expectedVersion, 'expectedVersion', 1) }
}

function transitionedLetterRequest(
  before: ActiveStudentLetterRequest,
  input: ReturnType<typeof parseLetterTransition>,
  actor: AuthContext,
  now: string,
): ActiveStudentLetterRequest {
  if (before.status !== 'SUBMITTED') conflict('INVALID_LETTER_TRANSITION', `Permohonan berstatus ${before.status} tidak dapat diverifikasi ulang.`)
  const base: ActiveStudentLetterRequest = {
    ...before,
    status: input.targetStatus,
    version: before.version + 1,
    updatedAt: now,
    updatedBy: actor.uid,
  }
  if (input.targetStatus === 'VERIFIED') {
    const { rejectionReason: _removed, ...withoutRejection } = base
    return { ...withoutRejection, verifiedAt: now, verifiedBy: actor.uid }
  }
  return { ...base, rejectionReason: input.rejectionReason }
}

export async function transitionLetterRequest(
  context: AuthContext,
  requestId: string,
  value: unknown,
  idempotencyKey: string,
  event?: H3Event,
  clock = new Date(),
): Promise<StudentAffairsWriteResult<ActiveStudentLetterRequest>> {
  const id = safeId(requestId, 'requestId')
  const input = parseLetterTransition(value)
  const hash = requestHash({ id, ...input })
  const namespace = `student-affairs:letter:transition:${context.uid}:${idempotencyKey}`
  const now = clock.toISOString()
  let before: ActiveStudentLetterRequest | undefined
  let result: StudentAffairsWriteResult<ActiveStudentLetterRequest>
  if (dataMode() === 'mock') {
    const replay = mockReplay<ActiveStudentLetterRequest>(namespace, hash)
    if (replay) return replay
    const stored = state.letterRequests.get(id)
    if (!stored) notFound('Permohonan surat aktif')
    before = clone(stored)
    requireStaffManage(context, before.programStudyId)
    if (before.version !== input.expectedVersion) conflict('VERSION_CONFLICT', 'Permohonan surat telah berubah.', { currentVersion: before.version })
    if (input.targetStatus === 'VERIFIED') {
      const eligibility = await evaluateActiveStudentEligibility(before.studentId, clock)
      if (!eligibility.eligible) conflict('ACTIVE_STUDENT_LETTER_INELIGIBLE', 'Kelayakan mahasiswa berubah sebelum verifikasi.', { reasons: eligibility.reasons })
      const current = state.letterRequests.get(id)
      if (!current || current.version !== input.expectedVersion) conflict('VERSION_CONFLICT', 'Permohonan surat telah berubah.', { currentVersion: current?.version })
      before = clone(current)
    }
    const after = transitionedLetterRequest(before, input, context, now)
    state.letterRequests.set(id, clone(after))
    result = { value: after, replayed: false }
    saveMockReplay(namespace, hash, result, now)
  } else {
    const replay = await firebaseReplay<ActiveStudentLetterRequest>(namespace, hash)
    if (replay) return replay
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan surat aktif tidak tersedia.')
    const ref = db.collection('activeStudentLetterRequests').doc(id)
    const idemRef = db.collection('idempotencyKeys').doc(opaqueId('idem', namespace))
    result = await db.runTransaction(async (transaction) => {
      const [previous, snapshot] = await Promise.all([transaction.get(idemRef), transaction.get(ref)])
      if (previous.exists) {
        const data = previous.data() as IdempotencyRecord<ActiveStudentLetterRequest>
        if (data.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk payload berbeda.')
        return { ...data.response, replayed: true, auditId: undefined }
      }
      if (!snapshot.exists) notFound('Permohonan surat aktif')
      before = { id: snapshot.id, ...snapshot.data() } as ActiveStudentLetterRequest
      requireStaffManage(context, before.programStudyId)
      if (before.version !== input.expectedVersion) conflict('VERSION_CONFLICT', 'Permohonan surat telah berubah.', { currentVersion: before.version })
      if (input.targetStatus === 'VERIFIED') {
        const profileRef = db.collection('studentAffairsProfiles').doc(before.studentId)
        const casesQuery = db.collection('studentCases').where('studentId', '==', before.studentId)
        const [profileSnapshot, casesSnapshot] = await Promise.all([transaction.get(profileRef), transaction.get(casesQuery)])
        if (!profileSnapshot.exists) notFound('Profil mahasiswa')
        const profile = { studentId: profileSnapshot.id, ...profileSnapshot.data() } as StudentAffairsProfile
        const cases = casesSnapshot.docs.map((document) => ({ id: document.id, ...document.data() }) as StudentViolationCase)
        const eligibility = activeStudentEligibilityFrom(profile, cases, clock)
        if (!eligibility.eligible) conflict('ACTIVE_STUDENT_LETTER_INELIGIBLE', 'Kelayakan mahasiswa berubah sebelum verifikasi.', { reasons: eligibility.reasons })
      }
      const after = transitionedLetterRequest(before, input, context, now)
      const response: StudentAffairsWriteResult<ActiveStudentLetterRequest> = { value: after, replayed: false }
      transaction.update(ref, after)
      transaction.create(idemRef, idemDocument(hash, response, now))
      return response
    })
    if (result.replayed) return result
  }
  if (!before) serviceUnavailable('State permohonan surat tidak tersedia.')
  const audit = await appendAudit({ actor: context, action: input.targetStatus === 'VERIFIED' ? 'ACTIVE_STUDENT_LETTER_VERIFIED' : 'ACTIVE_STUDENT_LETTER_REJECTED', resourceType: 'active_student_letter_request', resourceId: id, before: { status: before.status, version: before.version }, after: { status: result.value.status, version: result.value.version, rejectionReason: result.value.rejectionReason }, event })
  result.auditId = audit.id
  return result
}

function parseLetterIssuance(value: unknown): { expectedVersion: number; file: EvidenceFileReference } {
  const body = requireRecord(value)
  rejectUnknown(body, ['expectedVersion', 'file'])
  const file = parseEvidence([body.file], 'file', 1, 1)[0]!
  if (!file.checksumSha256) invalidInput('file.checksumSha256 wajib untuk menjamin integritas surat.')
  return { expectedVersion: requireInteger(body.expectedVersion, 'expectedVersion', 1), file }
}

function letterVerificationNumber(year: number, sequence: number): string {
  return `SKA/${year}/${String(sequence).padStart(6, '0')}`
}

function jakartaCalendarYear(clock: Date): number {
  return Number(new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: 'Asia/Jakarta' }).format(clock))
}

function buildLetterIssuance(
  request: ActiveStudentLetterRequest,
  eligibilitySnapshot: ActiveStudentEligibilitySnapshot,
  file: EvidenceFileReference,
  sequence: number,
  context: AuthContext,
  clock: Date,
): ActiveStudentLetterIssuance {
  const issuedAt = clock.toISOString()
  const id = opaqueId('letter_issuance', request.id)
  const verificationNumber = letterVerificationNumber(jakartaCalendarYear(clock), sequence)
  const immutableRecord = {
    id,
    requestId: request.id,
    studentId: request.studentId,
    programStudyId: request.programStudyId,
    verificationNumber,
    eligibilitySnapshot,
    purpose: request.purpose,
    file,
    issuedAt,
    issuedBy: context.uid,
    immutable: true as const,
  }
  return { ...immutableRecord, recordHash: requestHash(immutableRecord) }
}

export async function issueActiveStudentLetter(
  context: AuthContext,
  requestId: string,
  value: unknown,
  idempotencyKey: string,
  event?: H3Event,
  clock = new Date(),
): Promise<StudentAffairsWriteResult<ActiveStudentLetterIssuance>> {
  const id = safeId(requestId, 'requestId')
  const input = parseLetterIssuance(value)
  const hash = requestHash({ id, ...input })
  const namespace = `student-affairs:letter:issue:${context.uid}:${idempotencyKey}`
  const now = clock.toISOString()
  const year = jakartaCalendarYear(clock)
  const issuanceId = opaqueId('letter_issuance', id)
  let before: ActiveStudentLetterRequest | undefined
  let result: StudentAffairsWriteResult<ActiveStudentLetterIssuance>
  if (dataMode() === 'mock') {
    const replay = mockReplay<ActiveStudentLetterIssuance>(namespace, hash)
    if (replay) return replay
    const stored = state.letterRequests.get(id)
    if (!stored) notFound('Permohonan surat aktif')
    before = clone(stored)
    requireStaffManage(context, before.programStudyId)
    if (before.status !== 'VERIFIED') conflict('LETTER_NOT_VERIFIED', 'Permohonan surat harus berstatus VERIFIED sebelum diterbitkan.')
    if (before.version !== input.expectedVersion) conflict('VERSION_CONFLICT', 'Permohonan surat telah berubah.', { currentVersion: before.version })
    if (state.letterIssuances.has(issuanceId)) conflict('LETTER_ALREADY_ISSUED', 'Surat aktif telah diterbitkan.')
    const eligibilitySnapshot = await evaluateActiveStudentEligibility(before.studentId, clock)
    if (!eligibilitySnapshot.eligible) conflict('ACTIVE_STUDENT_LETTER_INELIGIBLE', 'Kelayakan mahasiswa berubah sebelum penerbitan.', { reasons: eligibilitySnapshot.reasons })
    const current = state.letterRequests.get(id)
    if (!current || current.status !== 'VERIFIED' || current.version !== input.expectedVersion || state.letterIssuances.has(issuanceId)) {
      conflict('VERSION_CONFLICT', 'Permohonan surat telah berubah selama penerbitan.', { currentVersion: current?.version })
    }
    before = clone(current)
    const sequence = (state.letterCounters.get(year) ?? 0) + 1
    const issuance = buildLetterIssuance(before, eligibilitySnapshot, input.file, sequence, context, clock)
    const updatedRequest: ActiveStudentLetterRequest = { ...before, status: 'ISSUED', issuedAt: now, issuanceId: issuance.id, version: before.version + 1, updatedAt: now, updatedBy: context.uid }
    state.letterCounters.set(year, sequence)
    state.letterIssuances.set(issuance.id, clone(issuance))
    state.letterRequests.set(id, clone(updatedRequest))
    result = { value: issuance, replayed: false }
    saveMockReplay(namespace, hash, result, now)
  } else {
    const replay = await firebaseReplay<ActiveStudentLetterIssuance>(namespace, hash)
    if (replay) return replay
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan surat aktif tidak tersedia.')
    const requestRef = db.collection('activeStudentLetterRequests').doc(id)
    const issuanceRef = db.collection('activeStudentLetterIssuances').doc(issuanceId)
    const counterRef = db.collection('studentAffairsCounters').doc(`active-student-letter-${year}`)
    const idemRef = db.collection('idempotencyKeys').doc(opaqueId('idem', namespace))
    result = await db.runTransaction(async (transaction) => {
      const [previous, requestSnapshot, existingIssuance, counterSnapshot] = await Promise.all([
        transaction.get(idemRef), transaction.get(requestRef), transaction.get(issuanceRef), transaction.get(counterRef),
      ])
      if (previous.exists) {
        const data = previous.data() as IdempotencyRecord<ActiveStudentLetterIssuance>
        if (data.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk payload berbeda.')
        return { ...data.response, replayed: true, auditId: undefined }
      }
      if (!requestSnapshot.exists) notFound('Permohonan surat aktif')
      before = { id: requestSnapshot.id, ...requestSnapshot.data() } as ActiveStudentLetterRequest
      requireStaffManage(context, before.programStudyId)
      if (before.status !== 'VERIFIED') conflict('LETTER_NOT_VERIFIED', 'Permohonan surat harus berstatus VERIFIED sebelum diterbitkan.')
      if (before.version !== input.expectedVersion) conflict('VERSION_CONFLICT', 'Permohonan surat telah berubah.', { currentVersion: before.version })
      if (existingIssuance.exists) conflict('LETTER_ALREADY_ISSUED', 'Surat aktif telah diterbitkan.')
      const profileRef = db.collection('studentAffairsProfiles').doc(before.studentId)
      const casesQuery = db.collection('studentCases').where('studentId', '==', before.studentId)
      const [profileSnapshot, casesSnapshot] = await Promise.all([transaction.get(profileRef), transaction.get(casesQuery)])
      if (!profileSnapshot.exists) notFound('Profil mahasiswa')
      const profile = { studentId: profileSnapshot.id, ...profileSnapshot.data() } as StudentAffairsProfile
      const cases = casesSnapshot.docs.map((document) => ({ id: document.id, ...document.data() }) as StudentViolationCase)
      const eligibilitySnapshot = activeStudentEligibilityFrom(profile, cases, clock)
      if (!eligibilitySnapshot.eligible) conflict('ACTIVE_STUDENT_LETTER_INELIGIBLE', 'Kelayakan mahasiswa berubah sebelum penerbitan.', { reasons: eligibilitySnapshot.reasons })
      const lastSequence = counterSnapshot.exists ? Number(counterSnapshot.data()?.lastSequence ?? 0) : 0
      if (!Number.isSafeInteger(lastSequence) || lastSequence < 0) serviceUnavailable('Counter nomor surat tidak valid.')
      const sequence = lastSequence + 1
      const issuance = buildLetterIssuance(before, eligibilitySnapshot, input.file, sequence, context, clock)
      const updatedRequest: ActiveStudentLetterRequest = { ...before, status: 'ISSUED', issuedAt: now, issuanceId: issuance.id, version: before.version + 1, updatedAt: now, updatedBy: context.uid }
      const response: StudentAffairsWriteResult<ActiveStudentLetterIssuance> = { value: issuance, replayed: false }
      transaction.set(counterRef, { key: 'active-student-letter', year, lastSequence: sequence, updatedAt: now, updatedBy: context.uid })
      transaction.create(issuanceRef, issuance)
      transaction.update(requestRef, updatedRequest)
      transaction.create(idemRef, idemDocument(hash, response, now))
      return response
    })
    if (result.replayed) return result
  }
  if (!before) serviceUnavailable('State permohonan surat tidak tersedia.')
  const audit = await appendAudit({ actor: context, action: 'ACTIVE_STUDENT_LETTER_ISSUED', resourceType: 'active_student_letter_issuance', resourceId: result.value.id, before: { requestStatus: before.status, requestVersion: before.version }, after: { requestId: id, verificationNumber: result.value.verificationNumber, recordHash: result.value.recordHash, fileId: result.value.file.fileId }, event })
  result.auditId = audit.id
  return result
}

export async function getLetterDownloadReference(context: AuthContext, requestId: string): Promise<ActiveStudentLetterIssuance> {
  const id = safeId(requestId, 'requestId')
  let request: ActiveStudentLetterRequest | undefined
  let issuance: ActiveStudentLetterIssuance | undefined
  if (dataMode() === 'mock') {
    request = state.letterRequests.get(id)
    if (request?.issuanceId) issuance = state.letterIssuances.get(request.issuanceId)
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan surat aktif tidak tersedia.')
    const requestSnapshot = await db.collection('activeStudentLetterRequests').doc(id).get()
    if (requestSnapshot.exists) request = { id: requestSnapshot.id, ...requestSnapshot.data() } as ActiveStudentLetterRequest
    if (request?.issuanceId) {
      const issuanceSnapshot = await db.collection('activeStudentLetterIssuances').doc(request.issuanceId).get()
      if (issuanceSnapshot.exists) issuance = { id: issuanceSnapshot.id, ...issuanceSnapshot.data() } as ActiveStudentLetterIssuance
    }
  }
  if (!request) notFound('Permohonan surat aktif')
  requireProfileRead(context, await loadProfile(request.studentId))
  if (request.status !== 'ISSUED' || !issuance) notFound('Surat aktif terbit')
  return clone(issuance)
}

export function resetStudentAffairsStateForTests(): void {
  state = initialState()
}

export function studentAffairsStateForTests(): StudentAffairsMockState {
  return clone(state)
}
