import { beforeEach, describe, expect, it } from 'vitest'
import type { IssuedGraduationDocument } from '../../server/types/graduation'
import type { AuthContext } from '../../server/types/auth'
import type { TracerAlumniProfile, TracerCareerData, TracerQuestionDefinition } from '../../server/types/tracer-study'
import { graduationModuleState, resetGraduationModuleState } from '../../server/services/graduation-state'
import {
  createTracerPeriod,
  createTracerQuestionnaire,
  hashTracerAccessToken,
  listOwnTracerAssignments,
  listTracerRespondents,
  resolveTracerAccessToken,
  submitTracerResponse,
  updateTracerPeriod,
  updateTracerQuestionnaire,
  withdrawTracerConsent,
} from '../../server/services/tracer-study'
import { sendTracerCampaign, type TracerEmailDeliveryHook } from '../../server/services/tracer-study-campaigns'
import {
  generateTracerOutcomeReport,
  safeTracerCsvCell,
  tracerOutcomeReportToCsv,
} from '../../server/services/tracer-study-reporting'
import {
  resetTracerStudyMockState,
  seedTracerAlumniForTests,
  tracerStudyMockState,
} from '../../server/services/tracer-study-mock'
import { CampusError } from '../../server/utils/errors'
import { mockState, resetMockState } from '../../server/utils/mock-store'
import { authContext } from './fixtures'

const staff = authContext('student-affairs-001', ['student_affairs_staff'], ['management-s1'])
const admin = authContext('admin-001', ['administrator'], [])
const leader = authContext('leader-001', ['leader'], [])
const testNow = Date.parse('2026-07-10T12:00:00.000Z')
const questions: TracerQuestionDefinition[] = [
  { id: 'fit', label: 'Kesesuaian kompetensi', type: 'SINGLE_CHOICE', required: true, options: [
    { value: 'LOW', label: 'Rendah' }, { value: 'HIGH', label: 'Tinggi' },
  ] },
  { id: 'private_note', label: 'Catatan pribadi', type: 'TEXT', required: false },
]
const career: TracerCareerData = {
  employmentStatus: 'EMPLOYED', waitMonths: 2, fieldAlignment: 4, incomeRange: '3M_TO_6M',
  organizationName: 'Organisasi Rahasia', workLocation: 'Jakarta',
}

function alumni(index: number, options: Partial<TracerAlumniProfile> = {}): TracerAlumniProfile {
  return {
    id: `alumni-${index}`, userUid: `alumni-user-${index}`, studentId: `student-${index}`,
    studentNumber: `NIM-${index}`, displayName: `Alumni Rahasia ${index}`, email: `alumni-${index}@example.test`,
    programStudyId: 'management-s1', programStudyName: 'S1 Manajemen', graduationYear: 2025,
    graduatedAt: '2025-08-30T00:00:00.000Z', contactable: true, ...options,
  }
}

function deliveryCapture() {
  const byEmail = new Map<string, string>()
  const calls: Array<{ email: string; body: string }> = []
  const hook: TracerEmailDeliveryHook = async (request) => {
    calls.push({ email: request.recipientEmail, body: request.textBody })
    const token = request.textBody.match(/access_token=([A-Za-z0-9_-]+)/)?.[1]
    if (!token) throw new Error('TOKEN_MISSING')
    byEmail.set(request.recipientEmail, token)
    return { providerMessageId: `provider-${calls.length}` }
  }
  return { byEmail, calls, hook }
}

