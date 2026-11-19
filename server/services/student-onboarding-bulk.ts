import type { H3Event } from 'h3'
import type { AuthContext } from '../types/auth'
import { BULK_STUDENT_ONBOARDING_HEADERS } from '../../shared/contracts/student-onboarding'
import type {
  BulkStudentOnboardingInput,
  BulkStudentOnboardingResult,
  BulkStudentOnboardingRow,
} from '../types/student-onboarding'
import { forbidden, invalidInput, isCampusError } from '../utils/errors'
import { parseDelimitedSource } from '../utils/import-parser'
import { hasRole } from '../utils/rbac'
import { requestHash } from '../utils/security'
import { requireInteger, requireString } from '../utils/validation'
import { createAccount, findActiveAccountByEmail } from './accounts'
import { onboardStudent } from './student-onboarding'

const MAX_BULK_ROWS = 100
const MAX_SOURCE_BYTES = 1024 * 1024
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const STUDENT_NUMBER = /^[A-Za-z0-9][A-Za-z0-9._/-]{1,31}$/
const COURSE_CODE = /^[A-Z0-9][A-Z0-9._-]{0,29}$/

export { BULK_STUDENT_ONBOARDING_HEADERS } from '../../shared/contracts/student-onboarding'

function normalizeHeader(value: string): string {
  return value.replace(/^\uFEFF/u, '').normalize('NFKC').trim().toLowerCase().replace(/[^a-z0-9]+/gu, '_').replace(/^_+|_+$/gu, '')
}

function requiredText(value: string, label: string, max: number): string {
  return requireString(value.normalize('NFKC').trim(), label, { min: 1, max })
}

function optionalText(value: string, label: string, max: number): string | undefined {
  const normalized = value.normalize('NFKC').trim()
  return normalized ? requireString(normalized, label, { max }) : undefined
}

function integer(value: string, label: string, min: number, max: number): number {
  if (!/^-?\d+$/u.test(value.trim())) invalidInput(`${label} harus berupa bilangan bulat.`)
  return requireInteger(Number(value), label, min, max)
}

function decimal(value: string, label: string, min: number, max: number): number {
  const normalized = value.trim().replace(',', '.')
  if (!/^\d+(?:\.\d{1,2})?$/u.test(normalized)) invalidInput(`${label} harus berupa angka maksimal dua desimal.`)
  const result = Number(normalized)
  if (!Number.isFinite(result) || result < min || result > max) invalidInput(`${label} harus antara ${min} dan ${max}.`)
  return result
}

function identifier(value: string, label: string): string {
  return requireString(value.trim(), label, { max: 128, pattern: SAFE_ID })
}

