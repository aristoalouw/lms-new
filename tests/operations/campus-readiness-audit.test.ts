import { describe, expect, it } from 'vitest'
import { evaluateCampusReadiness, parseEnvironment } from '../../scripts/audit-campus-readiness.mjs'

const completeCounts = {
  accounts: 3,
  activeStudents: 1,
  activeLecturers: 1,
  activeProgramStudies: 1,
  activeAcademicPeriods: 1,
  courseVersions: 1,
  activeCurricula: 1,
  academicStudentProfiles: 1,
  studentAcademicStates: 1,
  billingStudentProfiles: 1,
  activeClasses: 1,
  activeEnrollments: 1,
  learningSpaces: 1,
  publishedMaterials: 0,
  publishedAssignments: 0,
  admissionApplications: 0,
  invoices: 0,
  pddiktiJobs: 0,
  auditLogs: 1,
  activeRoleAccounts: {
    applicant: 1,
    student: 1,
    lecturer: 1,
    advisor: 1,
    academic_staff: 1,
    finance_staff: 1,
    student_affairs_staff: 1,
    admissions_staff: 1,
    leader: 1,
    administrator: 1,
  },
}

describe('campus production readiness audit', () => {
  it('parses a production env without exposing values through the evaluator', () => {
    expect(parseEnvironment('A=one\nB="two"\n# C=ignored\n')).toEqual({ A: 'one', B: 'two' })
  })

  it('reports data prerequisites separately from optional integrations', () => {
    const result = evaluateCampusReadiness({
      counts: completeCounts,
      environment: {
        CAMPUS_DATA_MODE: 'firebase',
        FIREBASE_SERVICE_ACCOUNT_BASE64: 'configured',
        FILE_UPLOADS_ENABLED: 'false',
        EMAIL_DELIVERY_ENABLED: 'false',
        SENTRY_ENABLED: 'false',
      },
    })
    expect(result.readyForRoleUat).toBe(true)
    expect(result.blockers).toEqual([])
    expect(result.roleUatGaps).toEqual([])
    expect(result.capabilities).toMatchObject({ firebaseCore: true, fileUploads: false, emailDelivery: false, sentry: false })
  })

  it('identifies incomplete student onboarding and enrolment without reading PII', () => {
    const result = evaluateCampusReadiness({
      counts: { ...completeCounts, activeCurricula: 0, academicStudentProfiles: 0, studentAcademicStates: 0, billingStudentProfiles: 0, activeEnrollments: 0 },
      environment: { CAMPUS_DATA_MODE: 'firebase', FIREBASE_SERVICE_ACCOUNT_BASE64: 'configured' },
    })
    expect(result.readyForRoleUat).toBe(false)
    expect(result.blockers.map(item => item.code)).toEqual(expect.arrayContaining([
      'CURRICULUM_REQUIRED',
      'STUDENT_ONBOARDING_INCOMPLETE',
      'ACTIVE_ENROLMENT_REQUIRED',
    ]))
  })

  it('reports missing operational roles independently from data blockers', () => {
    const result = evaluateCampusReadiness({
      counts: { ...completeCounts, activeRoleAccounts: { ...completeCounts.activeRoleAccounts, advisor: 0, leader: 0 } },
      environment: { CAMPUS_DATA_MODE: 'firebase', FIREBASE_SERVICE_ACCOUNT_BASE64: 'configured' },
    })
    expect(result.readyForRoleUat).toBe(false)
    expect(result.blockers.map(item => item.code)).toContain('ADVISOR_ACCOUNT_REQUIRED')
    expect(result.roleUatGaps.map(item => item.role)).toEqual(['advisor', 'leader'])
  })
})