async function setup(options: { alumniCount?: number; minimumCellSize?: number } = {}) {
  for (let index = 1; index <= (options.alumniCount ?? 1); index++) seedTracerAlumniForTests(alumni(index))
  const questionnaire = await createTracerQuestionnaire(staff, {
    name: 'Tracer Outcome', programStudyId: 'management-s1', questions,
  }, 'tracer-questionnaire-setup-0001')
  const created = await createTracerPeriod(staff, {
    name: 'Tracer Alumni 2025', questionnaireId: questionnaire.questionnaire.id,
    questionnaireVersion: questionnaire.definition.version, programStudyIds: ['management-s1'],
    graduationYearFrom: 2025, graduationYearTo: 2025,
    opensAt: '2026-07-01T00:00:00.000Z', closesAt: '2026-07-31T00:00:00.000Z',
    accessTokenTtlHours: 168, minimumCellSize: options.minimumCellSize ?? 3,
    consentVersion: 'CONSENT-2026-01', consentNotice: 'Saya setuju untuk statistik agregat dan dapat menarik persetujuan.',
  }, 'tracer-period-setup-key-0001')
  const active = await updateTracerPeriod(staff, created.period.id, {
    expectedVersion: 1, status: 'ACTIVE', name: created.period.name, programStudyIds: created.period.programStudyIds,
    graduationYearFrom: created.period.graduationYearFrom, graduationYearTo: created.period.graduationYearTo,
    opensAt: created.period.opensAt, closesAt: created.period.closesAt,
    accessTokenTtlHours: created.period.accessTokenTtlHours, minimumCellSize: created.period.minimumCellSize,
    consentVersion: created.period.consentVersion, consentNotice: created.period.consentNotice,
  })
  const delivery = deliveryCapture()
  const campaign = await sendTracerCampaign(staff, { periodId: active.period.id, kind: 'INITIAL' }, 'tracer-campaign-setup-0001', undefined, testNow, delivery.hook)
  return { questionnaire, period: active.period, delivery, campaign }
}

async function submitToken(token: string, key: string, note = 'Isi jawaban sangat rahasia') {
  return submitTracerResponse(null, {
    accessToken: token, consentAccepted: true, consentVersion: 'CONSENT-2026-01', career,
    answers: [{ questionId: 'fit', value: 'HIGH' }, { questionId: 'private_note', value: note }],
  }, key, undefined, testNow + 1_000)
}

