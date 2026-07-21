import type {
  AllowedFileMimeType,
  FileAccessPolicy,
  FilePolicyDescriptor,
} from '../types/files'
import type { AuthContext, UserRole } from '../types/auth'
import { forbidden, invalidInput } from '../utils/errors'

const MEBIBYTE = 1024 * 1024

export const FILE_UPLOAD_SESSION_TTL_MS = 10 * 60 * 1000
export const FILE_DOWNLOAD_TTL_MS = 5 * 60 * 1000
export const DEFAULT_FILE_QUOTA_BYTES = 250 * MEBIBYTE

interface TypePolicy {
  extension: string
  mimeType: AllowedFileMimeType
  maxSizeBytes: number
  label: string
  matchesMagic: (bytes: Uint8Array) => boolean
}

const TYPE_POLICIES: readonly TypePolicy[] = [
  {
    extension: 'pdf',
    mimeType: 'application/pdf',
    maxSizeBytes: 25 * MEBIBYTE,
    label: 'PDF',
    matchesMagic: bytes => bytes.length >= 5
      && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44
      && bytes[3] === 0x46 && bytes[4] === 0x2d,
  },
  {
    extension: 'jpg',
    mimeType: 'image/jpeg',
    maxSizeBytes: 10 * MEBIBYTE,
    label: 'JPEG',
    matchesMagic: bytes => bytes.length >= 3
      && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  },
  {
    extension: 'jpeg',
    mimeType: 'image/jpeg',
    maxSizeBytes: 10 * MEBIBYTE,
    label: 'JPEG',
    matchesMagic: bytes => bytes.length >= 3
      && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  },
  {
    extension: 'png',
    mimeType: 'image/png',
    maxSizeBytes: 10 * MEBIBYTE,
    label: 'PNG',
    matchesMagic: bytes => bytes.length >= 8
      && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
      && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a,
  },
] as const

const SCOPED_UPLOAD_ROLES: UserRole[] = [
  'applicant',
  'lecturer',
  'advisor',
  'academic_staff',
  'finance_staff',
  'student_affairs_staff',
  'admissions_staff',
  'leader',
  'administrator',
]

function configuredQuota(): number {
  const parsed = Number(process.env.FILE_QUOTA_BYTES)
  return Number.isSafeInteger(parsed) && parsed >= MEBIBYTE ? parsed : DEFAULT_FILE_QUOTA_BYTES
}

export function filePolicyDescriptor(): FilePolicyDescriptor {
  return {
    quotaBytes: configuredQuota(),
    uploadSessionTtlSeconds: FILE_UPLOAD_SESSION_TTL_MS / 1000,
    downloadUrlTtlSeconds: FILE_DOWNLOAD_TTL_MS / 1000,
    allowedTypes: TYPE_POLICIES.map(({ extension, mimeType, maxSizeBytes, label }) => ({
      extension,
      mimeType,
      maxSizeBytes,
      label,
    })),
  }
}

export function normalizeFileName(value: string): { name: string; extension: string } {
  const normalized = value.normalize('NFKC').trim()
  if (!normalized || normalized.length > 180 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    invalidInput('Nama file harus berisi 1-180 karakter tanpa karakter kontrol.')
  }
  if (normalized !== normalized.split(/[\\/]/).at(-1) || normalized === '.' || normalized === '..') {
    invalidInput('Nama file tidak boleh memuat jalur direktori.')
  }
  const extension = normalized.match(/\.([A-Za-z0-9]{1,10})$/)?.[1]?.toLowerCase()
  if (!extension) invalidInput('Nama file wajib memiliki ekstensi yang didukung.')
  return { name: normalized, extension }
}

