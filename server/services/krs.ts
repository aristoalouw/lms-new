import type { H3Event } from 'h3'
import type { AuthContext } from '../types/auth'
import type { KrsRecord, KrsStatus } from '../types/domain'
import { deriveStudentSemester } from '../utils/academic-semester'
import { appendAudit } from '../utils/audit'
import { conflict, notFound, serviceUnavailable } from '../utils/errors'
import { dataMode, firestoreAdmin } from '../utils/firebase-admin'
import { FIRESTORE_TTL_RETENTION_MS, firestorePurgeAfter } from '../utils/firestore-ttl'
import { cloneValue, mockState } from '../utils/mock-store'
import { hasProgramAccess, hasRole, requireKrsApprovalScope, requirePermission } from '../utils/rbac'
import { opaqueId, requestHash } from '../utils/security'
import { classEnrollmentId, upsertMockKrsClassEnrollment } from './academic-classes'
import { enrollMockKrsReservations, releaseMockKrsReservations } from './krs-enrollment'
import { krsModuleState } from './krs-state'
import { enqueueAcademicWorkflowNotification } from './notifications'

export interface ReviewKrsInput {
  decision: 'APPROVE' | 'REJECT'
  notes?: string
  expectedVersion?: number
}

export interface ReviewKrsResult {
  record: KrsRecord
  replayed?: boolean
  auditId?: string
}

export interface KrsReviewFilters {
  periodId?: string
  status?: KrsStatus | 'ALL'
  programStudyId?: string
}

export interface KrsReviewItem extends KrsRecord {
  studentSemester?: number
  cohortYear?: number
  programStudyName?: string
  periodLabel?: string
  periodActive?: boolean
  advisorName?: string
  reviewerName?: string
  canReview: boolean
}

export interface KrsReviewListResult {
  items: KrsReviewItem[]
  summary: {
    total: number
    submitted: number
    approved: number
    rejected: number
    draft: number
  }
  periods: Array<{
    id: string
    label: string
    active: boolean
    term?: 'ODD' | 'EVEN' | 'SHORT'
    academicYear?: string
  }>
  programs: Array<{
    id: string
    name: string
  }>
}

function canAccessKrsForReview(context: AuthContext, record: KrsRecord): boolean {
  if (hasRole(context, 'advisor') && record.advisorId === context.uid) return true
  if (hasRole(context, 'academic_staff') && hasProgramAccess(context, record.programStudyId)) return true
  return false
}

function formatPeriodLabel(period?: { id: string; academicYear?: string; term?: 'ODD' | 'EVEN' | 'SHORT' }, fallbackId?: string): string {
  if (!period?.academicYear) return fallbackId || period?.id || '—'
  const termWord = period.term === 'ODD' ? 'Ganjil' : period.term === 'EVEN' ? 'Genap' : period.term === 'SHORT' ? 'Pendek' : ''
  return termWord ? `${period.academicYear} ${termWord}` : period.academicYear
}

function statusSortRank(status: KrsStatus): number {
  if (status === 'SUBMITTED') return 0
  if (status === 'REJECTED') return 1
  if (status === 'APPROVED') return 2
  return 3
}

