import { beforeEach, describe, expect, it } from 'vitest'
import {
  academicClassStateForTests,
  checkInAttendance,
  configureGradeComponents,
  correctAttendance,
  createTeachingJournal,
  enterStudentGrade,
  getAcademicClassDetail,
  getOwnPublishedResult,
  issueAttendanceChallenge,
  listClassAttendancePage,
  listAcademicClasses,
  publishGrades,
  resetAcademicClassStateForTests,
  upsertMockKrsClassEnrollment,
} from '../../server/services/academic-classes'
import { CampusError } from '../../server/utils/errors'
import { mockState, resetMockState } from '../../server/utils/mock-store'
import { authContext } from './fixtures'

const classId = 'class-mgt-401-a'
const advisor = () => authContext('advisor-001', ['lecturer', 'advisor'], ['management-s1'])
const student = (id: string) => {
  const context = authContext(id, ['student'], ['management-s1'])
  context.scope.studentIds = [id]
  return context
}
const scheduledClock = new Date('2026-07-28T03:00:00.000Z')
const scheduledJournal = {
  meetingNumber: 2,
  occurredAt: '2026-07-28T01:05:00.000Z',
  durationMinutes: 100,
  topic: 'Analisis lingkungan dan posisi bersaing',
  deliveryMode: 'ONSITE',
}

describe('academic class scope and teaching journal', () => {
  beforeEach(() => {
    process.env.CAMPUS_DATA_MODE = 'mock'
    resetMockState()
    resetAcademicClassStateForTests()
  })

  it('filters class reads by lecturer assignment, program scope, and roster ownership', async () => {
    expect((await listAcademicClasses(advisor())).map((record) => record.id)).toEqual([classId])
    expect((await listAcademicClasses(authContext('academic-001', ['academic_staff'], ['management-s1']))).map((record) => record.id)).toEqual([classId])
    expect((await listAcademicClasses(student('student-001'))).map((record) => record.id)).toEqual([classId])
    expect((await listAcademicClasses(authContext('lecturer-002', ['lecturer'], ['informatics-s1']))).map((record) => record.id)).toEqual(['class-inf-601-a'])
    expect(await listAcademicClasses(authContext('finance-001', ['finance_staff'], ['management-s1']))).toEqual([])
  })

  it('limits a student detail response to their own roster and attendance rows', async () => {
    const lecturerView = await getAcademicClassDetail(advisor(), classId)
    const studentView = await getAcademicClassDetail(student('student-001'), classId)
    expect(lecturerView.roster).toHaveLength(2)
    expect(lecturerView.grades).toHaveLength(2)
    expect(studentView.roster.map((row) => row.studentId)).toEqual(['student-001'])
    expect(studentView.gradeConfiguration).toBeUndefined()
    expect(studentView.grades).toBeUndefined()
  })

  it('fails closed for a lecturer and staff member outside the class scope', async () => {
    await expect(getAcademicClassDetail(authContext('lecturer-999', ['lecturer'], ['management-s1']), classId))
      .rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' } satisfies Partial<CampusError>)
    await expect(createTeachingJournal(authContext('academic-inf', ['academic_staff'], ['informatics-s1']), classId, scheduledJournal, 'journal-scope-key-0001', undefined, scheduledClock))
      .rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' } satisfies Partial<CampusError>)
  })

  it('records an on-schedule journal once and idempotently replays it', async () => {
    const first = await createTeachingJournal(advisor(), classId, scheduledJournal, 'journal-key-0000001', undefined, scheduledClock)
    const replay = await createTeachingJournal(advisor(), classId, scheduledJournal, 'journal-key-0000001', undefined, scheduledClock)
    expect(first.value).toMatchObject({ meetingNumber: 2, realization: 'ON_SCHEDULE', scheduleVarianceMinutes: 5 })
    expect(replay.replayed).toBe(true)
    expect(replay.value.id).toBe(first.value.id)
    expect(academicClassStateForTests().classes.get(classId)?.realizedMeetingCount).toBe(1)
    expect(mockState().auditEntries.filter((entry) => entry.action === 'TEACHING_JOURNAL_CREATED')).toHaveLength(1)
  })

  it('requires a documented makeup reason outside the scheduled realization window', async () => {
    const late = { ...scheduledJournal, occurredAt: '2026-07-29T01:05:00.000Z' }
    const clock = new Date('2026-07-29T03:00:00.000Z')
    await expect(createTeachingJournal(advisor(), classId, late, 'journal-key-0000002', undefined, clock))
      .rejects.toMatchObject({ statusCode: 400, code: 'INVALID_INPUT' } satisfies Partial<CampusError>)
    const result = await createTeachingJournal(advisor(), classId, {
      ...late,
      makeupReason: 'Kampus ditutup saat jadwal reguler berlangsung.',
    }, 'journal-key-0000003', undefined, clock)
    expect(result.value).toMatchObject({ realization: 'MAKEUP', scheduleVarianceMinutes: 1445 })
  })

  it('rejects duplicate meetings and idempotency-key reuse with another payload', async () => {
    await createTeachingJournal(advisor(), classId, scheduledJournal, 'journal-key-0000004', undefined, scheduledClock)
    await expect(createTeachingJournal(advisor(), classId, { ...scheduledJournal, topic: 'Topik berbeda' }, 'journal-key-0000004', undefined, scheduledClock))
      .rejects.toMatchObject({ statusCode: 409, code: 'IDEMPOTENCY_KEY_REUSED' } satisfies Partial<CampusError>)
    await expect(createTeachingJournal(advisor(), classId, scheduledJournal, 'journal-key-0000005', undefined, scheduledClock))
      .rejects.toMatchObject({ statusCode: 409, code: 'JOURNAL_ALREADY_EXISTS' } satisfies Partial<CampusError>)
  })
})

