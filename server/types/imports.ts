export const IMPORT_DATASETS = ['students', 'courses', 'grades'] as const
export type ImportDataset = (typeof IMPORT_DATASETS)[number]

export const IMPORT_STATUSES = [
  'STAGING',
  'PREVIEWED',
  'APPROVED',
  'COMMITTING',
  'COMMITTED',
  'COMPENSATING',
  'FAILED',
  'COMPENSATED',
  'PARTIALLY_COMPENSATED',
] as const
export type ImportStatus = (typeof IMPORT_STATUSES)[number]

export type ImportRowAction = 'CREATE' | 'UPDATE' | 'SKIP' | 'INVALID'
export type ImportIssueSeverity = 'ERROR' | 'WARNING'

export interface ImportIssue {
  rowNumber: number
  field?: string
  code: string
  severity: ImportIssueSeverity
  message: string
}

export interface ImportStagedRow {
  rowNumber: number
  stableId?: string
  action: ImportRowAction
  data: Record<string, string | number | boolean>
  fingerprint?: string
  existingFingerprint?: string
  issues: ImportIssue[]
}

export interface ImportCounts {
  total: number
  valid: number
  errors: number
  warnings: number
  creates: number
  updates: number
  skips: number
  committed: number
  compensated: number
  compensationConflicts: number
}

export interface ImportRun {
  id: string
  dataset: ImportDataset
  sourceName: string
  format: 'csv' | 'tsv'
  checksum: string
  mappingVersion: string
  programStudyId: string
  status: ImportStatus
  counts: ImportCounts
  version: number
  createdAt: string
  createdBy: string
  expiresAt: string
  approvedAt?: string
  approvedBy?: string
  committedAt?: string
  committedBy?: string
  compensatedAt?: string
  compensatedBy?: string
  compensationReason?: string
  lastError?: { code: string; message: string; occurredAt: string }
}

export interface ImportPreviewResult {
  run: ImportRun
  sampleRows: ImportStagedRow[]
  issues: ImportIssue[]
  replayed: boolean
  auditId?: string
}

export interface ImportMutation {
  stableId: string
  targetCollection: string
  before: ImportTargetRecord | null
  afterFingerprint: string
  appliedAt: string
  compensationStatus?: 'COMPENSATED' | 'CONFLICT'
}

export interface ImportTargetRecord {
  id: string
  dataset: ImportDataset
  programStudyId: string
  data: Record<string, string | number | boolean>
  fingerprint: string
  version: number
  importRunId: string
  importedAt: string
  importedBy: string
}

export interface ImportListResult {
  items: ImportRun[]
  nextCursor?: string
}