export async function listKrsForReview(
  context: AuthContext,
  filters: KrsReviewFilters = {},
): Promise<KrsReviewListResult> {
  requirePermission(context, 'krs:approve')

  const periodMap = new Map<string, { id: string; academicYear?: string; term?: 'ODD' | 'EVEN' | 'SHORT'; active: boolean; deletedAt?: string }>()
  const programMap = new Map<string, { id: string; name: string }>()
  const studentMetaMap = new Map<string, { currentSemester?: number; cohortYear?: number }>()
  const accountNameMap = new Map<string, string>()
  let rawRecords: KrsRecord[]

  if (dataMode() === 'mock') {
    for (const period of krsModuleState().periods.values()) {
      periodMap.set(period.id, {
        id: period.id,
        academicYear: period.academicYear,
        term: period.term,
        active: period.status === 'KRS_OPEN',
      })
    }
    for (const student of krsModuleState().students.values()) {
      studentMetaMap.set(student.id, {
        currentSemester: student.currentSemester,
        cohortYear: student.cohortYear,
      })
    }
    rawRecords = [...mockState().krs.values()].map(record => cloneValue(record))
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan akademik tidak tersedia.')

    const [krsSnap, periodsSnap, programsSnap] = await Promise.all([
      db.collection('krs').limit(500).get(),
      db.collection('academicPeriodDefinitions').limit(200).get(),
      db.collection('academicProgramStudies').limit(200).get(),
    ])

    for (const doc of periodsSnap.docs) {
      const data = doc.data() as { academicYear?: string; term?: 'ODD' | 'EVEN' | 'SHORT'; active?: boolean; deletedAt?: string }
      periodMap.set(doc.id, {
        id: doc.id,
        academicYear: data.academicYear,
        term: data.term,
        active: Boolean(data.active && !data.deletedAt),
        deletedAt: data.deletedAt,
      })
    }
    for (const doc of programsSnap.docs) {
      const data = doc.data() as { name?: string; code?: string }
      programMap.set(doc.id, { id: doc.id, name: data.name || data.code || doc.id })
    }

    rawRecords = krsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }) as KrsRecord)

    const authorizedPreview = rawRecords.filter(record => canAccessKrsForReview(context, record))
    const studentIds = [...new Set(authorizedPreview.map(r => r.studentId).filter(Boolean))]
    const accountIds = [...new Set(authorizedPreview.flatMap(r => [r.advisorId, r.reviewedBy].filter((v): v is string => Boolean(v))))]

    const [profileSnaps, stateSnaps, accountSnaps] = await Promise.all([
      studentIds.length ? db.getAll(...studentIds.map(id => db.collection('academicStudentProfiles').doc(id))) : Promise.resolve([]),
      studentIds.length ? db.getAll(...studentIds.map(id => db.collection('studentAcademicStates').doc(id))) : Promise.resolve([]),
      accountIds.length ? db.getAll(...accountIds.map(id => db.collection('accounts').doc(id))) : Promise.resolve([]),
    ])

    for (const snap of stateSnaps) {
      if (!snap.exists) continue
      const data = snap.data() as { currentSemester?: number; cohortYear?: number }
      studentMetaMap.set(snap.id, { currentSemester: data.currentSemester, cohortYear: data.cohortYear })
    }
    for (const snap of profileSnaps) {
      if (!snap.exists) continue
      const data = snap.data() as { currentSemester?: number; cohortYear?: number }
      const existing = studentMetaMap.get(snap.id)
      studentMetaMap.set(snap.id, {
        currentSemester: data.currentSemester ?? existing?.currentSemester,
        cohortYear: data.cohortYear ?? existing?.cohortYear,
      })
    }
    for (const snap of accountSnaps) {
      if (!snap.exists) continue
      const data = snap.data() as { displayName?: string; email?: string }
      accountNameMap.set(snap.id, data.displayName || data.email || snap.id)
    }
  }

  const authorized = rawRecords.filter(record => canAccessKrsForReview(context, record))

  const enrichedAll: KrsReviewItem[] = authorized.map(record => {
    const period = periodMap.get(record.periodId)
    const studentMeta = studentMetaMap.get(record.studentId)
    const studentSemester = studentMeta?.currentSemester
      ?? deriveStudentSemester(studentMeta?.cohortYear, period?.academicYear, period?.term)
    return {
      ...record,
      studentSemester,
      ...(studentMeta?.cohortYear ? { cohortYear: studentMeta.cohortYear } : {}),
      programStudyName: programMap.get(record.programStudyId)?.name || record.programStudyId,
      periodLabel: formatPeriodLabel(period, record.periodId),
      periodActive: period ? period.active : false,
      ...(record.advisorId ? { advisorName: accountNameMap.get(record.advisorId) || record.advisorId } : {}),
      ...(record.reviewedBy ? { reviewerName: accountNameMap.get(record.reviewedBy) || record.reviewedBy } : {}),
      canReview: record.status === 'SUBMITTED',
    }
  })

  const scopeFiltered = enrichedAll.filter(item => {
    if (filters.periodId && filters.periodId !== 'ALL' && item.periodId !== filters.periodId) return false
    if (filters.programStudyId && filters.programStudyId !== 'ALL' && item.programStudyId !== filters.programStudyId) return false
    return true
  })

  const summary = {
    total: scopeFiltered.length,
    submitted: scopeFiltered.filter(item => item.status === 'SUBMITTED').length,
    approved: scopeFiltered.filter(item => item.status === 'APPROVED').length,
    rejected: scopeFiltered.filter(item => item.status === 'REJECTED').length,
    draft: scopeFiltered.filter(item => item.status === 'DRAFT').length,
  }

  const items = scopeFiltered
    .filter(item => (!filters.status || filters.status === 'ALL' ? true : item.status === filters.status))
    .sort((left, right) => {
      const rankDiff = statusSortRank(left.status) - statusSortRank(right.status)
      if (rankDiff !== 0) return rankDiff
      const leftTime = left.submittedAt || left.reviewedAt || ''
      const rightTime = right.submittedAt || right.reviewedAt || ''
      if (leftTime !== rightTime) return rightTime.localeCompare(leftTime)
      return left.studentName.localeCompare(right.studentName, 'id')
    })

  const referencedPeriodIds = new Set(enrichedAll.map(item => item.periodId))
  const periods = [...periodMap.values()]
    .filter(period => !period.deletedAt || referencedPeriodIds.has(period.id))
    .map(period => ({
      id: period.id,
      label: formatPeriodLabel(period, period.id),
      active: period.active,
      ...(period.term ? { term: period.term } : {}),
      ...(period.academicYear ? { academicYear: period.academicYear } : {}),
    }))
    .sort((left, right) => Number(right.active) - Number(left.active) || right.label.localeCompare(left.label, 'id'))

  for (const periodId of referencedPeriodIds) {
    if (!periods.some(period => period.id === periodId)) {
      periods.push({ id: periodId, label: periodId, active: false })
    }
  }

  const referencedProgramIds = new Set(enrichedAll.map(item => item.programStudyId))
  const programs = [...referencedProgramIds]
    .map(id => ({ id, name: programMap.get(id)?.name || id }))
    .sort((left, right) => left.name.localeCompare(right.name, 'id'))

  return { items, summary, periods, programs }
}

