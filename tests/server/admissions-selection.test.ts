import { beforeEach, describe, expect, it } from 'vitest'
import {
  assignApplicantToSelectionSession,
  createAdmissionSelectionSession,
  finalizeAdmissionSelectionScore,
  issueAdmissionLetterOfAcceptance,
  listAdmissionLetters,
  listAdmissionSelectionAssignments,
  verifyAdmissionLetter,
} from '../../server/services/admissions-selection'
import { admissionSelectionModuleState, resetAdmissionSelectionModuleState } from '../../server/services/admissions-selection-state'
import { admissionModuleState, resetAdmissionModuleState } from '../../server/services/admissions-state'
import { recordAdmissionFeeStatus, reviewAdmissionApplication, submitAdmissionApplication } from '../../server/services/admissions'
import { createAccount, resetAccountStateForTests } from '../../server/services/accounts'
import type { AuthContext } from '../../server/types/auth'
import type { CampusError } from '../../server/utils/errors'
import { resetMockState } from '../../server/utils/mock-store'
import { requestHash } from '../../server/utils/security'
import { authContext } from './fixtures'

const admissions = (programs = ['management-s1']) => authContext('admissions-001', ['admissions_staff'], programs)
const finance = () => authContext('finance-001', ['finance_staff'], ['management-s1'])
const admin = () => authContext('admin-001', ['administrator'], [])
const selectionClock = new Date('2026-07-21T08:00:00.000Z')
const scoreClock = new Date('2026-07-25T03:00:00.000Z')

function sessionInput(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Wawancara penerimaan gelombang 3',
    kind: 'INTERVIEW' as const,
    waveId: '2026-wave-3',
    programStudyId: 'management-s1',
    location: 'Ruang Seleksi A-201',
    startsAt: '2026-07-25T01:00:00.000Z',
    endsAt: '2026-07-25T03:00:00.000Z',
    capacity: 20,
    examinerIds: ['examiner-001'],
    ...overrides,
  }
}

function submission(identityNumber: string, email: string) {
  return {
    fullName: `Pendaftar ${identityNumber.slice(-4)}`,
    email,
    phone: '081234567899',
    identityNumber,
    programStudyId: 'management-s1',
    admissionPathId: 'regular' as const,
    studyModeId: 'hybrid' as const,
    waveId: '2026-wave-3',
    priorInstitution: 'SMA Nusantara',
    graduationYear: 2026,
    sourceInformation: 'school-visit',
    consent: true as const,
  }
}

function seedVerifiedDocuments(application: { id: string; applicantUid?: string; programStudyId: string }, suffix: string) {
  for (const documentType of ['IDENTITY', 'DIPLOMA'] as const) {
    const now = selectionClock.toISOString(), id = `selection-document-${documentType}-${suffix}`
    admissionModuleState().documents.set(id, {
      id, applicationId: application.id, applicantUid: application.applicantUid || `fixture-applicant-${suffix}`,
      programStudyId: application.programStudyId, documentType, fileId: `file-${documentType}-${suffix}`, fileVersion: 1,
      fileName: `${documentType.toLowerCase()}.pdf`, mimeType: 'application/pdf', sizeBytes: 100,
      checksumSha256: 'b'.repeat(64), status: 'VERIFIED', version: 2, submittedAt: now,
      submittedBy: application.applicantUid || `fixture-applicant-${suffix}`, reviewedAt: now,
      reviewedBy: 'admissions-001', reviewNote: 'Verified test fixture', updatedAt: now,
    })
  }
}

