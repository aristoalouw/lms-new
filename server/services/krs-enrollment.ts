import type { H3Event } from 'h3'
import type { AcademicClassRecord } from '../types/academic-classes'
import type { AuthContext } from '../types/auth'
import type { KrsRecord } from '../types/domain'
import type {
  KrsCatalogEntry,
  KrsPeriodPolicy,
  KrsSeatReservation,
  KrsStudentAcademicState,
  KrsWriteResult,
} from '../types/krs-enrollment'
import { appendAudit } from '../utils/audit'
import { conflict, forbidden, invalidInput, notFound, serviceUnavailable } from '../utils/errors'
import { dataMode, firestoreAdmin } from '../utils/firebase-admin'
import { firestorePurgeAfter } from '../utils/firestore-ttl'
import { cloneValue, mockState } from '../utils/mock-store'
import { hasRole } from '../utils/rbac'
import { opaqueId, requestHash } from '../utils/security'
import { krsModuleState } from './krs-state'

export interface SaveKrsDraftInput {
  periodId: string
  classIds: string[]
  expectedVersion: number
}

export interface SubmitKrsInput {
  expectedVersion: number
}

interface ValidatedSelection {
  classes: AcademicClassRecord[]
  totalCredits: number
}

const MAX_SELECTED_CLASSES = 16
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

function safeId(value: string, label: string): string {
  const normalized = value.trim()
  if (!SAFE_ID.test(normalized)) invalidInput(`${label} memiliki format yang tidak valid.`)
  return normalized
}

function ownStudentId(context: AuthContext): string {
  if (!hasRole(context, 'student')) forbidden('KRS hanya dapat diubah oleh mahasiswa pemiliknya.')
  if (context.scope.studentIds.length > 1) forbidden('Identitas mahasiswa pada sesi tidak unik.')
  return safeId(context.scope.studentIds[0] || context.uid, 'studentId')
}

function assertStudentOwnership(context: AuthContext, student: KrsStudentAcademicState): void {
  const ownId = ownStudentId(context)
  if (student.id !== ownId || student.studentUid !== context.uid) forbidden('Data akademik mahasiswa tidak cocok dengan sesi.')
  if (!student.active) conflict('STUDENT_NOT_ACTIVE', 'Mahasiswa tidak berstatus aktif untuk mengisi KRS.')
  if (context.scope.programStudyIds.length && !context.scope.programStudyIds.includes(student.programStudyId)) {
    forbidden('Program studi mahasiswa tidak cocok dengan lingkup sesi.')
  }
}

function requireOpenPeriod(period: KrsPeriodPolicy, now: Date): void {
  const opensAt = Date.parse(period.krsOpensAt)
  const closesAt = Date.parse(period.krsClosesAt)
  if (period.status !== 'KRS_OPEN' || !Number.isFinite(opensAt) || !Number.isFinite(closesAt)
    || now.getTime() < opensAt || now.getTime() > closesAt) {
    conflict('KRS_PERIOD_CLOSED', 'Periode pengisian KRS sedang ditutup.')
  }
}

function activeHoldCodes(student: KrsStudentAcademicState): string[] {
  return student.holds.filter(hold => hold.active).map(hold => `${hold.type}:${hold.id}`)
}

function schedulesOverlap(left: AcademicClassRecord, right: AcademicClassRecord): boolean {
  return left.schedule.some(leftMeeting => {
    const leftStart = Date.parse(leftMeeting.scheduledStartAt)
    const leftEnd = Date.parse(leftMeeting.scheduledEndAt)
    return right.schedule.some(rightMeeting => {
      const rightStart = Date.parse(rightMeeting.scheduledStartAt)
      const rightEnd = Date.parse(rightMeeting.scheduledEndAt)
      return Number.isFinite(leftStart) && Number.isFinite(leftEnd) && Number.isFinite(rightStart) && Number.isFinite(rightEnd)
        && leftStart < rightEnd && rightStart < leftEnd
    })
  })
}

