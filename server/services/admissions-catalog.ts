import type { H3Event } from 'h3'
import { DEMO_ADMISSION_PROGRAMS, DEMO_ADMISSION_WAVES } from '../data/admissions-catalog'
import type { AuthContext } from '../types/auth'
import {
  ADMISSION_PATH_IDS,
  STUDY_MODE_IDS,
  type AdmissionProgram,
  type AdmissionWave,
  type AdmissionWaveInput,
} from '../types/admissions'
import { appendAudit } from '../utils/audit'
import { conflict, forbidden, invalidInput, notFound, serviceUnavailable } from '../utils/errors'
import { dataMode, firestoreAdmin } from '../utils/firebase-admin'
import { firestorePurgeAfter } from '../utils/firestore-ttl'
import { hasRole, requirePermission } from '../utils/rbac'
import { opaqueId, requestHash } from '../utils/security'
import { requireInteger, requireString } from '../utils/validation'
import { admissionModuleState } from './admissions-state'

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{1,79}$/
const ACADEMIC_YEAR = /^\d{4}\/\d{4}$/
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000

export interface AdmissionCatalog {
  programs: AdmissionProgram[]
  waves: AdmissionWave[]
  paths: typeof ADMISSION_PATH_IDS
  studyModes: typeof STUDY_MODE_IDS
}

function asProgram(id: string, value: Record<string, unknown>): AdmissionProgram {
  return {
    id,
    code: String(value.code || ''),
    name: String(value.name || ''),
    unitId: String(value.unitId || value.facultyId || ''),
    active: value.active === true,
    ...(Number.isInteger(value.version) ? { version: Number(value.version) } : {}),
  }
}

function asWave(id: string, value: Record<string, unknown>): AdmissionWave {
  return {
    id,
    academicYear: String(value.academicYear || ''),
    label: String(value.label || ''),
    opensAt: String(value.opensAt || ''),
    closesAt: String(value.closesAt || ''),
    registrationFee: Number(value.registrationFee || 0),
    currency: 'IDR',
    active: value.active === true,
    programStudyIds: Array.isArray(value.programStudyIds) ? value.programStudyIds.filter(item => typeof item === 'string') : [],
    capacity: Number(value.capacity || 0),
    version: Number(value.version || 1),
    ...(typeof value.createdAt === 'string' ? { createdAt: value.createdAt } : {}),
    ...(typeof value.createdBy === 'string' ? { createdBy: value.createdBy } : {}),
    ...(typeof value.updatedAt === 'string' ? { updatedAt: value.updatedAt } : {}),
    ...(typeof value.updatedBy === 'string' ? { updatedBy: value.updatedBy } : {}),
  }
}

export async function admissionCatalog(options: { includeInactive?: boolean } = {}): Promise<AdmissionCatalog> {
  let programs: AdmissionProgram[]
  let waves: AdmissionWave[]
  if (dataMode() === 'mock') {
    programs = [...admissionModuleState().programs.values()].map(value => structuredClone(value))
    waves = [...admissionModuleState().waves.values()].map(value => structuredClone(value))
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan katalog PMB tidak tersedia.')
    const [programSnapshot, waveSnapshot] = await Promise.all([
      db.collection('academicProgramStudies').limit(100).get(),
      db.collection('admissionWaves').orderBy('opensAt', 'desc').limit(100).get(),
    ])
    programs = programSnapshot.docs.map(document => asProgram(document.id, document.data()))
    waves = waveSnapshot.docs.map(document => asWave(document.id, document.data()))
  }
  return {
    programs: programs.filter(program => options.includeInactive || program.active).sort((a, b) => a.name.localeCompare(b.name, 'id')),
    waves: waves.filter(wave => options.includeInactive || wave.active).sort((a, b) => b.opensAt.localeCompare(a.opensAt)),
    paths: [...ADMISSION_PATH_IDS],
    studyModes: [...STUDY_MODE_IDS],
  }
}