async function selectionReady(identityNumber: string, email: string, suffix: string) {
  const submitted = await submitAdmissionApplication(submission(identityNumber, email), `selection-submit-${suffix}`, null, undefined, selectionClock)
  let application = submitted.application
  seedVerifiedDocuments(application, suffix)
  for (const status of ['UNDER_REVIEW', 'DOCUMENTS_VERIFIED'] as const) {
    application = (await reviewAdmissionApplication(
      admissions(), application.id, { status, expectedVersion: application.version }, `selection-review-${status}-${suffix}`,
    )).application
  }
  application = (await recordAdmissionFeeStatus(
    finance(), application.id, { status: 'PAID', externalReference: `SEL-PAY-${suffix}`, expectedVersion: application.version }, `selection-fee-${suffix}`,
  )).application
  return application
}

async function acceptedClaimed(identityNumber: string, email: string, suffix: string) {
  const account = await createAccount(admin(), {
    email,
    displayName: `Applicant ${suffix}`,
    roles: ['applicant'],
    scope: { unitIds: ['admissions'], programStudyIds: ['management-s1'], cohortYears: [2026], studentIds: [] },
    status: 'active',
  }, `selection-account-${suffix}`)
  const applicant: AuthContext = authContext(account.account.id, ['applicant'], ['management-s1'])
  applicant.email = email
  const submitted = await submitAdmissionApplication(submission(identityNumber, email), `selection-claimed-submit-${suffix}`, applicant, undefined, selectionClock)
  let application = submitted.application
  seedVerifiedDocuments(application, suffix)
  for (const status of ['UNDER_REVIEW', 'DOCUMENTS_VERIFIED'] as const) {
    application = (await reviewAdmissionApplication(admissions(), application.id, {
      status, expectedVersion: application.version,
    }, `selection-claimed-review-${status}-${suffix}`)).application
  }
  application = (await recordAdmissionFeeStatus(finance(), application.id, {
    status: 'PAID', externalReference: `CLAIMED-PAY-${suffix}`, expectedVersion: application.version,
  }, `selection-claimed-fee-${suffix}`)).application
  application = (await reviewAdmissionApplication(admissions(), application.id, {
    status: 'ACCEPTED', expectedVersion: application.version,
  }, `selection-claimed-accept-${suffix}`)).application
  return { application, applicant }
}