function validateSelection(
  classes: AcademicClassRecord[],
  inputClassIds: string[],
  periodId: string,
  student: KrsStudentAcademicState,
): ValidatedSelection {
  if (!inputClassIds.length || inputClassIds.length > MAX_SELECTED_CLASSES) {
    invalidInput(`KRS harus berisi 1-${MAX_SELECTED_CLASSES} kelas.`)
  }
  if (new Set(inputClassIds).size !== inputClassIds.length || classes.length !== inputClassIds.length) {
    invalidInput('Daftar kelas mengandung duplikasi atau kelas yang tidak ditemukan.')
  }
  for (const record of classes) {
    if (record.status !== 'ACTIVE' || record.periodId !== periodId || record.programStudyId !== student.programStudyId) {
      conflict('CLASS_NOT_ELIGIBLE', 'Kelas tidak aktif atau berada di luar periode/program studi mahasiswa.', { classId: record.id })
    }
    if (!Number.isInteger(record.credits) || record.credits < 1 || record.credits > 12) {
      conflict('CLASS_CREDIT_INVALID', 'Bobot SKS kelas tidak valid.', { classId: record.id })
    }
    if (!Array.isArray(record.schedule) || record.schedule.length === 0 || record.schedule.length > 30) {
      conflict('CLASS_SCHEDULE_INVALID', 'Jadwal kelas belum valid untuk KRS.', { classId: record.id })
    }
  }
  const courseCodes = classes.map(record => record.courseCode)
  if (new Set(courseCodes).size !== courseCodes.length) conflict('DUPLICATE_COURSE', 'Satu mata kuliah hanya boleh dipilih satu kali.')

  const completed = new Set(student.completedCourseCodes)
  for (const record of classes) {
    const missing = (record.prerequisiteCourseCodes || []).filter(code => !completed.has(code))
    if (missing.length) conflict('PREREQUISITE_NOT_MET', 'Prasyarat mata kuliah belum terpenuhi.', { classId: record.id, missingCourseCodes: missing })
  }

  for (let left = 0; left < classes.length; left += 1) {
    for (let right = left + 1; right < classes.length; right += 1) {
      const leftClass = classes[left]!
      const rightClass = classes[right]!
      if (schedulesOverlap(leftClass, rightClass)) {
        conflict('SCHEDULE_CONFLICT', 'Jadwal kelas saling bertabrakan.', { classIds: [leftClass.id, rightClass.id] })
      }
    }
  }

  const totalCredits = classes.reduce((sum, record) => sum + record.credits, 0)
  if (totalCredits > student.maximumCredits) {
    conflict('CREDIT_LIMIT_EXCEEDED', 'Total SKS melebihi batas beban studi mahasiswa.', {
      totalCredits,
      maximumCredits: student.maximumCredits,
    })
  }
  return { classes, totalCredits }
}

function classSnapshot(record: AcademicClassRecord): NonNullable<KrsRecord['classSelections']>[number] {
  return {
    classId: record.id,
    courseCode: record.courseCode,
    courseName: record.courseName,
    section: record.section,
    credits: record.credits,
  }
}

function planId(studentId: string, periodId: string): string {
  return opaqueId('krs', `${studentId}:${periodId}`)
}

function reservationId(classId: string, studentId: string): string {
  return opaqueId('seat', `${classId}:${studentId}`)
}

