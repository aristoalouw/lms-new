import { beforeEach, describe, expect, it } from 'vitest'
import {
  addCaseStaffNote,
  appendPointAdjustment,
  applyForScholarship,
  configurePointPolicy,
  createPortfolioRecord,
  createViolationCase,
  getLetterDownloadReference,
  getPointLedger,
  getViolationCase,
  issueActiveStudentLetter,
  listLetterRequests,
  listPortfolio,
  listScholarshipApplications,
  requestActiveStudentLetter,
  resetStudentAffairsStateForTests,
  respondToViolationCase,
  reviewPortfolioRecord,
  reviewRequirementDocument,
  studentAffairsStateForTests,
  submitRequirementDocument,
  transitionLetterRequest,
  transitionScholarshipApplication,
  transitionViolationCase,
} from '../../server/services/student-affairs'
import { requestHash } from '../../server/utils/security'
import { mockState, resetMockState } from '../../server/utils/mock-store'
import type { CampusError } from '../../server/utils/errors'
import { authContext } from './fixtures'

const clock = new Date('2026-07-21T08:00:00.000Z')
const query = { page: 1, pageSize: 20 }
const student = (id: string, programStudyId = 'management-s1') => {
  const context = authContext(id, ['student'], [programStudyId])
  context.scope.studentIds = [id]
  return context
}
const staff = (programStudyId = 'management-s1') => authContext(`student-affairs-${programStudyId}`, ['student_affairs_staff'], [programStudyId])
const administrator = () => authContext('admin-student-affairs', ['administrator'], [])
const leader = () => authContext('leader-001', ['leader'], [])
const file = (fileId: string, checksum = '1'.repeat(64)) => ({
  fileId,
  fileName: `${fileId}.pdf`,
  mimeType: 'application/pdf',
  sizeBytes: 42_000,
  checksumSha256: checksum,
})

beforeEach(() => {
  process.env.CAMPUS_DATA_MODE = 'mock'
  resetMockState()
  resetStudentAffairsStateForTests()
})

