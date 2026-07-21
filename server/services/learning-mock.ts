import type {
  LearningActivityEvent,
  LearningAnnouncement,
  LearningAssignment,
  LearningAssignmentVersion,
  LearningForumPost,
  LearningForumThread,
  LearningGamificationPreference,
  LearningGrade,
  LearningMaterial,
  LearningMaterialVersion,
  LearningModule,
  LearningModuleVersion,
  LearningSpace,
  LearningSubmission,
  LearningSubmissionAttempt,
} from '../types/learning'

interface LearningIdempotencyEntry {
  requestHash: string
  response: unknown
}

export interface LearningMockState {
  spaces: Map<string, LearningSpace>
  modules: Map<string, LearningModule>
  moduleVersions: Map<string, LearningModuleVersion>
  materials: Map<string, LearningMaterial>
  materialVersions: Map<string, LearningMaterialVersion>
  assignments: Map<string, LearningAssignment>
  assignmentVersions: Map<string, LearningAssignmentVersion>
  submissions: Map<string, LearningSubmission>
  submissionAttempts: Map<string, LearningSubmissionAttempt>
  grades: Map<string, LearningGrade>
  announcements: Map<string, LearningAnnouncement>
  forumThreads: Map<string, LearningForumThread>
  forumPosts: Map<string, LearningForumPost>
  gamificationPreferences: Map<string, LearningGamificationPreference>
  activityEvents: Map<string, LearningActivityEvent>
  idempotency: Map<string, LearningIdempotencyEntry>
}

const space: LearningSpace = {
  id: 'class-mgt-401-a', kind: 'ACADEMIC_CLASS', title: 'Manajemen Strategik · Kelas A',
  description: 'Ruang materi, tugas, pengumuman, dan diskusi kelas Manajemen Strategik.', academicClassId: 'class-mgt-401-a',
  courseCode: 'MGT401', section: 'A', periodId: '2025-2026-2', programStudyId: 'management-s1', unitId: 'faculty-economics',
  lecturerIds: ['advisor-001'], participantUserIds: [], status: 'ACTIVE', gamificationAvailable: true, version: 1,
  createdAt: '2026-07-01T02:00:00.000Z', createdBy: 'advisor-001', updatedAt: '2026-07-20T02:00:00.000Z', updatedBy: 'advisor-001',
}

const moduleRecord: LearningModule = {
  id: 'learning-module-strategy-foundations', spaceId: space.id, title: 'Fondasi strategi',
  description: { format: 'PLAIN_TEXT', text: 'Konsep dasar, analisis lingkungan, dan pilihan strategi.' },
  order: 1, status: 'PUBLISHED', currentVersion: 1, version: 1,
  createdAt: '2026-07-01T02:10:00.000Z', createdBy: 'advisor-001', updatedAt: '2026-07-01T02:10:00.000Z', updatedBy: 'advisor-001',
}

const material: LearningMaterial = {
  id: 'learning-material-swot', spaceId: space.id, moduleId: moduleRecord.id, kind: 'RICH_TEXT',
  title: 'Kerangka analisis SWOT', summary: 'Ringkasan penggunaan SWOT secara kritis.',
  content: { format: 'QUILL_DELTA', ops: [{ insert: 'Tujuan belajar\n', attributes: { header: 2 } }, { insert: 'Membedakan faktor internal dan eksternal dalam analisis strategi.\n' }] },
  order: 1, status: 'PUBLISHED', currentVersion: 1, version: 1,
  createdAt: '2026-07-02T02:00:00.000Z', createdBy: 'advisor-001', updatedAt: '2026-07-02T02:00:00.000Z', updatedBy: 'advisor-001',
}

const assignment: LearningAssignment = {
  id: 'learning-assignment-case-analysis', spaceId: space.id, moduleId: moduleRecord.id,
  title: 'Analisis kasus strategi', instructions: { format: 'PLAIN_TEXT', text: 'Analisis posisi strategis organisasi pilihan Anda dan unggah laporan PDF.' },
  opensAt: '2026-07-01T00:00:00.000Z', dueAt: '2026-07-28T16:59:59.000Z', closesAt: '2026-08-04T16:59:59.000Z',
  maximumPoints: 100, maximumAttempts: 2, maximumFiles: 2, status: 'PUBLISHED', currentVersion: 1, version: 1,
  createdAt: '2026-07-03T02:00:00.000Z', createdBy: 'advisor-001', updatedAt: '2026-07-03T02:00:00.000Z', updatedBy: 'advisor-001',
}

