import type { H3Event } from 'h3'
import type { AuthContext } from '../types/auth'
import type { KrsRecord } from '../types/domain'
import { appendAudit } from '../utils/audit'
import { conflict, notFound, serviceUnavailable } from '../utils/errors'
import { dataMode, firestoreAdmin } from '../utils/firebase-admin'
import { cloneValue, mockState } from '../utils/mock-store'
import { requireKrsApprovalScope } from '../utils/rbac'
import { opaqueId, requestHash } from '../utils/security'
import { enrollMockKrsReservations, releaseMockKrsReservations } from './krs-enrollment'

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
    if (input.decision === 'APPROVE') enrollMockKrsReservations(before, now)
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
      const rosterRefs = classIds.map(classId => db.collection('academicClasses').doc(classId).collection('roster').doc(current.studentId))
      const allocationSnapshots = await Promise.all([
        ...classRefs.map(reference => transaction.get(reference)),
        ...reservationRefs.map(reference => transaction.get(reference)),
      ])
      const classSnapshots = allocationSnapshots.slice(0, classRefs.length)
      const reservationSnapshots = allocationSnapshots.slice(classRefs.length)
      classIds.forEach((classId, index) => {
        const classSnapshot = classSnapshots[index]
        const reservationSnapshot = reservationSnapshots[index]
        if (!classSnapshot?.exists) conflict('KRS_CLASS_MISSING', 'Kelas pada KRS tidak lagi tersedia.', { classId })
        if (!reservationSnapshot?.exists || reservationSnapshot.data()?.planId !== current.id) {
          conflict('KRS_RESERVATION_MISSING', 'Reservasi kursi KRS tidak konsisten.', { classId })
        }
        const classData = classSnapshot.data() as { rosterStudentIds?: string[]; reservedSeatCount?: number }
        const rosterStudentIds = Array.isArray(classData.rosterStudentIds) ? classData.rosterStudentIds : []
        if (input.decision === 'APPROVE') {
          transaction.update(reservationRefs[index]!, { status: 'ENROLLED', updatedAt: now })
          transaction.set(rosterRefs[index]!, {
            studentId: current.studentId,
            studentNumber: current.studentNumber,
            studentName: current.studentName,
            programStudyId: current.programStudyId,
            status: 'ACTIVE',
          })
          if (!rosterStudentIds.includes(current.studentId)) {
            transaction.update(classRefs[index]!, { rosterStudentIds: [...rosterStudentIds, current.studentId], updatedAt: now })
          }
        } else {
          const allocated = Number.isInteger(classData.reservedSeatCount) ? Number(classData.reservedSeatCount) : rosterStudentIds.length
          transaction.update(classRefs[index]!, { reservedSeatCount: Math.max(rosterStudentIds.length, allocated - 1), updatedAt: now })
          transaction.delete(reservationRefs[index]!)
        }
      })
      if (input.decision === 'REJECT') updated = { ...updated, seatsReserved: false }
      transaction.update(ref, updated)
      if (idemRef) {
        transaction.create(idemRef, {
          requestHash: hash,
          response: { record: updated, replayed: false },
          createdAt: now,
          expiresAt: new Date(Date.parse(now) + 24 * 60 * 60 * 1000).toISOString(),
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
  return { record: after, replayed: false, auditId: audit.id }
}