export async function admissionProgramById(idValue: string): Promise<AdmissionProgram> {
  const id = requireString(idValue, 'programStudyId', { max: 80, pattern: SAFE_ID })
  let program: AdmissionProgram | undefined
  if (dataMode() === 'mock') program = admissionModuleState().programs.get(id)
  else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan katalog PMB tidak tersedia.')
    const snapshot = await db.collection('academicProgramStudies').doc(id).get()
    if (snapshot.exists) program = asProgram(snapshot.id, snapshot.data() || {})
  }
  if (!program || !program.active || !program.code || !program.name || !program.unitId) invalidInput('Program studi PMB tidak valid atau tidak aktif.')
  return structuredClone(program)
}

export async function admissionWaveById(idValue: string, now?: number): Promise<AdmissionWave> {
  const id = requireString(idValue, 'waveId', { max: 80, pattern: SAFE_ID })
  let wave: AdmissionWave | undefined
  if (dataMode() === 'mock') wave = admissionModuleState().waves.get(id)
  else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan katalog PMB tidak tersedia.')
    const snapshot = await db.collection('admissionWaves').doc(id).get()
    if (snapshot.exists) wave = asWave(snapshot.id, snapshot.data() || {})
  }
  if (!wave || !wave.active) invalidInput('Gelombang PMB tidak valid atau tidak aktif.')
  if (now !== undefined && (now < Date.parse(wave.opensAt) || now > Date.parse(wave.closesAt))) {
    conflict('ADMISSION_WAVE_CLOSED', 'Gelombang pendaftaran belum dibuka atau telah ditutup.')
  }
  return structuredClone(wave)
}

function normalizeWave(input: AdmissionWaveInput, version: number, actor: string, prior?: AdmissionWave): AdmissionWave {
  const id = requireString(input.id, 'id', { max: 80, pattern: SAFE_ID })
  const academicYear = requireString(input.academicYear, 'academicYear', { max: 9, pattern: ACADEMIC_YEAR })
  const label = requireString(input.label, 'label', { min: 2, max: 120 }).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  const opens = Date.parse(requireString(input.opensAt, 'opensAt', { max: 48 }))
  const closes = Date.parse(requireString(input.closesAt, 'closesAt', { max: 48 }))
  if (!Number.isFinite(opens) || !Number.isFinite(closes) || closes <= opens) invalidInput('Rentang gelombang PMB tidak valid.')
  const programStudyIds = [...new Set(input.programStudyIds.map(item => requireString(item, 'programStudyId', { max: 80, pattern: SAFE_ID })))]
  if (!programStudyIds.length || programStudyIds.length > 100) invalidInput('Gelombang harus memiliki 1-100 program studi.')
  const timestamp = new Date().toISOString()
  return {
    id,
    academicYear,
    label,
    opensAt: new Date(opens).toISOString(),
    closesAt: new Date(closes).toISOString(),
    registrationFee: requireInteger(input.registrationFee, 'registrationFee', 0, 1_000_000_000),
    currency: 'IDR',
    active: input.active === true,
    programStudyIds,
    capacity: requireInteger(input.capacity, 'capacity', 1, 100_000),
    version,
    createdAt: prior?.createdAt || timestamp,
    createdBy: prior?.createdBy || actor,
    updatedAt: timestamp,
    updatedBy: actor,
  }
}

async function requireWaveScope(context: AuthContext, programStudyIds: string[]): Promise<void> {
  requirePermission(context, 'pmb.configure')
  if (!hasRole(context, 'administrator', 'admissions_staff')) forbidden('Katalog PMB hanya dapat dikelola petugas penerimaan.')
  await Promise.all(programStudyIds.map(admissionProgramById))
  if (!hasRole(context, 'administrator') && programStudyIds.some(id => !context.scope.programStudyIds.includes(id))) {
    forbidden('Gelombang memuat program studi di luar lingkup petugas.')
  }
}

