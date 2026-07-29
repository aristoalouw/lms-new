import { beforeEach, describe, expect, it } from 'vitest'
import {
  createAcademicClass,
  createClassEnrollment,
  getAcademicClassDetail,
  listClassEnrollments,
  resetAcademicClassStateForTests,
  updateAcademicClass,
  updateClassEnrollment,
} from '../../server/services/academic-classes'
import { resetAcademicAdministrationStateForTests } from '../../server/services/academic-administration'
import { resetAccountStateForTests } from '../../server/services/accounts'
import {
  createLearningAnnouncement,
  createLearningMaterial,
  createLearningModule,
  getLearningSpaceDetail,
  updateLearningAnnouncement,
  updateLearningMaterial,
  updateLearningModule,
} from '../../server/services/learning'
import { resetLearningMockState } from '../../server/services/learning-mock'
import { finalizeLearningSubmission, gradeLearningSubmission, saveLearningSubmissionDraft } from '../../server/services/learning-submissions'
import { CampusError } from '../../server/utils/errors'
import { appendAudit, listAuditEntriesPage } from '../../server/utils/audit'
import { resetMockState } from '../../server/utils/mock-store'
import { authContext } from './fixtures'

const administrator = () => authContext('admin-001', ['administrator'], [])
const lecturer = () => authContext('advisor-001', ['lecturer'], ['management-s1'])
const student = (id = 'student-001', program = 'management-s1') => {
  const context = authContext(id, ['student'], [program])
  context.scope.studentIds = [id]
  return context
}
const newClass = {
  courseVersionId: 'course-mgt401_v1', section: 'B', periodId: '2025-2026-2',
  lecturerIds: ['advisor-001'], lecturerNames: ['Dr. Budi Santoso'], capacity: 1,
  firstMeetingStartsAt: '2026-08-03T01:00:00.000Z', meetingCount: 14, meetingDurationMinutes: 100,
}

