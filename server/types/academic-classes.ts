export type AcademicClassStatus = 'ACTIVE' | 'CLOSED'
export type RosterStatus = 'ACTIVE' | 'WITHDRAWN'
export type DeliveryMode = 'ONSITE' | 'ONLINE' | 'HYBRID'
export type JournalRealization = 'ON_SCHEDULE' | 'MAKEUP'
export type AttendanceStatus = 'PRESENT' | 'LATE' | 'EXCUSED' | 'ABSENT'
export type AttendanceSource = 'QR' | 'MANUAL'

export interface ClassMeetingSchedule {
  meetingNumber: number
  scheduledStartAt: string
  scheduledEndAt: string
  attendanceOpensAt: string
  attendanceClosesAt: string
}

export interface AcademicClassRecord {
  id: string
  courseCode: string
  courseName: string
  credits: number
  section: string
  periodId: string
  programStudyId: string
  unitId: string
  lecturerIds: string[]
  lecturerNames: string[]
  timezone: 'Asia/Jakarta'
  status: AcademicClassStatus
  totalScheduledMeetings: number
  realizedMeetingCount: number
  schedule: ClassMeetingSchedule[]
  rosterStudentIds: string[]
  capacity?: number
  reservedSeatCount?: number
  prerequisiteCourseCodes?: string[]
  gradeConfigVersion: number
  gradebookVersion: number
  publicationVersion: number
  publishedGradebookVersion?: number
  latestPublicationId?: string
  updatedAt: string
}

export interface ClassRosterEntry {
  studentId: string
  studentNumber: string
  studentName: string
  programStudyId: string
  status: RosterStatus
}

export interface TeachingJournal {
  id: string
  classId: string
  meetingNumber: number
  scheduledStartAt: string
  occurredAt: string
  durationMinutes: number
  topic: string
  deliveryMode: DeliveryMode
  realization: JournalRealization
  scheduleVarianceMinutes: number
  makeupReason?: string
  notes?: string
  createdAt: string
  createdBy: string
}

export interface AttendanceRecord {
  id: string
  classId: string
  meetingNumber: number
  studentId: string
  status: AttendanceStatus
  source: AttendanceSource
  checkedInAt?: string
  correctionReason?: string
  correctedAt?: string
  correctedBy?: string
  version: number
  updatedAt: string
  updatedBy: string
}

export interface AttendanceChallenge {
  id: string
  classId: string
  meetingNumber: number
  nonceHash: string
  issuedAt: string
  expiresAt: string
  issuedBy: string
  usedStudentIds: string[]
}

export interface GradeComponent {
  id: string
  label: string
  weight: number
  maxScore: number
  order: number
}

export interface GradeConfiguration {
  classId: string
  version: number
  components: GradeComponent[]
  updatedAt: string
  updatedBy: string
}

export interface StudentGrade {
  id: string
  classId: string
  studentId: string
  componentScores: Record<string, number>
  finalScore: number
  letterGrade: string
  configVersion: number
  version: number
  updatedAt: string
  updatedBy: string
}

export interface PublishedGradeRow {
  studentId: string
  studentNumber: string
  studentName: string
  componentScores: Record<string, number>
  finalScore: number
  letterGrade: string
  credits: number
  qualityPoints: number
  sourceGradeVersion: number
}

export interface GradePublicationSnapshot {
  id: string
  classId: string
  publicationVersion: number
  gradebookVersion: number
  configVersion: number
  components: GradeComponent[]
  rows: PublishedGradeRow[]
  publishedAt: string
  publishedBy: string
}

export interface AcademicClassDetail {
  classRecord: AcademicClassRecord
  roster: ClassRosterEntry[]
  journals: TeachingJournal[]
  attendance: AttendanceRecord[]
  gradeConfiguration?: GradeConfiguration
  grades?: StudentGrade[]
}

export interface KhsPublishedResult {
  classId: string
  courseCode: string
  courseName: string
  section: string
  periodId: string
  credits: number
  studentId: string
  studentNumber: string
  finalScore: number
  letterGrade: string
  qualityPoints: number
  publicationVersion: number
  publishedAt: string
}
