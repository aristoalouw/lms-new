import type {
  GraduationApplication,
  GraduationDocumentTemplate,
  GraduationEligibilitySnapshot,
  GraduationParticipant,
  GraduationPeriod,
  IssuedGraduationDocument,
} from '../types/graduation'

export interface GraduationStudent {
  id: string
  userUid: string
  name: string
  studentNumber: string
  programStudyId: string
  programStudyName: string
}

export interface IdempotencyEntry {
  requestHash: string
  response: unknown
}

export interface GraduationModuleState {
  periods: Map<string, GraduationPeriod>
  students: Map<string, GraduationStudent>
  eligibilitySnapshots: Map<string, GraduationEligibilitySnapshot>
  applications: Map<string, GraduationApplication>
  participants: Map<string, GraduationParticipant>
  templates: Map<string, GraduationDocumentTemplate>
  documents: Map<string, IssuedGraduationDocument>
  assignments: Map<string, string>
  counters: Map<string, number>
  idempotency: Map<string, IdempotencyEntry>
}

const requirements = {
  version: 1,
  academic: { minimumCredits: 144, minimumGpa: 2, maximumGradeD: 4, requireNoGradeE: true, requireThesisPassed: true },
  finance: { maximumOutstandingAmount: 0 },
  library: { requireClearance: true, maximumUnreturnedItems: 0 },
  studentAffairs: { minimumPoints: 100, maximumActiveSanctions: 0 },
  effectiveAt: '2026-06-01T00:00:00.000Z',
  updatedBy: 'admin-001',
} as const

const period: GraduationPeriod = {
  id: 'period-yudisium-2026-02', code: 'YUD-2026-02', name: 'Yudisium Semester Genap 2025/2026',
  programStudyIds: ['management-s1', 'informatics-s1'], status: 'OPEN',
  registrationOpensAt: '2026-07-01T00:00:00.000Z', registrationClosesAt: '2026-08-15T16:59:59.000Z',
  yudisiumDate: '2026-08-28', graduationDate: '2026-10-17', version: 1,
  currentRequirements: structuredClone(requirements), requirementHistory: [structuredClone(requirements)],
  createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z',
}

const students: GraduationStudent[] = [
  { id: 'student-001', userUid: 'student-001', name: 'Nabila Putri', studentNumber: '23011001', programStudyId: 'management-s1', programStudyName: 'S1 Manajemen' },
  { id: 'student-002', userUid: 'student-002', name: 'Rafi Ramadhan', studentNumber: '23011002', programStudyId: 'management-s1', programStudyName: 'S1 Manajemen' },
  { id: 'student-003', userUid: 'student-003', name: 'Dimas Nugraha', studentNumber: '23022003', programStudyId: 'informatics-s1', programStudyName: 'S1 Informatika' },
]

const snapshots: GraduationEligibilitySnapshot[] = [
  {
    id: 'eligibility-student-001-v7', studentId: 'student-001', programStudyId: 'management-s1', capturedAt: '2026-07-20T02:00:00.000Z',
    sourceVersions: { academic: 18, finance: 9, library: 4, studentAffairs: 6 },
    academic: { earnedCredits: 146, gpa: 3.61, gradeDCount: 1, gradeECount: 0, thesisPassed: true },
    finance: { outstandingAmount: 0 }, library: { cleared: true, unreturnedItems: 0 }, studentAffairs: { points: 128, activeSanctions: 0 },
  },
  {
    id: 'eligibility-student-002-v5', studentId: 'student-002', programStudyId: 'management-s1', capturedAt: '2026-07-20T02:00:00.000Z',
    sourceVersions: { academic: 16, finance: 8, library: 3, studentAffairs: 5 },
    academic: { earnedCredits: 142, gpa: 3.18, gradeDCount: 2, gradeECount: 0, thesisPassed: true },
    finance: { outstandingAmount: 1_500_000 }, library: { cleared: false, unreturnedItems: 1 }, studentAffairs: { points: 92, activeSanctions: 0 },
  },
  {
    id: 'eligibility-student-003-v4', studentId: 'student-003', programStudyId: 'informatics-s1', capturedAt: '2026-07-20T02:00:00.000Z',
    sourceVersions: { academic: 20, finance: 7, library: 3, studentAffairs: 5 },
    academic: { earnedCredits: 148, gpa: 3.73, gradeDCount: 0, gradeECount: 0, thesisPassed: true },
    finance: { outstandingAmount: 0 }, library: { cleared: true, unreturnedItems: 0 }, studentAffairs: { points: 120, activeSanctions: 0 },
  },
]

const template = (type: GraduationDocumentTemplate['type'], title: string): GraduationDocumentTemplate => ({
  id: `template-${type.toLowerCase()}-default`, type, name: `${title} standar`, version: 1, status: 'ACTIVE',
  layout: {
    title,
    subtitle: 'Universitas Siber Nusantara',
    fields: [
      { key: 'student_name', label: 'Nama', source: 'studentName' },
      { key: 'student_number', label: 'Nomor Induk Mahasiswa', source: 'studentNumber' },
      { key: 'program', label: 'Program Studi', source: 'programStudyName' },
      { key: 'document_number', label: 'Nomor Dokumen', source: 'documentNumber' },
      { key: 'verification', label: 'Kode Verifikasi', source: 'verificationCode' },
    ],
    footerText: 'Dokumen elektronik diverifikasi melalui kode verifikasi resmi kampus.',
  },
  createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z', updatedBy: 'admin-001',
})

function initialState(): GraduationModuleState {
  const templates = [template('DECREE', 'Keputusan Yudisium'), template('DIPLOMA', 'Ijazah'), template('TRANSCRIPT', 'Transkrip Akademik'), template('SKPI', 'Surat Keterangan Pendamping Ijazah')]
  return {
    periods: new Map([[period.id, structuredClone(period)]]),
    students: new Map(students.map(student => [student.id, structuredClone(student)])),
    eligibilitySnapshots: new Map(snapshots.map(snapshot => [snapshot.studentId, structuredClone(snapshot)])),
    applications: new Map(), participants: new Map(),
    templates: new Map(templates.map(item => [item.id, structuredClone(item)])),
    documents: new Map(), assignments: new Map(), counters: new Map(), idempotency: new Map(),
  }
}

let state = initialState()

export function graduationModuleState(): GraduationModuleState {
  return state
}

export function resetGraduationModuleState(): void {
  state = initialState()
}
