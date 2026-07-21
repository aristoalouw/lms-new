export type LearningSpaceKind = 'ACADEMIC_CLASS' | 'GENERAL' | 'MOOC'
export type LearningSpaceStatus = 'ACTIVE' | 'ARCHIVED'

export interface LearningSpace {
  id: string
  kind: LearningSpaceKind
  title: string
  description?: string
  academicClassId?: string
  courseCode?: string
  section?: string
  periodId?: string
  programStudyId?: string
  unitId?: string
  lecturerIds: string[]
  participantUserIds: string[]
  status: LearningSpaceStatus
  gamificationAvailable: boolean
  version: number
  createdAt: string
  createdBy: string
  updatedAt: string
  updatedBy: string
}

export type SafeRichContent =
  | { format: 'PLAIN_TEXT'; text: string }
  | { format: 'QUILL_DELTA'; ops: SafeDeltaOperation[] }

export interface SafeDeltaOperation {
  insert: string
  attributes?: {
    bold?: boolean
    italic?: boolean
    underline?: boolean
    strike?: boolean
    list?: 'ordered' | 'bullet'
    header?: 1 | 2 | 3
    link?: string
  }
}

export interface LearningModule {
  id: string
  spaceId: string
  title: string
  description?: SafeRichContent
  order: number
  status: 'DRAFT' | 'PUBLISHED'
  currentVersion: number
  version: number
  createdAt: string
  createdBy: string
  updatedAt: string
  updatedBy: string
}

export interface LearningModuleVersion {
  id: string
  moduleId: string
  spaceId: string
  version: number
  title: string
  description?: SafeRichContent
  order: number
  status: LearningModule['status']
  createdAt: string
  createdBy: string
}

export interface LearningFileReference {
  fileId: string
  fileVersion: number
  fileName: string
  mimeType: string
  sizeBytes: number
}

export type LearningMaterialKind = 'RICH_TEXT' | 'FILE' | 'EXTERNAL_LINK'

export interface LearningMaterial {
  id: string
  spaceId: string
  moduleId: string
  kind: LearningMaterialKind
  title: string
  summary?: string
  content?: SafeRichContent
  file?: LearningFileReference
  externalUrl?: string
  order: number
  status: 'DRAFT' | 'PUBLISHED'
  duplicatedFromId?: string
  currentVersion: number
  version: number
  createdAt: string
  createdBy: string
  updatedAt: string
  updatedBy: string
}

export interface LearningMaterialVersion {
  id: string
  materialId: string
  spaceId: string
  moduleId: string
  version: number
  kind: LearningMaterialKind
  title: string
  summary?: string
  content?: SafeRichContent
  file?: LearningFileReference
  externalUrl?: string
  order: number
  status: LearningMaterial['status']
  duplicatedFromId?: string
  createdAt: string
  createdBy: string
}

export interface LearningAssignment {
  id: string
  spaceId: string
  moduleId?: string
  title: string
  instructions: SafeRichContent
  opensAt: string
  dueAt: string
  closesAt: string
  maximumPoints: number
  maximumAttempts: number
  maximumFiles: number
  status: 'DRAFT' | 'PUBLISHED' | 'CLOSED'
  currentVersion: number
  version: number
  createdAt: string
  createdBy: string
  updatedAt: string
  updatedBy: string
}

export interface LearningAssignmentVersion {
  id: string
  assignmentId: string
  spaceId: string
  version: number
  title: string
  instructions: SafeRichContent
  opensAt: string
  dueAt: string
  closesAt: string
  maximumPoints: number
  maximumAttempts: number
  maximumFiles: number
  status: LearningAssignment['status']
  createdAt: string
  createdBy: string
}

export interface LearningSubmission {
  id: string
  assignmentId: string
  spaceId: string
  studentId: string
  studentUid: string
  draftContent?: SafeRichContent
  draftFiles: LearningFileReference[]
  status: 'DRAFT' | 'SUBMITTED'
  attemptCount: number
  latestAttemptId?: string
  version: number
  createdAt: string
  updatedAt: string
}

