import { beforeEach, describe, expect, it } from 'vitest'
import { resetAcademicClassStateForTests } from '../../server/services/academic-classes'
import {
  createLearningAssignment,
  createLearningMaterial,
  createLearningModule,
  getLearningSpaceDetail,
  listLearningSpaces,
  updateLearningModule,
} from '../../server/services/learning'
import { getLearningProgressDashboard, updateLearningGamificationPreference } from '../../server/services/learning-dashboard'
import {
  createLearningForumPost,
  createLearningForumThread,
  listLearningForumPosts,
  listLearningForumThreads,
  moderateLearningForumThread,
} from '../../server/services/learning-forum'
import { learningMockState, resetLearningMockState } from '../../server/services/learning-mock'
import { finalizeLearningSubmission, gradeLearningSubmission, listLearningAssignmentSubmissions, saveLearningSubmissionDraft } from '../../server/services/learning-submissions'
import { CampusError } from '../../server/utils/errors'
import { resetMockState } from '../../server/utils/mock-store'
import { authContext } from './fixtures'

const spaceId = 'learning-space-class-mgt-401-a'
const assignmentId = 'learning-assignment-case-analysis'
const lecturer = () => authContext('advisor-001', ['lecturer', 'advisor'], ['management-s1'])
const student = (id = 'student-001') => authContext(id, ['student'], ['management-s1'])
const openedAt = Date.parse('2026-07-22T03:00:00.000Z')