describe('student affairs scope and portfolio points', () => {
  it('fails closed across student ownership and staff program scope without leader drill-down', async () => {
    const own = await listPortfolio(student('student-001'), query)
    const management = await listPortfolio(staff(), query)
    const outside = await listPortfolio(staff('accounting-s1'), query)

    expect(new Set(own.items.map((item) => item.studentId))).toEqual(new Set(['student-001']))
    expect(new Set(management.items.map((item) => item.programStudyId))).toEqual(new Set(['management-s1']))
    expect(outside.items).toEqual([])
    await expect(listPortfolio(leader(), query))
      .rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' } satisfies Partial<CampusError>)
    await expect(listPortfolio(student('student-001'), { ...query, studentId: 'student-002' }))
      .rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' } satisfies Partial<CampusError>)
  })

  it('accepts evidence metadata only and never accepts raw content or URLs', async () => {
    const payload = {
      kind: 'ACTIVITY', title: 'Relawan literasi kampus', category: 'VOLUNTEERING', level: 'CAMPUS',
      roleOrRank: 'Fasilitator', organization: 'Komunitas Literasi', occurredAt: '2026-07-18T08:00:00.000Z',
      evidence: [{ ...file('evidence-literacy'), content: 'raw-payload-that-must-not-be-stored' }],
    }
    await expect(createPortfolioRecord(student('student-001'), payload, 'portfolio-evidence-key-0001', undefined, clock))
      .rejects.toMatchObject({ statusCode: 400, code: 'INVALID_INPUT' } satisfies Partial<CampusError>)
    await expect(createPortfolioRecord(student('student-001'), { ...payload, evidence: [] }, 'portfolio-evidence-key-0002', undefined, clock))
      .rejects.toMatchObject({ statusCode: 400, code: 'INVALID_INPUT' } satisfies Partial<CampusError>)

    const saved = await createPortfolioRecord(student('student-001'), { ...payload, evidence: [file('evidence-literacy')] }, 'portfolio-evidence-key-0003', undefined, clock)
    expect(saved.value.evidence).toEqual([file('evidence-literacy')])
    expect(JSON.stringify(mockState().auditEntries[0])).not.toContain('raw-payload')
  })

  it('posts a verified portfolio award to the append-only ledger exactly once', async () => {
    const created = await createPortfolioRecord(student('student-001'), {
      kind: 'ACTIVITY', title: 'Relawan literasi kampus', category: 'VOLUNTEERING', level: 'CAMPUS',
      roleOrRank: 'Fasilitator', organization: 'Komunitas Literasi', occurredAt: '2026-07-18T08:00:00.000Z', evidence: [file('evidence-award')],
    }, 'portfolio-ledger-create-0001', undefined, clock)
    const review = { decision: 'VERIFY', ruleId: 'activity-campus', reviewNote: 'Bukti kegiatan telah diverifikasi.', expectedVersion: 1 }
    const first = await reviewPortfolioRecord(staff(), created.value.id, review, 'portfolio-ledger-review-0001', undefined, clock)
    const replay = await reviewPortfolioRecord(staff(), created.value.id, review, 'portfolio-ledger-review-0001', undefined, new Date('2026-07-22T08:00:00.000Z'))
    const ledger = await getPointLedger(student('student-001'), 'student-001')

    expect(first.value).toMatchObject({ status: 'VERIFIED', awardedPoints: 20, version: 2 })
    expect(replay.replayed).toBe(true)
    expect(ledger.entries.filter((entry) => entry.sourceId === created.value.id)).toHaveLength(1)
    expect(ledger.entries.every((entry) => entry.immutable)).toBe(true)
    const exposed = studentAffairsStateForTests()
    exposed.pointLedger.clear()
    expect((await getPointLedger(student('student-001'), 'student-001')).entries.length).toBeGreaterThan(0)
  })

  it('enforces point-policy versions, adjustment limits, and payload-bound idempotency', async () => {
    const adjustment = { studentId: 'student-001', points: 15, reason: 'Kontribusi khusus pada program pengabdian kampus.', expectedPolicyVersion: 1 }
    const first = await appendPointAdjustment(staff(), adjustment, 'point-adjustment-key-0001', undefined, clock)
    const replay = await appendPointAdjustment(staff(), adjustment, 'point-adjustment-key-0001', undefined, clock)
    expect(first.value.immutable).toBe(true)
    expect(replay).toMatchObject({ replayed: true, value: { id: first.value.id } })
    await expect(appendPointAdjustment(staff(), { ...adjustment, points: 16 }, 'point-adjustment-key-0001', undefined, clock))
      .rejects.toMatchObject({ statusCode: 409, code: 'IDEMPOTENCY_KEY_REUSED' } satisfies Partial<CampusError>)
    await expect(appendPointAdjustment(staff(), { ...adjustment, points: 101 }, 'point-adjustment-key-0002', undefined, clock))
      .rejects.toMatchObject({ statusCode: 400, code: 'INVALID_INPUT' } satisfies Partial<CampusError>)
    await expect(configurePointPolicy(staff(), 'management-s1', {
      expectedVersion: 0, adjustmentLimit: 100,
      rules: [{ id: 'activity-campus', label: 'Kegiatan kampus', portfolioKind: 'ACTIVITY', level: 'CAMPUS', points: 20 }],
    }, 'point-policy-stale-0001', undefined, clock)).rejects.toMatchObject({ statusCode: 409, code: 'VERSION_CONFLICT' } satisfies Partial<CampusError>)
  })
})