function parseRow(values: string[], indexes: Map<string, number>, rowNumber: number): BulkStudentOnboardingRow {
  const read = (name: typeof BULK_STUDENT_ONBOARDING_HEADERS[number]) => values[indexes.get(name)!] || ''
  for (const value of values) {
    if (/^[=+@-]/u.test(value.trim())) invalidInput(`Baris ${rowNumber} memuat nilai yang menyerupai formula spreadsheet.`)
  }
  const status = requiredText(read('status'), `Baris ${rowNumber} status`, 24).toUpperCase() as BulkStudentOnboardingRow['status']
  if (!['ACTIVE', 'LEAVE', 'INACTIVE', 'GRADUATED', 'TRANSFERRED_OUT'].includes(status)) invalidInput(`Baris ${rowNumber} memiliki status tidak valid.`)
  const pathway = requiredText(read('pathway'), `Baris ${rowNumber} pathway`, 24).toUpperCase() as BulkStudentOnboardingRow['pathway']
  if (!['REGULAR', 'TRANSFER', 'DOUBLE_DEGREE'].includes(pathway)) invalidInput(`Baris ${rowNumber} memiliki pathway tidak valid.`)
  const originInstitution = optionalText(read('origin_institution'), `Baris ${rowNumber} origin_institution`, 180)
  const partnerInstitution = optionalText(read('partner_institution'), `Baris ${rowNumber} partner_institution`, 180)
  if (pathway === 'TRANSFER' && !originInstitution) invalidInput(`Baris ${rowNumber} wajib memuat origin_institution.`)
  if (pathway === 'DOUBLE_DEGREE' && !partnerInstitution) invalidInput(`Baris ${rowNumber} wajib memuat partner_institution.`)
  if (pathway === 'REGULAR' && (originInstitution || partnerInstitution)) invalidInput(`Baris ${rowNumber} REGULAR tidak boleh memuat institusi asal/mitra.`)
  const maximumCredits = integer(read('maximum_credits'), `Baris ${rowNumber} maximum_credits`, 0, 30)
  const registeredCredits = integer(read('registered_credits'), `Baris ${rowNumber} registered_credits`, 0, 30)
  if (status === 'ACTIVE' && (maximumCredits < 1 || registeredCredits > maximumCredits)) {
    invalidInput(`Baris ${rowNumber} memiliki batas atau SKS terdaftar yang tidak valid.`)
  }
  const completedCourseCodes = [...new Set(read('completed_course_codes').split(/[\s,;|]+/u).map(value => value.trim().toUpperCase()).filter(Boolean))]
  if (completedCourseCodes.length > 300 || completedCourseCodes.some(code => !COURSE_CODE.test(code))) {
    invalidInput(`Baris ${rowNumber} memiliki kode mata kuliah lulus yang tidak valid.`)
  }
  return {
    rowNumber,
    email: requireString(read('email').trim().toLowerCase(), `Baris ${rowNumber} email`, { max: 254, pattern: EMAIL }),
    displayName: requireString(read('display_name').normalize('NFKC').trim(), `Baris ${rowNumber} display_name`, { min: 2, max: 150 }),
    studentId: identifier(read('student_id'), `Baris ${rowNumber} student_id`),
    studentNumber: requireString(read('student_number').trim().toUpperCase(), `Baris ${rowNumber} student_number`, { max: 32, pattern: STUDENT_NUMBER }),
    programStudyId: identifier(read('program_study_id'), `Baris ${rowNumber} program_study_id`),
    cohortYear: integer(read('cohort_year'), `Baris ${rowNumber} cohort_year`, 1950, 2200),
    advisorEmail: requireString(read('advisor_email').trim().toLowerCase(), `Baris ${rowNumber} advisor_email`, { max: 254, pattern: EMAIL }),
    currentPeriodId: identifier(read('current_period_id'), `Baris ${rowNumber} current_period_id`),
    curriculumVersionId: identifier(read('curriculum_version_id'), `Baris ${rowNumber} curriculum_version_id`),
    status,
    pathway,
    ...(originInstitution ? { originInstitution } : {}),
    ...(partnerInstitution ? { partnerInstitution } : {}),
    maximumCredits,
    registeredCredits,
    totalEarnedCredits: integer(read('total_earned_credits'), `Baris ${rowNumber} total_earned_credits`, 0, 400),
    cumulativeGpa: decimal(read('cumulative_gpa'), `Baris ${rowNumber} cumulative_gpa`, 0, 4),
    completedCourseCodes,
    reason: requireString(read('reason').normalize('NFKC').trim(), `Baris ${rowNumber} reason`, { min: 10, max: 1_000 }),
  }
}

