import { beforeEach, describe, expect, it } from 'vitest'
import {
  getGraduationDocument,
  graduationDocumentContentHash,
  issueGraduationDocument,
  listGraduationDocuments,
  publishGraduationTemplate,
  reissueGraduationDocument,
  revokeGraduationDocument,
  verifyGraduationDocument,
  verifyIssuedGraduationDocumentHash,
} from '../../server/services/graduation-documents'
import { submitGraduationApplication, transitionGraduationApplication } from '../../server/services/graduation'
import { graduationModuleState, resetGraduationModuleState } from '../../server/services/graduation-state'
import type { IssuedGraduationDocument } from '../../server/types/graduation'
import { CampusError } from '../../server/utils/errors'
import { resetMockState } from '../../server/utils/mock-store'
import { authContext } from './fixtures'

const periodId = 'period-yudisium-2026-02'
const registrationTime = new Date('2026-07-21T02:00:00.000Z')
const issuer = (uid = 'academic-issuer-001') => authContext(uid, ['academic_staff'], ['management-s1'])

function makeEligible(studentId: string): void {
  const state = graduationModuleState()
  const source = state.eligibilitySnapshots.get('student-001')!
  const target = state.eligibilitySnapshots.get(studentId)!
  state.eligibilitySnapshots.set(studentId, {
    ...structuredClone(source),
    id: `eligibility-${studentId}-eligible`,
    studentId,
    programStudyId: target.programStudyId,
  })
}

async function finalizedApplication(studentId: string, suffix: string) {
  if (studentId !== 'student-001') makeEligible(studentId)
  const submitted = await submitGraduationApplication(
    authContext(studentId, ['student'], []),
    { periodId, studentId },
    `graduation-document-submit-${suffix}`,
    undefined,
    registrationTime,
  )
  const firstReviewer = issuer(`academic-first-${suffix}`)
  const reviewing = await transitionGraduationApplication(firstReviewer, submitted.application.id, {
    transition: 'START_REVIEW', expectedVersion: submitted.application.version,
  }, `graduation-document-review-${suffix}`)
  const firstApproved = await transitionGraduationApplication(firstReviewer, submitted.application.id, {
    transition: 'FIRST_APPROVE', expectedVersion: reviewing.application.version,
  }, `graduation-document-first-${suffix}`)
  return (await transitionGraduationApplication(issuer(`academic-final-${suffix}`), submitted.application.id, {
    transition: 'FINAL_APPROVE', expectedVersion: firstApproved.application.version,
  }, `graduation-document-final-${suffix}`)).application
}

