import { MOCK_DASHBOARD } from '../data/mock-data'
import type { AuthContext } from '../types/auth'
import type { DashboardSnapshot } from '../types/domain'
import { notFound, serviceUnavailable } from '../utils/errors'
import { dataMode, firestoreAdmin } from '../utils/firebase-admin'
import { can, filterProgramScope, requirePermission } from '../utils/rbac'
import { serverFeatureProfile } from '../utils/feature-profile'

const LIVE_SNAPSHOT_MAX_AGE_MS = 15 * 60 * 1000

async function liveDashboardSnapshot(
  db: NonNullable<ReturnType<typeof firestoreAdmin>>,
  periodId: string,
  programStudyId?: string,
): Promise<DashboardSnapshot> {
  const periodSnapshot = await db.collection('academicPeriodDefinitions').doc(periodId).get()
  if (!periodSnapshot.exists) notFound('Periode akademik')
  const academicYear = String(periodSnapshot.data()?.academicYear || '')

  let studentQuery: FirebaseFirestore.Query = db.collection('academicStudentProfiles').where('status', '==', 'ACTIVE')
  let classQuery: FirebaseFirestore.Query = db.collection('academicClasses').where('periodId', '==', periodId).where('status', '==', 'ACTIVE')
  let invoiceQuery: FirebaseFirestore.Query = db.collection('invoices').where('periodId', '==', periodId)
  let applicationQuery: FirebaseFirestore.Query = db.collection('admissionApplications').where('academicYear', '==', academicYear)
  let sourceQuery: FirebaseFirestore.Query = db.collection('pddiktiSourceRecords').where('periodId', '==', periodId)
  let jobQuery: FirebaseFirestore.Query = db.collection('pddiktiSyncJobs').where('periodId', '==', periodId)
  let tracerRecipientQuery: FirebaseFirestore.Query = db.collection('tracerRecipients')
  let tracerResponseQuery: FirebaseFirestore.Query = db.collection('tracerResponses').where('status', '==', 'SUBMITTED')
  let programQuery: FirebaseFirestore.Query = db.collection('academicProgramStudies').where('active', '==', true)
  if (programStudyId) {
    studentQuery = studentQuery.where('programStudyId', '==', programStudyId)
    classQuery = classQuery.where('programStudyId', '==', programStudyId)
    invoiceQuery = invoiceQuery.where('programStudyId', '==', programStudyId)
    applicationQuery = applicationQuery.where('programStudyId', '==', programStudyId)
    sourceQuery = sourceQuery.where('programStudyId', '==', programStudyId)
    jobQuery = jobQuery.where('programStudyId', '==', programStudyId)
    tracerRecipientQuery = tracerRecipientQuery.where('programStudyId', '==', programStudyId)
    tracerResponseQuery = tracerResponseQuery.where('programStudyId', '==', programStudyId)
    programQuery = db.collection('academicProgramStudies').where('__name__', '==', programStudyId)
  }

  const [studentCount, classes, invoices, applications, sources, jobs, recipients, responses, programs] = await Promise.all([
    studentQuery.count().get(), classQuery.limit(1_000).get(), invoiceQuery.limit(5_000).get(),
    applicationQuery.limit(5_000).get(), sourceQuery.limit(10_000).get(), jobQuery.limit(1_000).get(),
    tracerRecipientQuery.limit(5_000).get(), tracerResponseQuery.limit(5_000).get(), programQuery.limit(100).get(),
  ])

  const classRecords = classes.docs.map(document => document.data() as { totalScheduledMeetings?: number; realizedMeetingCount?: number })
  const attendanceCounts = await Promise.all(classes.docs.map(async document => {
    const attendance = document.ref.collection('attendance')
    const [total, attended] = await Promise.all([
      attendance.count().get(),
      attendance.where('status', 'in', ['PRESENT', 'LATE', 'EXCUSED']).count().get(),
    ])
    return { total: total.data().count, attended: attended.data().count }
  }))
  const attendanceTotal = attendanceCounts.reduce((sum, item) => sum + item.total, 0)
  const attendancePresent = attendanceCounts.reduce((sum, item) => sum + item.attended, 0)
  const scheduledMeetings = classRecords.reduce((sum, item) => sum + Number(item.totalScheduledMeetings || 0), 0)
  const realizedMeetings = classRecords.reduce((sum, item) => sum + Number(item.realizedMeetingCount || 0), 0)

  const invoiceRows = invoices.docs.map(document => document.data() as { status?: string; totalAmount?: number; paidAmount?: number; dueDate?: string })
  const activeInvoices = invoiceRows.filter(item => item.status !== 'VOID')
  const applicationRows = applications.docs.map(document => document.data() as { status?: string; registrationFeeStatus?: string })
  const sourceRows = sources.docs.map(document => document.data() as { eligible?: boolean; blockers?: unknown[] })
  const jobRows = jobs.docs.map(document => document.data() as { status?: string; entityIds?: unknown[]; updatedAt?: string })
  const responseRows = responses.docs.map(document => document.data() as { career?: { employmentStatus?: string; waitMonths?: number } })
  const programRows = programs.docs.map(document => document.data() as { accreditationStatus?: string; accreditationExpiresAt?: string })
  const expiryDates = programRows.map(item => item.accreditationExpiresAt || '').filter(Boolean).sort()
  const riskBoundary = Date.now() + 365 * 86_400_000

  return {
    periodId,
    updatedAt: new Date().toISOString(),
    academic: {
      activeStudents: studentCount.data().count,
      classesRunning: classes.size,
      averageAttendancePercent: attendanceTotal ? Math.round(attendancePresent * 10_000 / attendanceTotal) / 100 : 0,
      lecturesRealizedPercent: scheduledMeetings ? Math.round(realizedMeetings * 10_000 / scheduledMeetings) / 100 : 0,
    },
    finance: {
      billedAmount: activeInvoices.reduce((sum, item) => sum + Number(item.totalAmount || 0), 0),
      collectedAmount: activeInvoices.reduce((sum, item) => sum + Number(item.paidAmount || 0), 0),
      overdueInvoices: activeInvoices.filter(item => item.status !== 'PAID' && item.dueDate && Date.parse(item.dueDate) < Date.now()).length,
      currency: 'IDR',
    },
    admissions: {
      applicants: applicationRows.length,
      verifiedApplicants: applicationRows.filter(item => ['DOCUMENTS_VERIFIED', 'ACCEPTED', 'ENROLLMENT_PENDING_IDENTITY', 'ENROLLED'].includes(item.status || '')).length,
      admittedApplicants: applicationRows.filter(item => ['ACCEPTED', 'ENROLLMENT_PENDING_IDENTITY', 'ENROLLED'].includes(item.status || '')).length,
      enrolledApplicants: applicationRows.filter(item => item.status === 'ENROLLED').length,
    },
    pddikti: {
      completenessPercent: sourceRows.length ? Math.round(sourceRows.filter(item => item.eligible && !(item.blockers?.length)).length * 10_000 / sourceRows.length) / 100 : 0,
      queuedRecords: jobRows.filter(item => ['QUEUED', 'PROCESSING'].includes(item.status || '')).reduce((sum, item) => sum + (item.entityIds?.length || 0), 0),
      failedRecords: jobRows.filter(item => ['FAILED', 'DEAD_LETTER'].includes(item.status || '')).reduce((sum, item) => sum + (item.entityIds?.length || 0), 0),
      ...(jobRows.filter(item => item.status === 'SUCCEEDED' && item.updatedAt).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0]?.updatedAt
        ? { lastSuccessfulSyncAt: jobRows.filter(item => item.status === 'SUCCEEDED' && item.updatedAt).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0]!.updatedAt }
        : {}),
    },
    outcomes: {
      tracerResponseRatePercent: recipients.size ? Math.round(responseRows.length * 10_000 / recipients.size) / 100 : 0,
      employedWithinSixMonthsPercent: responseRows.length ? Math.round(responseRows.filter(item => item.career?.employmentStatus === 'EMPLOYED' && Number(item.career.waitMonths || 0) <= 6).length * 10_000 / responseRows.length) / 100 : 0,
      respondents: responseRows.length,
    },
    accreditation: {
      institutionStatus: programStudyId ? String(programRows[0]?.accreditationStatus || 'Belum dikonfigurasi') : 'Lihat status per program studi',
      programStudyAtRisk: programRows.filter(item => item.accreditationExpiresAt && Date.parse(item.accreditationExpiresAt) <= riskBoundary).length,
      nearestExpiryDate: expiryDates[0] || 'Belum dikonfigurasi',
    },
  }
}