export function parseBulkStudentOnboardingSource(input: BulkStudentOnboardingInput): BulkStudentOnboardingRow[] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalidInput('Body bulk onboarding tidak valid.')
  if (!['csv', 'tsv'].includes(input.format)) invalidInput('Format bulk onboarding harus csv atau tsv.')
  requireString(input.sourceName, 'sourceName', { min: 5, max: 120, pattern: /^[\p{L}\p{N}_.() -]+$/u })
  if (!input.sourceName.toLowerCase().endsWith(`.${input.format}`)) invalidInput(`Nama sumber harus berakhiran .${input.format}.`)
  if (Buffer.byteLength(input.content || '', 'utf8') > MAX_SOURCE_BYTES) invalidInput('Sumber bulk onboarding melebihi 1 MB.')
  const rows = parseDelimitedSource(input.content, input.format === 'csv' ? ',' : '\t')
  if (rows.length - 1 > MAX_BULK_ROWS) invalidInput(`Bulk onboarding dibatasi ${MAX_BULK_ROWS} mahasiswa per batch.`)
  const headers = rows[0]!.map(normalizeHeader)
  const duplicates = headers.filter((header, index) => headers.indexOf(header) !== index)
  if (duplicates.length) invalidInput(`Header duplikat: ${[...new Set(duplicates)].join(', ')}.`)
  const expected = new Set<string>(BULK_STUDENT_ONBOARDING_HEADERS)
  const unknown = headers.filter(header => !expected.has(header))
  const missing = BULK_STUDENT_ONBOARDING_HEADERS.filter(header => !headers.includes(header))
  if (unknown.length) invalidInput(`Header tidak didukung: ${unknown.join(', ')}.`)
  if (missing.length) invalidInput(`Header wajib belum tersedia: ${missing.join(', ')}.`)
  const indexes = new Map(headers.map((header, index) => [header, index]))
  const parsed = rows.slice(1).map((row, index) => parseRow(row, indexes, index + 2))
  const unique = (field: keyof Pick<BulkStudentOnboardingRow, 'email' | 'studentId' | 'studentNumber'>, label: string) => {
    const values = parsed.map(row => String(row[field]).toLowerCase())
    if (new Set(values).size !== values.length) invalidInput(`${label} duplikat ditemukan dalam sumber bulk onboarding.`)
  }
  unique('email', 'Email'); unique('studentId', 'ID mahasiswa'); unique('studentNumber', 'NIM')
  return parsed
}

export async function bulkOnboardStudents(
  context: AuthContext,
  input: BulkStudentOnboardingInput,
  idempotencyKey: string,
  event?: H3Event,
): Promise<BulkStudentOnboardingResult> {
  if (!hasRole(context, 'administrator') || !hasRole(context, 'academic_staff')) {
    forbidden('Bulk onboarding memerlukan role administrator dan staf akademik pada akun operator yang sama.')
  }
  const rows = parseBulkStudentOnboardingSource(input)
  const batchFingerprint = requestHash({ idempotencyKey, sourceName: input.sourceName, content: input.content }).slice(0, 32)
  const results: BulkStudentOnboardingResult['rows'] = []

  for (const row of rows) {
    let accountCreated = false
    try {
      let account = await findActiveAccountByEmail(row.email)
      if (!account) {
        const created = await createAccount(context, {
          email: row.email,
          displayName: row.displayName,
          roles: ['student'],
          scope: { unitIds: [], programStudyIds: [row.programStudyId], cohortYears: [row.cohortYear], studentIds: [row.studentId] },
          status: 'active',
          guardianStudentIds: [],
        }, `bulk-account-${batchFingerprint}-${row.rowNumber}`, event)
        account = created.account
        accountCreated = !created.replayed
      }
      const onboarding = await onboardStudent(context, {
        accountId: account.id,
        studentId: row.studentId,
        studentNumber: row.studentNumber,
        programStudyId: row.programStudyId,
        cohortYear: row.cohortYear,
        advisorEmail: row.advisorEmail,
        currentPeriodId: row.currentPeriodId,
        curriculumVersionId: row.curriculumVersionId,
        status: row.status,
        pathway: row.pathway,
        ...(row.originInstitution ? { originInstitution: row.originInstitution } : {}),
        ...(row.partnerInstitution ? { partnerInstitution: row.partnerInstitution } : {}),
        maximumCredits: row.maximumCredits,
        registeredCredits: row.registeredCredits,
        totalEarnedCredits: row.totalEarnedCredits,
        cumulativeGpa: row.cumulativeGpa,
        completedCourseCodes: row.completedCourseCodes,
        reason: row.reason,
        expectedVersion: 0,
      }, `bulk-onboard-${batchFingerprint}-${row.rowNumber}`, event)
      results.push({ rowNumber: row.rowNumber, status: onboarding.replayed ? 'REPLAYED' : 'ONBOARDED', accountCreated })
    } catch (error) {
      if (!isCampusError(error)) throw error
      results.push({ rowNumber: row.rowNumber, status: 'FAILED', accountCreated, code: error.code, message: error.message })
    }
  }

  const onboarded = results.filter(row => row.status === 'ONBOARDED').length
  const replayed = results.filter(row => row.status === 'REPLAYED').length
  const failed = results.filter(row => row.status === 'FAILED').length
  return { sourceName: input.sourceName, total: results.length, onboarded, replayed, failed, rows: results }
}
