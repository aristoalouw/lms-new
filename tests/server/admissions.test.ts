import { beforeEach, describe, expect, it } from 'vitest'
import {
  admissionCatalog,
  admissionRuntimeForTests,
  claimAdmissionApplication,
  convertAcceptedApplicant,
  getAdmissionApplication,
  listAdmissionApplications,
  listOwnAdmissionApplications,
  recordAdmissionFeeStatus,
  reviewAdmissionApplication,
  submitAdmissionApplication,
} from '../../server/services/admissions'
import { admissionModuleState, resetAdmissionModuleState } from '../../server/services/admissions-state'
import { createAdmissionWave, updateAdmissionWave } from '../../server/services/admissions-catalog'
import { accountRuntimeForTests, createAccount, resetAccountStateForTests } from '../../server/services/accounts'
import type { AuthContext } from '../../server/types/auth'
import { CampusError } from '../../server/utils/errors'
import { resetMockState } from '../../server/utils/mock-store'
import { authContext } from './fixtures'

const admin = () => authContext('admin-001', ['administrator'], [])
const admissions = (programs = ['management-s1']) => authContext('admissions-001', ['admissions_staff'], programs)
const finance = (programs = ['management-s1']) => authContext('finance-001', ['finance_staff'], programs)

function submission(overrides: Record<string, unknown> = {}) {
  return {
    fullName: 'Calon Mahasiswa Baru',
    email: 'candidate.new@example.test',
    phone: '081234567899',
    identityNumber: '3173010101010001',
    programStudyId: 'management-s1',
    admissionPathId: 'regular',
    studyModeId: 'hybrid',
    waveId: '2026-wave-3',
    priorInstitution: 'SMA Nusantara',
    graduationYear: 2026,
    sourceInformation: 'school-visit',
    consent: true,
    ...overrides,
  }
}

function applicant(uid: string, email: string, program = 'management-s1'): AuthContext {
  const context = authContext(uid, ['applicant'], [program])
  context.email = email
  return context
}

async function createApplicantAccount(email: string, key: string) {
  return createAccount(admin(), {
    email,
    displayName: `Applicant ${key.slice(-4)}`,
    roles: ['applicant'],
    scope: { unitIds: ['admissions'], programStudyIds: ['management-s1'], cohortYears: [2026], studentIds: [] },
    status: 'active',
  }, key)
}

async function acceptedPaidApplication(identityNumber: string, email: string, keySuffix: string) {
  const account = await createApplicantAccount(email, `account-create-admission-${keySuffix}`)
  const user = applicant(account.account.id, email)
  const submitted = await submitAdmissionApplication(
    submission({ identityNumber, email }), `admission-submit-key-${keySuffix}`, user, undefined,
    new Date('2026-07-21T02:00:00.000Z'),
  )
  let application = submitted.application
  for (const documentType of ['IDENTITY', 'DIPLOMA'] as const) {
    const now = '2026-07-21T02:01:00.000Z'
    admissionModuleState().documents.set(`document-${documentType}-${keySuffix}`, {
      id: `document-${documentType}-${keySuffix}`, applicationId: application.id, applicantUid: user.uid,
      programStudyId: application.programStudyId, documentType, fileId: `file-${documentType}-${keySuffix}`,
      fileVersion: 1, fileName: `${documentType.toLowerCase()}.pdf`, mimeType: 'application/pdf', sizeBytes: 100,
      checksumSha256: 'a'.repeat(64), status: 'VERIFIED', version: 2, submittedAt: now, submittedBy: user.uid,
      reviewedAt: now, reviewedBy: 'admissions-001', reviewNote: 'Verified test fixture', updatedAt: now,
    })
  }
  for (const status of ['UNDER_REVIEW', 'DOCUMENTS_VERIFIED', 'ACCEPTED'] as const) {
    const result = await reviewAdmissionApplication(
      admissions(), application.id, { status, expectedVersion: application.version },
      `admission-review-${status.toLowerCase()}-${keySuffix}`,
    )
    application = result.application
  }
  application = (await recordAdmissionFeeStatus(
    finance(), application.id,
    { status: 'PAID', externalReference: `PAY-${keySuffix}`, expectedVersion: application.version },
    `admission-fee-key-${keySuffix}`,
  )).application
  return { application, account: account.account }
}