describe('student violation due process and redaction', () => {
  it('redacts staff-only notes from students and prevents cross-student reads', async () => {
    const own = await getViolationCase(student('student-001'), 'case-2026-001')
    const staffView = await getViolationCase(staff(), 'case-2026-001')
    expect('staffNotes' in own).toBe(false)
    expect('staffNotes' in staffView && staffView.staffNotes).toHaveLength(1)
    await expect(getViolationCase(student('student-002'), 'case-2026-001'))
      .rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' } satisfies Partial<CampusError>)
    await addCaseStaffNote(staff(), 'case-2026-001', { body: 'Catatan internal tambahan untuk petugas.', expectedVersion: 2 }, 'case-note-key-000001', undefined, clock)
    expect('staffNotes' in await getViolationCase(student('student-001'), 'case-2026-001')).toBe(false)
  })

  it('allows only the owning student to respond and rejects stale versions', async () => {
    await expect(respondToViolationCase(student('student-002'), 'case-2026-001', {
      response: 'Saya menyampaikan klarifikasi lengkap atas kejadian tersebut.', expectedVersion: 2,
    }, 'case-response-wrong-owner', undefined, clock)).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' } satisfies Partial<CampusError>)

    const response = await respondToViolationCase(student('student-001'), 'case-2026-001', {
      response: 'Saya menyampaikan klarifikasi lengkap dan kronologi atas kejadian tersebut.', expectedVersion: 2,
    }, 'case-response-own-00001', undefined, clock)
    expect(response.value).toMatchObject({ status: 'STUDENT_RESPONSE', version: 3 })
    expect('staffNotes' in response.value).toBe(false)
    await expect(transitionViolationCase(staff(), 'case-2026-001', { targetStatus: 'UNDER_REVIEW', expectedVersion: 2, pointAdjustment: 0 }, 'case-transition-stale-01', undefined, clock))
      .rejects.toMatchObject({ statusCode: 409, code: 'VERSION_CONFLICT' } satisfies Partial<CampusError>)
  })

  it('honors the response window and rejects invalid state transitions', async () => {
    await expect(transitionViolationCase(staff(), 'case-2026-001', { targetStatus: 'UNDER_REVIEW', expectedVersion: 2, pointAdjustment: 0 }, 'case-due-process-key-1', undefined, clock))
      .rejects.toMatchObject({ statusCode: 409, code: 'DUE_PROCESS_PENDING' } satisfies Partial<CampusError>)
    const review = await transitionViolationCase(staff(), 'case-2026-001', { targetStatus: 'UNDER_REVIEW', expectedVersion: 2, pointAdjustment: 0 }, 'case-due-process-key-2', undefined, new Date('2026-07-26T08:00:00.000Z'))
    expect(review.value.status).toBe('UNDER_REVIEW')
    await expect(transitionViolationCase(staff(), 'case-2026-001', { targetStatus: 'NOTIFIED', expectedVersion: 3, pointAdjustment: 0 }, 'case-invalid-transition', undefined, clock))
      .rejects.toMatchObject({ statusCode: 409, code: 'INVALID_CASE_TRANSITION' } satisfies Partial<CampusError>)
  })

  it('records a resolution sanction once in the immutable point ledger', async () => {
    await respondToViolationCase(student('student-001'), 'case-2026-001', {
      response: 'Saya menyampaikan klarifikasi lengkap dan kronologi atas kejadian tersebut.', expectedVersion: 2,
    }, 'case-resolution-response', undefined, clock)
    await transitionViolationCase(staff(), 'case-2026-001', { targetStatus: 'UNDER_REVIEW', expectedVersion: 3, pointAdjustment: 0 }, 'case-resolution-review', undefined, clock)
    const resolved = await transitionViolationCase(staff(), 'case-2026-001', {
      targetStatus: 'RESOLVED', expectedVersion: 4, outcome: 'WRITTEN_WARNING',
      resolutionSummary: 'Peringatan tertulis dan pengurangan poin kemahasiswaan.', pointAdjustment: -10, expectedPolicyVersion: 1,
    }, 'case-resolution-final', undefined, clock)
    expect(resolved.value).toMatchObject({ status: 'RESOLVED', resolution: { pointAdjustment: -10 } })
    const entries = (await getPointLedger(student('student-001'), 'student-001')).entries.filter((entry) => entry.sourceType === 'CASE' && entry.sourceId === 'case-2026-001')
    expect(entries).toEqual([expect.objectContaining({ points: -10, immutable: true })])
  })
})

