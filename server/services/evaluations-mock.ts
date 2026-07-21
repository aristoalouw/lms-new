import type {
  AnonymousEvaluationResponse,
  EvaluationEnrollment,
  EvaluationFormRecord,
  EvaluationFormVersion,
  EvaluationPeriodRecord,
  EvaluationRespondentIdentity,
  EvaluationSubmissionReceipt,
} from '../types/evaluations'

interface EvaluationIdempotencyEntry<T = unknown> {
  requestHash: string
  response: T
  createdAt: string
}

export interface EvaluationMockState {
  forms: Map<string, EvaluationFormRecord>
  formVersions: Map<string, EvaluationFormVersion>
  periods: Map<string, EvaluationPeriodRecord>
  enrollments: Map<string, EvaluationEnrollment>
  responses: Map<string, AnonymousEvaluationResponse>
  respondentIdentities: Map<string, EvaluationRespondentIdentity>
  idempotency: Map<string, EvaluationIdempotencyEntry>
}

const demoForm: EvaluationFormRecord = {
  id: 'evalform_111111111111111111111111',
  name: 'Evaluasi Pembelajaran Semester',
  description: 'Umpan balik terstruktur untuk peningkatan mutu pembelajaran.',
  programStudyId: 'management-s1',
  currentVersion: 1,
  nextVersion: 2,
  version: 1,
  status: 'ACTIVE',
  createdAt: '2026-06-15T02:00:00.000Z',
  createdBy: 'academic-001',
  updatedAt: '2026-06-15T02:00:00.000Z',
  updatedBy: 'academic-001',
}

const demoFormVersion: EvaluationFormVersion = {
  id: `${demoForm.id}_v1`,
  formId: demoForm.id,
  version: 1,
  name: demoForm.name,
  description: demoForm.description,
  programStudyId: demoForm.programStudyId,
  questions: [
    { id: 'clarity', label: 'Dosen menyampaikan materi secara jelas dan terstruktur.', type: 'LIKERT_1_5', required: true },
    { id: 'feedback', label: 'Dosen memberikan umpan balik yang membantu proses belajar.', type: 'LIKERT_1_5', required: true },
    { id: 'fairness', label: 'Penilaian dilakukan secara transparan dan adil.', type: 'LIKERT_1_5', required: true },
    { id: 'recommendation', label: 'Saya merekomendasikan pendekatan pembelajaran pada kelas ini.', type: 'BOOLEAN', required: true },
    { id: 'comment', label: 'Saran perbaikan untuk pembelajaran berikutnya.', type: 'TEXT', required: false, helpText: 'Maksimal 1.000 karakter. Jangan cantumkan data pribadi.' },
  ],
  createdAt: demoForm.createdAt,
  createdBy: demoForm.createdBy,
}

const demoPeriod: EvaluationPeriodRecord = {
  id: 'evalperiod_111111111111111111111111',
  name: 'Evaluasi Genap 2025/2026',
  academicPeriodId: '2025-2026-2',
  programStudyId: 'management-s1',
  formId: demoForm.id,
  formVersion: 1,
  opensAt: '2026-07-01T00:00:00.000Z',
  closesAt: '2026-08-31T16:59:59.000Z',
  minimumResponses: 3,
  version: 1,
  createdAt: '2026-06-20T03:00:00.000Z',
  createdBy: 'academic-001',
  updatedAt: '2026-06-20T03:00:00.000Z',
  updatedBy: 'academic-001',
}

const demoEnrollment: EvaluationEnrollment = {
  id: 'enrollment-mgt401-b-student-001',
  studentUid: 'student-001',
  studentId: 'student-001',
  lecturerId: 'advisor-001',
  lecturerName: 'Dr. Budi Santoso',
  courseId: 'course-mgt401',
  courseCode: 'MGT401',
  courseName: 'Manajemen Strategik',
  classId: 'class-mgt401-b',
  className: 'MGT401-B',
  programStudyId: 'management-s1',
  academicPeriodId: '2025-2026-2',
  status: 'ENROLLED',
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function initialState(seedDemo: boolean): EvaluationMockState {
  return {
    forms: new Map(seedDemo ? [[demoForm.id, clone(demoForm)]] : []),
    formVersions: new Map(seedDemo ? [[demoFormVersion.id, clone(demoFormVersion)]] : []),
    periods: new Map(seedDemo ? [[demoPeriod.id, clone(demoPeriod)]] : []),
    enrollments: new Map(seedDemo ? [[demoEnrollment.id, clone(demoEnrollment)]] : []),
    responses: new Map(),
    respondentIdentities: new Map(),
    idempotency: new Map<string, EvaluationIdempotencyEntry<EvaluationSubmissionReceipt>>(),
  }
}

let state = initialState(true)

export function evaluationMockState(): EvaluationMockState {
  return state
}

export function resetEvaluationMockState(options: { seedDemo?: boolean } = {}): void {
  state = initialState(options.seedDemo !== false)
}

export function seedEvaluationEnrollmentForTests(enrollment: EvaluationEnrollment): void {
  state.enrollments.set(enrollment.id, clone(enrollment))
}

export function cloneEvaluationValue<T>(value: T): T {
  return clone(value)
}