function draftRecord(
  previous: KrsRecord | undefined,
  student: KrsStudentAcademicState,
  period: KrsPeriodPolicy,
  selection: ValidatedSelection,
): KrsRecord {
  if (previous && previous.studentId !== student.id) forbidden('KRS bukan milik mahasiswa pada sesi ini.')
  if (previous && !['DRAFT', 'REJECTED'].includes(previous.status)) {
    conflict('KRS_NOT_EDITABLE', 'KRS tidak dapat diubah pada status saat ini.', { currentStatus: previous.status })
  }
  return {
    id: previous?.id ?? planId(student.id, period.id),
    studentId: student.id,
    studentUid: student.studentUid,
    studentName: student.studentName,
    studentNumber: student.studentNumber,
    advisorId: student.advisorId,
    programStudyId: student.programStudyId,
    periodId: period.id,
    totalCredits: selection.totalCredits,
    courseCodes: selection.classes.map(record => record.courseCode),
    classIds: selection.classes.map(record => record.id),
    classSelections: selection.classes.map(classSnapshot),
    maximumCredits: student.maximumCredits,
    eligibilityVersion: student.version,
    seatsReserved: false,
    status: 'DRAFT',
    version: (previous?.version ?? 0) + 1,
  }
}

function ensureExpectedVersion(previous: KrsRecord | undefined, expectedVersion: number): void {
  const currentVersion = previous?.version ?? 0
  if (currentVersion !== expectedVersion) {
    conflict('VERSION_CONFLICT', 'KRS telah berubah. Muat ulang sebelum menyimpan.', { currentVersion })
  }
}

function mockStudent(studentId: string): KrsStudentAcademicState {
  const student = krsModuleState().students.get(studentId)
  if (!student) notFound('Status akademik mahasiswa')
  return structuredClone(student)
}

function mockPeriod(periodId: string): KrsPeriodPolicy {
  const period = krsModuleState().periods.get(periodId)
  if (!period) notFound('Periode akademik')
  return structuredClone(period)
}

function mockClasses(classIds: string[]): AcademicClassRecord[] {
  return classIds.map(id => {
    const record = krsModuleState().classes.get(id)
    if (!record) notFound('Kelas')
    return structuredClone(record)
  })
}

export async function listKrsCatalog(
  context: AuthContext,
  periodIdValue: string,
): Promise<{ period: KrsPeriodPolicy; student: KrsStudentAcademicState; classes: KrsCatalogEntry[] }> {
  const studentId = ownStudentId(context)
  const periodId = safeId(periodIdValue, 'periodId')
  let period: KrsPeriodPolicy
  let student: KrsStudentAcademicState
  let classes: AcademicClassRecord[]

  if (dataMode() === 'mock') {
    period = mockPeriod(periodId)
    student = mockStudent(studentId)
    classes = [...krsModuleState().classes.values()].filter(record => record.periodId === periodId && record.programStudyId === student.programStudyId)
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan KRS tidak tersedia.')
    const [periodSnapshot, studentSnapshot, classSnapshot] = await Promise.all([
      db.collection('academicPeriods').doc(periodId).get(),
      db.collection('studentAcademicStates').doc(studentId).get(),
      db.collection('academicClasses').where('periodId', '==', periodId).limit(1_000).get(),
    ])
    if (!periodSnapshot.exists) notFound('Periode akademik')
    if (!studentSnapshot.exists) notFound('Status akademik mahasiswa')
    period = { id: periodSnapshot.id, ...periodSnapshot.data() } as KrsPeriodPolicy
    student = { id: studentSnapshot.id, ...studentSnapshot.data() } as KrsStudentAcademicState
    classes = classSnapshot.docs
      .map(document => ({ id: document.id, ...document.data() }) as AcademicClassRecord)
      .filter(record => record.programStudyId === student.programStudyId && record.status === 'ACTIVE')
  }
  assertStudentOwnership(context, student)
  const completed = new Set(student.completedCourseCodes)
  return {
    period,
    student,
    classes: classes.map(classRecord => {
      const missingPrerequisiteCodes = (classRecord.prerequisiteCourseCodes || []).filter(code => !completed.has(code))
      const used = classRecord.reservedSeatCount ?? classRecord.rosterStudentIds?.length ?? 0
      return {
        classRecord: structuredClone(classRecord),
        availableSeats: Math.max(0, (classRecord.capacity ?? 0) - used),
        eligibleByPrerequisite: missingPrerequisiteCodes.length === 0,
        missingPrerequisiteCodes,
      }
    }),
  }
}