describe('scholarships and requirement documents', () => {
  it('evaluates scholarship eligibility from immutable profile and document snapshots', async () => {
    const eligible = await applyForScholarship(student('student-001'), {
      programId: 'scholarship-merit-2026', statement: 'Saya mengajukan beasiswa untuk mempertahankan prestasi dan kontribusi kampus.',
      submittedDocumentIds: ['document-student-001-transcript'],
    }, 'scholarship-eligible-key', undefined, clock)
    expect(eligible.value.eligibilitySnapshot.eligible).toBe(true)
    expect(eligible.value.eligibilitySnapshot.checks.every((check) => check.passed)).toBe(true)

    await expect(applyForScholarship(student('student-002'), {
      programId: 'scholarship-merit-2026', statement: 'Saya mengajukan beasiswa untuk mendukung kelanjutan studi dan pengembangan diri.',
      submittedDocumentIds: ['document-student-002-transcript'],
    }, 'scholarship-ineligible-key', undefined, clock)).rejects.toMatchObject({ statusCode: 409, code: 'SCHOLARSHIP_NOT_ELIGIBLE' } satisfies Partial<CampusError>)
    await expect(applyForScholarship(student('student-001'), {
      programId: 'scholarship-merit-2026', statement: 'Saya mengajukan beasiswa dengan berkas milik mahasiswa lain yang tidak sah.',
      submittedDocumentIds: ['document-student-002-transcript'],
    }, 'scholarship-cross-doc-key', undefined, clock)).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' } satisfies Partial<CampusError>)
  })

  it('runs the reviewed scholarship state machine and redacts internal notes', async () => {
    const application = await applyForScholarship(student('student-001'), {
      programId: 'scholarship-merit-2026', statement: 'Saya mengajukan beasiswa untuk mempertahankan prestasi dan kontribusi kampus.',
      submittedDocumentIds: ['document-student-001-transcript'],
    }, 'scholarship-workflow-apply', undefined, clock)
    const reviewed = await transitionScholarshipApplication(staff(), application.value.id, {
      targetStatus: 'UNDER_REVIEW', expectedVersion: 1, internalReviewNotes: 'Periksa konsistensi capaian dan surat rekomendasi.',
    }, 'scholarship-workflow-review', undefined, clock)
    expect('internalReviewNotes' in reviewed.value && reviewed.value.internalReviewNotes).toContain('konsistensi')
    const studentView = (await listScholarshipApplications(student('student-001'), query)).items[0]!
    expect('internalReviewNotes' in studentView).toBe(false)
    const awarded = await transitionScholarshipApplication(staff(), application.value.id, {
      targetStatus: 'AWARDED', expectedVersion: 2, decisionReason: 'Memenuhi seluruh kriteria dan peringkat seleksi.',
    }, 'scholarship-workflow-award', undefined, clock)
    expect(awarded.value.status).toBe('AWARDED')
    expect(studentAffairsStateForTests().scholarshipPrograms.get('scholarship-merit-2026')?.awardedCount).toBe(1)
    await expect(transitionScholarshipApplication(staff(), application.value.id, {
      targetStatus: 'AWARDED', expectedVersion: 2, decisionReason: 'Keputusan stale.',
    }, 'scholarship-workflow-stale', undefined, clock)).rejects.toMatchObject({ statusCode: 409, code: 'VERSION_CONFLICT' } satisfies Partial<CampusError>)
  })

  it('stores requirement documents as references and reviews them optimistically', async () => {
    await expect(submitRequirementDocument(student('student-001'), {
      documentType: 'RECOMMENDATION', label: 'Surat rekomendasi', file: { ...file('recommendation-invalid'), downloadUrl: 'https://example.test/private' },
    }, 'document-invalid-key-01', undefined, clock)).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_INPUT' } satisfies Partial<CampusError>)
    const submitted = await submitRequirementDocument(student('student-001'), {
      documentType: 'RECOMMENDATION', label: 'Surat rekomendasi', file: file('recommendation-valid'),
    }, 'document-submit-key-01', undefined, clock)
    await expect(reviewRequirementDocument(staff('informatics-s1'), submitted.value.id, { status: 'VERIFIED', expectedVersion: 1 }, 'document-review-outside', undefined, clock))
      .rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' } satisfies Partial<CampusError>)
    const verified = await reviewRequirementDocument(staff(), submitted.value.id, { status: 'VERIFIED', expectedVersion: 1 }, 'document-review-valid', undefined, clock)
    expect(verified.value).toMatchObject({ status: 'VERIFIED', version: 2, file: file('recommendation-valid') })
    await expect(reviewRequirementDocument(staff(), submitted.value.id, { status: 'REJECTED', rejectionReason: 'Dokumen kedaluwarsa.', expectedVersion: 1 }, 'document-review-stale', undefined, clock))
      .rejects.toMatchObject({ statusCode: 409, code: 'VERSION_CONFLICT' } satisfies Partial<CampusError>)
  })
})

