import { beforeEach, describe, expect, it } from 'vitest'
import {
  evaluateGraduationEligibility,
  getGraduationApplication,
  getGraduationParticipant,
  listGraduationApplications,
  listGraduationParticipants,
  submitGraduationApplication,
  transitionGraduationApplication,
  updateGraduationPeriod,
  updateGraduationParticipantStatus,
} from '../../server/services/graduation'
import { graduationModuleState, resetGraduationModuleState } from '../../server/services/graduation-state'
import { CampusError } from '../../server/utils/errors'
import { resetMockState } from '../../server/utils/mock-store'
import { authContext } from './fixtures'

const periodId = 'period-yudisium-2026-02'
const registrationTime = new Date('2026-07-21T02:00:00.000Z')
const managementStaff = (uid = 'academic-management-001') => authContext(uid, ['academic_staff'], ['management-s1'])

async function submit(studentId = 'student-001', key = `graduation-submit-${studentId}`) {
  return submitGraduationApplication(
    authContext(studentId, ['student'], []),
    { periodId, studentId },
    key,
    undefined,
    registrationTime,
  )
}

describe('graduation eligibility and yudisium review', () => {
  beforeEach(() => {
    process.env.CAMPUS_DATA_MODE = 'mock'
    process.env.NODE_ENV = 'test'
    resetMockState()
    resetGraduationModuleState()
  })

  it('reports deterministic blockers from every authoritative clearance area', () => {
    const state = graduationModuleState()
    const snapshot = state.eligibilitySnapshots.get('student-002')!
    const requirements = state.periods.get(periodId)!.currentRequirements
    const result = evaluateGraduationEligibility(snapshot, requirements, registrationTime)

    expect(result.eligible).toBe(false)
    expect(result.blockerCodes).toEqual([
      'ACADEMIC_CREDITS',
      'FINANCE_CLEARANCE',
      'LIBRARY_CLEARANCE',
      'LIBRARY_ITEMS',
      'AFFAIRS_POINTS',
    ])
    expect(result.checks).toHaveLength(10)
    expect(new Set(result.checks.map(check => check.area))).toEqual(new Set(['ACADEMIC', 'FINANCE', 'LIBRARY', 'STUDENT_AFFAIRS']))
  })

  it('records a blocked application from the server snapshot and safely replays submission', async () => {
    const first = await submit('student-002', 'graduation-submit-blocked-0001')
    const replay = await submit('student-002', 'graduation-submit-blocked-0001')

    expect(first.application).toMatchObject({ status: 'BLOCKED', version: 1 })
    expect(first.application.eligibilityEvaluation.blockerCodes).toContain('FINANCE_CLEARANCE')
    expect(first.application.eligibilitySnapshot.id).toBe('eligibility-student-002-v5')
    expect(replay).toMatchObject({ replayed: true, application: { id: first.application.id } })
  })

  it('enforces owner and program scope without cross-student list or detail leakage', async () => {
    const management = await submit('student-001', 'graduation-submit-scope-0001')
    const informatics = await submit('student-003', 'graduation-submit-scope-0002')

    expect((await listGraduationApplications(managementStaff())).map(item => item.id)).toEqual([management.application.id])
    expect((await listGraduationApplications(authContext('academic-info-001', ['academic_staff'], ['informatics-s1']))).map(item => item.id))
      .toEqual([informatics.application.id])
    expect(await listGraduationApplications(authContext('student-999', ['student'], []))).toEqual([])
    await expect(getGraduationApplication(authContext('student-999', ['student'], []), management.application.id))
      .rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' } satisfies Partial<CampusError>)
    await expect(getGraduationApplication(authContext('academic-info-001', ['academic_staff'], ['informatics-s1']), management.application.id))
      .rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' } satisfies Partial<CampusError>)
    expect(await listGraduationApplications(authContext('leader-001', ['leader'], []))).toHaveLength(2)
  })

  it('enforces optimistic versions, the state graph, and distinct two-person final approval', async () => {
    const submitted = await submit('student-001', 'graduation-submit-review-0001')
    const firstReviewer = managementStaff('academic-reviewer-001')
    const finalReviewer = managementStaff('academic-reviewer-002')
    const reviewing = await transitionGraduationApplication(firstReviewer, submitted.application.id, {
      transition: 'START_REVIEW', expectedVersion: 1,
    }, 'graduation-transition-review-0001')

    await expect(transitionGraduationApplication(firstReviewer, submitted.application.id, {
      transition: 'FIRST_APPROVE', expectedVersion: 1,
    }, 'graduation-transition-stale-0001')).rejects.toMatchObject({
      code: 'VERSION_CONFLICT', details: { currentVersion: 2 },
    } satisfies Partial<CampusError>)

    const firstApproved = await transitionGraduationApplication(firstReviewer, submitted.application.id, {
      transition: 'FIRST_APPROVE', expectedVersion: reviewing.application.version,
    }, 'graduation-transition-first-0001')
    await expect(transitionGraduationApplication(firstReviewer, submitted.application.id, {
      transition: 'FINAL_APPROVE', expectedVersion: firstApproved.application.version,
    }, 'graduation-transition-same-person-0001')).rejects.toMatchObject({ code: 'TWO_PERSON_RULE' } satisfies Partial<CampusError>)

    const final = await transitionGraduationApplication(finalReviewer, submitted.application.id, {
      transition: 'FINAL_APPROVE', expectedVersion: firstApproved.application.version,
    }, 'graduation-transition-final-0001')
    const replay = await transitionGraduationApplication(finalReviewer, submitted.application.id, {
      transition: 'FINAL_APPROVE', expectedVersion: firstApproved.application.version,
    }, 'graduation-transition-final-0001')

    expect(final.application).toMatchObject({ status: 'FINAL_APPROVED', firstApprovedBy: firstReviewer.uid, finalApprovedBy: finalReviewer.uid, version: 4 })
    expect(final.participant).toMatchObject({ status: 'YUDISIUM_APPROVED', version: 1 })
    expect(replay).toMatchObject({ replayed: true, participant: { id: final.participant!.id } })
    expect(graduationModuleState().participants.size).toBe(1)
    expect((await listGraduationParticipants(authContext('student-001', ['student'], []))).map(item => item.id)).toEqual([final.participant!.id])
    expect((await getGraduationParticipant(authContext('leader-001', ['leader'], []), final.participant!.id)).status).toBe('YUDISIUM_APPROVED')
    await expect(getGraduationParticipant(authContext('student-999', ['student'], []), final.participant!.id))
      .rejects.toMatchObject({ statusCode: 403 } satisfies Partial<CampusError>)

    const graduated = await updateGraduationParticipantStatus(finalReviewer, final.participant!.id, {
      status: 'GRADUATED', expectedVersion: 1, reason: 'Wisuda terkonfirmasi oleh panitia',
    }, 'graduation-participant-graduated-0001')
    const participantReplay = await updateGraduationParticipantStatus(finalReviewer, final.participant!.id, {
      status: 'GRADUATED', expectedVersion: 1, reason: 'Wisuda terkonfirmasi oleh panitia',
    }, 'graduation-participant-graduated-0001')
    expect(graduated.participant).toMatchObject({ status: 'GRADUATED', version: 2 })
    expect(graduated.participant.history.at(-1)).toMatchObject({ from: 'YUDISIUM_APPROVED', to: 'GRADUATED' })
    expect(graduated.application).toMatchObject({ status: 'GRADUATED', version: 5 })
    expect(participantReplay.replayed).toBe(true)
  })

  it('rechecks the latest authoritative snapshot before final approval', async () => {
    const submitted = await submit('student-001', 'graduation-submit-recheck-0001')
    const firstReviewer = managementStaff('academic-reviewer-003')
    const reviewing = await transitionGraduationApplication(firstReviewer, submitted.application.id, {
      transition: 'START_REVIEW', expectedVersion: 1,
    }, 'graduation-transition-review-0002')
    const firstApproved = await transitionGraduationApplication(firstReviewer, submitted.application.id, {
      transition: 'FIRST_APPROVE', expectedVersion: reviewing.application.version,
    }, 'graduation-transition-first-0002')

    const latest = graduationModuleState().eligibilitySnapshots.get('student-001')!
    graduationModuleState().eligibilitySnapshots.set('student-001', {
      ...latest,
      id: 'eligibility-student-001-v8',
      finance: { outstandingAmount: 250_000 },
      sourceVersions: { ...latest.sourceVersions, finance: latest.sourceVersions.finance + 1 },
    })
    await expect(transitionGraduationApplication(managementStaff('academic-reviewer-004'), submitted.application.id, {
      transition: 'FINAL_APPROVE', expectedVersion: firstApproved.application.version,
    }, 'graduation-transition-final-blocked-0001')).rejects.toMatchObject({
      code: 'ELIGIBILITY_BLOCKED', details: { blockerCodes: ['FINANCE_CLEARANCE'] },
    } satisfies Partial<CampusError>)
  })

  it('versions requirements and rejects stale period administration', async () => {
    const admin = authContext('admin-001', ['administrator'], [])
    const period = graduationModuleState().periods.get(periodId)!
    const requirements = structuredClone(period.currentRequirements)
    requirements.academic.minimumCredits = 146
    const updated = await updateGraduationPeriod(admin, periodId, {
      expectedVersion: 1,
      requirements,
    }, 'graduation-period-update-0001')

    expect(updated.period).toMatchObject({ version: 2, currentRequirements: { version: 2, academic: { minimumCredits: 146 } } })
    expect(updated.period.requirementHistory.map(item => item.version)).toEqual([1, 2])
    await expect(updateGraduationPeriod(admin, periodId, {
      expectedVersion: 1,
      status: 'REVIEW',
    }, 'graduation-period-update-stale-0001')).rejects.toMatchObject({ code: 'VERSION_CONFLICT' } satisfies Partial<CampusError>)
  })
})