describe('learning spaces, assignments, submissions, and forums', () => {
  beforeEach(() => {
    process.env.CAMPUS_DATA_MODE = 'mock'
    resetMockState(); resetAcademicClassStateForTests(); resetLearningMockState()
  })

  it('derives access from the academic-class roster and manager assignment', async () => {
    const learnerSpaces = await listLearningSpaces(student())
    expect(learnerSpaces).toEqual([expect.objectContaining({ id: spaceId, academicClassId: 'class-mgt-401-a' })])
    expect((await getLearningSpaceDetail(student(), spaceId)).canManage).toBe(false)
    expect((await getLearningSpaceDetail(lecturer(), spaceId)).canManage).toBe(true)
    expect(await listLearningSpaces(student('student-003'))).toHaveLength(0)
  })

  it('creates immutable module definitions and detects idempotency or version conflicts', async () => {
    const input = { spaceId, title: 'Analisis industri', description: { format: 'PLAIN_TEXT' as const, text: 'Porter dan dinamika industri.' }, order: 2, status: 'DRAFT' as const }
    const first = await createLearningModule(lecturer(), input, 'learning-module-key-0001')
    const replay = await createLearningModule(lecturer(), input, 'learning-module-key-0001')
    expect(first).toMatchObject({ module: { version: 1, currentVersion: 1 }, definition: { version: 1 }, replayed: false })
    expect(replay.replayed).toBe(true)
    const updated = await updateLearningModule(lecturer(), first.module.id, { title: 'Analisis industri terbaru', description: input.description, order: 2, status: 'PUBLISHED', expectedVersion: 1 })
    expect(updated).toMatchObject({ module: { version: 2, currentVersion: 2, status: 'PUBLISHED' }, definition: { version: 2 } })
    expect(learningMockState().moduleVersions.size).toBe(3)
    await expect(updateLearningModule(lecturer(), first.module.id, { title: 'Stale', order: 2, status: 'PUBLISHED', expectedVersion: 1 })).rejects.toMatchObject({ code: 'VERSION_CONFLICT' } satisfies Partial<CampusError>)
  })

  it('accepts only structured rich content and safe HTTPS external links', async () => {
    await expect(createLearningMaterial(lecturer(), { spaceId, moduleId: 'learning-module-strategy-foundations', kind: 'EXTERNAL_LINK', title: 'Tautan tidak aman', externalUrl: 'javascript:alert(1)', order: 2, status: 'PUBLISHED' }, 'learning-material-key-001')).rejects.toMatchObject({ statusCode: 400 } satisfies Partial<CampusError>)
    const material = await createLearningMaterial(lecturer(), { spaceId, moduleId: 'learning-module-strategy-foundations', kind: 'EXTERNAL_LINK', title: 'Referensi strategi', summary: 'Bacaan eksternal resmi.', externalUrl: 'https://example.edu/strategy', order: 2, status: 'PUBLISHED' }, 'learning-material-key-002')
    expect(material.material).toMatchObject({ externalUrl: 'https://example.edu/strategy', currentVersion: 1 })
    await expect(createLearningModule(lecturer(), { spaceId, title: 'Konten rusak', description: { format: 'QUILL_DELTA', ops: [{ insert: 'Klik', attributes: { link: 'javascript:alert(1)' } }] }, order: 3, status: 'DRAFT' }, 'learning-module-key-0002')).rejects.toMatchObject({ statusCode: 400 } satisfies Partial<CampusError>)
  })

  it('validates assignment windows and immutable definition snapshots', async () => {
    await expect(createLearningAssignment(lecturer(), { spaceId, title: 'Jendela salah', instructions: { format: 'PLAIN_TEXT', text: 'Kerjakan.' }, opensAt: '2026-07-25T00:00:00.000Z', dueAt: '2026-07-24T00:00:00.000Z', closesAt: '2026-07-26T00:00:00.000Z', maximumPoints: 100, maximumAttempts: 1, maximumFiles: 0, status: 'PUBLISHED' }, 'learning-assignment-001')).rejects.toMatchObject({ statusCode: 400 } satisfies Partial<CampusError>)
    const result = await createLearningAssignment(lecturer(), { spaceId, moduleId: 'learning-module-strategy-foundations', title: 'Refleksi mingguan', instructions: { format: 'PLAIN_TEXT', text: 'Tulis refleksi singkat.' }, opensAt: '2026-07-20T00:00:00.000Z', dueAt: '2026-07-30T00:00:00.000Z', closesAt: '2026-08-02T00:00:00.000Z', maximumPoints: 25, maximumAttempts: 2, maximumFiles: 0, status: 'PUBLISHED' }, 'learning-assignment-002')
    expect(result).toMatchObject({ assignment: { currentVersion: 1, maximumPoints: 25 }, definition: { version: 1 } })
  })

  it('separates mutable drafts from immutable final attempts and classifies lateness', async () => {
    const draft = await saveLearningSubmissionDraft(student(), { assignmentId, expectedVersion: 0, content: { format: 'PLAIN_TEXT', text: 'Analisis final mahasiswa.' }, fileIds: [] }, 'learning-draft-key-0001', undefined, openedAt)
    const final = await finalizeLearningSubmission(student(), { assignmentId, expectedVersion: draft.submission.version }, 'learning-final-key-0001', undefined, openedAt)
    expect(final).toMatchObject({ submission: { status: 'SUBMITTED', attemptCount: 1, version: 2 }, attempt: { attemptNumber: 1, timeliness: 'ON_TIME', assignmentVersion: 1 } })
    const revisedDraft = await saveLearningSubmissionDraft(student(), { assignmentId, expectedVersion: 2, content: { format: 'PLAIN_TEXT', text: 'Analisis final revisi.' }, fileIds: [] }, 'learning-draft-key-0004', undefined, openedAt)
    const second = await finalizeLearningSubmission(student(), { assignmentId, expectedVersion: revisedDraft.submission.version }, 'learning-final-key-0002', undefined, openedAt)
    expect(second.attempt).toMatchObject({ attemptNumber: 2, timeliness: 'ON_TIME' })
    expect(learningMockState().submissionAttempts.size).toBe(2)
  })

  it('publishes a score against a specific immutable attempt and exposes it only to its learner', async () => {
    const draft = await saveLearningSubmissionDraft(student(), { assignmentId, expectedVersion: 0, content: { format: 'PLAIN_TEXT', text: 'Jawaban siap dinilai.' }, fileIds: [] }, 'learning-draft-key-0002', undefined, openedAt)
    const final = await finalizeLearningSubmission(student(), { assignmentId, expectedVersion: draft.submission.version }, 'learning-final-key-0003', undefined, openedAt)
    const grade = await gradeLearningSubmission(lecturer(), { attemptId: final.attempt.id, expectedVersion: 0, score: 88.5, feedback: { format: 'PLAIN_TEXT', text: 'Argumentasi kuat dan terstruktur.' }, status: 'PUBLISHED' })
    expect(grade.grade).toMatchObject({ attemptId: final.attempt.id, score: 88.5, status: 'PUBLISHED', version: 1 })
    expect((await getLearningSpaceDetail(student(), spaceId)).ownGrades).toEqual([expect.objectContaining({ score: 88.5 })])
    expect((await listLearningAssignmentSubmissions(lecturer(), assignmentId))[0]).toMatchObject({ attempts: [{ id: final.attempt.id }], grade: { score: 88.5 } })
  })

  it('limits forum nesting to two levels and hides moderated content from learners', async () => {
    const thread = await createLearningForumThread(student(), { spaceId, title: 'Diskusi strategi', body: { format: 'PLAIN_TEXT', text: 'Bagaimana memilih prioritas strategi?' } }, 'learning-thread-key-0001')
    const root = await createLearningForumPost(student(), { threadId: thread.thread.id, body: { format: 'PLAIN_TEXT', text: 'Menurut saya gunakan dampak dan kelayakan.' } }, 'learning-post-key-00001')
    const reply = await createLearningForumPost(lecturer(), { threadId: thread.thread.id, parentPostId: root.post.id, body: { format: 'PLAIN_TEXT', text: 'Tambahkan bukti dari analisis industri.' } }, 'learning-post-key-00002')
    expect(reply.post.depth).toBe(1)
    await expect(createLearningForumPost(student(), { threadId: thread.thread.id, parentPostId: reply.post.id, body: { format: 'PLAIN_TEXT', text: 'Balasan tingkat ketiga.' } }, 'learning-post-key-00003')).rejects.toMatchObject({ code: 'FORUM_DEPTH_LIMIT' } satisfies Partial<CampusError>)
    await moderateLearningForumThread(lecturer(), thread.thread.id, { expectedVersion: 3, status: 'HIDDEN', reason: 'Topik digabung dengan forum utama.' })
    expect((await listLearningForumThreads(student(), spaceId)).items).toHaveLength(0)
    expect((await listLearningForumThreads(lecturer(), spaceId)).items).toHaveLength(1)
    expect((await listLearningForumPosts(lecturer(), thread.thread.id)).items).toHaveLength(2)
  })

  it('keeps gamification opt-in, transparent, and descriptive only', async () => {
    const draft = await saveLearningSubmissionDraft(student(), { assignmentId, expectedVersion: 0, content: { format: 'PLAIN_TEXT', text: 'Jawaban tepat waktu.' }, fileIds: [] }, 'learning-draft-key-0003', undefined, openedAt)
    await finalizeLearningSubmission(student(), { assignmentId, expectedVersion: draft.submission.version }, 'learning-final-key-0004', undefined, openedAt)
    await createLearningForumThread(student(), { spaceId, title: 'Kontribusi forum', body: { format: 'PLAIN_TEXT', text: 'Satu kontribusi yang terlihat.' } }, 'learning-thread-key-0002')
    const before = await getLearningProgressDashboard(student(), spaceId)
    expect(before.gamification).toMatchObject({ available: true, optedIn: false, points: 0 })
    await updateLearningGamificationPreference(student(), spaceId, { optedIn: true, expectedVersion: 0 }, 'learning-game-key-00001')
    const after = await getLearningProgressDashboard(student(), spaceId)
    expect(after).toMatchObject({ roleView: 'LEARNER', submittedAssignments: 1, completionPercent: 100, method: 'DESCRIPTIVE_ONLY', gamification: { optedIn: true, points: 12 } })
  })
})