describe('tracer study security, privacy, and workflow', () => {
  beforeEach(() => {
    process.env.CAMPUS_DATA_MODE = 'mock'
    resetMockState()
    resetTracerStudyMockState({ seedDemo: false })
    resetGraduationModuleState()
  })

  it('stores only token hashes, enforces TTL, and allows only one response per access token', async () => {
    const { period, delivery } = await setup()
    const token = delivery.byEmail.get('alumni-1@example.test')!
    expect(token).toMatch(/^[A-Za-z0-9_-]{32,}$/)
    expect(hashTracerAccessToken(token)).toHaveLength(64)
    const stored = [...tracerStudyMockState().tokens.values()].find(item => item.purpose === 'ACCESS')!
    expect(stored).toMatchObject({ tokenHash: hashTracerAccessToken(token), status: 'ACTIVE', periodId: period.id })
    expect(stored).not.toHaveProperty('token')
    expect(JSON.stringify({
      campaigns: [...tracerStudyMockState().campaigns.values()],
      deliveries: [...tracerStudyMockState().deliveries.values()],
      tokens: [...tracerStudyMockState().tokens.values()],
    })).not.toContain(token)

    stored.expiresAt = new Date(testNow - 1).toISOString()
    tracerStudyMockState().tokens.set(stored.id, stored)
    await expect(resolveTracerAccessToken(token, { now: testNow })).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' } satisfies Partial<CampusError>)
    stored.expiresAt = new Date(testNow + 60_000).toISOString()
    tracerStudyMockState().tokens.set(stored.id, stored)

    const first = await submitToken(token, 'tracer-submit-once-0001')
    const replay = await submitToken(token, 'tracer-submit-once-0001')
    expect(first).toMatchObject({ replayed: false })
    expect(first.withdrawalToken).toMatch(/^[A-Za-z0-9_-]{32,}$/)
    expect(replay).toMatchObject({ replayed: true, receiptId: first.receiptId })
    expect(replay.withdrawalToken).toBeUndefined()
    expect(tracerStudyMockState().responses).toHaveLength(1)
    await expect(submitToken(token, 'tracer-submit-replay-0002')).rejects.toMatchObject({ code: 'TOKEN_REPLAYED' } satisfies Partial<CampusError>)
  })

  it('requires explicit versioned consent and clears response data after withdrawal', async () => {
    const { period, delivery } = await setup()
    const token = delivery.byEmail.get('alumni-1@example.test')!
    await expect(submitTracerResponse(null, {
      accessToken: token, consentAccepted: false, consentVersion: period.consentVersion, career,
      answers: [{ questionId: 'fit', value: 'HIGH' }],
    }, 'tracer-no-consent-0001', undefined, testNow + 1_000)).rejects.toMatchObject({ code: 'INVALID_INPUT' } satisfies Partial<CampusError>)
    expect([...tracerStudyMockState().tokens.values()].find(item => item.purpose === 'ACCESS')?.status).toBe('ACTIVE')

    const submitted = await submitToken(token, 'tracer-consent-submit-0001')
    const response = [...tracerStudyMockState().responses.values()][0]!
    expect(response.career?.organizationName).toBe('Organisasi Rahasia')
    const withdrawn = await withdrawTracerConsent(null, {
      withdrawalToken: submitted.withdrawalToken, expectedConsentVersion: 1,
    }, 'tracer-withdraw-consent-0001', undefined, testNow + 2_000)
    expect(withdrawn).toMatchObject({ status: 'WITHDRAWN', replayed: false })
    expect(tracerStudyMockState().responses.get(response.id)).toMatchObject({ status: 'WITHDRAWN', answers: [] })
    expect(tracerStudyMockState().responses.get(response.id)?.career).toBeUndefined()
    expect([...tracerStudyMockState().consents.values()][0]).toMatchObject({ status: 'WITHDRAWN', version: 2 })
    const report = await generateTracerOutcomeReport(staff, { periodId: period.id, groupBy: 'program' })
    expect(report.groups).toEqual([])
    const replay = await withdrawTracerConsent(null, {
      withdrawalToken: submitted.withdrawalToken, expectedConsentVersion: 1,
    }, 'tracer-withdraw-consent-0001', undefined, testNow + 2_000)
    expect(replay.replayed).toBe(true)
  })

  it('enforces alumni ownership, staff program scope, leader aggregate-only access, and links owned issued SKPI', async () => {
    const { period } = await setup()
    const recipient = [...tracerStudyMockState().recipients.values()][0]!
    graduationModuleState().documents.set('skpi-issued-001', {
      id: 'skpi-issued-001', studentId: 'student-1', studentUid: 'alumni-user-1', programStudyId: 'management-s1',
      type: 'SKPI', documentNumber: 'SKPI/MGT/2025/001', status: 'ISSUED', issuedAt: '2025-09-01T00:00:00.000Z',
    } as IssuedGraduationDocument)
    const owner = authContext('alumni-user-1', ['student'])
    const assignments = await listOwnTracerAssignments(owner, testNow)
    expect(assignments).toHaveLength(1)
    expect(assignments[0]).toMatchObject({ recipientId: recipient.id, skpiReferences: [{ documentId: 'skpi-issued-001', documentNumber: 'SKPI/MGT/2025/001' }] })
    expect(assignments[0]?.skpiReferences[0]?.href).toContain('/api/graduation/documents/skpi-issued-001/render')
    expect(await listOwnTracerAssignments(authContext('someone-else', ['student']), testNow)).toEqual([])

    const outsider = authContext('affairs-other', ['student_affairs_staff'], ['informatics-s1'])
    await expect(listTracerRespondents(outsider, period.id)).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' } satisfies Partial<CampusError>)
    await expect(generateTracerOutcomeReport(outsider, { periodId: period.id, groupBy: 'program' })).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' } satisfies Partial<CampusError>)
    await expect(listTracerRespondents(leader, period.id)).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' } satisfies Partial<CampusError>)
    await expect(generateTracerOutcomeReport(leader, { periodId: period.id, groupBy: 'program' })).resolves.toMatchObject({ method: 'DESCRIPTIVE_ONLY' })
  })

  it('suppresses small cells and never leaks respondent identity or free-text into aggregate JSON or CSV', async () => {
    const { period, delivery } = await setup({ alumniCount: 3, minimumCellSize: 3 })
    await submitToken(delivery.byEmail.get('alumni-1@example.test')!, 'tracer-threshold-submit-0001', '=PRIVATE_ONE')
    await submitToken(delivery.byEmail.get('alumni-2@example.test')!, 'tracer-threshold-submit-0002', '@PRIVATE_TWO')
    const suppressed = await generateTracerOutcomeReport(staff, { periodId: period.id, groupBy: 'program' })
    expect(suppressed.groups).toEqual([expect.objectContaining({ suppressed: true, responseCount: null, employmentStatus: {}, incomeRange: {} })])
    expect(JSON.stringify(suppressed)).not.toContain('Alumni Rahasia')
    expect(JSON.stringify(suppressed)).not.toContain('alumni-1@example.test')
    expect(JSON.stringify(suppressed)).not.toContain('PRIVATE_ONE')

    await submitToken(delivery.byEmail.get('alumni-3@example.test')!, 'tracer-threshold-submit-0003', '+PRIVATE_THREE')
    await expect(generateTracerOutcomeReport(admin, { periodId: period.id, groupBy: 'program' }))
      .rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' } satisfies Partial<CampusError>)
    const report = await generateTracerOutcomeReport(staff, { periodId: period.id, groupBy: 'program' })
    expect(report.groups[0]).toMatchObject({ suppressed: false, responseCount: 3, averageWaitMonths: 2, averageFieldAlignment: 4 })
    expect(report.groups[0]?.employmentStatus.EMPLOYED).toEqual({ count: 3, percent: 100 })
    const csv = tracerOutcomeReportToCsv(report)
    expect(csv.startsWith('\uFEFF')).toBe(true)
    for (const secret of ['Alumni Rahasia', 'alumni-1@example.test', 'student-1', 'PRIVATE_ONE', 'Organisasi Rahasia']) expect(csv).not.toContain(secret)
    expect(safeTracerCsvCell('=HYPERLINK("https://invalid")')).toBe('"\'=HYPERLINK(""https://invalid"")"')
    expect(safeTracerCsvCell('+SUM(1,1)')).toBe('"\'+SUM(1,1)"')
    expect(report.confidentiality).toEqual({ respondentIdentityIncluded: false, freeTextIncluded: false, smallCellsSuppressed: true, minimumCellSize: 3 })
  })

  it('deduplicates reminders and skips completed respondents without persisting one-time links', async () => {
    const { period, delivery } = await setup({ alumniCount: 2 })
    await submitToken(delivery.byEmail.get('alumni-1@example.test')!, 'tracer-reminder-complete-0001')
    const reminder = deliveryCapture()
    const first = await sendTracerCampaign(staff, {
      periodId: period.id, kind: 'REMINDER', reminderSequence: 1,
    }, 'tracer-reminder-send-0001', undefined, testNow + 3_000, reminder.hook)
    expect(first.campaign).toMatchObject({ sentCount: 1, skippedCount: 0 })
    expect(reminder.calls).toHaveLength(1)
    const duplicateHook = deliveryCapture()
    const duplicate = await sendTracerCampaign(staff, {
      periodId: period.id, kind: 'REMINDER', reminderSequence: 1,
    }, 'tracer-reminder-send-0002', undefined, testNow + 4_000, duplicateHook.hook)
    expect(duplicate.campaign).toMatchObject({ sentCount: 0, skippedCount: 1 })
    expect(duplicateHook.calls).toHaveLength(0)
    expect(JSON.stringify([...tracerStudyMockState().deliveries.values()])).not.toContain(reminder.byEmail.get('alumni-2@example.test'))
  })

  it('enforces optimistic concurrency, idempotency, audit, and one-way period transitions', async () => {
    seedTracerAlumniForTests(alumni(1))
    const created = await createTracerQuestionnaire(staff, {
      name: 'Versioned tracer', programStudyId: 'management-s1', questions,
    }, 'tracer-versioned-form-0001')
    const replay = await createTracerQuestionnaire(staff, {
      name: 'Versioned tracer', programStudyId: 'management-s1', questions,
    }, 'tracer-versioned-form-0001')
    expect(replay).toMatchObject({ replayed: true, questionnaire: { id: created.questionnaire.id } })
    await expect(createTracerQuestionnaire(staff, {
      name: 'Different payload', programStudyId: 'management-s1', questions,
    }, 'tracer-versioned-form-0001')).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' } satisfies Partial<CampusError>)
    const updated = await updateTracerQuestionnaire(staff, created.questionnaire.id, {
      expectedVersion: 1, name: 'Versioned tracer v2', programStudyId: 'management-s1', questions,
    })
    expect(updated).toMatchObject({ questionnaire: { version: 2, currentVersion: 2 }, definition: { version: 2 } })
    await expect(updateTracerQuestionnaire(staff, created.questionnaire.id, {
      expectedVersion: 1, name: 'Stale', programStudyId: 'management-s1', questions,
    })).rejects.toMatchObject({ code: 'VERSION_CONFLICT' } satisfies Partial<CampusError>)

    const period = await createTracerPeriod(staff, {
      name: 'Transition period', questionnaireId: created.questionnaire.id, questionnaireVersion: 1,
      programStudyIds: ['management-s1'], graduationYearFrom: 2025, graduationYearTo: 2025,
      opensAt: '2026-07-01T00:00:00.000Z', closesAt: '2026-07-31T00:00:00.000Z',
      accessTokenTtlHours: 24, minimumCellSize: 3, consentVersion: 'CONSENT-1', consentNotice: 'Persetujuan agregat dapat ditarik kembali.',
    }, 'tracer-transition-period-0001')
    const update = (expectedVersion: number, status: 'DRAFT' | 'ACTIVE' | 'CLOSED') => updateTracerPeriod(staff, period.period.id, {
      expectedVersion, status, name: period.period.name, programStudyIds: period.period.programStudyIds,
      graduationYearFrom: 2025, graduationYearTo: 2025, opensAt: period.period.opensAt, closesAt: period.period.closesAt,
      accessTokenTtlHours: 24, minimumCellSize: 3, consentVersion: 'CONSENT-1', consentNotice: 'Persetujuan agregat dapat ditarik kembali.',
    })
    await update(1, 'ACTIVE')
    await expect(update(2, 'DRAFT')).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' } satisfies Partial<CampusError>)
    await update(2, 'CLOSED')
    await expect(update(3, 'ACTIVE')).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' } satisfies Partial<CampusError>)
    expect(mockState().auditEntries.some(entry => entry.action === 'TRACER_QUESTIONNAIRE_CREATED')).toBe(true)
    expect(JSON.stringify(mockState().auditEntries)).not.toContain('Isi jawaban sangat rahasia')
  })

  it('does not accept a forged authenticated recipient reference', async () => {
    const { delivery } = await setup()
    const recipient = [...tracerStudyMockState().recipients.values()][0]!
    const attacker: AuthContext = authContext('attacker', ['student'])
    await expect(submitTracerResponse(attacker, {
      recipientId: recipient.id, consentAccepted: true, consentVersion: 'CONSENT-2026-01', career,
      answers: [{ questionId: 'fit', value: 'HIGH' }],
    }, 'tracer-owner-forgery-0001', undefined, testNow + 1_000)).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' } satisfies Partial<CampusError>)
    expect(delivery.calls).toHaveLength(1)
  })
})
