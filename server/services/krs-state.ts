import type { AcademicClassRecord, ClassMeetingSchedule } from '../types/academic-classes'
import type { KrsPeriodPolicy, KrsSeatReservation, KrsStudentAcademicState, KrsWriteResult } from '../types/krs-enrollment'

interface KrsIdempotencyRecord {
  requestHash: string
  response: KrsWriteResult
  createdAt: string
}

export interface KrsModuleState {
  periods: Map<string, KrsPeriodPolicy>
  classes: Map<string, AcademicClassRecord>
  students: Map<string, KrsStudentAcademicState>
  reservations: Map<string, KrsSeatReservation>
  idempotency: Map<string, KrsIdempotencyRecord>
}

function weeklyMeetings(startIso: string): ClassMeetingSchedule[] {
  const start = Date.parse(startIso)
  return Array.from({ length: 16 }, (_, index) => {
    const begins = start + index * 7 * 86_400_000
    return {
      meetingNumber: index + 1,
      scheduledStartAt: new Date(begins).toISOString(),
      scheduledEndAt: new Date(begins + 100 * 60_000).toISOString(),
      attendanceOpensAt: new Date(begins - 15 * 60_000).toISOString(),
      attendanceClosesAt: new Date(begins + 115 * 60_000).toISOString(),
    }
  })
}

function seededClass(
  id: string,
  courseCode: string,
  courseName: string,
  credits: number,
  section: string,
  startIso: string,
  options: { capacity?: number; reservedSeatCount?: number; prerequisites?: string[] } = {},
): AcademicClassRecord {
  return {
    id,
    courseCode,
    courseName,
    credits,
    section,
    periodId: '2026-2027-1',
    programStudyId: 'management-s1',
    unitId: 'faculty-economics',
    lecturerIds: ['lecturer-001'],
    lecturerNames: ['Dr. Budi Santoso'],
    timezone: 'Asia/Jakarta',
    status: 'ACTIVE',
    totalScheduledMeetings: 16,
    realizedMeetingCount: 0,
    schedule: weeklyMeetings(startIso),
    rosterStudentIds: [],
    capacity: options.capacity ?? 40,
    reservedSeatCount: options.reservedSeatCount ?? 0,
    prerequisiteCourseCodes: options.prerequisites ?? [],
    gradeConfigVersion: 1,
    gradebookVersion: 0,
    publicationVersion: 0,
    updatedAt: '2026-07-20T00:00:00.000Z',
  }
}

function initialState(): KrsModuleState {
  const classes = [
    seededClass('class-mgt-501-a', 'MGT501', 'Analitik Keputusan', 3, 'A', '2026-08-24T01:00:00.000Z', { prerequisites: ['MGT301'] }),
    seededClass('class-mgt-502-a', 'MGT502', 'Manajemen Risiko', 3, 'A', '2026-08-25T03:00:00.000Z'),
    seededClass('class-mgt-503-a', 'MGT503', 'Strategi Digital', 3, 'A', '2026-08-26T06:00:00.000Z'),
    seededClass('class-mgt-504-a', 'MGT504', 'Seminar Manajemen', 3, 'A', '2026-08-24T01:30:00.000Z'),
    seededClass('class-mgt-505-a', 'MGT505', 'Topik Khusus', 3, 'A', '2026-08-27T01:00:00.000Z', { capacity: 1, reservedSeatCount: 1 }),
  ]
  const students: KrsStudentAcademicState[] = [
    {
      id: 'student-010',
      studentUid: 'student-010',
      studentNumber: '23011010',
      studentName: 'Mahasiswa Uji KRS',
      programStudyId: 'management-s1',
      advisorId: 'advisor-001',
      active: true,
      maximumCredits: 24,
      completedCourseCodes: ['MGT301', 'MGT302'],
      holds: [],
      version: 3,
      updatedAt: '2026-07-20T00:00:00.000Z',
    },
  ]
  return {
    periods: new Map([['2026-2027-1', {
      id: '2026-2027-1', status: 'KRS_OPEN', krsOpensAt: '2026-07-01T00:00:00.000Z',
      krsClosesAt: '2026-08-15T16:59:59.000Z', revisionClosesAt: '2026-08-29T16:59:59.000Z', version: 2,
    }]]),
    classes: new Map(classes.map(record => [record.id, structuredClone(record)])),
    students: new Map(students.map(record => [record.id, structuredClone(record)])),
    reservations: new Map(),
    idempotency: new Map(),
  }
}

let state = initialState()

export function krsModuleState(): KrsModuleState {
  return state
}

export function resetKrsModuleState(): void {
  state = initialState()
}