export async function getOwnKrs(context: AuthContext, periodIdValue: string): Promise<KrsRecord | null> {
  const studentId = ownStudentId(context)
  const periodId = safeId(periodIdValue, 'periodId')
  if (dataMode() === 'mock') {
    const match = [...mockState().krs.values()].find(record => record.studentId === studentId && record.periodId === periodId)
    return match ? cloneValue(match) : null
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan KRS tidak tersedia.')
  const snapshot = await db.collection('krs')
    .where('studentUid', '==', context.uid)
    .where('periodId', '==', periodId)
    .limit(2)
    .get()
  if (snapshot.size > 1) serviceUnavailable('Terdapat lebih dari satu KRS mahasiswa pada periode yang sama.')
  const document = snapshot.docs[0]
  if (!document) return null
  const record = { id: document.id, ...document.data() } as KrsRecord
  if (record.studentId !== studentId) forbidden('Identitas KRS tidak cocok dengan sesi.')
  return record
}

export async function saveKrsDraft(
  context: AuthContext,
  input: SaveKrsDraftInput,
  idempotencyKey: string,
  event?: H3Event,
  clock = new Date(),
): Promise<KrsWriteResult> {
  const studentId = ownStudentId(context)
  const periodId = safeId(input.periodId, 'periodId')
  const classIds = input.classIds.map(id => safeId(id, 'classId'))
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 0) invalidInput('expectedVersion tidak valid.')
  const hash = requestHash({ periodId, classIds, expectedVersion: input.expectedVersion })
  const namespace = `krs:draft:${context.uid}:${idempotencyKey}`
  const now = clock.toISOString()
  let result: KrsWriteResult

  if (dataMode() === 'mock') {
    const previousReplay = krsModuleState().idempotency.get(namespace)
    if (previousReplay) {
      if (previousReplay.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.')
      return { ...structuredClone(previousReplay.response), replayed: true, auditId: undefined }
    }
    const period = mockPeriod(periodId)
    requireOpenPeriod(period, clock)
    const student = mockStudent(studentId)
    assertStudentOwnership(context, student)
    const classes = mockClasses(classIds)
    const selection = validateSelection(classes, classIds, periodId, student)
    const id = planId(studentId, periodId)
    const previous = mockState().krs.get(id)
    ensureExpectedVersion(previous, input.expectedVersion)
    const record = draftRecord(previous, student, period, selection)
    mockState().krs.set(id, cloneValue(record))
    result = { record, replayed: false }
    krsModuleState().idempotency.set(namespace, { requestHash: hash, response: structuredClone(result), createdAt: now })
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan KRS tidak tersedia.')
    const id = planId(studentId, periodId)
    const planRef = db.collection('krs').doc(id)
    const studentRef = db.collection('studentAcademicStates').doc(studentId)
    const periodRef = db.collection('academicPeriods').doc(periodId)
    const idemRef = db.collection('idempotencyKeys').doc(opaqueId('idem', namespace))
    const classRefs = classIds.map(classId => db.collection('academicClasses').doc(classId))
    result = await db.runTransaction(async transaction => {
      const [idemSnapshot, planSnapshot, studentSnapshot, periodSnapshot, ...classSnapshots] = await Promise.all([
        transaction.get(idemRef), transaction.get(planRef), transaction.get(studentRef), transaction.get(periodRef),
        ...classRefs.map(reference => transaction.get(reference)),
      ])
      if (idemSnapshot.exists) {
        const stored = idemSnapshot.data() as { requestHash: string; response: KrsWriteResult }
        if (stored.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.')
        return { ...stored.response, replayed: true, auditId: undefined }
      }
      if (!studentSnapshot.exists) notFound('Status akademik mahasiswa')
      if (!periodSnapshot.exists) notFound('Periode akademik')
      const student = { id: studentSnapshot.id, ...studentSnapshot.data() } as KrsStudentAcademicState
      const period = { id: periodSnapshot.id, ...periodSnapshot.data() } as KrsPeriodPolicy
      assertStudentOwnership(context, student)
      requireOpenPeriod(period, clock)
      const classes = classSnapshots.map(snapshot => {
        if (!snapshot.exists) notFound('Kelas')
        return { id: snapshot.id, ...snapshot.data() } as AcademicClassRecord
      })
      const selection = validateSelection(classes, classIds, periodId, student)
      const previous = planSnapshot.exists ? ({ id: planSnapshot.id, ...planSnapshot.data() } as KrsRecord) : undefined
      ensureExpectedVersion(previous, input.expectedVersion)
      const record = draftRecord(previous, student, period, selection)
      const response: KrsWriteResult = { record, replayed: false }
      transaction.set(planRef, record)
      transaction.create(idemRef, {
        requestHash: hash,
        response,
        createdAt: now,
        purgeAfter: firestorePurgeAfter(now, IDEMPOTENCY_TTL_MS),
      })
      return response
    })
    if (result.replayed) return result
  }

  const audit = await appendAudit({
    actor: context,
    action: 'KRS_DRAFT_SAVED',
    resourceType: 'krs',
    resourceId: result.record.id,
    after: { periodId, classIds: result.record.classIds, totalCredits: result.record.totalCredits, version: result.record.version },
    event,
  })
  result.auditId = audit.id
  return result
}

export async function submitKrs(
  context: AuthContext,
  krsIdValue: string,
  input: SubmitKrsInput,
  idempotencyKey: string,
  event?: H3Event,
  clock = new Date(),
): Promise<KrsWriteResult> {
  const studentId = ownStudentId(context)
  const krsId = safeId(krsIdValue, 'krsId')
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) invalidInput('expectedVersion tidak valid.')
  const hash = requestHash({ krsId, expectedVersion: input.expectedVersion })
  const namespace = `krs:submit:${context.uid}:${idempotencyKey}`
  const now = clock.toISOString()
  let result: KrsWriteResult

  const validateSubmission = (
    record: KrsRecord,
    student: KrsStudentAcademicState,
    period: KrsPeriodPolicy,
    classes: AcademicClassRecord[],
  ): ValidatedSelection => {
    if (record.studentId !== studentId || record.studentUid !== context.uid) forbidden('KRS bukan milik mahasiswa pada sesi ini.')
    if (record.status !== 'DRAFT' && record.status !== 'REJECTED') conflict('KRS_NOT_SUBMITTABLE', 'KRS tidak dapat diajukan pada status saat ini.')
    if (record.version !== input.expectedVersion) conflict('VERSION_CONFLICT', 'KRS telah berubah.', { currentVersion: record.version })
    assertStudentOwnership(context, student)
    requireOpenPeriod(period, clock)
    const holds = activeHoldCodes(student)
    if (holds.length) conflict('KRS_HELD', 'KRS dicekal oleh kondisi akademik, keuangan, atau administrasi.', { holdCodes: holds })
    return validateSelection(classes, record.classIds || [], record.periodId, student)
  }

  if (dataMode() === 'mock') {
    const replay = krsModuleState().idempotency.get(namespace)
    if (replay) {
      if (replay.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.')
      return { ...structuredClone(replay.response), replayed: true, auditId: undefined }
    }
    const record = mockState().krs.get(krsId)
    if (!record) notFound('KRS')
    const student = mockStudent(studentId)
    const period = mockPeriod(record.periodId)
    const classes = mockClasses(record.classIds || [])
    const selection = validateSubmission(record, student, period, classes)
    for (const classRecord of selection.classes) {
      const reservation = krsModuleState().reservations.get(reservationId(classRecord.id, studentId))
      if (reservation && reservation.planId !== record.id) conflict('SEAT_ALREADY_RESERVED', 'Kursi kelas telah dipesan oleh KRS lain.')
      const used = classRecord.reservedSeatCount ?? classRecord.rosterStudentIds?.length ?? 0
      const capacity = classRecord.capacity ?? 0
      if (!reservation && (capacity < 1 || used >= capacity)) conflict('CLASS_FULL', 'Kapasitas kelas telah penuh.', { classId: classRecord.id })
    }
    for (const classRecord of selection.classes) {
      const id = reservationId(classRecord.id, studentId)
      if (!krsModuleState().reservations.has(id)) {
        krsModuleState().classes.set(classRecord.id, { ...classRecord, reservedSeatCount: (classRecord.reservedSeatCount ?? classRecord.rosterStudentIds?.length ?? 0) + 1, updatedAt: now })
        krsModuleState().reservations.set(id, { id, classId: classRecord.id, studentId, planId: record.id, status: 'RESERVED', createdAt: now, updatedAt: now })
      }
    }
    const submitted: KrsRecord = {
      ...record,
      classSelections: selection.classes.map(classSnapshot),
      courseCodes: selection.classes.map(item => item.courseCode),
      totalCredits: selection.totalCredits,
      maximumCredits: student.maximumCredits,
      eligibilityVersion: student.version,
      seatsReserved: true,
      status: 'SUBMITTED',
      version: record.version + 1,
      submittedAt: now,
      reviewedAt: undefined,
      reviewedBy: undefined,
      reviewNotes: undefined,
    }
    mockState().krs.set(krsId, cloneValue(submitted))
    result = { record: submitted, replayed: false }
    krsModuleState().idempotency.set(namespace, { requestHash: hash, response: structuredClone(result), createdAt: now })
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan KRS tidak tersedia.')
    const planRef = db.collection('krs').doc(krsId)
    const studentRef = db.collection('studentAcademicStates').doc(studentId)
    const idemRef = db.collection('idempotencyKeys').doc(opaqueId('idem', namespace))
    result = await db.runTransaction(async transaction => {
      const [idemSnapshot, planSnapshot, studentSnapshot] = await Promise.all([
        transaction.get(idemRef), transaction.get(planRef), transaction.get(studentRef),
      ])
      if (idemSnapshot.exists) {
        const stored = idemSnapshot.data() as { requestHash: string; response: KrsWriteResult }
        if (stored.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.')
        return { ...stored.response, replayed: true, auditId: undefined }
      }
      if (!planSnapshot.exists) notFound('KRS')
      if (!studentSnapshot.exists) notFound('Status akademik mahasiswa')
      const record = { id: planSnapshot.id, ...planSnapshot.data() } as KrsRecord
      const classIds = record.classIds || []
      const periodRef = db.collection('academicPeriods').doc(record.periodId)
      const classRefs = classIds.map(classId => db.collection('academicClasses').doc(classId))
      const reservationRefs = classIds.map(classId => db.collection('academicClasses').doc(classId).collection('seatReservations').doc(studentId))
      const [periodSnapshot, ...classAndReservationSnapshots] = await Promise.all([
        transaction.get(periodRef),
        ...classRefs.map(reference => transaction.get(reference)),
        ...reservationRefs.map(reference => transaction.get(reference)),
      ])
      if (!periodSnapshot.exists) notFound('Periode akademik')
      const classSnapshots = classAndReservationSnapshots.slice(0, classRefs.length)
      const reservationSnapshots = classAndReservationSnapshots.slice(classRefs.length)
      const classes = classSnapshots.map(snapshot => {
        if (!snapshot.exists) notFound('Kelas')
        return { id: snapshot.id, ...snapshot.data() } as AcademicClassRecord
      })
      const student = { id: studentSnapshot.id, ...studentSnapshot.data() } as KrsStudentAcademicState
      const period = { id: periodSnapshot.id, ...periodSnapshot.data() } as KrsPeriodPolicy
      const selection = validateSubmission(record, student, period, classes)
      selection.classes.forEach((classRecord, index) => {
        const reservation = reservationSnapshots[index]
        if (reservation?.exists && reservation.data()?.planId !== record.id) conflict('SEAT_ALREADY_RESERVED', 'Kursi kelas telah dipesan oleh KRS lain.')
        const used = classRecord.reservedSeatCount ?? classRecord.rosterStudentIds?.length ?? 0
        const capacity = classRecord.capacity ?? 0
        if (!reservation?.exists && (capacity < 1 || used >= capacity)) conflict('CLASS_FULL', 'Kapasitas kelas telah penuh.', { classId: classRecord.id })
      })
      selection.classes.forEach((classRecord, index) => {
        if (!reservationSnapshots[index]?.exists) {
          transaction.update(classRefs[index]!, { reservedSeatCount: (classRecord.reservedSeatCount ?? classRecord.rosterStudentIds?.length ?? 0) + 1, updatedAt: now })
          const reservation: KrsSeatReservation = {
            id: studentId, classId: classRecord.id, studentId, planId: record.id,
            status: 'RESERVED', createdAt: now, updatedAt: now,
          }
          transaction.create(reservationRefs[index]!, reservation)
        }
      })
      const submitted: KrsRecord = {
        ...record,
        classSelections: selection.classes.map(classSnapshot),
        courseCodes: selection.classes.map(item => item.courseCode),
        totalCredits: selection.totalCredits,
        maximumCredits: student.maximumCredits,
        eligibilityVersion: student.version,
        seatsReserved: true,
        status: 'SUBMITTED',
        version: record.version + 1,
        submittedAt: now,
      }
      const response: KrsWriteResult = { record: submitted, replayed: false }
      transaction.update(planRef, submitted)
      transaction.create(idemRef, {
        requestHash: hash,
        response,
        createdAt: now,
        purgeAfter: firestorePurgeAfter(now, IDEMPOTENCY_TTL_MS),
      })
      return response
    })
    if (result.replayed) return result
  }

  const audit = await appendAudit({
    actor: context,
    action: 'KRS_SUBMITTED',
    resourceType: 'krs',
    resourceId: krsId,
    after: {
      status: result.record.status,
      classIds: result.record.classIds,
      totalCredits: result.record.totalCredits,
      eligibilityVersion: result.record.eligibilityVersion,
      version: result.record.version,
    },
    event,
  })
  result.auditId = audit.id
  return result
}

export function releaseMockKrsReservations(record: KrsRecord, now: string): void {
  if (!record.seatsReserved) return
  for (const classId of record.classIds || []) {
    const id = reservationId(classId, record.studentId)
    const reservation = krsModuleState().reservations.get(id)
    if (!reservation || reservation.planId !== record.id) continue
    const classRecord = krsModuleState().classes.get(classId)
    if (classRecord) {
      krsModuleState().classes.set(classId, {
        ...classRecord,
        reservedSeatCount: Math.max(classRecord.rosterStudentIds?.length ?? 0, (classRecord.reservedSeatCount ?? classRecord.rosterStudentIds?.length ?? 0) - 1),
        updatedAt: now,
      })
    }
    krsModuleState().reservations.delete(id)
  }
}

export function enrollMockKrsReservations(record: KrsRecord, now: string): void {
  for (const classId of record.classIds || []) {
    const id = reservationId(classId, record.studentId)
    const reservation = krsModuleState().reservations.get(id)
    if (!reservation || reservation.planId !== record.id) continue
    krsModuleState().reservations.set(id, { ...reservation, status: 'ENROLLED', updatedAt: now })
    const classRecord = krsModuleState().classes.get(classId)
    if (classRecord && !(classRecord.rosterStudentIds ?? []).includes(record.studentId)) {
      krsModuleState().classes.set(classId, { ...classRecord, rosterStudentIds: [...(classRecord.rosterStudentIds ?? []), record.studentId], updatedAt: now })
    }
  }
}
