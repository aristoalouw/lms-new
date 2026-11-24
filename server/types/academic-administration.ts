import type { SafeRichContent } from './learning'

export interface AcademicProgramStudy {
  id: string
  facultyId: string
  code: string
  name: string
  level: 'D3' | 'S1' | 'S2'
  active: boolean
  accreditationStatus: string
  accreditationExpiresAt: string
  version: number
  deletedAt?: string
  deletedBy?: string
  previousActive?: boolean
}

export interface AcademicPeriodDefinition {
  id: string
  academicYear: string
  term: 'ODD' | 'EVEN' | 'SHORT'
  startsAt: string
  endsAt: string
  krsOpensAt: string
  krsClosesAt: string
  krsRevisionClosesAt: string
  krsStatus: 'DRAFT' | 'KRS_OPEN' | 'KRS_CLOSED' | 'CLOSED'
  active: boolean
  version: number
  deletedAt?: string
  deletedBy?: string
  previousActive?: boolean
  previousKrsStatus?: 'DRAFT' | 'KRS_OPEN' | 'KRS_CLOSED' | 'CLOSED'
}

export interface AcademicCourseVersion {
  id: string
  courseId: string
  code: string
  name: string
  programStudyId: string
  version: number
  credits: number
  semesterRecommendation: number
  prerequisiteCourseCodes: string[]
  equivalentCourseCodes: string[]
  status: 'DRAFT' | 'ACTIVE' | 'RETIRED'
  createdAt: string
  createdBy: string
  immutable: true
  deletedAt?: string
  deletedBy?: string
  previousStatus?: 'DRAFT' | 'ACTIVE' | 'RETIRED'
}

export interface LmsAcademicCatalog {
  programs: AcademicProgramStudy[]
  periods: AcademicPeriodDefinition[]
  courses: AcademicCourseVersion[]
  allPrograms?: AcademicProgramStudy[]
  allPeriods?: AcademicPeriodDefinition[]
  allCourses?: AcademicCourseVersion[]
  deleted?: {
    programs: AcademicProgramStudy[]
    periods: AcademicPeriodDefinition[]
    courses: AcademicCourseVersion[]
  }
}

export interface CurriculumVersion {
  id: string
  curriculumId: string
  programStudyId: string
  name: string
  version: number
  effectiveCohortFrom: number
  effectiveCohortTo: number
  courseVersionIds: string[]
  totalCredits: number
  status: 'DRAFT' | 'ACTIVE' | 'RETIRED'
  createdAt: string
  createdBy: string
  immutable: true
  deletedAt?: string
  deletedBy?: string
  previousStatus?: 'DRAFT' | 'ACTIVE' | 'RETIRED'
}

export interface StudentAcademicStatusEvent {
  id: string
  status: 'ACTIVE' | 'LEAVE' | 'INACTIVE' | 'GRADUATED' | 'TRANSFERRED_OUT'
  periodId: string
  reason: string
  effectiveAt: string
  recordedBy: string
}

export interface StudentAcademicProfileRecord {
  studentId: string
  studentUid: string
  studentNumber: string
  studentName: string
  programStudyId: string
  facultyId: string
  cohortYear: number
  advisorId: string
  currentPeriodId: string
  status: StudentAcademicStatusEvent['status']
  pathway: 'REGULAR' | 'TRANSFER' | 'DOUBLE_DEGREE'
  partnerInstitution?: string
  originInstitution?: string
  curriculumVersionId: string
  totalEarnedCredits: number
  cumulativeGpa: number
  version: number
  statusHistory: StudentAcademicStatusEvent[]
  updatedAt: string
}

export interface AcademicCalendarEvent {
  id: string
  periodId: string
  programStudyIds: string[]
  title: string
  category: 'ACADEMIC' | 'KRS' | 'EXAM' | 'GRADUATION' | 'HOLIDAY' | 'DEADLINE'
  startsAt: string
  endsAt: string
  description?: string
  version: number
  createdAt: string
  createdBy: string
  deletedAt?: string
  deletedBy?: string
}

export interface LeaveRequest {
  id: string
  studentId: string
  studentUid: string
  programStudyId: string
  periodId: string
  reason: string
  supportingFileId?: string
  eligibilitySnapshot: {
    status: StudentAcademicProfileRecord['status']
    financeHoldActive: boolean
    requestedAt: string
  }
  status: 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'CANCELLED'
  version: number
  submittedAt: string
  reviewedAt?: string
  reviewedBy?: string
  reviewNote?: string
}