export interface DashboardSummary {
  periodId: string
  updatedAt: string
  filter: { programStudyId?: string }
  sections: Partial<Pick<DashboardSnapshot, 'academic' | 'finance' | 'admissions' | 'pddikti' | 'outcomes' | 'accreditation'>>
}

export async function dashboardSummary(
  context: AuthContext,
  filter: { periodId?: string; programStudyId?: string } = {},
): Promise<DashboardSummary> {
  requirePermission(context, 'dashboard:view')
  let periodId = filter.periodId
  const programStudyId = filterProgramScope(context, filter.programStudyId)

  let snapshot: DashboardSnapshot
  if (dataMode() === 'mock') {
    periodId ||= MOCK_DASHBOARD.periodId
    snapshot = structuredClone({ ...MOCK_DASHBOARD, periodId })
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan dashboard tidak tersedia.')
    if (!periodId) {
      const activePeriod = await db.collection('academicPeriodDefinitions').where('active', '==', true).orderBy('startsAt', 'desc').limit(1).get()
      if (activePeriod.empty) notFound('Periode akademik aktif')
      periodId = activePeriod.docs[0]!.id
    }
    const suffix = programStudyId ? `__${programStudyId}` : ''
    const reference = db.collection('dashboardSnapshots').doc(`${periodId}${suffix}`)
    const document = await reference.get()
    const stored = document.data() as (DashboardSnapshot & { source?: string }) | undefined
    const fresh = stored?.source === 'LIVE_AGGREGATE' && Date.now() - Date.parse(stored.updatedAt) < LIVE_SNAPSHOT_MAX_AGE_MS
    snapshot = fresh ? stored : await liveDashboardSnapshot(db, periodId, programStudyId)
    if (!fresh) await reference.set({ ...snapshot, source: 'LIVE_AGGREGATE' })
  }

  const sections: DashboardSummary['sections'] = {}
  if (can(context, 'dashboard:view_academic')) sections.academic = snapshot.academic
  if (serverFeatureProfile() === 'lms-mvp') {
    return {
      periodId: snapshot.periodId,
      updatedAt: snapshot.updatedAt,
      filter: { ...(programStudyId ? { programStudyId } : {}) },
      sections,
    }
  }
  if (can(context, 'dashboard:view_finance')) sections.finance = snapshot.finance
  if (can(context, 'dashboard:view_admissions')) sections.admissions = snapshot.admissions
  if (can(context, 'dashboard:view_pddikti')) sections.pddikti = snapshot.pddikti
  if (can(context, 'dashboard:view_outcomes')) sections.outcomes = snapshot.outcomes
  if (can(context, 'dashboard:view_accreditation')) sections.accreditation = snapshot.accreditation

  return {
    periodId: snapshot.periodId,
    updatedAt: snapshot.updatedAt,
    filter: { ...(programStudyId ? { programStudyId } : {}) },
    sections,
  }
}