describe('QR and manual attendance', () => {
  beforeEach(() => {
    process.env.CAMPUS_DATA_MODE = 'mock'
    resetMockState()
    resetAcademicClassStateForTests()
  })

  it('issues a short-lived challenge and consumes it once per roster member', async () => {
    const clock = new Date('2026-07-21T01:05:00.000Z')
    const issued = await issueAttendanceChallenge(advisor(), classId, { meetingNumber: 1, ttlSeconds: 60 }, 'qr-issue-key-00001', undefined, clock)
    const replayedIssue = await issueAttendanceChallenge(advisor(), classId, { meetingNumber: 1, ttlSeconds: 60 }, 'qr-issue-key-00001', undefined, clock)
    expect(replayedIssue.replayed).toBe(true)
    expect(replayedIssue.value.challengeToken).toBe(issued.value.challengeToken)
    expect(Date.parse(issued.value.expiresAt) - clock.getTime()).toBe(60_000)

    const checked = await checkInAttendance(student('student-001'), classId, { challengeToken: issued.value.challengeToken }, 'qr-checkin-key-001', undefined, clock)
    const transportReplay = await checkInAttendance(student('student-001'), classId, { challengeToken: issued.value.challengeToken }, 'qr-checkin-key-001', undefined, clock)
    expect(checked.value).toMatchObject({ studentId: 'student-001', status: 'PRESENT', source: 'QR', version: 1 })
    expect(transportReplay.replayed).toBe(true)

    await expect(checkInAttendance(student('student-001'), classId, { challengeToken: issued.value.challengeToken }, 'qr-checkin-key-002', undefined, clock))
      .rejects.toMatchObject({ statusCode: 409, code: 'ATTENDANCE_NONCE_REPLAYED' } satisfies Partial<CampusError>)
    const secondStudent = await checkInAttendance(student('student-002'), classId, { challengeToken: issued.value.challengeToken }, 'qr-checkin-key-003', undefined, clock)
    expect(secondStudent.value.studentId).toBe('student-002')
  })

  it('rejects expired, cross-class, and non-roster QR check-ins', async () => {
    const clock = new Date('2026-07-21T01:05:00.000Z')
    const issued = await issueAttendanceChallenge(advisor(), classId, { meetingNumber: 1, ttlSeconds: 30 }, 'qr-issue-key-00002', undefined, clock)
    await expect(checkInAttendance(student('student-001'), classId, { challengeToken: issued.value.challengeToken }, 'qr-checkin-key-004', undefined, new Date('2026-07-21T01:05:31.000Z')))
      .rejects.toMatchObject({ statusCode: 409, code: 'ATTENDANCE_CHALLENGE_EXPIRED' } satisfies Partial<CampusError>)
    await expect(checkInAttendance(student('student-003'), 'class-inf-601-a', { challengeToken: issued.value.challengeToken }, 'qr-checkin-key-005', undefined, new Date('2026-07-21T03:05:00.000Z')))
      .rejects.toMatchObject({ statusCode: 409, code: 'INVALID_ATTENDANCE_CHALLENGE' } satisfies Partial<CampusError>)
    await expect(checkInAttendance(student('student-999'), classId, { challengeToken: issued.value.challengeToken }, 'qr-checkin-key-006', undefined, clock))
      .rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' } satisfies Partial<CampusError>)
  })

  it('requires an explicit reason and optimistic version for manual correction', async () => {
    await expect(correctAttendance(advisor(), classId, {
      meetingNumber: 1, studentId: 'student-001', status: 'EXCUSED', reason: 'singkat', expectedVersion: 0,
    }, 'manual-attendance-001'))
      .rejects.toMatchObject({ statusCode: 400, code: 'INVALID_INPUT' } satisfies Partial<CampusError>)

    const corrected = await correctAttendance(advisor(), classId, {
      meetingNumber: 1,
      studentId: 'student-001',
      status: 'EXCUSED',
      reason: 'Surat keterangan sakit telah diverifikasi.',
      expectedVersion: 0,
    }, 'manual-attendance-002')
    expect(corrected.value).toMatchObject({ status: 'EXCUSED', source: 'MANUAL', version: 1 })
    expect(mockState().auditEntries[0]).toMatchObject({ action: 'ATTENDANCE_MANUALLY_CORRECTED' })

    await expect(correctAttendance(advisor(), classId, {
      meetingNumber: 1,
      studentId: 'student-001',
      status: 'PRESENT',
      reason: 'Koreksi lanjutan dengan bukti yang sesuai.',
      expectedVersion: 0,
    }, 'manual-attendance-003')).rejects.toMatchObject({ statusCode: 409, code: 'VERSION_CONFLICT' } satisfies Partial<CampusError>)

    await expect(correctAttendance(authContext('academic-inf', ['academic_staff'], ['informatics-s1']), classId, {
      meetingNumber: 1,
      studentId: 'student-002',
      status: 'PRESENT',
      reason: 'Koreksi dari unit yang tidak memiliki lingkup.',
      expectedVersion: 0,
    }, 'manual-attendance-004')).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' } satisfies Partial<CampusError>)
  })

  it('paginates a lecturer meeting roster and limits students to their own history', async () => {
    for (let index = 1; index <= 51; index += 1) {
      const studentId = `history-student-${String(index).padStart(3, '0')}`
      upsertMockKrsClassEnrollment({
        classId,
        studentId,
        studentUid: studentId,
        studentNumber: `H${String(index).padStart(4, '0')}`,
        studentName: `Mahasiswa Histori ${index}`,
        programStudyId: 'management-s1',
        periodId: '2025-2026-2',
        sourceRef: `history-source-${index}`,
        actorId: 'advisor-001',
        now: '2026-07-28T02:00:00.000Z',
      })
      await correctAttendance(advisor(), classId, {
        meetingNumber: 2,
        studentId,
        status: 'PRESENT',
        reason: 'Kehadiran uji pagination telah diverifikasi oleh dosen.',
        expectedVersion: 0,
      }, `manual-attendance-history-${String(index).padStart(3, '0')}`)
    }
    await correctAttendance(advisor(), classId, {
      meetingNumber: 1,
      studentId: 'student-001',
      status: 'PRESENT',
      reason: 'Mahasiswa hadir dan bukti pertemuan telah diverifikasi.',
      expectedVersion: 0,
    }, 'manual-attendance-history-own')

    const first = await listClassAttendancePage(advisor(), classId, { meetingNumber: 2, limit: 50 })
    const second = await listClassAttendancePage(advisor(), classId, { meetingNumber: 2, limit: 50, cursor: first.nextCursor })
    expect(first.items).toHaveLength(50)
    expect(first.nextCursor).toBeTruthy()
    expect(second.items).toHaveLength(1)

    const own = await listClassAttendancePage(student('student-001'), classId)
    expect(own.items).toHaveLength(1)
    expect(own.items[0]).toMatchObject({ studentId: 'student-001', meetingNumber: 1 })
    await expect(listClassAttendancePage(student('student-001'), classId, { studentId: 'student-002' }))
      .rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' } satisfies Partial<CampusError>)
    await expect(listClassAttendancePage(authContext('admin-001', ['administrator']), classId))
      .rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' } satisfies Partial<CampusError>)
  })
})