describe('MVP class and canonical enrollment lifecycle', () => {
  beforeEach(() => {
    process.env.CAMPUS_DATA_MODE = 'mock'
    process.env.APP_FEATURE_PROFILE = 'lms-mvp'
    resetMockState(); resetAccountStateForTests(); resetAcademicAdministrationStateForTests(); resetAcademicClassStateForTests(); resetLearningMockState()
  })

  it('creates one same-id learning space, rejects duplicate class keys, and replays idempotently', async () => {
    const first = await createAcademicClass(administrator(), newClass, 'mvp-class-create-0001')
    const replay = await createAcademicClass(administrator(), newClass, 'mvp-class-create-0001')
    expect(first.value.learningSpace.id).toBe(first.value.classRecord.id)
    expect(first.value.learningSpace.academicClassId).toBe(first.value.classRecord.id)
    expect(replay).toMatchObject({ replayed: true, value: { classRecord: { id: first.value.classRecord.id } } })
    await expect(createAcademicClass(administrator(), newClass, 'mvp-class-create-0002'))
      .rejects.toMatchObject({ code: 'ACADEMIC_CLASS_DUPLICATE' } satisfies Partial<CampusError>)
  })

  it('uses one canonical enrollment record and revokes access without deleting history', async () => {
    const created = await createAcademicClass(administrator(), newClass, 'mvp-class-create-0003')
    const classId = created.value.classRecord.id
    const enrollment = await createClassEnrollment(administrator(), classId, {
      studentId: 'student-001', studentUid: 'student-001', studentNumber: '23900900', studentName: 'Nama tidak dipercaya',
      programStudyId: 'management-s1', reason: 'Override admin untuk pilot staging.', sourceRef: 'pilot-uat',
    }, 'mvp-enrollment-create-0001')
    expect(enrollment.value).toMatchObject({ status: 'ACTIVE', source: 'ADMIN', version: 1, studentName: 'Nabila Putri' })
    expect((await listClassEnrollments(administrator(), classId)).items).toEqual([expect.objectContaining({ studentId: 'student-001' })])
    expect((await listClassEnrollments(lecturer(), classId)).items).toEqual([expect.objectContaining({ studentId: 'student-001' })])
    await expect(listClassEnrollments(student('student-001'), classId)).rejects.toMatchObject({ statusCode: 403 })
    expect((await getAcademicClassDetail(student('student-001'), classId)).roster).toHaveLength(1)

    const withdrawn = await updateClassEnrollment(administrator(), classId, 'student-001', {
      status: 'WITHDRAWN', reason: 'Mahasiswa membatalkan enrolment pilot.', expectedVersion: 1,
    }, 'mvp-enrollment-withdraw-0001')
    expect(withdrawn.value).toMatchObject({ status: 'WITHDRAWN', version: 2 })
    await expect(getAcademicClassDetail(student('student-001'), classId)).rejects.toMatchObject({ statusCode: 403 })
    expect((await listClassEnrollments(administrator(), classId)).items[0]).toMatchObject({ status: 'WITHDRAWN', version: 2 })

    const reactivated = await updateClassEnrollment(administrator(), classId, 'student-001', {
      status: 'ACTIVE', reason: 'Enrolment diaktifkan kembali setelah verifikasi.', expectedVersion: 2,
    }, 'mvp-enrollment-reactivate-0001')
    expect(reactivated.value).toMatchObject({ status: 'ACTIVE', version: 3 })
  })

  it('enforces program scope, capacity, optimistic class versions, and space status sync', async () => {
    const created = await createAcademicClass(administrator(), newClass, 'mvp-class-create-0004')
    const classId = created.value.classRecord.id
    await expect(createClassEnrollment(administrator(), classId, {
      studentId: 'student-001', studentUid: 'student-001', studentNumber: '24900001', studentName: 'Lintas Prodi',
      programStudyId: 'informatics-s1', reason: 'Percobaan override lintas program studi.',
    }, 'mvp-enrollment-create-0002')).rejects.toMatchObject({ statusCode: 403 })
    await createClassEnrollment(administrator(), classId, {
      studentId: 'student-001', studentUid: 'student-001', studentNumber: '23900901', studentName: 'Dian Ayu',
      reason: 'Override admin untuk kuota terakhir.',
    }, 'mvp-enrollment-create-0003')
    await expect(createClassEnrollment(administrator(), classId, {
      studentId: 'student-002', studentUid: 'student-002', studentNumber: '23900902', studentName: 'Bima Putra',
      reason: 'Override admin saat kelas telah penuh.',
    }, 'mvp-enrollment-create-0004')).rejects.toMatchObject({ code: 'CLASS_CAPACITY_EXCEEDED' })
    await expect(updateAcademicClass(administrator(), classId, { expectedVersion: 1, section: 'C', capacity: 2 }, 'mvp-class-update-0001'))
      .resolves.toMatchObject({ value: { classRecord: { version: 2 } } })
    await expect(updateAcademicClass(administrator(), classId, { expectedVersion: 1, status: 'CLOSED' }, 'mvp-class-update-0002'))
      .rejects.toMatchObject({ code: 'VERSION_CONFLICT' })
    const closed = await updateAcademicClass(administrator(), classId, { expectedVersion: 2, status: 'CLOSED' }, 'mvp-class-update-0003')
    expect(closed.value).toMatchObject({ classRecord: { status: 'CLOSED' }, learningSpace: { status: 'ARCHIVED' } })
  })

  it('rejects mismatched, missing, and non-student enrollment identities', async () => {
    const created = await createAcademicClass(administrator(), newClass, 'mvp-class-create-identity-0001')
    const classId = created.value.classRecord.id
    const base = {
      studentNumber: '23900999',
      studentName: 'Tidak dipercaya',
      reason: 'Validasi identitas enrolment oleh administrator.',
    }
    await expect(createClassEnrollment(administrator(), classId, {
      ...base, studentId: 'student-002', studentUid: 'student-001',
    }, 'mvp-enrollment-identity-0001')).rejects.toMatchObject({ statusCode: 400 })
    await expect(createClassEnrollment(administrator(), classId, {
      ...base, studentId: 'missing-student', studentUid: 'missing-student',
    }, 'mvp-enrollment-identity-0002')).rejects.toMatchObject({ statusCode: 400 })
    await expect(createClassEnrollment(administrator(), classId, {
      ...base, studentId: 'admin-001', studentUid: 'admin-001',
    }, 'mvp-enrollment-identity-0003')).rejects.toMatchObject({ statusCode: 400 })
  })
})

