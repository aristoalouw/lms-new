import type {
  AdmissionLetterOfAcceptance,
  AdmissionSelectionAssignment,
  AdmissionSelectionScore,
  AdmissionSelectionSession,
  AdmissionSelectionWriteResult,
} from '../types/admissions-selection'

interface IdempotencyRecord {
  requestHash: string
  response: AdmissionSelectionWriteResult<unknown>
  createdAt: string
}

interface ApplicantSchedule {
  applicationId: string
  sessions: Array<{ sessionId: string; startsAt: string; endsAt: string }>
  version: number
}

export interface AdmissionSelectionModuleState {
  sessions: Map<string, AdmissionSelectionSession>
  assignments: Map<string, AdmissionSelectionAssignment>
  scores: Map<string, AdmissionSelectionScore>
  applicantSchedules: Map<string, ApplicantSchedule>
  letters: Map<string, AdmissionLetterOfAcceptance>
  letterAssignments: Map<string, string>
  letterCounters: Map<string, number>
  idempotency: Map<string, IdempotencyRecord>
}

function initialState(): AdmissionSelectionModuleState {
  return {
    sessions: new Map(),
    assignments: new Map(),
    scores: new Map(),
    applicantSchedules: new Map(),
    letters: new Map(),
    letterAssignments: new Map(),
    letterCounters: new Map(),
    idempotency: new Map(),
  }
}

let state = initialState()

export function admissionSelectionModuleState(): AdmissionSelectionModuleState {
  return state
}

export function resetAdmissionSelectionModuleState(): void {
  state = initialState()
}