describe('gradebook and immutable publication', () => {
  beforeEach(() => {
    process.env.CAMPUS_DATA_MODE = 'mock'
    resetMockState()
    resetAcademicClassStateForTests()
  })

  it('requires component weights to total exactly 100 and applies optimistic configuration versions', async () => {
    await expect(configureGradeComponents(advisor(), classId, {
      expectedVersion: 1,
      components: [
        { id: 'coursework', label: 'Tugas', weight: 60, maxScore: 100, order: 1 },
        { id: 'final', label: 'Ujian akhir', weight: 30, maxScore: 100, order: 2 },
      ],
    }, 'grade-config-key-001')).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_INPUT' } satisfies Partial<CampusError>)

    const configured = await configureGradeComponents(advisor(), classId, {
      expectedVersion: 1,
      components: [
        { id: 'coursework', label: 'Tugas', weight: 60, maxScore: 100, order: 1 },
        { id: 'final', label: 'Ujian akhir', weight: 40, maxScore: 100, order: 2 },
      ],
    }, 'grade-config-key-002')
    expect(configured.value).toMatchObject({ version: 2 })
    await expect(configureGradeComponents(advisor(), classId, {
      expectedVersion: 1,
      components: configured.value.components,
    }, 'grade-config-key-003')).rejects.toMatchObject({ statusCode: 409, code: 'VERSION_CONFLICT' } satisfies Partial<CampusError>)
  })

  it('enters a complete per-student grade with optimistic version and scope checks', async () => {
    const input = {
      expectedVersion: 1,
      expectedConfigVersion: 1,
      componentScores: { assignments: 90, midterm: 85, final: 95 },
    }
    const entered = await enterStudentGrade(advisor(), classId, 'student-001', input, 'grade-entry-key-001')
    expect(entered.value).toMatchObject({ finalScore: 90.5, letterGrade: 'A', version: 2 })
    await expect(enterStudentGrade(advisor(), classId, 'student-001', input, 'grade-entry-key-002'))
      .rejects.toMatchObject({ statusCode: 409, code: 'VERSION_CONFLICT' } satisfies Partial<CampusError>)
    await expect(enterStudentGrade(authContext('academic-inf', ['academic_staff'], ['informatics-s1']), classId, 'student-001', input, 'grade-entry-key-003'))
      .rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' } satisfies Partial<CampusError>)
  })

  it('rejects missing, unknown, and out-of-range component scores', async () => {
    await expect(enterStudentGrade(advisor(), classId, 'student-001', {
      expectedVersion: 1,
      expectedConfigVersion: 1,
      componentScores: { assignments: 90, final: 95 },
    }, 'grade-entry-key-004')).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_INPUT' } satisfies Partial<CampusError>)
    await expect(enterStudentGrade(advisor(), classId, 'student-001', {
      expectedVersion: 1,
      expectedConfigVersion: 1,
      componentScores: { assignments: 101, midterm: 85, final: 95 },
    }, 'grade-entry-key-005')).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_INPUT' } satisfies Partial<CampusError>)
  })

  it('publishes one atomic snapshot, replays it, and never mutates the frozen rows', async () => {
    const published = await publishGrades(advisor(), classId, { expectedGradebookVersion: 2 }, 'grade-publish-key-001')
    const replay = await publishGrades(advisor(), classId, { expectedGradebookVersion: 2 }, 'grade-publish-key-001')
    expect(published.value).toMatchObject({ publicationVersion: 1, gradebookVersion: 2, configVersion: 1 })
    expect(published.value.rows).toHaveLength(2)
    expect(replay.replayed).toBe(true)
    expect(replay.value).toEqual(published.value)

    await expect(publishGrades(advisor(), classId, { expectedGradebookVersion: 2 }, 'grade-publish-key-002'))
      .rejects.toMatchObject({ statusCode: 409, code: 'GRADEBOOK_ALREADY_PUBLISHED' } satisfies Partial<CampusError>)

    const frozenScore = published.value.rows.find((row) => row.studentId === 'student-001')?.finalScore
    await enterStudentGrade(advisor(), classId, 'student-001', {
      expectedVersion: 1,
      expectedConfigVersion: 1,
      componentScores: { assignments: 100, midterm: 100, final: 100 },
    }, 'grade-entry-key-006')
    const storedSnapshot = academicClassStateForTests().publications.get(classId)?.get(published.value.id)
    expect(storedSnapshot?.rows.find((row) => row.studentId === 'student-001')?.finalScore).toBe(frozenScore)
  })

  it('rejects stale and configuration-mismatched gradebook publication', async () => {
    await expect(publishGrades(advisor(), classId, { expectedGradebookVersion: 1 }, 'grade-publish-key-003'))
      .rejects.toMatchObject({ statusCode: 409, code: 'GRADEBOOK_VERSION_CONFLICT' } satisfies Partial<CampusError>)
    await configureGradeComponents(advisor(), classId, {
      expectedVersion: 1,
      components: [
        { id: 'assignments', label: 'Tugas', weight: 20, maxScore: 100, order: 1 },
        { id: 'midterm', label: 'UTS', weight: 30, maxScore: 100, order: 2 },
        { id: 'final', label: 'UAS', weight: 50, maxScore: 100, order: 3 },
      ],
    }, 'grade-config-key-004')
    await expect(publishGrades(advisor(), classId, { expectedGradebookVersion: 3 }, 'grade-publish-key-004'))
      .rejects.toMatchObject({ statusCode: 409, code: 'GRADEBOOK_CONFIG_MISMATCH' } satisfies Partial<CampusError>)
  })

  it('returns only the owning student KHS-style result from the published snapshot', async () => {
    await publishGrades(advisor(), classId, { expectedGradebookVersion: 2 }, 'grade-publish-key-005')
    const result = await getOwnPublishedResult(student('student-001'), classId)
    expect(result).toMatchObject({
      classId,
      studentId: 'student-001',
      courseCode: 'MGT401',
      credits: 3,
      letterGrade: 'A',
      publicationVersion: 1,
    })
    await expect(getOwnPublishedResult(student('student-003'), classId))
      .rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' } satisfies Partial<CampusError>)
    await expect(getOwnPublishedResult(authContext('guardian-001', ['guardian'], []), classId))
      .rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' } satisfies Partial<CampusError>)
  })
})