describe('MVP learning authorization and archive transitions', () => {
  beforeEach(() => {
    process.env.CAMPUS_DATA_MODE = 'mock'
    process.env.APP_FEATURE_PROFILE = 'lms-mvp'
    resetMockState(); resetAcademicClassStateForTests(); resetLearningMockState()
  })

  it('prevents administrators from authoring content or grading', async () => {
    await expect(createLearningModule(administrator(), {
      spaceId: 'class-mgt-401-a', title: 'Admin module', order: 2, status: 'DRAFT',
    }, 'mvp-admin-module-0001')).rejects.toMatchObject({ statusCode: 403 })

    const draft = await saveLearningSubmissionDraft(student(), {
      assignmentId: 'learning-assignment-case-analysis', expectedVersion: 0,
      content: { format: 'PLAIN_TEXT', text: 'Jawaban final untuk uji role.' }, fileIds: [],
    }, 'mvp-student-draft-0001', undefined, Date.parse('2026-07-22T03:00:00.000Z'))
    const final = await finalizeLearningSubmission(student(), {
      assignmentId: 'learning-assignment-case-analysis', expectedVersion: draft.submission.version,
    }, 'mvp-student-final-0001', undefined, Date.parse('2026-07-22T03:00:00.000Z'))
    await expect(gradeLearningSubmission(administrator(), {
      attemptId: final.attempt.id, expectedVersion: 0, score: 100,
      feedback: { format: 'PLAIN_TEXT', text: 'Admin tidak boleh menilai.' }, status: 'PUBLISHED',
    })).rejects.toMatchObject({ statusCode: 403 })
  })

  it('archives modules and materials irreversibly while keeping immutable versions', async () => {
    const module = await createLearningModule(lecturer(), {
      spaceId: 'class-mgt-401-a', title: 'Modul arsip', order: 2, status: 'PUBLISHED',
    }, 'mvp-module-archive-0001')
    const archivedModule = await updateLearningModule(lecturer(), module.module.id, {
      title: module.module.title, order: module.module.order, status: 'ARCHIVED', expectedVersion: 1,
    })
    expect(archivedModule.module).toMatchObject({ status: 'ARCHIVED', currentVersion: 2 })
    await expect(updateLearningModule(lecturer(), module.module.id, {
      title: module.module.title, order: module.module.order, status: 'PUBLISHED', expectedVersion: 2,
    })).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' })

    const material = await createLearningMaterial(lecturer(), {
      spaceId: 'class-mgt-401-a', moduleId: 'learning-module-strategy-foundations',
      kind: 'RICH_TEXT', title: 'Materi arsip', content: { format: 'PLAIN_TEXT', text: 'Konten aman.' }, order: 2, status: 'PUBLISHED',
    }, 'mvp-material-archive-0001')
    const archived = await updateLearningMaterial(lecturer(), material.material.id, {
      kind: material.material.kind, title: material.material.title, content: material.material.content,
      order: material.material.order, status: 'ARCHIVED', expectedVersion: 1,
    })
    expect(archived.material).toMatchObject({ status: 'ARCHIVED', currentVersion: 2 })
    expect((await getLearningSpaceDetail(student(), 'class-mgt-401-a')).materials)
      .not.toContainEqual(expect.objectContaining({ id: material.material.id }))
  })

  it('updates and archives announcements with optimistic versions', async () => {
    const created = await createLearningAnnouncement(lecturer(), {
      spaceId: 'class-mgt-401-a', title: 'Jadwal pilot', body: { format: 'PLAIN_TEXT', text: 'Pertemuan dimulai tepat waktu.' }, pinned: true,
    }, 'mvp-announcement-0001')
    const archived = await updateLearningAnnouncement(lecturer(), created.announcement.id, {
      title: created.announcement.title, body: created.announcement.body, pinned: false, status: 'ARCHIVED', expectedVersion: 1,
    })
    expect(archived.announcement).toMatchObject({ status: 'ARCHIVED', version: 2, pinned: false })
    await expect(updateLearningAnnouncement(lecturer(), created.announcement.id, {
      title: created.announcement.title, body: created.announcement.body, pinned: false, status: 'PUBLISHED', expectedVersion: 2,
    })).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' })
  })
})

describe('MVP operational audit pagination', () => {
  beforeEach(() => {
    process.env.CAMPUS_DATA_MODE = 'mock'
    process.env.APP_FEATURE_PROFILE = 'lms-mvp'
    resetMockState()
  })

  it('returns at most the requested page and continues without duplicates', async () => {
    await appendAudit({ actor: administrator(), action: 'MVP_TEST_ONE', resourceType: 'test', resourceId: 'one' })
    await appendAudit({ actor: administrator(), action: 'MVP_TEST_TWO', resourceType: 'test', resourceId: 'two' })
    const first = await listAuditEntriesPage({ limit: 1 })
    const second = await listAuditEntriesPage({ limit: 1, cursor: first.nextCursor })
    expect(first.items).toHaveLength(1)
    expect(first.nextCursor).toBeTruthy()
    expect(second.items).toHaveLength(1)
    expect(second.items[0]?.id).not.toBe(first.items[0]?.id)
    expect(second.nextCursor).toBeUndefined()
  })
})
