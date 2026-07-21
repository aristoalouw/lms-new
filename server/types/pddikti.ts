import type { PddiktiEntityType, PddiktiSyncJob } from './domain'

export type PddiktiScalar = string | number | boolean | null

export interface PddiktiValidationIssue {
  code: string
  field?: string
  message: string
}

export interface PddiktiSourceRecord {
  id: string
  entityType: PddiktiEntityType
  programStudyId: string
  periodId: string
  version: number
  eligible: boolean
  blockers: PddiktiValidationIssue[]
  data: Record<string, PddiktiScalar>
  updatedAt: string
}

export interface PddiktiMappingDefinition {
  entityType: PddiktiEntityType
  version: string
  contractVersion: string
  requiredInternalFields: string[]
  /** Internal field -> neutral adapter-contract field. This is not a Neo Feeder action schema. */
  fieldMap: Record<string, string>
  active: boolean
  createdAt: string
}

export interface PddiktiContractRecord {
  internalId: string
  internalVersion: number
  mappingVersion: string
  fingerprint: string
  fields: Record<string, PddiktiScalar>
}

export interface PddiktiAdapterContract {
  name: string
  version: string
  /** Opaque, operator-verified gateway operation keys; no vendor actions are assumed by this application. */
  operationKeys: Partial<Record<PddiktiEntityType, string>>
  maxBatchSize: number
  timeoutMs: number
}

export interface PddiktiAdapterHealth {
  configured: boolean
  reachable: boolean
  contractVersion: string
  checkedAt: string
  latencyMs?: number
  message?: string
}

export interface PddiktiPushBatchRequest {
  contractVersion: string
  operationKey: string
  entityType: PddiktiEntityType
  programStudyId: string
  periodId: string
  idempotencyKey: string
  records: PddiktiContractRecord[]
}

export interface PddiktiPushItemResult {
  internalId: string
  status: 'ACCEPTED' | 'REJECTED'
  remoteId?: string
  remoteVersion?: string
  error?: { code: string; message: string }
}

export interface PddiktiPushBatchResult {
  requestId?: string
  items: PddiktiPushItemResult[]
}

export interface PddiktiRemoteRecord {
  remoteId: string
  internalId?: string
  remoteVersion?: string
  fields: Record<string, PddiktiScalar>
}

export interface PddiktiRemoteSnapshotRequest {
  contractVersion: string
  operationKey: string
  entityType: PddiktiEntityType
  programStudyId: string
  periodId: string
}

export interface PddiktiFeederAdapter {
  readonly contractVersion: string
  health(signal: AbortSignal): Promise<PddiktiAdapterHealth>
  pushBatch(request: PddiktiPushBatchRequest, signal: AbortSignal): Promise<PddiktiPushBatchResult>
  fetchSnapshot(request: PddiktiRemoteSnapshotRequest, signal: AbortSignal): Promise<PddiktiRemoteRecord[]>
}

export type PddiktiJobEventType =
  | 'QUEUED'
  | 'CLAIMED'
  | 'LEASE_RECOVERED'
  | 'BATCH_ACCEPTED'
  | 'BATCH_REJECTED'
  | 'RETRY_SCHEDULED'
  | 'SUCCEEDED'
  | 'DEAD_LETTERED'
  | 'MANUAL_RETRY'

export interface PddiktiJobEvent {
  id: string
  type: PddiktiJobEventType
  occurredAt: string
  actor: string
  attempt: number
  batchIndex?: number
  accepted?: number
  rejected?: number
  error?: { code: string; message: string }
}

export interface PddiktiWorkerJob extends PddiktiSyncJob {
  contractVersion: string
  mappingVersion: string
  payloadFingerprint: string
  recordCount: number
  leaseOwner?: string
  leaseToken?: string
  leaseExpiresAt?: string
  claimedAt?: string
  completedAt?: string
  leaseRecoveries: number
  acceptedCount: number
  rejectedCount: number
  history: PddiktiJobEvent[]
}

export interface PddiktiJobPayloadSnapshot {
  jobId: string
  contractVersion: string
  mappingVersion: string
  payloadFingerprint: string
  records: PddiktiContractRecord[]
  createdAt: string
}

