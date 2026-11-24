import type { AcademicClassRecord } from './academic-classes'
import type { KrsRecord } from './domain'

export type KrsHoldType = 'ACADEMIC' | 'FINANCE' | 'ADMINISTRATIVE'

export interface KrsHold {
  id: string
  type: KrsHoldType
  reason: string
  active: boolean
}

export interface KrsStudentAcademicState {
  id: string
  studentUid: string
  studentNumber: string
  studentName: string
  programStudyId: string
  cohortYear?: number
  currentSemester?: number
  advisorId: string
  active: boolean
  maximumCredits: number
  completedCourseCodes: string[]
  holds: KrsHold[]
  version: number
  updatedAt: string
}

export interface KrsPeriodPolicy {
  id: string
  academicYear?: string
  term?: 'ODD' | 'EVEN' | 'SHORT'
  status: 'DRAFT' | 'KRS_OPEN' | 'KRS_CLOSED' | 'CLOSED'
  krsOpensAt: string
  krsClosesAt: string
  revisionClosesAt: string
  version: number
}

export interface KrsSeatReservation {
  id: string
  classId: string
  studentId: string
  planId: string
  status: 'RESERVED' | 'ENROLLED'
  createdAt: string
  updatedAt: string
}

export interface KrsCatalogEntry {
  classRecord: AcademicClassRecord
  availableSeats: number
  eligibleByPrerequisite: boolean
  missingPrerequisiteCodes: string[]
  semesterRecommendation?: number
  semesterParity?: 'ODD' | 'EVEN'
  semesterTrack?: 'CURRENT' | 'LOWER' | 'UPPER' | 'UNSPECIFIED'
  eligibleBySemester?: boolean
  semesterBlockReason?: string
}

export interface KrsWriteResult {
  record: KrsRecord
  replayed: boolean
  auditId?: string
}
