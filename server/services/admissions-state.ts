import { DEMO_ADMISSION_PROGRAMS, DEMO_ADMISSION_WAVES } from '../data/admissions-catalog'
import type { AdmissionApplicationRecord, AdmissionDocumentRecord, AdmissionProgram, AdmissionStudentRecord, AdmissionWave } from '../types/admissions'

interface AdmissionIdempotencyEntry<T = unknown> {
  requestHash: string
  response: T
  createdAt: string
}

interface AdmissionModuleState {
  programs: Map<string, AdmissionProgram>
  waves: Map<string, AdmissionWave>
  applications: Map<string, AdmissionApplicationRecord>
  students: Map<string, AdmissionStudentRecord>
  idempotency: Map<string, AdmissionIdempotencyEntry>
  registrationNumbers: Set<string>
  feeReferences: Map<string, string>
  studentSequences: Map<string, number>
  documents: Map<string, AdmissionDocumentRecord>
}

const SEEDED_APPLICATION: AdmissionApplicationRecord = {
  id: 'admission-demo-001',
  registrationNumber: 'PMB-2026-ANISA1',
  applicantUid: 'applicant-001',
  fullName: 'Anisa Rahma',
  email: 'anisa.candidate@example.test',
  phone: '081234567890',
  identityFingerprint: 'seeded-private-fingerprint',
  identityLast4: '4321',
  programStudyId: 'management-s1',
  unitId: 'faculty-economics',
  admissionPathId: 'regular',
  studyModeId: 'hybrid',
  waveId: '2026-wave-3',
  academicYear: '2026/2027',
  priorInstitution: 'SMA Nusantara',
  graduationYear: 2026,
  sourceInformation: 'school-visit',
  consentedAt: '2026-07-15T04:00:00.000Z',
  submittedAt: '2026-07-15T04:00:00.000Z',
  status: 'ACCEPTED',
  registrationFeeStatus: 'PAID',
  registrationFeeAmount: 500_000,
  registrationFeeReference: 'PMB-DEMO-PAYMENT-001',
  reviewedAt: '2026-07-18T03:00:00.000Z',
  reviewedBy: 'admissions-001',
  selectedAt: '2026-07-18T03:00:00.000Z',
  version: 4,
  updatedAt: '2026-07-18T03:00:00.000Z',
  updatedBy: 'admissions-001',
}

function initialState(): AdmissionModuleState {
  return {
    programs: new Map(DEMO_ADMISSION_PROGRAMS.map(program => [program.id, structuredClone(program)])),
    waves: new Map(DEMO_ADMISSION_WAVES.map(wave => [wave.id, structuredClone(wave)])),
    applications: new Map([[SEEDED_APPLICATION.id, structuredClone(SEEDED_APPLICATION)]]),
    students: new Map(),
    idempotency: new Map(),
    registrationNumbers: new Set([SEEDED_APPLICATION.registrationNumber]),
    feeReferences: new Map([[SEEDED_APPLICATION.registrationFeeReference!, SEEDED_APPLICATION.id]]),
    studentSequences: new Map(),
    documents: new Map(),
  }
}

let state = initialState()

export function admissionModuleState(): AdmissionModuleState {
  return state
}

export function resetAdmissionModuleState(): void {
  state = initialState()
}