describe('PMB selection scheduling, scoring, and Letter of Acceptance', () => {
  beforeEach(() => {
    process.env.CAMPUS_DATA_MODE = 'mock'
    process.env.NODE_ENV = 'test'
    process.env.PMB_PII_HASH_SECRET = 'selection-test-pii-key-with-more-than-32-characters'
    resetMockState()
    resetAccountStateForTests()
    resetAdmissionModuleState()
    resetAdmissionSelectionModuleState()
  })

  it('creates a scoped, versioned session with replay-safe idempotency', async () => {
    const first = await createAdmissionSelectionSession(admissions(), sessionInput(), 'selection-session-key-0001', undefined, selectionClock)
    const replay = await createAdmissionSelectionSession(admissions(), sessionInput(), 'selection-session-key-0001', undefined, selectionClock)
    expect(first.value).toMatchObject({ status: 'SCHEDULED', assignedCount: 0, version: 1, capacity: 20 })
    expect(replay).toMatchObject({ replayed: true, value: { id: first.value.id } })
    await expect(createAdmissionSelectionSession(admissions(['informatics-s1']), sessionInput(), 'selection-session-key-0002', undefined, selectionClock))
      .rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' } satisfies Partial<CampusError>)
  })

  it('atomically assigns only paid, document-verified applicants', async () => {
    const ready = await selectionReady('3173010101011001', 'selection.ready@example.test', '1001')
    const unready = (await submitAdmissionApplication(
      submission('3173010101011002', 'selection.unready@example.test'), 'selection-unready-submit', null, undefined, selectionClock,
    )).application
    const session = (await createAdmissionSelectionSession(admissions(), sessionInput(), 'selection-session-assign-01', undefined, selectionClock)).value
    const assigned = await assignApplicantToSelectionSession(admissions(), session.id, ready.id, 'selection-assignment-key-01', undefined, selectionClock)
    expect(assigned.value).toMatchObject({ applicationId: ready.id, status: 'SCHEDULED' })
    expect(admissionSelectionModuleState().sessions.get(session.id)?.assignedCount).toBe(1)
    await expect(assignApplicantToSelectionSession(admissions(), session.id, unready.id, 'selection-assignment-key-02', undefined, selectionClock))
      .rejects.toMatchObject({ code: 'APPLICATION_NOT_SELECTION_READY' } satisfies Partial<CampusError>)
  })

  it('prevents capacity overflow and overlapping applicant schedules', async () => {
    const firstApplicant = await selectionReady('3173010101011011', 'selection.one@example.test', '1011')
    const secondApplicant = await selectionReady('3173010101011012', 'selection.two@example.test', '1012')
    const firstSession = (await createAdmissionSelectionSession(admissions(), sessionInput({ capacity: 1 }), 'selection-capacity-session-1', undefined, selectionClock)).value
    await assignApplicantToSelectionSession(admissions(), firstSession.id, firstApplicant.id, 'selection-capacity-assign-1', undefined, selectionClock)
    await expect(assignApplicantToSelectionSession(admissions(), firstSession.id, secondApplicant.id, 'selection-capacity-assign-2', undefined, selectionClock))
      .rejects.toMatchObject({ code: 'SELECTION_SESSION_FULL' } satisfies Partial<CampusError>)

    const overlapping = (await createAdmissionSelectionSession(admissions(), sessionInput({ location: 'Ruang B', capacity: 20 }), 'selection-overlap-session', undefined, selectionClock)).value
    await expect(assignApplicantToSelectionSession(admissions(), overlapping.id, firstApplicant.id, 'selection-overlap-assign', undefined, selectionClock))
      .rejects.toMatchObject({ code: 'SELECTION_SCHEDULE_CONFLICT' } satisfies Partial<CampusError>)
  })

  it('lets only an assigned examiner or scoped PMB staff finalize an immutable score', async () => {
    const application = await selectionReady('3173010101011021', 'selection.score@example.test', '1021')
    const session = (await createAdmissionSelectionSession(admissions(), sessionInput(), 'selection-score-session', undefined, selectionClock)).value
    const assignment = (await assignApplicantToSelectionSession(admissions(), session.id, application.id, 'selection-score-assignment', undefined, selectionClock)).value
    const input = {
      components: [
        { key: 'communication', label: 'Komunikasi', score: 42, maximumScore: 50 },
        { key: 'motivation', label: 'Motivasi studi', score: 45, maximumScore: 50 },
      ],
      recommendation: 'ACCEPT' as const,
    }
    await expect(reviewAdmissionApplication(admissions(), application.id, {
      status: 'ACCEPTED', expectedVersion: application.version,
    }, 'selection-decision-too-early'))
      .rejects.toMatchObject({ code: 'SELECTION_NOT_FINAL' } satisfies Partial<CampusError>)
    await expect(finalizeAdmissionSelectionScore(authContext('other-examiner', ['lecturer']), assignment.id, input, 'selection-score-wrong-user', undefined, scoreClock))
      .rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' } satisfies Partial<CampusError>)
    const examiner = authContext('examiner-001', ['lecturer'])
    const score = await finalizeAdmissionSelectionScore(examiner, assignment.id, input, 'selection-score-final-001', undefined, scoreClock)
    expect(score.value).toMatchObject({ totalScore: 87, recommendation: 'ACCEPT', immutable: true })
    const { contentHash, ...base } = score.value
    expect(contentHash).toBe(requestHash(base))
    const replay = await finalizeAdmissionSelectionScore(examiner, assignment.id, input, 'selection-score-final-001', undefined, scoreClock)
    expect(replay.replayed).toBe(true)
    const decision = await reviewAdmissionApplication(admissions(), application.id, {
      status: 'ACCEPTED', expectedVersion: application.version,
    }, 'selection-decision-after-score')
    expect(decision.application.status).toBe('ACCEPTED')
    await expect(finalizeAdmissionSelectionScore(examiner, assignment.id, input, 'selection-score-final-002', undefined, scoreClock))
      .rejects.toMatchObject({ code: 'SELECTION_SCORE_FINAL' } satisfies Partial<CampusError>)
  })

  it('exposes assignments only to the applicant owner, scoped staff, or examiner', async () => {
    const claimed = await acceptedClaimed('3173010101011031', 'selection.owner@example.test', '1031')
    // Return the accepted record to document-verified solely for a synthetic assignment fixture.
    const stored = admissionModuleState().applications.get(claimed.application.id)!
    admissionModuleState().applications.set(stored.id, { ...stored, status: 'DOCUMENTS_VERIFIED' })
    const session = (await createAdmissionSelectionSession(admissions(), sessionInput(), 'selection-owner-session', undefined, selectionClock)).value
    await assignApplicantToSelectionSession(admissions(), session.id, claimed.application.id, 'selection-owner-assignment', undefined, selectionClock)
    expect(await listAdmissionSelectionAssignments(claimed.applicant)).toHaveLength(1)
    expect(await listAdmissionSelectionAssignments(authContext('unrelated-applicant', ['applicant']))).toHaveLength(0)
    expect(await listAdmissionSelectionAssignments(authContext('examiner-001', ['lecturer']))).toHaveLength(1)
  })

  it('issues unique, immutable LoA numbers under concurrent requests and safely replays', async () => {
    const left = await acceptedClaimed('3173010101011041', 'selection.loa.left@example.test', '1041')
    const right = await acceptedClaimed('3173010101011042', 'selection.loa.right@example.test', '1042')
    const [leftLetter, rightLetter] = await Promise.all([
      issueAdmissionLetterOfAcceptance(admissions(), left.application.id, left.application.version, 'selection-loa-issue-left', undefined, selectionClock),
      issueAdmissionLetterOfAcceptance(admissions(), right.application.id, right.application.version, 'selection-loa-issue-right', undefined, selectionClock),
    ])
    expect(new Set([leftLetter.value.documentNumber, rightLetter.value.documentNumber]).size).toBe(2)
    expect([leftLetter.value.documentNumber, rightLetter.value.documentNumber].sort()).toEqual([
      'LOA/MANAGEMENT-S1/2026/00001', 'LOA/MANAGEMENT-S1/2026/00002',
    ])
    for (const letter of [leftLetter.value, rightLetter.value]) {
      const { contentHash, ...base } = letter
      expect(contentHash).toBe(requestHash(base))
      expect(letter.verificationCode).toMatch(/^[A-F0-9]{32}$/)
    }
    const replay = await issueAdmissionLetterOfAcceptance(admissions(), left.application.id, left.application.version, 'selection-loa-issue-left', undefined, selectionClock)
    expect(replay).toMatchObject({ replayed: true, value: { documentNumber: leftLetter.value.documentNumber } })
  })

  it('limits LoA reads to the applicant owner or scoped staff and provides minimal verification', async () => {
    const claimed = await acceptedClaimed('3173010101011051', 'selection.verify@example.test', '1051')
    const issued = await issueAdmissionLetterOfAcceptance(admissions(), claimed.application.id, claimed.application.version, 'selection-loa-verify-issue', undefined, selectionClock)
    expect(await listAdmissionLetters(claimed.applicant)).toHaveLength(1)
    expect(await listAdmissionLetters(authContext('other-applicant', ['applicant']))).toHaveLength(0)
    const verification = await verifyAdmissionLetter(issued.value.verificationCode)
    expect(verification).toMatchObject({ valid: true, documentNumber: issued.value.documentNumber, status: 'ISSUED' })
    expect(await verifyAdmissionLetter('F'.repeat(32))).toEqual({ valid: false })
  })
})