export interface LearningSubmissionAttempt {
  id: string
  submissionId: string
  assignmentId: string
  spaceId: string
  studentId: string
  studentUid: string
  attemptNumber: number
  content?: SafeRichContent
  files: LearningFileReference[]
  submittedAt: string
  timeliness: 'ON_TIME' | 'LATE'
  assignmentVersion: number
}

export interface LearningGrade {
  id: string
  assignmentId: string
  spaceId: string
  studentId: string
  attemptId: string
  score: number
  feedback: SafeRichContent
  status: 'DRAFT' | 'PUBLISHED'
  version: number
  gradedAt: string
  gradedBy: string
  updatedAt: string
}

export interface LearningAnnouncement {
  id: string
  spaceId: string
  title: string
  body: SafeRichContent
  pinned: boolean
  status: 'PUBLISHED' | 'ARCHIVED'
  version: number
  createdAt: string
  createdBy: string
  updatedAt: string
  updatedBy: string
}

export interface LearningForumEdit {
  body: SafeRichContent
  editedAt: string
  editedBy: string
}

export interface LearningForumThread {
  id: string
  spaceId: string
  title: string
  body: SafeRichContent
  authorUid: string
  status: 'OPEN' | 'LOCKED' | 'HIDDEN'
  replyCount: number
  version: number
  editHistory: LearningForumEdit[]
  createdAt: string
  updatedAt: string
  moderatedAt?: string
  moderatedBy?: string
  moderationReason?: string
}

export interface LearningForumPost {
  id: string
  threadId: string
  spaceId: string
  parentPostId?: string
  depth: 0 | 1
  body: SafeRichContent
  authorUid: string
  status: 'VISIBLE' | 'HIDDEN'
  version: number
  editHistory: LearningForumEdit[]
  createdAt: string
  updatedAt: string
  moderatedAt?: string
  moderatedBy?: string
  moderationReason?: string
}

export type LearningActivityKind =
  | 'MODULE_PUBLISHED'
  | 'MATERIAL_PUBLISHED'
  | 'ASSIGNMENT_PUBLISHED'
  | 'SUBMISSION_FINALIZED'
  | 'GRADE_PUBLISHED'
  | 'ANNOUNCEMENT_PUBLISHED'
  | 'FORUM_THREAD_CREATED'
  | 'FORUM_POST_CREATED'

export interface LearningActivityEvent {
  id: string
  spaceId: string
  actorUid: string
  kind: LearningActivityKind
  resourceId: string
  label: string
  occurredAt: string
}

export interface LearningGamificationPreference {
  id: string
  spaceId: string
  userUid: string
  optedIn: boolean
  version: number
  updatedAt: string
}

export interface LearningGamificationRule {
  id: 'ON_TIME_SUBMISSION' | 'FORUM_CONTRIBUTION'
  label: string
  points: number
  maximumPerSpace: number
}

export interface LearningSpaceDetail {
  space: LearningSpace
  modules: LearningModule[]
  materials: LearningMaterial[]
  assignments: LearningAssignment[]
  announcements: LearningAnnouncement[]
  ownSubmissions: LearningSubmission[]
  ownGrades: LearningGrade[]
  canManage: boolean
}

export interface LearningProgressDashboard {
  spaceId: string
  generatedAt: string
  roleView: 'LEARNER' | 'TEACHER'
  modulesPublished: number
  materialsPublished: number
  assignmentsPublished: number
  submittedAssignments: number
  onTimeSubmissions: number
  lateSubmissions: number
  completionPercent: number
  recentActivity: LearningActivityEvent[]
  gamification: {
    available: boolean
    optedIn: boolean
    preferenceVersion: number
    points: number
    rules: LearningGamificationRule[]
    explanation: string
  }
  method: 'DESCRIPTIVE_ONLY'
}

export interface LearningPage<T> {
  items: T[]
  nextCursor?: string
}