export function validateDeclaredFile(
  name: string,
  declaredMimeType: string,
  sizeBytes: number,
): TypePolicy {
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) invalidInput('Ukuran file tidak valid.')
  const normalized = normalizeFileName(name)
  const policy = TYPE_POLICIES.find(item => item.extension === normalized.extension)
  if (!policy || policy.mimeType !== declaredMimeType) {
    invalidInput('Ekstensi dan tipe MIME file tidak sesuai atau tidak didukung.')
  }
  if (sizeBytes > policy.maxSizeBytes) {
    invalidInput(`Ukuran ${policy.label} melebihi batas ${Math.floor(policy.maxSizeBytes / MEBIBYTE)} MB.`)
  }
  return policy
}

export function verifyFileSignature(
  extension: string,
  declaredMimeType: AllowedFileMimeType,
  bytes: Uint8Array,
): AllowedFileMimeType {
  const policy = TYPE_POLICIES.find(item => item.extension === extension && item.mimeType === declaredMimeType)
  if (!policy || !policy.matchesMagic(bytes)) {
    invalidInput('Isi file tidak sesuai dengan ekstensi dan tipe MIME yang dinyatakan.')
  }
  return policy.mimeType
}

function uniqueStrings(values: unknown, label: string): string[] {
  if (values === undefined) return []
  if (!Array.isArray(values) || values.length > 100) invalidInput(`${label} tidak valid.`)
  const normalized = values.map((item) => {
    if (typeof item !== 'string' || !/^[A-Za-z0-9._:@-]{1,128}$/.test(item)) invalidInput(`${label} tidak valid.`)
    return item
  })
  return [...new Set(normalized)]
}

function requireSubset(requested: string[], owned: string[], label: string): void {
  if (requested.some(item => !owned.includes(item))) forbidden(`${label} berada di luar lingkup akun Anda.`)
}

export function normalizeFileAccess(
  context: AuthContext,
  requested?: Partial<FileAccessPolicy>,
): FileAccessPolicy {
  if (requested?.visibility !== undefined && requested.visibility !== 'OWNER' && requested.visibility !== 'SCOPED') {
    invalidInput('visibility file tidak valid.')
  }
  const visibility = requested?.visibility === 'SCOPED' ? 'SCOPED' : 'OWNER'
  const empty: FileAccessPolicy = {
    visibility,
    allowedRoles: [],
    allowedUserIds: [],
    unitIds: [],
    programStudyIds: [],
    studentIds: [],
  }
  if (visibility === 'OWNER') return empty
  if (!context.roles.some(role => SCOPED_UPLOAD_ROLES.includes(role))) {
    forbidden('Akun Anda tidak dapat membuat file berlingkup bersama.')
  }

  const allowedRoles = uniqueStrings(requested?.allowedRoles, 'allowedRoles') as UserRole[]
  const validRoles = new Set<UserRole>([
    'applicant', 'student', 'lecturer', 'advisor', 'academic_staff', 'finance_staff',
    'student_affairs_staff', 'admissions_staff', 'leader', 'administrator', 'guardian',
  ])
  if (allowedRoles.some(role => !validRoles.has(role))) invalidInput('allowedRoles memuat role yang tidak valid.')
  const allowedUserIds = uniqueStrings(requested?.allowedUserIds, 'allowedUserIds')
  const unitIds = uniqueStrings(requested?.unitIds, 'unitIds')
  const programStudyIds = uniqueStrings(requested?.programStudyIds, 'programStudyIds')
  const studentIds = uniqueStrings(requested?.studentIds, 'studentIds')

  if (!context.roles.includes('administrator')) {
    requireSubset(unitIds, context.scope.unitIds, 'Unit')
    requireSubset(programStudyIds, context.scope.programStudyIds, 'Program studi')
    requireSubset(studentIds, context.scope.studentIds, 'Mahasiswa')
  }
  if (![allowedRoles, allowedUserIds, unitIds, programStudyIds, studentIds].some(items => items.length)) {
    invalidInput('File bersama wajib memiliki penerima atau lingkup akses.')
  }
  return { visibility, allowedRoles, allowedUserIds, unitIds, programStudyIds, studentIds }
}

export function quotaLimitBytes(): number {
  return configuredQuota()
}