const announcement: LearningAnnouncement = {
  id: 'learning-announcement-welcome', spaceId: space.id, title: 'Selamat datang di ruang kelas',
  body: { format: 'PLAIN_TEXT', text: 'Silakan pelajari modul pertama dan sampaikan pertanyaan melalui forum.' },
  pinned: true, status: 'PUBLISHED', version: 1, createdAt: '2026-07-01T02:20:00.000Z', createdBy: 'advisor-001', updatedAt: '2026-07-01T02:20:00.000Z', updatedBy: 'advisor-001',
}

function moduleVersion(record: LearningModule): LearningModuleVersion {
  return { id: `${record.id}_v1`, moduleId: record.id, spaceId: record.spaceId, version: 1, title: record.title, description: record.description, order: record.order, status: record.status, createdAt: record.createdAt, createdBy: record.createdBy }
}

function materialVersion(record: LearningMaterial): LearningMaterialVersion {
  return { id: `${record.id}_v1`, materialId: record.id, spaceId: record.spaceId, moduleId: record.moduleId, version: 1, kind: record.kind, title: record.title, summary: record.summary, content: record.content, file: record.file, externalUrl: record.externalUrl, order: record.order, status: record.status, createdAt: record.createdAt, createdBy: record.createdBy }
}

function assignmentVersion(record: LearningAssignment): LearningAssignmentVersion {
  return { id: `${record.id}_v1`, assignmentId: record.id, spaceId: record.spaceId, version: 1, title: record.title, instructions: record.instructions, opensAt: record.opensAt, dueAt: record.dueAt, closesAt: record.closesAt, maximumPoints: record.maximumPoints, maximumAttempts: record.maximumAttempts, maximumFiles: record.maximumFiles, status: record.status, createdAt: record.createdAt, createdBy: record.createdBy }
}

function initialState(seedDemo: boolean): LearningMockState {
  const events: LearningActivityEvent[] = seedDemo ? [
    { id: 'learning-event-material-swot', spaceId: space.id, actorUid: 'advisor-001', kind: 'MATERIAL_PUBLISHED', resourceId: material.id, label: material.title, occurredAt: material.createdAt },
    { id: 'learning-event-assignment-case', spaceId: space.id, actorUid: 'advisor-001', kind: 'ASSIGNMENT_PUBLISHED', resourceId: assignment.id, label: assignment.title, occurredAt: assignment.createdAt },
    { id: 'learning-event-announcement-welcome', spaceId: space.id, actorUid: 'advisor-001', kind: 'ANNOUNCEMENT_PUBLISHED', resourceId: announcement.id, label: announcement.title, occurredAt: announcement.createdAt },
  ] : []
  return {
    spaces: new Map(seedDemo ? [[space.id, structuredClone(space)]] : []),
    modules: new Map(seedDemo ? [[moduleRecord.id, structuredClone(moduleRecord)]] : []),
    moduleVersions: new Map(seedDemo ? [[`${moduleRecord.id}_v1`, structuredClone(moduleVersion(moduleRecord))]] : []),
    materials: new Map(seedDemo ? [[material.id, structuredClone(material)]] : []),
    materialVersions: new Map(seedDemo ? [[`${material.id}_v1`, structuredClone(materialVersion(material))]] : []),
    assignments: new Map(seedDemo ? [[assignment.id, structuredClone(assignment)]] : []),
    assignmentVersions: new Map(seedDemo ? [[`${assignment.id}_v1`, structuredClone(assignmentVersion(assignment))]] : []),
    announcements: new Map(seedDemo ? [[announcement.id, structuredClone(announcement)]] : []),
    activityEvents: new Map(events.map(item => [item.id, structuredClone(item)])),
    submissions: new Map(), submissionAttempts: new Map(), grades: new Map(), forumThreads: new Map(), forumPosts: new Map(), gamificationPreferences: new Map(), idempotency: new Map(),
  }
}

let state = initialState(true)

export function learningMockState(): LearningMockState {
  return state
}

export function resetLearningMockState(options: { seedDemo?: boolean } = {}): void {
  state = initialState(options.seedDemo !== false)
}

export function seedLearningSpaceForTests(record: LearningSpace): void {
  state.spaces.set(record.id, structuredClone(record))
}
