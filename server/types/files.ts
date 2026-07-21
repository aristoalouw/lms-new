import type { UserRole } from './auth'

export const FILE_STATES = ['UPLOADING', 'QUARANTINED', 'CLEAN', 'REJECTED', 'DELETED'] as const
export type FileState = (typeof FILE_STATES)[number]

export const FILE_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const
export type AllowedFileMimeType = (typeof FILE_MIME_TYPES)[number]

export interface FileAccessPolicy {
  visibility: 'OWNER' | 'SCOPED'
  allowedRoles: UserRole[]
  allowedUserIds: string[]
  unitIds: string[]
  programStudyIds: string[]
  studentIds: string[]
  learningSpaceIds: string[]
}

export interface PrivateFileRecord {
  id: string
  ownerUid: string
  ownerName: string
  name: string
  extension: string
  mimeType: AllowedFileMimeType
  sizeBytes: number
  status: FileState
  access: FileAccessPolicy
  currentVersion: number | null
  nextVersion: number
  versionCount: number
  pendingVersion?: number
  createdAt: string
  updatedAt: string
  deleted: boolean
  deletedAt?: string
  deletedBy?: string
}

export interface PrivateFileVersion {
  id: string
  fileId: string
  uploadSessionId: string
  version: number
  ownerUid: string
  createdBy: string
  name: string
  extension: string
  declaredMimeType: AllowedFileMimeType
  detectedMimeType?: AllowedFileMimeType
  expectedSizeBytes: number
  sizeBytes?: number
  sha256?: string
  storagePath: string
  status: Exclude<FileState, 'DELETED'>
  scanResult?: 'CLEAN' | 'INFECTED' | 'UNAVAILABLE' | 'ERROR'
  scanMessage?: string
  createdAt: string
  finalizedAt?: string
  scannedAt?: string
  rejectedAt?: string
  rejectionCode?: string
}

export interface FileUploadSession {
  id: string
  fileId: string
  versionId: string
  version: number
  ownerUid: string
  createdBy: string
  expectedSizeBytes: number
  declaredMimeType: AllowedFileMimeType
  extension: string
  storagePath: string
  status: 'RESERVED' | 'QUARANTINED' | 'COMPLETED' | 'REJECTED' | 'EXPIRED'
  createdAt: string
  expiresAt: string
  finalizedAt?: string
  idempotencyHash?: string
}

export interface FileQuota {
  ownerUid: string
  usedBytes: number
  reservedBytes: number
  limitBytes: number
  updatedAt: string
}

export interface CreateUploadSessionInput {
  fileId?: string
  name: string
  declaredMimeType: string
  sizeBytes: number
  access?: Partial<FileAccessPolicy>
}

export interface UploadTarget {
  url: string
  method: 'PUT'
  headers: Record<string, string>
  expiresAt: string
}

export interface CreateUploadSessionResult {
  file: PrivateFileRecord
  session: Omit<FileUploadSession, 'storagePath' | 'idempotencyHash'>
  upload: UploadTarget
  quota: FileQuota
}

export interface FileListFilters {
  search?: string
  status?: FileState
  mimeType?: AllowedFileMimeType
  scope?: 'owned' | 'accessible' | 'all'
  cursor?: string
  limit?: number
  includeDeleted?: boolean
}

export interface FileListResult {
  items: PrivateFileRecord[]
  nextCursor?: string
  quota: FileQuota
}

export interface FileDetailResult {
  file: PrivateFileRecord
  versions: Array<Omit<PrivateFileVersion, 'storagePath' | 'uploadSessionId'>>
  quota: FileQuota
}

export interface SignedDownloadResult {
  url: string
  expiresAt: string
  fileName: string
  mimeType: AllowedFileMimeType
  sizeBytes: number
  version: number
  auditId: string
}

export interface FilePolicyDescriptor {
  quotaBytes: number
  uploadSessionTtlSeconds: number
  downloadUrlTtlSeconds: number
  allowedTypes: Array<{
    extension: string
    mimeType: AllowedFileMimeType
    maxSizeBytes: number
    label: string
  }>
}
