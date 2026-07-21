import type { PddiktiEntityType } from '../types/domain'
import type {
  PddiktiBatchResultHistory,
  PddiktiEntityMapping,
  PddiktiJobPayloadSnapshot,
  PddiktiMappingDefinition,
  PddiktiReconciliation,
  PddiktiRemoteRecord,
  PddiktiSourceRecord,
  PddiktiStudentDataChangeRequest,
  PddiktiWorkerRun,
} from '../types/pddikti'

export const DEFAULT_PDDIKTI_CONTRACT_VERSION = 'campus-pddikti-gateway/2026-01'

interface IdempotencyEntry {
  requestHash: string
  response: unknown
}

export interface PddiktiModuleState {
  sourceRecords: Map<string, PddiktiSourceRecord>
  mappingDefinitions: Map<string, PddiktiMappingDefinition>
  entityMappings: Map<string, PddiktiEntityMapping>
  jobPayloads: Map<string, PddiktiJobPayloadSnapshot>
  batchResults: Map<string, PddiktiBatchResultHistory>
  remoteSnapshots: Map<string, PddiktiRemoteRecord[]>
  reconciliations: Map<string, PddiktiReconciliation>
  workerRuns: Map<string, PddiktiWorkerRun>
  idempotency: Map<string, IdempotencyEntry>
  studentDataChanges: Map<string, PddiktiStudentDataChangeRequest>
}

export function sourceRecordKey(entityType: PddiktiEntityType, id: string): string {
  return `${entityType}:${id}`
}

export function remoteSnapshotKey(entityType: PddiktiEntityType, programStudyId: string, periodId: string): string {
  return `${entityType}:${programStudyId}:${periodId}`
}

function record(
  entityType: PddiktiEntityType,
  id: string,
  data: PddiktiSourceRecord['data'],
  options: Partial<Pick<PddiktiSourceRecord, 'programStudyId' | 'periodId' | 'eligible' | 'blockers' | 'version'>> = {},
): PddiktiSourceRecord {
  return {
    id,
    entityType,
    programStudyId: options.programStudyId ?? 'management-s1',
    periodId: options.periodId ?? '2025-2026-2',
    version: options.version ?? 1,
    eligible: options.eligible ?? true,
    blockers: options.blockers ?? [],
    data,
    updatedAt: '2026-07-21T00:00:00.000Z',
  }
}

const sourceRecords: PddiktiSourceRecord[] = [
  record('grade', 'grade-101', { studentNumber: '23011001', courseCode: 'MN401', classCode: 'MN-4A', finalGrade: 86, letterGrade: 'A' }, { version: 4 }),
  record('grade', 'grade-102', { studentNumber: '23011002', courseCode: 'MN401', classCode: 'MN-4A', finalGrade: 78, letterGrade: 'B+' }, { version: 3 }),
  record('grade', 'grade-001', { studentNumber: '23011003', courseCode: 'MN201', classCode: 'MN-2A', finalGrade: 82, letterGrade: 'A-' }),
  record('grade', 'grade-002', { studentNumber: '23011004', courseCode: 'MN201', classCode: 'MN-2A', finalGrade: 75, letterGrade: 'B+' }),
  record('grade', 'grade-003', { studentNumber: '23011005', courseCode: 'MN201', classCode: 'MN-2A', finalGrade: 70, letterGrade: 'B' }),
  record('grade', 'grade-blocked-001', { studentNumber: '23011006', courseCode: 'MN401', classCode: 'MN-4A', finalGrade: null, letterGrade: null }, {
    eligible: false,
    blockers: [{ code: 'FINAL_GRADE_MISSING', field: 'finalGrade', message: 'Nilai akhir belum diterbitkan.' }],
  }),
  record('student', 'student-009', { studentNumber: '23011009', name: 'Mahasiswa Sembilan', status: 'ACTIVE', cohortYear: 2023 }),
  record('student', 'student-001', { studentNumber: '23011001', name: 'Nabila Putri', status: 'ACTIVE', cohortYear: 2023 }, { version: 7 }),
  record('lecturer', 'lecturer-001', { lecturerNumber: 'D-001', name: 'Arif Nugroho', status: 'ACTIVE' }),
  record('course', 'course-mn401', { courseCode: 'MN401', name: 'Manajemen Strategik', credits: 3 }),
  record('class', 'class-mn401-a', { classCode: 'MN-4A', courseCode: 'MN401', capacity: 40, meetingCount: 16 }),
  record('student_activity', 'activity-001', { studentNumber: '23011001', activityType: 'THESIS', status: 'COMPLETED' }),
  record('graduation', 'graduation-001', { studentNumber: '23011001', decreeNumber: 'SK-YUD/MANAGEMENT-S1/2026/00001', graduationDate: '2026-10-17' }),
]

const mappingFields: Record<PddiktiEntityType, string[]> = {
  student: ['studentNumber', 'name', 'status', 'cohortYear'],
  lecturer: ['lecturerNumber', 'name', 'status'],
  course: ['courseCode', 'name', 'credits'],
  class: ['classCode', 'courseCode', 'capacity', 'meetingCount'],
  grade: ['studentNumber', 'courseCode', 'classCode', 'finalGrade', 'letterGrade'],
  student_activity: ['studentNumber', 'activityType', 'status'],
  graduation: ['studentNumber', 'decreeNumber', 'graduationDate'],
}

function mapping(entityType: PddiktiEntityType): PddiktiMappingDefinition {
  const fields = mappingFields[entityType]
  return {
    entityType,
    version: `${entityType}-mapping-v1`,
    contractVersion: DEFAULT_PDDIKTI_CONTRACT_VERSION,
    requiredInternalFields: [...fields],
    fieldMap: Object.fromEntries(fields.map(field => [field, field])),
    active: true,
    createdAt: '2026-07-01T00:00:00.000Z',
  }
}

function initialState(): PddiktiModuleState {
  const definitions = (Object.keys(mappingFields) as PddiktiEntityType[]).map(mapping)
  const remoteGrades: PddiktiRemoteRecord[] = [
    { remoteId: 'remote-grade-101', internalId: 'grade-101', remoteVersion: '12', fields: { studentNumber: '23011001', courseCode: 'MN401', classCode: 'MN-4A', finalGrade: 86, letterGrade: 'A' } },
    { remoteId: 'remote-grade-102', internalId: 'grade-102', remoteVersion: '8', fields: { studentNumber: '23011002', courseCode: 'MN401', classCode: 'MN-4A', finalGrade: 74, letterGrade: 'B' } },
    { remoteId: 'remote-grade-orphan', internalId: 'grade-remote-only', remoteVersion: '2', fields: { studentNumber: '23011999', courseCode: 'MN401', classCode: 'MN-4A', finalGrade: 80, letterGrade: 'A-' } },
  ]
  return {
    sourceRecords: new Map(sourceRecords.map(item => [sourceRecordKey(item.entityType, item.id), structuredClone(item)])),
    mappingDefinitions: new Map(definitions.map(item => [`${item.entityType}:${item.version}`, structuredClone(item)])),
    entityMappings: new Map(),
    jobPayloads: new Map(),
    batchResults: new Map(),
    remoteSnapshots: new Map([[remoteSnapshotKey('grade', 'management-s1', '2025-2026-2'), remoteGrades]]),
    reconciliations: new Map(),
    workerRuns: new Map(),
    idempotency: new Map(),
    studentDataChanges: new Map(),
  }
}

let state = initialState()

export function pddiktiModuleState(): PddiktiModuleState {
  return state
}

export function resetPddiktiModuleState(): void {
  state = initialState()
}