export async function createAdmissionWave(
  context: AuthContext,
  input: AdmissionWaveInput,
  idempotencyKey: string,
  event?: H3Event,
): Promise<{ wave: AdmissionWave; replayed: boolean; auditId?: string }> {
  await requireWaveScope(context, input.programStudyIds)
  const hash = requestHash(input)
  const candidate = normalizeWave(input, 1, context.uid)
  const namespace = `admission-wave-create:${context.uid}:${idempotencyKey}`
  if (dataMode() === 'mock') {
    const state = admissionModuleState()
    const prior = state.idempotency.get(namespace)
    if (prior) {
      if (prior.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk gelombang berbeda.')
      return { wave: structuredClone(state.waves.get(candidate.id) || candidate), replayed: true }
    }
    if (state.waves.has(candidate.id)) conflict('ADMISSION_WAVE_EXISTS', 'ID gelombang PMB sudah digunakan.')
    state.waves.set(candidate.id, structuredClone(candidate))
    state.idempotency.set(namespace, { requestHash: hash, response: { waveId: candidate.id }, createdAt: candidate.updatedAt! })
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan katalog PMB tidak tersedia.')
    const reference = db.collection('admissionWaves').doc(candidate.id)
    const idemRef = db.collection('idempotencyKeys').doc(opaqueId('idem', namespace))
    const result = await db.runTransaction(async transaction => {
      const [existing, prior] = await Promise.all([transaction.get(reference), transaction.get(idemRef)])
      if (prior.exists) {
        if (prior.data()?.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk gelombang berbeda.')
        if (!existing.exists) conflict('IDEMPOTENCY_RESULT_MISSING', 'Hasil mutasi gelombang tidak ditemukan.')
        return { wave: asWave(existing.id, existing.data() || {}), replayed: true }
      }
      if (existing.exists) conflict('ADMISSION_WAVE_EXISTS', 'ID gelombang PMB sudah digunakan.')
      transaction.create(reference, candidate)
      transaction.create(idemRef, {
        requestHash: hash,
        waveId: candidate.id,
        createdAt: candidate.updatedAt,
        purgeAfter: firestorePurgeAfter(candidate.updatedAt!, IDEMPOTENCY_TTL_MS),
      })
      return { wave: candidate, replayed: false }
    })
    if (result.replayed) return result
  }
  const audit = await appendAudit({ actor: context, action: 'ADMISSION_WAVE_CREATED', resourceType: 'admission_wave', resourceId: candidate.id, after: candidate, event })
  return { wave: candidate, replayed: false, auditId: audit.id }
}

export async function updateAdmissionWave(
  context: AuthContext,
  idValue: string,
  input: AdmissionWaveInput & { expectedVersion: number },
  event?: H3Event,
): Promise<{ wave: AdmissionWave; auditId: string }> {
  const id = requireString(idValue, 'id', { max: 80, pattern: SAFE_ID })
  if (input.id !== id) invalidInput('ID gelombang pada path dan body harus sama.')
  await requireWaveScope(context, input.programStudyIds)
  const expectedVersion = requireInteger(input.expectedVersion, 'expectedVersion', 1, 100_000)
  let before: AdmissionWave
  let wave: AdmissionWave
  if (dataMode() === 'mock') {
    const state = admissionModuleState()
    const current = state.waves.get(id)
    if (!current) notFound('Gelombang PMB')
    if (current.version !== expectedVersion) conflict('VERSION_CONFLICT', 'Gelombang PMB telah berubah.', { currentVersion: current.version })
    before = structuredClone(current)
    wave = normalizeWave(input, expectedVersion + 1, context.uid, current)
    state.waves.set(id, structuredClone(wave))
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan katalog PMB tidak tersedia.')
    const reference = db.collection('admissionWaves').doc(id)
    const result = await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(reference)
      if (!snapshot.exists) notFound('Gelombang PMB')
      const current = asWave(snapshot.id, snapshot.data() || {})
      if (current.version !== expectedVersion) conflict('VERSION_CONFLICT', 'Gelombang PMB telah berubah.', { currentVersion: current.version })
      const next = normalizeWave(input, expectedVersion + 1, context.uid, current)
      transaction.set(reference, next)
      return { current, next }
    })
    before = result.current
    wave = result.next
  }
  const audit = await appendAudit({ actor: context, action: 'ADMISSION_WAVE_UPDATED', resourceType: 'admission_wave', resourceId: id, before, after: wave, event })
  return { wave, auditId: audit.id }
}

export { DEMO_ADMISSION_PROGRAMS as ADMISSION_PROGRAMS, DEMO_ADMISSION_WAVES as ADMISSION_WAVES }