export interface AdvisingSession {
  id: string
  studentId: string
  studentUid: string
  advisorId: string
  programStudyId: string
  topic: string
  requestedAt: string
  scheduledAt?: string
  channel?: 'IN_PERSON' | 'VIDEO' | 'PHONE'
  status: 'REQUESTED' | 'SCHEDULED' | 'COMPLETED' | 'CANCELLED'
  studentSummary?: string
  privateAdvisorNote?: string
  version: number
  createdAt: string
  updatedAt: string
}

export interface RpsSection {
  week: number
  learningOutcome: string
  topic: string
  method: string
  assessment: string
  references: string[]
}

export interface RpsVersion {
  id: string
  rpsId: string
  courseVersionId: string
  programStudyId: string
  periodId: string
  lecturerIds: string[]
  version: number
  title: string
  description: SafeRichContent
  courseLearningOutcomes: string[]
  sections: RpsSection[]
  assessmentWeights: Array<{ label: string; weight: number }>
  status: 'DRAFT' | 'PUBLISHED' | 'RETIRED'
  source: 'MANUAL'
  createdAt: string
  createdBy: string
  immutable: true
  deletedAt?: string
  deletedBy?: string
  previousStatus?: 'DRAFT' | 'ACTIVE' | 'RETIRED'
}

export interface RpsHead {
  id: string
  courseVersionId: string
  programStudyId: string
  periodId: string
  currentVersion: number
  currentVersionId: string
  publishedVersion?: number
  publishedVersionId?: string
  updatedAt: string
  updatedBy: string
}

export interface ThesisGuidanceEntry {
  id: string
  occurredAt: string
  summary: string
  nextAction: string
  recordedBy: string
  immutable: true
}

export interface ThesisRecord {
  id: string
  studentId: string
  studentUid: string
  programStudyId: string
  title: string
  abstract: SafeRichContent
  supervisorIds: string[]
  status: 'PROPOSED' | 'APPROVED' | 'IN_PROGRESS' | 'READY_FOR_DEFENSE' | 'PASSED' | 'REJECTED'
  proposalFileId?: string
  guidance: ThesisGuidanceEntry[]
  version: number
  createdAt: string
  updatedAt: string
  reviewedAt?: string
  reviewedBy?: string
}

export interface MbkmLogEntry {
  id: string
  occurredOn: string
  activity: string
  hours: number
  evidenceFileId?: string
  createdAt: string
  immutable: true
}

export interface MbkmConversion {
  courseCode: string
  credits: number
  gradeLetter: string
}

export interface MbkmActivity {
  id: string
  studentId: string
  studentUid: string
  programStudyId: string
  periodId: string
  scheme: 'INTERNSHIP' | 'EXCHANGE' | 'TEACHING' | 'RESEARCH' | 'ENTREPRENEURSHIP' | 'HUMANITARIAN'
  partnerName: string
  title: string
  startsOn: string
  endsOn: string
  supervisorIds: string[]
  status: 'PROPOSED' | 'APPROVED' | 'ACTIVE' | 'COMPLETED' | 'REJECTED'
  logbook: MbkmLogEntry[]
  evaluation?: { score: number; note: string; evaluatedAt: string; evaluatedBy: string }
  conversions: MbkmConversion[]
  version: number
  createdAt: string
  updatedAt: string
}

export interface AcademicGradeRecord {
  id: string
  classId?: string
  publicationVersion?: number
  studentId: string
  periodId: string
  courseCode: string
  courseName: string
  credits: number
  numericScore: number
  letterGrade: string
  gradePoint: number
  publicationId: string
  publishedAt: string
  immutable: true
}

export interface SemesterResult {
  periodId: string
  studentId: string
  rows: AcademicGradeRecord[]
  attemptedCredits: number
  earnedCredits: number
  semesterGpa: number
  generatedAt: string
}

export interface AcademicTranscript {
  student: StudentAcademicProfileRecord
  rows: AcademicGradeRecord[]
  totalAttemptedCredits: number
  totalEarnedCredits: number
  cumulativeGpa: number
  generatedAt: string
  status: 'PROVISIONAL'
}

export interface AcademicAdministrationWorkspace {
  profile?: StudentAcademicProfileRecord
  programs: AcademicProgramStudy[]
  periods: AcademicPeriodDefinition[]
  courses: AcademicCourseVersion[]
  curricula: CurriculumVersion[]
  calendar: AcademicCalendarEvent[]
  leaveRequests: LeaveRequest[]
  advisingSessions: AdvisingSession[]
  rpsVersions: RpsVersion[]
  theses: ThesisRecord[]
  mbkmActivities: MbkmActivity[]
}
