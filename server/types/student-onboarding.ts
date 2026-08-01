import type { StudentAcademicProfileRecord } from './academic-administration'
import type { BillingStudentProfile } from './billing'
import type { KrsStudentAcademicState } from './krs-enrollment'

export interface StudentOnboardingRecord {
  profile: StudentAcademicProfileRecord
  krsState: KrsStudentAcademicState
  billingProfile: BillingStudentProfile
}

export interface StudentOnboardingSnapshot {
  profile?: StudentAcademicProfileRecord
  krsState?: KrsStudentAcademicState
  billingProfile?: BillingStudentProfile
  complete: boolean
}

export interface StudentOnboardingResult extends StudentOnboardingRecord {
  replayed: boolean
  auditId?: string
}