export interface PddiktiEntityMapping {
  id: string
  entityType: PddiktiEntityType
  internalId: string
  remoteId: string
  programStudyId: string
  mappingVersion: string
  internalFingerprint: string
  remoteVersion?: string
  status: 'ACTIVE' | 'REPLACED'
  firstMappedAt: string
  updatedAt: string
  history: Array<{
    occurredAt: string
    jobId: string
    internalFingerprint: string
    remoteId: string
    remoteVersion?: string
  }>
}

export interface PddiktiBatchResultHistory {
  id: string
  jobId: string
  attempt: number
  batchIndex: number
  idempotencyKey: string
  startedAt: string
  completedAt: string
  accepted: number
  rejected: number
  itemResults: PddiktiPushItemResult[]
}

export interface PddiktiWorkerRun {
  id: string
  workerId: string
  contractVersion: string
  startedAt: string
  completedAt: string
  claimed: number
  succeeded: number
  retried: number
  deadLettered: number
}

export interface PddiktiWorkerStatus {
  contract: PddiktiAdapterContract
  adapter: PddiktiAdapterHealth
  queue: Record<'QUEUED' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'DEAD_LETTER', number>
  lastRun?: PddiktiWorkerRun
}

export type PddiktiDifferenceState = 'MATCH' | 'DIFFERENT' | 'MISSING_REMOTE' | 'MISSING_INTERNAL'

export interface PddiktiReconciliationRow {
  key: string
  internalId?: string
  remoteId?: string
  state: PddiktiDifferenceState
  differingFields: string[]
  internalFingerprint?: string
  remoteFingerprint?: string
  decision?: 'QUEUE_INTERNAL' | 'ACKNOWLEDGE_REMOTE'
  decidedAt?: string
  decidedBy?: string
}

export interface PddiktiReconciliation {
  id: string
  entityType: PddiktiEntityType
  programStudyId: string
  periodId: string
  contractVersion: string
  mappingVersion: string
  status: 'OPEN' | 'REVIEWED'
  version: number
  createdAt: string
  createdBy: string
  updatedAt: string
  summary: Record<PddiktiDifferenceState, number>
  rows: PddiktiReconciliationRow[]
}

export interface PddiktiEntityReadiness {
  entityType: PddiktiEntityType
  total: number
  eligible: number
  blocked: number
  queued: number
  synced: number
  completenessPercent: number
  blockerCounts: Record<string, number>
  mappingVersion: string
}

export interface PddiktiReadinessSummary {
  programStudyId: string
  periodId: string
  generatedAt: string
  total: number
  eligible: number
  blocked: number
  completenessPercent: number
  entities: PddiktiEntityReadiness[]
}

export interface PddiktiStudentDataChangeItem {
  field: 'name' | 'birthPlace' | 'birthDate' | 'gender' | 'identityNumber' | 'motherName'
  previousValue: string
  requestedValue: string
}

export interface PddiktiStudentDataChangeRequest {
  id: string
  studentId: string
  studentNumber: string
  programStudyId: string
  periodId: string
  reason: string
  changes: PddiktiStudentDataChangeItem[]
  evidenceFileIds: string[]
  status: 'SUBMITTED' | 'VALIDATED' | 'QUEUED' | 'COMPLETED' | 'REJECTED'
  version: number
  submittedAt: string
  submittedBy: string
  updatedAt: string
  updatedBy: string
  reviewNote?: string
  remoteTicket?: string
  completedAt?: string
}

export interface PddiktiDiplomaEligibilityCheck {
  code: 'STUDENT_SOURCE' | 'GRADUATION_SOURCE' | 'STUDENT_MAPPING' | 'GRADUATION_MAPPING' | 'OPEN_PDM' | 'OPEN_RECONCILIATION'
  passed: boolean
  message: string
}

export interface PddiktiDiplomaEligibility {
  studentId: string
  studentNumber: string
  programStudyId: string
  periodId: string
  eligible: boolean
  checks: PddiktiDiplomaEligibilityCheck[]
  evaluatedAt: string
  snapshotHash: string
}