function reviewedRecord(record: KrsRecord, context: AuthContext, input: ReviewKrsInput, now: string): KrsRecord {
  requireKrsApprovalScope(context, record)
  if (record.status !== 'SUBMITTED') {
    conflict('KRS_NOT_REVIEWABLE', 'KRS hanya dapat ditinjau saat berstatus SUBMITTED.', { currentStatus: record.status })
  }
  if (input.expectedVersion !== undefined && record.version !== input.expectedVersion) {
    conflict('VERSION_CONFLICT', 'KRS telah berubah. Muat ulang data sebelum menyetujui.', { currentVersion: record.version })
  }
  return {
    ...record,
    status: input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
    version: record.version + 1,
    reviewedAt: now,
    reviewedBy: context.uid,
    reviewNotes: input.notes ?? '',
  }
}

export async function reviewKrs(
  krsId: string,
  context: AuthContext,
  input: ReviewKrsInput,
  event?: H3Event,
  idempotencyKey?: string,
): Promise<ReviewKrsResult> {
  const now = new Date().toISOString()
  const namespace = idempotencyKey ? `krs:review:${context.uid}:${idempotencyKey}` : undefined
  const hash = requestHash({ krsId, ...input })
  let before: KrsRecord
  let after: KrsRecord

  if (dataMode() === 'mock') {
    if (namespace) {
      const previous = mockState().idempotency.get(namespace)
      if (previous) {
        if (previous.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk keputusan KRS berbeda.')
        return { ...(cloneValue(previous.response) as ReviewKrsResult), replayed: true, auditId: undefined }
      }
    }
    const stored = mockState().krs.get(krsId)
    if (!stored) notFound('KRS')
    before = cloneValue(stored)
    after = reviewedRecord(before, context, input, now)
    if (input.decision === 'APPROVE') {
      enrollMockKrsReservations(before, now)
      for (const classId of before.classIds ?? []) {
        upsertMockKrsClassEnrollment({
          classId,
          studentId: before.studentId,
          studentUid: before.studentUid ?? before.studentId,
          studentNumber: before.studentNumber,
          studentName: before.studentName,
          programStudyId: before.programStudyId,
          periodId: before.periodId,
          sourceRef: before.id,
          actorId: context.uid,
          now,
        })
      }
    }
    else {
      releaseMockKrsReservations(before, now)
      after = { ...after, seatsReserved: false }
    }
    mockState().krs.set(krsId, cloneValue(after))
    if (namespace) mockState().idempotency.set(namespace, { requestHash: hash, response: { record: cloneValue(after), replayed: false }, createdAt: now })
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan akademik tidak tersedia.')
    const ref = db.collection('krs').doc(krsId)
    const idemRef = namespace ? db.collection('idempotencyKeys').doc(opaqueId('idem', namespace)) : undefined
    const result = await db.runTransaction(async (transaction) => {
      const [snapshot, idemSnapshot] = await Promise.all([
        transaction.get(ref),
        ...(idemRef ? [transaction.get(idemRef)] : []),
      ])
      if (idemSnapshot?.exists) {
        const stored = idemSnapshot.data() as { requestHash: string; response: ReviewKrsResult }
        if (stored.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk keputusan KRS berbeda.')
        return { current: stored.response.record, updated: stored.response.record, replayed: true }
      }
      if (!snapshot.exists) notFound('KRS')
      const current = { id: snapshot.id, ...snapshot.data() } as KrsRecord
      let updated = reviewedRecord(current, context, input, now)
      const classIds = current.seatsReserved ? (current.classIds || []) : []
      const classRefs = classIds.map(classId => db.collection('academicClasses').doc(classId))
      const reservationRefs = classIds.map(classId => db.collection('academicClasses').doc(classId).collection('seatReservations').doc(current.studentId))
      const enrollmentRefs = classIds.map(classId => db.collection('classEnrollments').doc(classEnrollmentId(classId, current.studentId)))
      const allocationSnapshots = await Promise.all([
        ...classRefs.map(reference => transaction.get(reference)),
        ...reservationRefs.map(reference => transaction.get(reference)),
        ...enrollmentRefs.map(reference => transaction.get(reference)),
      ])
      const classSnapshots = allocationSnapshots.slice(0, classRefs.length)
      const reservationSnapshots = allocationSnapshots.slice(classRefs.length, classRefs.length * 2)
      const enrollmentSnapshots = allocationSnapshots.slice(classRefs.length * 2)
      classIds.forEach((classId, index) => {
        const classSnapshot = classSnapshots[index]
        const reservationSnapshot = reservationSnapshots[index]
        if (input.decision === 'APPROVE') {
          if (!classSnapshot?.exists) conflict('KRS_CLASS_MISSING', 'Kelas pada KRS tidak lagi tersedia.', { classId })
          if (!reservationSnapshot?.exists || reservationSnapshot.data()?.planId !== current.id) {
            conflict('KRS_RESERVATION_MISSING', 'Reservasi kursi KRS tidak konsisten.', { classId })
          }
          const classData = classSnapshot.data() as { rosterStudentIds?: string[]; reservedSeatCount?: number; enrollmentCount?: number }
          const rosterStudentIds = Array.isArray(classData.rosterStudentIds) ? classData.rosterStudentIds : []
          transaction.update(reservationRefs[index]!, { status: 'ENROLLED', updatedAt: now })
          const priorEnrollment = enrollmentSnapshots[index]
          const priorData = priorEnrollment?.exists ? priorEnrollment.data() : undefined
          transaction.set(enrollmentRefs[index]!, {
            id: enrollmentRefs[index]!.id,
            classId,
            studentId: current.studentId,
            studentUid: current.studentUid ?? current.studentId,
            studentNumber: current.studentNumber,
            studentName: current.studentName,
            programStudyId: current.programStudyId,
            periodId: current.periodId,
            status: 'ACTIVE',
            source: 'KRS',
            sourceRef: current.id,
            version: Number(priorData?.version ?? 0) + 1,
            createdAt: priorData?.createdAt ?? now,
            createdBy: priorData?.createdBy ?? context.uid,
            updatedAt: now,
            updatedBy: context.uid,
          })
          const enrollmentCount = Number(classData.enrollmentCount ?? rosterStudentIds.length)
          const alreadyActive = priorData?.status === 'ACTIVE'
          transaction.update(classRefs[index]!, { enrollmentCount: enrollmentCount + (alreadyActive ? 0 : 1), updatedAt: now, updatedBy: context.uid })
        } else {
          if (classSnapshot?.exists && reservationSnapshot?.exists && reservationSnapshot.data()?.planId === current.id) {
            const classData = classSnapshot.data() as { rosterStudentIds?: string[]; reservedSeatCount?: number }
            const rosterStudentIds = Array.isArray(classData.rosterStudentIds) ? classData.rosterStudentIds : []
            const allocated = Number.isInteger(classData.reservedSeatCount) ? Number(classData.reservedSeatCount) : rosterStudentIds.length
            transaction.update(classRefs[index]!, { reservedSeatCount: Math.max(rosterStudentIds.length, allocated - 1), updatedAt: now })
            transaction.delete(reservationRefs[index]!)
          }
        }
      })
      if (input.decision === 'REJECT') updated = { ...updated, seatsReserved: false }
      transaction.update(ref, updated)
      if (idemRef) {
        transaction.create(idemRef, {
          requestHash: hash,
          response: { record: updated, replayed: false },
          createdAt: now,
          purgeAfter: firestorePurgeAfter(now, FIRESTORE_TTL_RETENTION_MS.idempotency),
        })
      }
      return { current, updated, replayed: false }
    })
    if (result.replayed) return { record: result.updated, replayed: true }
    before = result.current
    after = result.updated
  }

  const audit = await appendAudit({
    actor: context,
    action: input.decision === 'APPROVE' ? 'KRS_APPROVED' : 'KRS_REJECTED',
    resourceType: 'krs',
    resourceId: krsId,
    before: { status: before.status, version: before.version },
    after: { status: after.status, version: after.version, reviewNotes: after.reviewNotes },
    event,
  })
  if (after.studentUid) {
    try {
      await enqueueAcademicWorkflowNotification(context, {
        recipientUid: after.studentUid,
        templateKey: input.decision === 'APPROVE' ? 'krs-approved' : 'krs-rejected',
        variables: {
          periodId: after.periodId,
          totalCredits: after.totalCredits,
          reviewNotes: after.reviewNotes || 'Silakan periksa catatan dosen wali di halaman KRS.',
        },
        actionPath: '/akademik/krs',
        eventKey: `krs-reviewed:${krsId}:v${after.version}`,
      }, event)
    } catch {
      // Do not fail KRS review if notification delivery fails transiently.
    }
  }
  return { record: after, replayed: false, auditId: audit.id }
}
