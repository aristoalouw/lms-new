import { beforeEach, describe, expect, it } from 'vitest'
import { accountRuntimeForTests, resetAccountStateForTests } from '../../server/services/accounts'
import { academicAdministrationState, resetAcademicAdministrationStateForTests } from '../../server/services/academic-administration-state'
import { resetBillingStateForTests } from '../../server/services/billing-state'
import { resetKrsModuleState } from '../../server/services/krs-state'
import {
  BULK_STUDENT_ONBOARDING_HEADERS,
  bulkOnboardStudents,
  parseBulkStudentOnboardingSource,
} from '../../server/services/student-onboarding-bulk'
import { resetMockState } from '../../server/utils/mock-store'
import { authContext } from './fixtures'

const operator = () => authContext('admin-academic-001', ['administrator', 'academic_staff'], ['management-s1'])
const header = BULK_STUDENT_ONBOARDING_HEADERS.join(',')
const row = (overrides: Partial<Record<typeof BULK_STUDENT_ONBOARDING_HEADERS[number], string>> = {}) => {
  const values: Record<typeof BULK_STUDENT_ONBOARDING_HEADERS[number], string> = {
    email: 'bulk.student@example.test',
    display_name: 'Mahasiswa Bulk Resmi',
    student_id: 'student-bulk-001',
    student_number: '26011099',
    program_study_id: 'management-s1',
    cohort_year: '2026',
    advisor_email: 'budi.santoso@example.test',
    current_period_id: '2025-2026-2',
    curriculum_version_id: 'curriculum-mgt-2023_v1',
    status: 'ACTIVE',
    pathway: 'REGULAR',
    maximum_credits: '24',
    registered_credits: '0',
    total_earned_credits: '0',
    cumulative_gpa: '0',
    completed_course_codes: '',
    reason: 'Registrasi awal dari data institusi yang telah diverifikasi.',
    origin_institution: '',
    partner_institution: '',
    ...overrides,
  }
  return BULK_STUDENT_ONBOARDING_HEADERS.map(field => {
    const value = values[field]
    return value.includes(',') || value.includes('"') ? `"${value.replaceAll('"', '""')}"` : value
  }).join(',')
}
const input = (rows = [row()]) => ({ sourceName: 'onboarding-mahasiswa.csv', format: 'csv' as const, content: `${header}\n${rows.join('\n')}` })

describe('bulk canonical student onboarding', () => {
  beforeEach(() => {
    process.env.CAMPUS_DATA_MODE = 'mock'
    process.env.APP_FEATURE_PROFILE = 'full-campus'
    resetMockState(); resetAccountStateForTests(); resetAcademicAdministrationStateForTests(); resetKrsModuleState(); resetBillingStateForTests()
  })

  it('creates a scoped account and all canonical projections, then replays safely', async () => {
    const first = await bulkOnboardStudents(operator(), input(), 'bulk-student-onboarding-0001')
    const replay = await bulkOnboardStudents(operator(), input(), 'bulk-student-onboarding-0001')

    expect(first).toMatchObject({ total: 1, onboarded: 1, failed: 0, rows: [{ rowNumber: 2, status: 'ONBOARDED', accountCreated: true }] })
    expect(replay).toMatchObject({ total: 1, onboarded: 0, replayed: 1, failed: 0, rows: [{ rowNumber: 2, status: 'REPLAYED', accountCreated: false }] })
    const account = accountRuntimeForTests().accounts.find(item => item.email === 'bulk.student@example.test')
    expect(account).toMatchObject({ roles: ['student'], scope: { programStudyIds: ['management-s1'], cohortYears: [2026], studentIds: ['student-bulk-001'] } })
    expect(academicAdministrationState().profiles.get('student-bulk-001')).toMatchObject({ studentNumber: '26011099', advisorId: 'advisor-001', version: 1 })
  })

  it('continues valid rows and returns a sanitized failure for a row with invalid master data', async () => {
    const second = row({
      email: 'bulk.student.two@example.test',
      display_name: 'Mahasiswa Bulk Kedua',
      student_id: 'student-bulk-002',
      student_number: '26011100',
      curriculum_version_id: 'curriculum-missing',
    })
    const result = await bulkOnboardStudents(operator(), input([row(), second]), 'bulk-student-onboarding-0002')
    expect(result).toMatchObject({ total: 2, onboarded: 1, failed: 1 })
    expect(result.rows[1]).toMatchObject({ rowNumber: 3, status: 'FAILED', accountCreated: true, code: 'CURRICULUM_NOT_ACTIVE' })
    expect(result.rows[1]).not.toHaveProperty('email')
    expect(result.rows[1]).not.toHaveProperty('studentId')
  })

  it('requires a combined administrator and academic staff operator', async () => {
    await expect(bulkOnboardStudents(authContext('academic-only', ['academic_staff'], ['management-s1']), input(), 'bulk-student-onboarding-0003'))
      .rejects.toMatchObject({ statusCode: 403 })
    await expect(bulkOnboardStudents(authContext('admin-only', ['administrator'], []), input(), 'bulk-student-onboarding-0004'))
      .rejects.toMatchObject({ statusCode: 403 })
  })

  it('rejects duplicate identities and spreadsheet formula input before writing', () => {
    const duplicate = row({ display_name: 'Mahasiswa Duplikat' })
    expect(() => parseBulkStudentOnboardingSource(input([row(), duplicate]))).toThrow(/Email duplikat/u)
    expect(() => parseBulkStudentOnboardingSource(input([row({ display_name: '=HYPERLINK("https://example.test")' })])))
      .toThrow(/formula spreadsheet/u)
  })

  it('rejects a malformed request body as a validation error', () => {
    expect(() => parseBulkStudentOnboardingSource(null as unknown as Parameters<typeof parseBulkStudentOnboardingSource>[0]))
      .toThrow(/Body bulk onboarding tidak valid/u)
  })
})
