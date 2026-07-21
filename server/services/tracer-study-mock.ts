import type {
  TracerAlumniProfile,
  TracerCampaign,
  TracerConsentRecord,
  TracerDeliveryRecord,
  TracerDistributionPeriod,
  TracerOpaqueTokenRecord,
  TracerQuestionnaire,
  TracerQuestionnaireVersion,
  TracerRecipient,
  TracerResponse,
} from '../types/tracer-study'

interface TracerIdempotencyEntry {
  requestHash: string
  response: unknown
}

export interface TracerStudyMockState {
  questionnaires: Map<string, TracerQuestionnaire>
  questionnaireVersions: Map<string, TracerQuestionnaireVersion>
  periods: Map<string, TracerDistributionPeriod>
  alumniProfiles: Map<string, TracerAlumniProfile>
  recipients: Map<string, TracerRecipient>
  tokens: Map<string, TracerOpaqueTokenRecord>
  responses: Map<string, TracerResponse>
  consents: Map<string, TracerConsentRecord>
  campaigns: Map<string, TracerCampaign>
  deliveries: Map<string, TracerDeliveryRecord>
  idempotency: Map<string, TracerIdempotencyEntry>
}

const demoQuestionnaire: TracerQuestionnaire = {
  id: 'tracer-questionnaire-career-2026',
  name: 'Tracer Study Lulusan 2026',
  description: 'Kuesioner outcome pekerjaan, kewirausahaan, dan studi lanjut alumni.',
  programStudyId: 'management-s1',
  currentVersion: 1,
  version: 1,
  status: 'ACTIVE',
  createdAt: '2026-06-15T02:00:00.000Z',
  createdBy: 'student-affairs-001',
  updatedAt: '2026-06-15T02:00:00.000Z',
  updatedBy: 'student-affairs-001',
}

const demoDefinition: TracerQuestionnaireVersion = {
  id: `${demoQuestionnaire.id}_v1`,
  questionnaireId: demoQuestionnaire.id,
  version: 1,
  name: demoQuestionnaire.name,
  description: demoQuestionnaire.description,
  questions: [
    { id: 'competency_fit', label: 'Seberapa sesuai kompetensi kuliah dengan pekerjaan atau kegiatan Anda?', type: 'SINGLE_CHOICE', required: true, options: [
      { value: 'VERY_LOW', label: 'Sangat rendah' }, { value: 'LOW', label: 'Rendah' }, { value: 'MEDIUM', label: 'Sedang' }, { value: 'HIGH', label: 'Tinggi' }, { value: 'VERY_HIGH', label: 'Sangat tinggi' },
    ] },
    { id: 'career_note', label: 'Catatan karier yang ingin disampaikan kepada kampus', type: 'TEXT', required: false },
  ],
  createdAt: demoQuestionnaire.createdAt,
  createdBy: demoQuestionnaire.createdBy,
}

const demoPeriod: TracerDistributionPeriod = {
  id: 'tracer-period-2026',
  name: 'Tracer Study Lulusan 2024-2025',
  questionnaireId: demoQuestionnaire.id,
  questionnaireVersion: 1,
  programStudyIds: ['management-s1'],
  graduationYearFrom: 2024,
  graduationYearTo: 2025,
  opensAt: '2026-07-01T00:00:00.000Z',
  closesAt: '2026-09-30T16:59:59.000Z',
  status: 'ACTIVE',
  accessTokenTtlHours: 168,
  minimumCellSize: 3,
  consentVersion: 'TRACER-CONSENT-2026-01',
  consentNotice: 'Saya bersedia memberikan data outcome karier untuk statistik agregat kampus. Saya dapat menarik persetujuan dan data saya tidak lagi disertakan dalam pelaporan.',
  version: 1,
  createdAt: '2026-06-15T02:30:00.000Z',
  createdBy: 'student-affairs-001',
  updatedAt: '2026-06-15T02:30:00.000Z',
  updatedBy: 'student-affairs-001',
}

const demoAlumni: TracerAlumniProfile[] = [
  { id: 'alumni-001', userUid: 'student-001', studentId: 'student-001', studentNumber: '23011001', displayName: 'Nabila Putri', email: 'nabila.alumni@example.test', programStudyId: 'management-s1', programStudyName: 'S1 Manajemen', graduationYear: 2025, graduatedAt: '2025-08-28T00:00:00.000Z', contactable: true },
  { id: 'alumni-002', studentId: 'student-102', studentNumber: '21011022', displayName: 'Bagas Pratama', email: 'bagas.alumni@example.test', programStudyId: 'management-s1', programStudyName: 'S1 Manajemen', graduationYear: 2024, graduatedAt: '2024-08-30T00:00:00.000Z', contactable: true },
  { id: 'alumni-003', studentId: 'student-103', studentNumber: '21011031', displayName: 'Fira Amalia', email: 'fira.alumni@example.test', programStudyId: 'management-s1', programStudyName: 'S1 Manajemen', graduationYear: 2024, graduatedAt: '2024-08-30T00:00:00.000Z', contactable: true },
  { id: 'alumni-004', studentId: 'student-104', studentNumber: '21011044', displayName: 'Rizky Ananda', email: 'rizky.alumni@example.test', programStudyId: 'management-s1', programStudyName: 'S1 Manajemen', graduationYear: 2024, graduatedAt: '2024-08-30T00:00:00.000Z', contactable: true },
]

function initialState(seedDemo: boolean): TracerStudyMockState {
  return {
    questionnaires: new Map(seedDemo ? [[demoQuestionnaire.id, structuredClone(demoQuestionnaire)]] : []),
    questionnaireVersions: new Map(seedDemo ? [[demoDefinition.id, structuredClone(demoDefinition)]] : []),
    periods: new Map(seedDemo ? [[demoPeriod.id, structuredClone(demoPeriod)]] : []),
    alumniProfiles: new Map(seedDemo ? demoAlumni.map(item => [item.id, structuredClone(item)]) : []),
    recipients: new Map(), tokens: new Map(), responses: new Map(), consents: new Map(), campaigns: new Map(), deliveries: new Map(), idempotency: new Map(),
  }
}

let state = initialState(true)

export function tracerStudyMockState(): TracerStudyMockState {
  return state
}

export function resetTracerStudyMockState(options: { seedDemo?: boolean } = {}): void {
  state = initialState(options.seedDemo !== false)
}

export function seedTracerAlumniForTests(profile: TracerAlumniProfile): void {
  state.alumniProfiles.set(profile.id, structuredClone(profile))
}

export function seedTracerPeriodForTests(period: TracerDistributionPeriod): void {
  state.periods.set(period.id, structuredClone(period))
}
