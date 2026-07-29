import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const firestoreRules = readFileSync(resolve(process.cwd(), 'firebase/firestore.rules'), 'utf8')
const storageRules = readFileSync(resolve(process.cwd(), 'firebase/storage.rules'), 'utf8')
const lmsFirestoreRules = readFileSync(resolve(process.cwd(), 'firebase/firestore.lms-mvp.rules'), 'utf8')
const lmsStorageRules = readFileSync(resolve(process.cwd(), 'firebase/storage.lms-mvp.rules'), 'utf8')
const firestoreIndexes = JSON.parse(readFileSync(resolve(process.cwd(), 'firebase/firestore.indexes.json'), 'utf8')) as {
  indexes: Array<{ collectionGroup: string; fields: Array<{ fieldPath: string; order?: string }> }>
}

describe('Firebase security rule invariants', () => {
  it('keeps audit, idempotency, payment reference, and dashboard writes server-only', () => {
    for (const collection of [
      'auditLogs', 'idempotencyKeys', 'paymentReferences', 'dashboardSnapshots',
      'accounts', 'accountEmailIndex', 'rateLimitBuckets', 'importRuns',
      'paymentGatewayEvents', 'paymentReversalReferences', 'files', 'fileVersions',
      'notificationTemplates', 'notificationPreferences', 'inAppNotifications', 'emailOutbox',
      'communicationIdempotency', 'serviceTickets', 'admissionApplications', 'admissionIdentityIndex',
      'admissionDocuments', 'admissionDocumentKeys',
      'admissionPaymentReferences', 'studentNumberSequences', 'academicClasses', 'evaluationForms',
      'evaluationResponses', 'evaluationRespondentIdentities', 'evaluationIdempotency',
      'studentAcademicStates', 'academicPeriods', 'graduationPeriods', 'graduationApplications',
      'graduationEligibilitySnapshots', 'issuedGraduationDocuments', 'graduationIdempotency',
      'tracerQuestionnaires', 'tracerOpaqueTokens', 'tracerResponses', 'tracerConsents',
      'tracerCampaigns', 'tracerStudyIdempotency',
      'studentAffairsProfiles', 'studentPortfolio', 'studentPointPolicies', 'studentPointLedger',
      'studentCases', 'scholarshipPrograms', 'scholarshipApplications', 'studentRequirementDocuments',
      'activeStudentLetterRequests', 'activeStudentLetterIssuances', 'studentAffairsCounters',
      'admissionSelectionSessions', 'admissionSelectionAssignments', 'admissionSelectionScores',
      'admissionApplicationSchedules', 'admissionLetters', 'admissionLetterAssignments',
      'admissionLetterCounters', 'admissionSelectionIdempotency',
      'pddiktiSourceRecords', 'pddiktiMappingDefinitions', 'pddiktiMappingPointers',
      'pddiktiJobPayloads', 'pddiktiBatchResults', 'pddiktiEntityMappings',
      'pddiktiReconciliations', 'pddiktiWorkerRuns', 'pddiktiStudentDataChanges',
      'pddiktiStudentDataChangeKeys',
      'learningSpaces', 'learningModules', 'learningModuleVersions', 'learningMaterials',
      'learningMaterialVersions', 'learningAssignments', 'learningAssignmentVersions',
      'learningSubmissions', 'learningSubmissionAttempts', 'learningGrades',
      'learningAnnouncements', 'learningForumThreads', 'learningForumPosts',
      'learningGamificationPreferences', 'learningActivityEvents', 'learningIdempotency',
      'billingStudentProfiles', 'billingTariffPlans', 'billingTariffPlanHeads',
      'billingCounters', 'billingInvoiceKeys', 'billingInvoiceAdjustments',
      'billingInstallmentPlans', 'billingInstallmentKeys', 'billingDepositAccounts',
      'billingDepositTransactions', 'billingDepositReferences', 'billingVouchers',
      'billingVoucherRedemptions', 'billingVoucherRedemptionKeys',
      'billingPaymentProofs', 'billingPaymentProofReferences',
      'academicProgramStudies', 'academicPeriodDefinitions', 'academicCourseVersions', 'academicCourseHeads',
      'academicCurriculumVersions', 'academicCurriculumHeads', 'academicStudentProfiles', 'academicCalendarEvents',
      'academicLeaveRequests', 'academicLeaveKeys', 'academicAdvisingSessions',
      'academicRpsHeads', 'academicRpsVersions', 'academicTheses',
      'academicMbkmActivities', 'academicMbkmKeys', 'academicGradeRecords',
    ]) {
      expect(firestoreRules).toContain(`match /${collection}/`)
    }
    expect(firestoreRules).toMatch(/match \/auditLogs\/\{auditId\}[\s\S]*?allow create, update, delete: if false;/)
    expect(firestoreRules).toMatch(/match \/idempotencyKeys\/\{keyId\}[\s\S]*?allow read, write: if false;/)
  })

  it('defaults unknown Firestore documents and Storage objects to deny', () => {
    expect(firestoreRules).toMatch(/match \/\{document=\*\*\}[\s\S]*?allow read, write: if false;/)
    expect(storageRules).toMatch(/match \/\{allPaths=\*\*\}[\s\S]*?allow read, write: if false;/)
  })

  it('keeps the LMS profile server-only except for the owner minimum profile', () => {
    expect(lmsFirestoreRules).toMatch(/match \/users\/\{userId\}[\s\S]*?request\.auth\.uid == userId/)
    expect(lmsFirestoreRules).toMatch(/match \/\{document=\*\*\}[\s\S]*?allow read, write: if false;/)
    expect(lmsStorageRules).toMatch(/match \/\{allPaths=\*\*\}[\s\S]*?allow read, write: if false;/)
    expect(lmsStorageRules).not.toContain('student-documents')
    expect(lmsStorageRules).not.toContain('admissions/public')
  })

  it('enforces MIME type and size constraints for client uploads', () => {
    expect(storageRules).toContain('request.resource.size <= 10 * 1024 * 1024')
    expect(storageRules).toContain("request.resource.contentType.matches('application/pdf|image/jpeg|image/png')")
    expect(storageRules).toMatch(/match \/private\/\{allPaths=\*\*\}[\s\S]*?allow read, write: if false;/)
  })

  it('declares composite indexes for high-volume scoped server queries', () => {
    const hasIndex = (collectionGroup: string, fieldPaths: string[]) => firestoreIndexes.indexes.some(index => (
      index.collectionGroup === collectionGroup
      && index.fields.map(field => field.fieldPath).join(',') === fieldPaths.join(',')
    ))
    expect(hasIndex('files', ['ownerUid', 'updatedAt', '__name__'])).toBe(true)
    expect(hasIndex('importRuns', ['programStudyId', 'dataset', 'status', 'createdAt'])).toBe(true)
    expect(hasIndex('paymentGatewayEvents', ['provider', 'programStudyId', 'status', 'receivedAt'])).toBe(true)
    expect(hasIndex('admissionApplications', ['programStudyId', 'status', 'waveId', 'updatedAt'])).toBe(true)
    expect(hasIndex('admissionDocuments', ['applicationId', 'updatedAt'])).toBe(true)
    expect(hasIndex('emailOutbox', ['status', 'nextAttemptAt'])).toBe(true)
    expect(hasIndex('evaluationFormVersions', ['formId', 'version'])).toBe(true)
    expect(hasIndex('krs', ['studentUid', 'periodId'])).toBe(true)
    expect(hasIndex('pddiktiSyncJobs', ['status', 'nextAttemptAt'])).toBe(true)
    expect(hasIndex('pddiktiSyncJobs', ['status', 'leaseExpiresAt'])).toBe(true)
    expect(hasIndex('pddiktiReconciliations', ['programStudyId', 'updatedAt'])).toBe(true)
    expect(hasIndex('pddiktiSourceRecords', ['programStudyId', 'periodId'])).toBe(true)
    expect(hasIndex('pddiktiStudentDataChanges', ['programStudyId', 'status', 'updatedAt'])).toBe(true)
    expect(hasIndex('invoices', ['programStudyId', 'status', 'dueDate'])).toBe(true)
    expect(hasIndex('billingPaymentProofs', ['programStudyId', 'status', 'submittedAt'])).toBe(true)
    expect(hasIndex('academicLeaveRequests', ['programStudyId', 'status', 'submittedAt'])).toBe(true)
    expect(hasIndex('academicAdvisingSessions', ['advisorId', 'status', 'requestedAt'])).toBe(true)
    expect(hasIndex('academicGradeRecords', ['studentId', 'periodId', 'courseCode'])).toBe(true)
    expect(hasIndex('academicClasses', ['lecturerIds', 'periodId', 'programStudyId', '__name__'])).toBe(true)
    expect(hasIndex('classEnrollments', ['studentUid', 'status', 'periodId', 'programStudyId', 'classId'])).toBe(true)
  })
})