describe('controlled graduation document issuance', () => {
  beforeEach(() => {
    process.env.CAMPUS_DATA_MODE = 'mock'
    process.env.NODE_ENV = 'test'
    resetMockState()
    resetGraduationModuleState()
  })

  it('allocates unique monotonic numbers under concurrent issuance', async () => {
    const [left, right] = await Promise.all([
      finalizedApplication('student-001', 'counter-left-0001'),
      finalizedApplication('student-002', 'counter-right-0001'),
    ])
    const [leftDocument, rightDocument] = await Promise.all([
      issueGraduationDocument(issuer(), { applicationId: left.id, type: 'DECREE' }, 'graduation-issue-counter-left-0001'),
      issueGraduationDocument(issuer(), { applicationId: right.id, type: 'DECREE' }, 'graduation-issue-counter-right-0001'),
    ])

    const numbers = [leftDocument.document.documentNumber, rightDocument.document.documentNumber].sort()
    expect(new Set(numbers).size).toBe(2)
    expect(numbers.map(number => number.slice(-5))).toEqual(['00001', '00002'])
    expect(graduationModuleState().counters.get('DECREE:2026:management-s1')).toBe(2)
  })

  it('freezes the template and render payload behind a deterministic immutable hash', async () => {
    const application = await finalizedApplication('student-001', 'immutable-0001')
    const issued = await issueGraduationDocument(issuer(), {
      applicationId: application.id,
      type: 'TRANSCRIPT',
    }, 'graduation-issue-immutable-0001')
    const originalHash = issued.document.contentHash
    const originalTitle = issued.document.renderPayload.title
    const source = [...graduationModuleState().templates.values()].find(template => template.type === 'TRANSCRIPT' && template.status === 'ACTIVE')!
    await publishGraduationTemplate(authContext('admin-001', ['administrator'], []), source.id, {
      expectedVersion: source.version,
      name: 'Transkrip versi baru',
      layout: { ...structuredClone(source.layout), title: 'Transkrip Akademik Versi Baru' },
    }, 'graduation-template-publish-immutable-0001')

    const stored = graduationModuleState().documents.get(issued.document.id)!
    expect(stored.contentHash).toBe(originalHash)
    expect(stored.renderPayload.title).toBe(originalTitle)
    expect(verifyIssuedGraduationDocumentHash(stored)).toBe(true)
    expect(graduationDocumentContentHash(stored.templateSnapshot, stored.renderPayload)).toBe(originalHash)

    const returned = await getGraduationDocument(authContext('student-001', ['student'], []), issued.document.id)
    returned.renderPayload.title = 'Tampered client copy'
    expect(graduationModuleState().documents.get(issued.document.id)!.renderPayload.title).toBe(originalTitle)
    const tampered = structuredClone(stored) as IssuedGraduationDocument
    tampered.renderPayload.fields[0]!.value = 'Nama Palsu'
    expect(verifyIssuedGraduationDocumentHash(tampered)).toBe(false)
    expect(await verifyGraduationDocument(authContext('student-001', ['student'], []), stored.verificationCode))
      .toMatchObject({ valid: true, contentHashMatches: true, documentNumber: stored.documentNumber })
  })

  it('preserves revoked originals and creates an auditable reissue with a fresh number', async () => {
    const application = await finalizedApplication('student-001', 'reissue-0001')
    const issued = await issueGraduationDocument(issuer(), {
      applicationId: application.id,
      type: 'DIPLOMA',
    }, 'graduation-issue-reissue-0001')
    const revoked = await revokeGraduationDocument(issuer(), issued.document.id, {
      expectedVersion: 1,
      reason: 'Kesalahan ejaan nama pada sumber resmi',
    }, 'graduation-revoke-0001')
    const revokeReplay = await revokeGraduationDocument(issuer(), issued.document.id, {
      expectedVersion: 1,
      reason: 'Kesalahan ejaan nama pada sumber resmi',
    }, 'graduation-revoke-0001')

    expect(revoked.document).toMatchObject({ status: 'REVOKED', version: 2 })
    expect(revokeReplay.replayed).toBe(true)
    expect(await verifyGraduationDocument(authContext('student-001', ['student'], []), issued.document.verificationCode))
      .toMatchObject({ valid: false, status: 'REVOKED', contentHashMatches: true })

    const reissued = await reissueGraduationDocument(issuer(), issued.document.id, {
      expectedVersion: revoked.document.version,
      reason: 'Penerbitan koreksi setelah data sumber diperbaiki',
    }, 'graduation-reissue-0001')
    const replay = await reissueGraduationDocument(issuer(), issued.document.id, {
      expectedVersion: revoked.document.version,
      reason: 'Penerbitan koreksi setelah data sumber diperbaiki',
    }, 'graduation-reissue-0001')

    expect(reissued.document).toMatchObject({ status: 'ISSUED', version: 1, reissueOf: issued.document.id })
    expect(reissued.document.documentNumber).not.toBe(issued.document.documentNumber)
    expect(reissued.sourceDocument).toMatchObject({ id: issued.document.id, status: 'REVOKED', version: 3 })
    expect(reissued.sourceDocument.history.at(-1)).toMatchObject({ action: 'REISSUED_AS', relatedDocumentId: reissued.document.id })
    expect(reissued.document.history[0]).toMatchObject({ action: 'REISSUED_FROM', relatedDocumentId: issued.document.id })
    expect(replay).toMatchObject({ replayed: true, document: { id: reissued.document.id } })
    expect(await verifyGraduationDocument(authContext('student-001', ['student'], []), reissued.document.verificationCode))
      .toMatchObject({ valid: true, status: 'ISSUED' })
  })

  it('prevents duplicate assignments and enforces owner, role, and program visibility', async () => {
    const application = await finalizedApplication('student-001', 'scope-0001')
    const issued = await issueGraduationDocument(issuer(), {
      applicationId: application.id,
      type: 'SKPI',
    }, 'graduation-issue-scope-0001')

    await expect(issueGraduationDocument(issuer(), {
      applicationId: application.id,
      type: 'SKPI',
    }, 'graduation-issue-duplicate-0001')).rejects.toMatchObject({ code: 'DOCUMENT_ALREADY_ASSIGNED' } satisfies Partial<CampusError>)
    await expect(getGraduationDocument(authContext('student-999', ['student'], []), issued.document.id))
      .rejects.toMatchObject({ statusCode: 403 } satisfies Partial<CampusError>)
    await expect(getGraduationDocument(authContext('academic-info-001', ['academic_staff'], ['informatics-s1']), issued.document.id))
      .rejects.toMatchObject({ statusCode: 403 } satisfies Partial<CampusError>)
    expect(await listGraduationDocuments(authContext('student-999', ['student'], []))).toEqual([])
    expect(await verifyGraduationDocument(authContext('student-999', ['student'], []), issued.document.verificationCode))
      .toEqual({ valid: false, verificationCode: issued.document.verificationCode })
    expect((await listGraduationDocuments(authContext('student-001', ['student'], []))).map(item => item.id)).toEqual([issued.document.id])
    await expect(getGraduationDocument(authContext('leader-001', ['leader'], []), issued.document.id))
      .rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' } satisfies Partial<CampusError>)
  })

  it('returns a deterministic print payload and explicitly does not claim to generate a credential PDF', async () => {
    const application = await finalizedApplication('student-001', 'render-0001')
    const result = await issueGraduationDocument(issuer(), {
      applicationId: application.id,
      type: 'DECREE',
    }, 'graduation-issue-render-0001')

    expect(result.document.renderPayload).toMatchObject({
      documentType: 'DECREE',
      documentNumber: result.document.documentNumber,
      verificationCode: result.document.verificationCode,
      limitation: 'DETERMINISTIC_RENDER_PAYLOAD_ONLY_NO_CREDENTIAL_PDF',
    })
    expect(JSON.stringify(result.document.renderPayload)).not.toMatch(/pdfUrl|downloadUrl|signedUrl/i)
  })
})