describe('admission workflow', () => {
  beforeEach(() => {
    process.env.CAMPUS_DATA_MODE = 'mock'
    process.env.NODE_ENV = 'test'
    process.env.PMB_PII_HASH_SECRET = 'test-only-pmb-hash-secret-with-at-least-32-characters'
    resetMockState()
    resetAccountStateForTests()
    resetAdmissionModuleState()
  })

  it('publishes stable catalog identifiers without exposing server configuration', async () => {
    const catalog = await admissionCatalog()
    expect(catalog.programs.map(item => item.id)).toContain('management-s1')
    expect(catalog.waves[0]).toMatchObject({ id: '2026-wave-3', currency: 'IDR', registrationFee: 500_000 })
  })

  it('mengelola gelombang Firebase-ready secara scoped, idempotent, dan versioned', async () => {
    const input = {
      id: '2027-wave-1', academicYear: '2027/2028', label: 'Gelombang 1',
      opensAt: '2027-01-01T00:00:00+07:00', closesAt: '2027-03-31T23:59:00+07:00',
      registrationFee: 500_000, active: false, programStudyIds: ['management-s1'], capacity: 150,
    }
    const created = await createAdmissionWave(admissions(), input, 'admission-wave-key-0001')
    const replay = await createAdmissionWave(admissions(), input, 'admission-wave-key-0001')
    expect(created).toMatchObject({ replayed: false, wave: { id: input.id, version: 1, capacity: 150 } })
    expect(replay).toMatchObject({ replayed: true, wave: { id: input.id, version: 1 } })

    const updated = await updateAdmissionWave(admissions(), input.id, {
      ...input, label: 'Gelombang Reguler 1', active: true, expectedVersion: 1,
    })
    expect(updated.wave).toMatchObject({ label: 'Gelombang Reguler 1', active: true, version: 2 })
    await expect(updateAdmissionWave(admissions(), input.id, {
      ...input, expectedVersion: 1,
    })).rejects.toMatchObject({ statusCode: 409, code: 'VERSION_CONFLICT' })

    await expect(createAdmissionWave(admissions(), {
      ...input, id: '2027-wave-other', programStudyIds: ['accounting-s1'],
    }, 'admission-wave-key-0002')).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' })
  })

  it('submits once, stores only a fingerprint for identity, and never returns it', async () => {
    const first = await submitAdmissionApplication(
      submission(), 'admission-submit-key-0001', null, undefined,
      new Date('2026-07-21T02:00:00.000Z'),
    )
    const replay = await submitAdmissionApplication(
      submission(), 'admission-submit-key-0001', null, undefined,
      new Date('2026-07-21T02:05:00.000Z'),
    )

    expect(first).toMatchObject({ replayed: false, application: { status: 'SUBMITTED', identityLast4: '0001' } })
    expect(replay).toMatchObject({ replayed: true, application: { id: first.application.id } })
    expect(first.application).not.toHaveProperty('identityFingerprint')
    const stored = admissionRuntimeForTests().applications.find(item => item.id === first.application.id)!
    expect(stored.identityFingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(first)).not.toContain('3173010101010001')
  })

  it('rejects idempotency reuse, duplicate identities, missing consent, and closed waves', async () => {
    await submitAdmissionApplication(submission(), 'admission-submit-key-0002', null, undefined, new Date('2026-07-21T02:00:00Z'))
    await expect(submitAdmissionApplication(
      submission({ fullName: 'Nama Berbeda' }), 'admission-submit-key-0002', null, undefined, new Date('2026-07-21T02:00:00Z'),
    )).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' } satisfies Partial<CampusError>)
    await expect(submitAdmissionApplication(
      submission({ email: 'other@example.test' }), 'admission-submit-key-0003', null, undefined, new Date('2026-07-21T02:00:00Z'),
    )).rejects.toMatchObject({ code: 'APPLICATION_ALREADY_EXISTS' } satisfies Partial<CampusError>)
    await expect(submitAdmissionApplication(
      submission({ identityNumber: '3173010101010002', consent: false }), 'admission-submit-key-0004', null, undefined, new Date('2026-07-21T02:00:00Z'),
    )).rejects.toMatchObject({ code: 'INVALID_INPUT' } satisfies Partial<CampusError>)
    await expect(submitAdmissionApplication(
      submission({ identityNumber: '3173010101010003' }), 'admission-submit-key-0005', null, undefined, new Date('2026-09-01T02:00:00Z'),
    )).rejects.toMatchObject({ code: 'ADMISSION_WAVE_CLOSED' } satisfies Partial<CampusError>)
  })

  it('enforces program scope for staff lists and detail reads', async () => {
    const submitted = await submitAdmissionApplication(
      submission({ programStudyId: 'informatics-s1', identityNumber: '3173010101010010' }),
      'admission-submit-key-0010', null, undefined, new Date('2026-07-21T02:00:00Z'),
    )
    const scoped = await listAdmissionApplications(admissions(), {})
    expect(scoped.items.every(item => item.programStudyId === 'management-s1')).toBe(true)
    await expect(getAdmissionApplication(admissions(), submitted.application.id))
      .rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' } satisfies Partial<CampusError>)
    expect((await listAdmissionApplications(admissions(['informatics-s1']), { programStudyId: 'informatics-s1' })).items).toHaveLength(1)
    await expect(listAdmissionApplications(admin(), { programStudyId: 'informatics-s1' }))
      .rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' } satisfies Partial<CampusError>)
  })

  it('lets only the matching applicant claim and view an unlinked application', async () => {
    const submitted = await submitAdmissionApplication(submission(), 'admission-submit-key-0020', null, undefined, new Date('2026-07-21T02:00:00Z'))
    const wrong = applicant('applicant-wrong', 'wrong@example.test')
    await expect(claimAdmissionApplication(
      wrong, submitted.application.id, submitted.application.registrationNumber, submitted.application.version,
    )).rejects.toMatchObject({ statusCode: 404 } satisfies Partial<CampusError>)

    const owner = applicant('applicant-new', 'candidate.new@example.test')
    const claimed = await claimAdmissionApplication(
      owner, submitted.application.id, submitted.application.registrationNumber, submitted.application.version,
    )
    expect(claimed.application.applicantUid).toBe(owner.uid)
    expect((await listOwnAdmissionApplications(owner))).toHaveLength(1)
    await expect(getAdmissionApplication(wrong, submitted.application.id))
      .rejects.toMatchObject({ statusCode: 403 } satisfies Partial<CampusError>)
  })

  it('enforces the document-review state machine and optimistic versions', async () => {
    const submitted = await submitAdmissionApplication(submission(), 'admission-submit-key-0030', null, undefined, new Date('2026-07-21T02:00:00Z'))
    await expect(reviewAdmissionApplication(
      admissions(), submitted.application.id, { status: 'ACCEPTED', expectedVersion: 1 }, 'admission-review-key-0030',
    )).rejects.toMatchObject({ code: 'INVALID_STATUS_TRANSITION' } satisfies Partial<CampusError>)
    const underReview = await reviewAdmissionApplication(
      admissions(), submitted.application.id, { status: 'UNDER_REVIEW', expectedVersion: 1 }, 'admission-review-key-0031',
    )
    expect(underReview.application.version).toBe(2)
    await expect(reviewAdmissionApplication(
      admissions(), submitted.application.id, { status: 'DOCUMENTS_VERIFIED', expectedVersion: 1 }, 'admission-review-key-0032',
    )).rejects.toMatchObject({ code: 'VERSION_CONFLICT' } satisfies Partial<CampusError>)
  })

  it('restricts fee validation, makes references unique, and supports safe replay', async () => {
    const submitted = await submitAdmissionApplication(submission(), 'admission-submit-key-0040', null, undefined, new Date('2026-07-21T02:00:00Z'))
    await expect(recordAdmissionFeeStatus(
      admissions(), submitted.application.id,
      { status: 'PAID', externalReference: 'PAY-0040', expectedVersion: 1 }, 'admission-fee-key-0040',
    )).rejects.toMatchObject({ statusCode: 403 } satisfies Partial<CampusError>)
    const first = await recordAdmissionFeeStatus(
      finance(), submitted.application.id,
      { status: 'PAID', externalReference: 'PAY-0040', expectedVersion: 1 }, 'admission-fee-key-0041',
    )
    const replay = await recordAdmissionFeeStatus(
      finance(), submitted.application.id,
      { status: 'PAID', externalReference: 'PAY-0040', expectedVersion: 1 }, 'admission-fee-key-0041',
    )
    expect(first.application.registrationFeeStatus).toBe('PAID')
    expect(replay.replayed).toBe(true)
  })

  it('converts the seeded accepted applicant atomically and promotes its account claims', async () => {
    const result = await convertAcceptedApplicant(
      admissions(), 'admission-demo-001', { expectedVersion: 4 }, 'admission-convert-key-0050',
    )
    expect(result).toMatchObject({
      replayed: false,
      application: { status: 'ENROLLED', studentNumber: '26MGT00001' },
      student: { status: 'ACTIVE', studentNumber: '26MGT00001' },
    })
    const account = accountRuntimeForTests().accounts.find(item => item.id === 'applicant-001')
    expect(account).toMatchObject({ status: 'active', roles: ['student'] })
    expect(account?.scope.studentIds).toEqual([result.student.id])

    const replay = await convertAcceptedApplicant(
      admissions(), 'admission-demo-001', { expectedVersion: 4 }, 'admission-convert-key-0050',
    )
    expect(replay.replayed).toBe(true)
    expect(admissionRuntimeForTests().students).toHaveLength(1)
  })

  it('requires accepted, paid, and account-linked state before enrollment', async () => {
    const submitted = await submitAdmissionApplication(submission(), 'admission-submit-key-0060', null, undefined, new Date('2026-07-21T02:00:00Z'))
    await expect(convertAcceptedApplicant(
      admissions(), submitted.application.id, { expectedVersion: 1 }, 'admission-convert-key-0060',
    )).rejects.toMatchObject({ code: 'APPLICATION_NOT_ACCEPTED' } satisfies Partial<CampusError>)
  })

  it('allocates distinct monotonically increasing NIM values under concurrent conversions', async () => {
    const left = await acceptedPaidApplication('3173010101010101', 'left.candidate@example.test', '0101')
    const right = await acceptedPaidApplication('3173010101010102', 'right.candidate@example.test', '0102')
    const [leftResult, rightResult] = await Promise.all([
      convertAcceptedApplicant(admissions(), left.application.id, { expectedVersion: left.application.version }, 'admission-convert-key-0101'),
      convertAcceptedApplicant(admissions(), right.application.id, { expectedVersion: right.application.version }, 'admission-convert-key-0102'),
    ])
    expect(new Set([leftResult.student.studentNumber, rightResult.student.studentNumber]).size).toBe(2)
    expect([leftResult.student.studentNumber, rightResult.student.studentNumber].sort()).toEqual(['26MGT00001', '26MGT00002'])
  })
})