describe('active-student letter issuance', () => {
  it('blocks issuance eligibility when a major case is unresolved', async () => {
    await createViolationCase(staff(), {
      studentId: 'student-002', title: 'Dugaan pelanggaran berat', allegation: 'Dugaan pelanggaran berat sedang dalam pemeriksaan resmi.',
      severity: 'MAJOR', occurredAt: '2026-07-18T08:00:00.000Z', responseDueAt: '2026-07-28T08:00:00.000Z', evidence: [],
    }, 'letter-ineligible-case', undefined, clock)
    await expect(requestActiveStudentLetter(student('student-002'), { purpose: 'Persyaratan administrasi magang.' }, 'letter-ineligible-request', undefined, clock))
      .rejects.toMatchObject({ statusCode: 409, code: 'ACTIVE_STUDENT_LETTER_INELIGIBLE' } satisfies Partial<CampusError>)
  })

  it('issues concurrent requests with unique sequential numbers and verifiable immutable hashes', async () => {
    const firstRequest = await requestActiveStudentLetter(student('student-001'), { purpose: 'Persyaratan administrasi program magang.' }, 'letter-request-student-001', undefined, clock)
    const secondRequest = await requestActiveStudentLetter(student('student-003', 'informatics-s1'), { purpose: 'Persyaratan administrasi program pertukaran.' }, 'letter-request-student-003', undefined, clock)
    await expect(transitionLetterRequest(administrator(), firstRequest.value.id, { targetStatus: 'VERIFIED', expectedVersion: 1 }, 'letter-admin-denied', undefined, clock))
      .rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' } satisfies Partial<CampusError>)
    await transitionLetterRequest(staff(), firstRequest.value.id, { targetStatus: 'VERIFIED', expectedVersion: 1 }, 'letter-verify-student-001', undefined, clock)
    await transitionLetterRequest(staff('informatics-s1'), secondRequest.value.id, { targetStatus: 'VERIFIED', expectedVersion: 1 }, 'letter-verify-student-003', undefined, clock)
    await expect(transitionLetterRequest(staff(), firstRequest.value.id, { targetStatus: 'REJECTED', rejectionReason: 'Stale.', expectedVersion: 1 }, 'letter-transition-stale', undefined, clock))
      .rejects.toMatchObject({ statusCode: 409, code: 'VERSION_CONFLICT' } satisfies Partial<CampusError>)

    const [first, second] = await Promise.all([
      issueActiveStudentLetter(staff(), firstRequest.value.id, { expectedVersion: 2, file: file('letter-student-001', 'a'.repeat(64)) }, 'letter-issue-student-001', undefined, clock),
      issueActiveStudentLetter(staff('informatics-s1'), secondRequest.value.id, { expectedVersion: 2, file: file('letter-student-003', 'b'.repeat(64)) }, 'letter-issue-student-003', undefined, clock),
    ])
    expect([first.value.verificationNumber, second.value.verificationNumber].sort()).toEqual(['SKA/2026/000001', 'SKA/2026/000002'])
    for (const issuance of [first.value, second.value]) {
      const { recordHash, ...immutableRecord } = issuance
      expect(recordHash).toMatch(/^[a-f0-9]{64}$/)
      expect(requestHash(immutableRecord)).toBe(recordHash)
      expect(issuance.immutable).toBe(true)
    }
    expect(studentAffairsStateForTests().letterCounters.get(2026)).toBe(2)

    const replay = await issueActiveStudentLetter(staff(), firstRequest.value.id, { expectedVersion: 2, file: file('letter-student-001', 'a'.repeat(64)) }, 'letter-issue-student-001', undefined, new Date('2026-07-22T08:00:00.000Z'))
    expect(replay).toMatchObject({ replayed: true, value: { verificationNumber: first.value.verificationNumber, recordHash: first.value.recordHash } })
    const allProgramsStaff = authContext('student-affairs-all', ['student_affairs_staff'], ['management-s1', 'informatics-s1'])
    expect((await listLetterRequests(allProgramsStaff, query)).items).toHaveLength(2)
    expect((await getLetterDownloadReference(student('student-001'), firstRequest.value.id)).file.fileId).toBe('letter-student-001')
    await expect(getLetterDownloadReference(student('student-002'), firstRequest.value.id))
      .rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' } satisfies Partial<CampusError>)
  })
})
