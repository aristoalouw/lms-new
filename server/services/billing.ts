import type { H3Event } from 'h3'
import type { AuthContext } from '../types/auth'
import type {
  BatchInvoiceResult,
  BillingAcademicHold,
  BillingInvoice,
  BillingInvoiceView,
  BillingListResult,
  BillingStudentProfile,
  BillingSummary,
  BillingVoucher,
  BillingWriteResult,
  DepositAccount,
  DepositTransaction,
  InstallmentPlan,
  InstallmentSchedule,
  InstallmentScheduleView,
  InvoiceAdjustment,
  InvoiceAdjustmentType,
  InvoiceLineItemSnapshot,
  PaymentProof,
  PaymentProofFileReference,
  PaymentProofStatus,
  TariffComponent,
  TariffComponentKind,
  TariffPlanHead,
  TariffPlanStatus,
  TariffPlanVersion,
  VoucherRedemption,
} from '../types/billing'
import type { InvoiceRecord, PaymentRecord } from '../types/domain'
import type { KrsHold, KrsStudentAcademicState } from '../types/krs-enrollment'
import { appendAudit } from '../utils/audit'
import { conflict, forbidden, invalidInput, notFound, serviceUnavailable } from '../utils/errors'
import { dataMode, firestoreAdmin } from '../utils/firebase-admin'
import { mockState } from '../utils/mock-store'
import { hasProgramAccess, hasRole } from '../utils/rbac'
import { opaqueId, requestHash } from '../utils/security'
import { normalizeIsoInstant, optionalString, requireInteger, requireRecord, requireString } from '../utils/validation'
import { getPrivateFileDetail } from './files'
import { krsModuleState } from './krs-state'
import {
  billingIdempotencyRecord,
  billingModuleState,
  billingStateForTests,
  resetBillingStateForTests,
  saveBillingReplay,
} from './billing-state'

export { billingStateForTests, resetBillingStateForTests }

export interface BillingListQuery {
  page: number
  pageSize: number
  studentId?: string
  programStudyId?: string
  periodId?: string
  status?: string
  search?: string
}

interface IdempotencyDocument<T> {
  requestHash: string
  response: T
  createdAt: string
}

interface RelatedBillingRecords {
  adjustments: InvoiceAdjustment[]
  installmentPlans: InstallmentPlan[]
  proofs: PaymentProof[]
  payments: PaymentRecord[]
}

const MAX_COLLECTION_SCAN = 5_000
const MAX_BATCH_STUDENTS = 50
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1_000
const COMPONENT_KINDS: TariffComponentKind[] = ['MANDATORY', 'PER_CREDIT', 'OTHER']
const PLAN_STATUSES: TariffPlanStatus[] = ['DRAFT', 'ACTIVE', 'RETIRED']
const ADJUSTMENT_TYPES: InvoiceAdjustmentType[] = ['SCHOLARSHIP', 'DISCOUNT', 'PENALTY']
const PROOF_STATUSES: PaymentProofStatus[] = ['SUBMITTED', 'VERIFIED', 'REJECTED']

function clone<T>(value: T): T {
  return structuredClone(value)
}

function rejectUnknown(body: Record<string, unknown>, allowed: readonly string[]): void {
  const unknown = Object.keys(body).filter(key => !allowed.includes(key))
  if (unknown.length) invalidInput(`Field tidak didukung: ${unknown.join(', ')}.`)
}

function safeId(value: unknown, label: string): string {
  return requireString(value, label, { max: 128, pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]*$/ })
}

function requireIdr(value: unknown, label: string, min = 0): number {
  return requireInteger(value, label, min, 100_000_000_000_000)
}

function requireDate(value: unknown, label: string): string {
  const date = requireString(value, label, { max: 10, pattern: /^\d{4}-\d{2}-\d{2}$/ })
  if (Number.isNaN(Date.parse(`${date}T00:00:00.000Z`))) invalidInput(`${label} tidak valid.`)
  return date
}

function jakartaCalendarYear(clock: Date): number {
  return Number(new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: 'Asia/Jakarta' }).format(clock))
}

function endOfJakartaDay(date: string): number {
  return Date.parse(`${date}T16:59:59.999Z`)
}

function studentCandidates(context: AuthContext): string[] {
  return [...new Set([context.uid, ...context.scope.studentIds])]
}

function isScopedFinance(context: AuthContext, programStudyId: string): boolean {
  return hasRole(context, 'finance_staff') && hasProgramAccess(context, programStudyId)
}

function requireFinanceManage(context: AuthContext, programStudyId: string): void {
  if (!isScopedFinance(context, programStudyId)) {
    forbidden('Data keuangan berada di luar lingkup program studi Anda.')
  }
}

function requireFinanceRole(context: AuthContext): void {
  if (!hasRole(context, 'finance_staff')) forbidden('Tindakan ini hanya tersedia untuk pengelola keuangan.')
}

function canReadInvoice(context: AuthContext, invoice: Pick<InvoiceRecord, 'studentId' | 'programStudyId'>): boolean {
  return isScopedFinance(context, invoice.programStudyId)
    || (hasRole(context, 'student') && studentCandidates(context).includes(invoice.studentId))
}

function requireInvoiceRead(context: AuthContext, invoice: Pick<InvoiceRecord, 'studentId' | 'programStudyId'>): void {
  if (!canReadInvoice(context, invoice)) forbidden('Tagihan berada di luar lingkup akses Anda.')
}

async function loadCollection<T>(collection: string): Promise<T[]> {
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan billing tidak tersedia.')
  const snapshot = await db.collection(collection).limit(MAX_COLLECTION_SCAN).get()
  return snapshot.docs.map(document => ({ id: document.id, ...document.data() }) as T)
}

function mockReplay<T>(namespace: string, hash: string): T | undefined {
  const previous = billingIdempotencyRecord(namespace)
  if (!previous) return undefined
  if (previous.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk payload berbeda.')
  const replay = clone(previous.response) as T & { replayed?: boolean; auditId?: string }
  replay.replayed = true
  replay.auditId = undefined
  return replay
}

async function firebaseReplay<T>(namespace: string, hash: string): Promise<T | undefined> {
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan billing tidak tersedia.')
  const snapshot = await db.collection('idempotencyKeys').doc(opaqueId('idem', namespace)).get()
  if (!snapshot.exists) return undefined
  const previous = snapshot.data() as IdempotencyDocument<T>
  if (previous.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk payload berbeda.')
  const replay = clone(previous.response) as T & { replayed?: boolean; auditId?: string }
  replay.replayed = true
  replay.auditId = undefined
  return replay
}

function idempotencyDocument<T>(hash: string, response: T, now: string): Record<string, unknown> {
  return { requestHash: hash, response, createdAt: now, expiresAt: new Date(Date.parse(now) + IDEMPOTENCY_TTL_MS).toISOString() }
}

async function loadBillingProfile(studentId: string): Promise<BillingStudentProfile> {
  if (dataMode() === 'mock') {
    const profile = billingModuleState().profiles.get(studentId)
    if (!profile) notFound('Profil billing mahasiswa')
    return clone(profile)
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan profil billing tidak tersedia.')
  const snapshot = await db.collection('billingStudentProfiles').doc(studentId).get()
  if (!snapshot.exists) notFound('Profil billing mahasiswa')
  return { studentId: snapshot.id, ...snapshot.data() } as BillingStudentProfile
}

function invoiceCore(invoice: BillingInvoice): InvoiceRecord {
  return {
    id: invoice.id,
    studentId: invoice.studentId,
    studentName: invoice.studentName,
    programStudyId: invoice.programStudyId,
    invoiceNumber: invoice.invoiceNumber,
    totalAmount: invoice.totalAmount,
    paidAmount: invoice.paidAmount,
    currency: 'IDR',
    status: invoice.status,
    dueDate: invoice.dueDate,
    version: invoice.version,
  }
}

function legacyBillingInvoice(core: InvoiceRecord, profile?: BillingStudentProfile): BillingInvoice {
  const issuedAt = /^\d{4}-\d{2}-\d{2}$/.test(core.dueDate) ? `${core.dueDate}T00:00:00.000Z` : '1970-01-01T00:00:00.000Z'
  return {
    ...core,
    studentNumber: profile?.studentNumber || '',
    unitId: profile?.unitId || '',
    cohortYear: profile?.cohortYear || 0,
    periodId: profile?.currentPeriodId || 'legacy',
    tariffPlanId: 'legacy',
    tariffPlanVersionId: 'legacy_v1',
    tariffPlanVersion: 1,
    lineItems: [{
      id: `${core.id}_legacy`, tariffComponentId: 'legacy-balance', code: 'LEGACY_BALANCE', label: 'Saldo tagihan migrasi', kind: 'OTHER',
      quantity: 1, unitAmountIdr: core.totalAmount, amountIdr: core.totalAmount, tariffPlanVersionId: 'legacy_v1', immutable: true,
    }],
    baseAmountIdr: core.totalAmount,
    adjustmentAmountIdr: 0,
    issuedAt,
    issuedBy: 'legacy-import',
    updatedAt: issuedAt,
  }
}

function hydrateMockInvoice(core: InvoiceRecord): BillingInvoice {
  const snapshot = billingModuleState().invoiceSnapshots.get(core.id)
  if (!snapshot) return legacyBillingInvoice(core, billingModuleState().profiles.get(core.studentId))
  return { ...clone(snapshot), ...clone(core), updatedAt: snapshot.updatedAt }
}

async function loadInvoice(invoiceId: string): Promise<BillingInvoice> {
  const id = safeId(invoiceId, 'invoiceId')
  if (dataMode() === 'mock') {
    const core = mockState().invoices.get(id)
    if (!core) notFound('Tagihan')
    return hydrateMockInvoice(core)
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan tagihan tidak tersedia.')
  const snapshot = await db.collection('invoices').doc(id).get()
  if (!snapshot.exists) notFound('Tagihan')
  const core = { id: snapshot.id, ...snapshot.data() } as InvoiceRecord
  const data = snapshot.data() as Partial<BillingInvoice>
  if (Array.isArray(data.lineItems) && typeof data.periodId === 'string') return { id: snapshot.id, ...snapshot.data() } as BillingInvoice
  let profile: BillingStudentProfile | undefined
  try { profile = await loadBillingProfile(core.studentId) } catch { /* legacy records remain readable */ }
  return legacyBillingInvoice(core, profile)
}

export function parseBillingListQuery(value: Record<string, unknown>): BillingListQuery {
  const scalar = (item: unknown, label: string): string | undefined => {
    if (item === undefined || item === '') return undefined
    if (Array.isArray(item)) invalidInput(`${label} hanya boleh memiliki satu nilai.`)
    return String(item)
  }
  const page = requireInteger(Number(scalar(value.page, 'page') ?? 1), 'page', 1, 100_000)
  const pageSize = requireInteger(Number(scalar(value.pageSize, 'pageSize') ?? 20), 'pageSize', 1, 100)
  const studentId = scalar(value.studentId, 'studentId')
  const programStudyId = scalar(value.programStudyId, 'programStudyId')
  const periodId = scalar(value.periodId, 'periodId')
  const status = scalar(value.status, 'status')
  const search = scalar(value.search, 'search')
  return {
    page, pageSize,
    ...(studentId ? { studentId: safeId(studentId, 'studentId') } : {}),
    ...(programStudyId ? { programStudyId: safeId(programStudyId, 'programStudyId') } : {}),
    ...(periodId ? { periodId: safeId(periodId, 'periodId') } : {}),
    ...(status ? { status: requireString(status, 'status', { max: 30 }) } : {}),
    ...(search ? { search: requireString(search, 'search', { max: 100 }) } : {}),
  }
}

function paginate<T>(items: T[], query: BillingListQuery): BillingListResult<T> {
  const total = items.length
  const totalPages = Math.max(1, Math.ceil(total / query.pageSize))
  const start = (query.page - 1) * query.pageSize
  return { items: items.slice(start, start + query.pageSize).map(clone), page: query.page, pageSize: query.pageSize, total, totalPages }
}

function parseTariffPlan(value: unknown): {
  logicalId: string
  name: string
  expectedLatestVersion: number
  status: TariffPlanStatus
  applicability: TariffPlanVersion['applicability']
  components: TariffComponent[]
} {
  const body = requireRecord(value)
  rejectUnknown(body, ['logicalId', 'name', 'expectedLatestVersion', 'status', 'applicability', 'components'])
  const logicalId = safeId(body.logicalId, 'logicalId')
  const status = requireString(body.status, 'status', { max: 20 }) as TariffPlanStatus
  if (!PLAN_STATUSES.includes(status)) invalidInput('status tarif tidak valid.')
  const applicabilityBody = requireRecord(body.applicability, 'applicability')
  rejectUnknown(applicabilityBody, ['programStudyIds', 'cohortYearFrom', 'cohortYearTo', 'periodIds'])
  if (!Array.isArray(applicabilityBody.programStudyIds) || applicabilityBody.programStudyIds.length < 1 || applicabilityBody.programStudyIds.length > 20) invalidInput('applicability.programStudyIds harus berisi 1-20 program studi.')
  if (!Array.isArray(applicabilityBody.periodIds) || applicabilityBody.periodIds.length < 1 || applicabilityBody.periodIds.length > 20) invalidInput('applicability.periodIds harus berisi 1-20 periode.')
  const cohortYearFrom = requireInteger(applicabilityBody.cohortYearFrom, 'applicability.cohortYearFrom', 1900, 2200)
  const cohortYearTo = requireInteger(applicabilityBody.cohortYearTo, 'applicability.cohortYearTo', cohortYearFrom, 2200)
  if (!Array.isArray(body.components) || body.components.length < 1 || body.components.length > 50) invalidInput('components harus berisi 1-50 komponen.')
  const components = body.components.map((item, index): TariffComponent => {
    const component = requireRecord(item, `components[${index}]`)
    rejectUnknown(component, ['id', 'code', 'label', 'kind', 'unitAmountIdr', 'description'])
    const kind = requireString(component.kind, `components[${index}].kind`, { max: 20 }) as TariffComponentKind
    if (!COMPONENT_KINDS.includes(kind)) invalidInput(`components[${index}].kind tidak valid.`)
    return {
      id: safeId(component.id, `components[${index}].id`),
      code: requireString(component.code, `components[${index}].code`, { max: 40, pattern: /^[A-Z][A-Z0-9_]*$/ }),
      label: requireString(component.label, `components[${index}].label`, { min: 3, max: 160 }),
      kind,
      unitAmountIdr: requireIdr(component.unitAmountIdr, `components[${index}].unitAmountIdr`, 1),
      ...(optionalString(component.description, `components[${index}].description`, 500) ? { description: optionalString(component.description, `components[${index}].description`, 500) } : {}),
    }
  })
  if (!components.some(component => component.kind === 'MANDATORY')) invalidInput('Tarif harus memiliki minimal satu komponen MANDATORY.')
  if (new Set(components.map(component => component.id)).size !== components.length || new Set(components.map(component => component.code)).size !== components.length) invalidInput('ID dan kode komponen tarif harus unik.')
  return {
    logicalId,
    name: requireString(body.name, 'name', { min: 5, max: 180 }),
    expectedLatestVersion: requireInteger(body.expectedLatestVersion, 'expectedLatestVersion', 0),
    status,
    applicability: {
      programStudyIds: [...new Set(applicabilityBody.programStudyIds.map((item, index) => safeId(item, `applicability.programStudyIds[${index}]`)))],
      cohortYearFrom,
      cohortYearTo,
      periodIds: [...new Set(applicabilityBody.periodIds.map((item, index) => safeId(item, `applicability.periodIds[${index}]`)))],
    },
    components,
  }
}

export async function createTariffPlanVersion(
  context: AuthContext,
  value: unknown,
  idempotencyKey: string,
  event?: H3Event,
  clock = new Date(),
): Promise<BillingWriteResult<TariffPlanVersion>> {
  requireFinanceRole(context)
  const input = parseTariffPlan(value)
  if (input.applicability.programStudyIds.some(id => !context.scope.programStudyIds.includes(id))) forbidden('Tarif mencakup program studi di luar lingkup Anda.')
  const hash = requestHash(input)
  const namespace = `billing:tariff-version:${context.uid}:${idempotencyKey}`
  const now = clock.toISOString()
  let result: BillingWriteResult<TariffPlanVersion>
  if (dataMode() === 'mock') {
    const replay = mockReplay<BillingWriteResult<TariffPlanVersion>>(namespace, hash)
    if (replay) return replay
    const head = billingModuleState().tariffHeads.get(input.logicalId)
    const latest = head?.latestVersion ?? 0
    if (latest !== input.expectedLatestVersion) conflict('VERSION_CONFLICT', 'Versi tarif telah berubah.', { currentVersion: latest })
    const version = latest + 1
    const plan: TariffPlanVersion = { id: `${input.logicalId}_v${version}`, logicalId: input.logicalId, name: input.name, version, status: input.status, currency: 'IDR', applicability: clone(input.applicability), components: clone(input.components), createdAt: now, createdBy: context.uid, immutable: true }
    const nextHead: TariffPlanHead = { logicalId: input.logicalId, latestVersion: version, latestVersionId: plan.id, ...(input.status === 'ACTIVE' ? { activeVersion: version, activeVersionId: plan.id } : head?.activeVersion ? { activeVersion: head.activeVersion, activeVersionId: head.activeVersionId } : {}), updatedAt: now, updatedBy: context.uid }
    billingModuleState().tariffPlans.set(plan.id, clone(plan))
    billingModuleState().tariffHeads.set(input.logicalId, clone(nextHead))
    result = { value: plan, replayed: false }
    saveBillingReplay(namespace, hash, result, now)
  } else {
    const replay = await firebaseReplay<BillingWriteResult<TariffPlanVersion>>(namespace, hash)
    if (replay) return replay
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan tarif tidak tersedia.')
    const headRef = db.collection('billingTariffPlanHeads').doc(input.logicalId)
    const idemRef = db.collection('idempotencyKeys').doc(opaqueId('idem', namespace))
    result = await db.runTransaction(async transaction => {
      const [previous, headSnapshot] = await Promise.all([transaction.get(idemRef), transaction.get(headRef)])
      if (previous.exists) {
        const stored = previous.data() as IdempotencyDocument<BillingWriteResult<TariffPlanVersion>>
        if (stored.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk payload berbeda.')
        return { ...stored.response, replayed: true, auditId: undefined }
      }
      const head = headSnapshot.exists ? headSnapshot.data() as TariffPlanHead : undefined
      const latest = head?.latestVersion ?? 0
      if (latest !== input.expectedLatestVersion) conflict('VERSION_CONFLICT', 'Versi tarif telah berubah.', { currentVersion: latest })
      const version = latest + 1
      const plan: TariffPlanVersion = { id: `${input.logicalId}_v${version}`, logicalId: input.logicalId, name: input.name, version, status: input.status, currency: 'IDR', applicability: clone(input.applicability), components: clone(input.components), createdAt: now, createdBy: context.uid, immutable: true }
      const nextHead: TariffPlanHead = { logicalId: input.logicalId, latestVersion: version, latestVersionId: plan.id, ...(input.status === 'ACTIVE' ? { activeVersion: version, activeVersionId: plan.id } : head?.activeVersion ? { activeVersion: head.activeVersion, activeVersionId: head.activeVersionId } : {}), updatedAt: now, updatedBy: context.uid }
      const response: BillingWriteResult<TariffPlanVersion> = { value: plan, replayed: false }
      transaction.create(db.collection('billingTariffPlans').doc(plan.id), plan)
      transaction.set(headRef, nextHead)
      transaction.create(idemRef, idempotencyDocument(hash, response, now))
      return response
    })
    if (result.replayed) return result
  }
  const audit = await appendAudit({ actor: context, action: 'BILLING_TARIFF_VERSION_CREATED', resourceType: 'billing_tariff_plan', resourceId: result.value.id, after: { logicalId: result.value.logicalId, version: result.value.version, status: result.value.status, programStudyIds: result.value.applicability.programStudyIds, componentCount: result.value.components.length }, event })
  result.auditId = audit.id
  return result
}

export async function listTariffPlans(context: AuthContext, query: BillingListQuery): Promise<BillingListResult<TariffPlanVersion>> {
  if (!hasRole(context, 'finance_staff')) forbidden('Anda tidak memiliki akses ke tarif billing.')
  const rows = dataMode() === 'mock' ? [...billingModuleState().tariffPlans.values()].map(clone) : await loadCollection<TariffPlanVersion>('billingTariffPlans')
  const filtered = rows.filter(plan => {
    const scoped = plan.applicability.programStudyIds.some(id => context.scope.programStudyIds.includes(id))
    return scoped
      && (!query.programStudyId || plan.applicability.programStudyIds.includes(query.programStudyId))
      && (!query.periodId || plan.applicability.periodIds.includes(query.periodId))
      && (!query.status || plan.status === query.status)
      && (!query.search || `${plan.name} ${plan.logicalId}`.toLocaleLowerCase('id-ID').includes(query.search.toLocaleLowerCase('id-ID')))
  }).sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  return paginate(filtered, query)
}

function validateUktEligibility(profile: BillingStudentProfile, plan: TariffPlanVersion): void {
  if (profile.enrollmentStatus !== 'ACTIVE') conflict('UKT_STUDENT_NOT_ACTIVE', 'Mahasiswa tidak aktif dan tidak memenuhi syarat penerbitan UKT.')
  if (profile.currentPeriodId && !plan.applicability.periodIds.includes(profile.currentPeriodId)) conflict('UKT_PERIOD_NOT_APPLICABLE', 'Periode mahasiswa tidak termasuk dalam tarif UKT.')
  if (!plan.applicability.programStudyIds.includes(profile.programStudyId)) conflict('UKT_PROGRAM_NOT_APPLICABLE', 'Program studi mahasiswa tidak termasuk dalam tarif UKT.')
  if (profile.cohortYear < plan.applicability.cohortYearFrom || profile.cohortYear > plan.applicability.cohortYearTo) conflict('UKT_COHORT_NOT_APPLICABLE', 'Angkatan mahasiswa tidak termasuk dalam tarif UKT.')
  if (!Number.isSafeInteger(profile.registeredCredits) || profile.registeredCredits < 0 || profile.registeredCredits > 40) conflict('UKT_CREDIT_LOAD_INVALID', 'Jumlah SKS mahasiswa tidak valid untuk perhitungan tarif.')
}

function snapshotLineItems(plan: TariffPlanVersion, profile: BillingStudentProfile, invoiceId: string): InvoiceLineItemSnapshot[] {
  return plan.components.map(component => {
    const quantity = component.kind === 'PER_CREDIT' ? profile.registeredCredits : 1
    const amountIdr = component.unitAmountIdr * quantity
    if (!Number.isSafeInteger(amountIdr) || amountIdr < 0) serviceUnavailable('Perhitungan komponen tagihan tidak valid.')
    return {
      id: `${invoiceId}_${component.id}`,
      tariffComponentId: component.id,
      code: component.code,
      label: component.label,
      kind: component.kind,
      quantity,
      unitAmountIdr: component.unitAmountIdr,
      amountIdr,
      tariffPlanVersionId: plan.id,
      immutable: true,
    }
  })
}

function buildInvoice(plan: TariffPlanVersion, profile: BillingStudentProfile, invoiceId: string, invoiceNumber: string, dueDate: string, context: AuthContext, now: string): BillingInvoice {
  const lineItems = snapshotLineItems(plan, profile, invoiceId)
  const baseAmountIdr = lineItems.reduce((total, item) => total + item.amountIdr, 0)
  return {
    id: invoiceId,
    studentId: profile.studentId,
    studentName: profile.studentName,
    studentNumber: profile.studentNumber,
    programStudyId: profile.programStudyId,
    unitId: profile.unitId,
    cohortYear: profile.cohortYear,
    invoiceNumber,
    periodId: profile.currentPeriodId,
    tariffPlanId: plan.logicalId,
    tariffPlanVersionId: plan.id,
    tariffPlanVersion: plan.version,
    lineItems,
    baseAmountIdr,
    adjustmentAmountIdr: 0,
    totalAmount: baseAmountIdr,
    paidAmount: 0,
    currency: 'IDR',
    status: baseAmountIdr === 0 ? 'PAID' : 'UNPAID',
    dueDate,
    version: 1,
    issuedAt: now,
    issuedBy: context.uid,
    updatedAt: now,
  }
}

function parseBatchInvoice(value: unknown): { tariffPlanVersionId: string; studentIds: string[]; dueDate: string } {
  const body = requireRecord(value)
  rejectUnknown(body, ['tariffPlanVersionId', 'studentIds', 'dueDate'])
  if (!Array.isArray(body.studentIds) || body.studentIds.length < 1 || body.studentIds.length > MAX_BATCH_STUDENTS) invalidInput(`studentIds harus berisi 1-${MAX_BATCH_STUDENTS} mahasiswa.`)
  return {
    tariffPlanVersionId: safeId(body.tariffPlanVersionId, 'tariffPlanVersionId'),
    studentIds: [...new Set(body.studentIds.map((item, index) => safeId(item, `studentIds[${index}]`)))],
    dueDate: requireDate(body.dueDate, 'dueDate'),
  }
}

function financeHold(periodId: string, outstandingAmountIdr: number, now: string): BillingAcademicHold {
  return {
    id: `billing-${periodId}`,
    type: 'FINANCE',
    reason: outstandingAmountIdr > 0 ? `Kewajiban UKT periode ${periodId} belum diselesaikan.` : `Kewajiban UKT periode ${periodId} telah diselesaikan.`,
    active: outstandingAmountIdr > 0,
    source: 'BILLING',
    periodId,
    outstandingAmountIdr,
    evaluatedAt: now,
  }
}

function mergeFinanceHold(holds: KrsHold[] | undefined, hold: BillingAcademicHold): KrsHold[] {
  return [...(holds || []).filter(item => item.id !== hold.id), clone(hold)]
}

function applyMockAcademicHold(studentId: string, hold: BillingAcademicHold, now: string): void {
  billingModuleState().academicHolds.set(studentId, clone(hold))
  const student = krsModuleState().students.get(studentId)
  if (student) krsModuleState().students.set(studentId, { ...student, holds: mergeFinanceHold(student.holds, hold), version: student.version + 1, updatedAt: now })
}

export async function issueInvoiceBatch(
  context: AuthContext,
  value: unknown,
  idempotencyKey: string,
  event?: H3Event,
  clock = new Date(),
): Promise<BatchInvoiceResult> {
  requireFinanceRole(context)
  const input = parseBatchInvoice(value)
  const hash = requestHash(input)
  const namespace = `billing:invoice-batch:${context.uid}:${idempotencyKey}`
  const now = clock.toISOString()
  const year = jakartaCalendarYear(clock)
  let result: BatchInvoiceResult
  if (dataMode() === 'mock') {
    const replay = mockReplay<BatchInvoiceResult>(namespace, hash)
    if (replay) return replay
    const plan = billingModuleState().tariffPlans.get(input.tariffPlanVersionId)
    if (!plan) notFound('Versi tarif')
    if (plan.status !== 'ACTIVE') conflict('TARIFF_NOT_ACTIVE', 'Hanya versi tarif ACTIVE yang dapat diterbitkan.')
    const profiles = input.studentIds.map(studentId => {
      const profile = billingModuleState().profiles.get(studentId)
      if (!profile) notFound('Profil billing mahasiswa')
      requireFinanceManage(context, profile.programStudyId)
      validateUktEligibility(profile, plan)
      return clone(profile)
    })
    const existingKeys = new Set([...mockState().invoices.values()].map(invoice => `${invoice.studentId}:${hydrateMockInvoice(invoice).periodId}`))
    const skippedStudentIds: string[] = []
    const issuable = profiles.filter(profile => {
      if (!existingKeys.has(`${profile.studentId}:${profile.currentPeriodId}`)) return true
      skippedStudentIds.push(profile.studentId)
      return false
    })
    let sequence = billingModuleState().invoiceCounters.get(year) ?? 0
    const invoices = issuable.map(profile => {
      sequence += 1
      const invoiceId = opaqueId('invoice', `${profile.studentId}:${profile.currentPeriodId}`)
      return buildInvoice(plan, profile, invoiceId, `INV/${year}/${String(sequence).padStart(6, '0')}`, input.dueDate, context, now)
    })
    for (const invoice of invoices) {
      mockState().invoices.set(invoice.id, clone(invoiceCore(invoice)))
      billingModuleState().invoiceSnapshots.set(invoice.id, clone(invoice))
      applyMockAcademicHold(invoice.studentId, financeHold(invoice.periodId, invoice.totalAmount, now), now)
    }
    billingModuleState().invoiceCounters.set(year, sequence)
    result = { invoices, skippedStudentIds, replayed: false }
    saveBillingReplay(namespace, hash, result, now)
  } else {
    const replay = await firebaseReplay<BatchInvoiceResult>(namespace, hash)
    if (replay) return replay
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan tagihan tidak tersedia.')
    const planRef = db.collection('billingTariffPlans').doc(input.tariffPlanVersionId)
    const counterRef = db.collection('billingCounters').doc(`invoice-${year}`)
    const idemRef = db.collection('idempotencyKeys').doc(opaqueId('idem', namespace))
    const profileRefs = input.studentIds.map(studentId => db.collection('billingStudentProfiles').doc(studentId))
    const academicRefs = input.studentIds.map(studentId => db.collection('studentAcademicStates').doc(studentId))
    result = await db.runTransaction(async transaction => {
      const [previous, planSnapshot, counterSnapshot, ...studentSnapshots] = await Promise.all([
        transaction.get(idemRef), transaction.get(planRef), transaction.get(counterRef),
        ...profileRefs.map(reference => transaction.get(reference)),
        ...academicRefs.map(reference => transaction.get(reference)),
      ])
      if (previous.exists) {
        const stored = previous.data() as IdempotencyDocument<BatchInvoiceResult>
        if (stored.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk payload berbeda.')
        return { ...stored.response, replayed: true, auditId: undefined }
      }
      if (!planSnapshot.exists) notFound('Versi tarif')
      const plan = { id: planSnapshot.id, ...planSnapshot.data() } as TariffPlanVersion
      if (plan.status !== 'ACTIVE') conflict('TARIFF_NOT_ACTIVE', 'Hanya versi tarif ACTIVE yang dapat diterbitkan.')
      const profileSnapshots = studentSnapshots.slice(0, profileRefs.length)
      const academicSnapshots = studentSnapshots.slice(profileRefs.length)
      const profiles = profileSnapshots.map(snapshot => {
        if (!snapshot?.exists) notFound('Profil billing mahasiswa')
        const profile = { studentId: snapshot.id, ...snapshot.data() } as BillingStudentProfile
        requireFinanceManage(context, profile.programStudyId)
        validateUktEligibility(profile, plan)
        return profile
      })
      const keyRefs = profiles.map(profile => db.collection('billingInvoiceKeys').doc(opaqueId('invoice_key', `${profile.studentId}:${profile.currentPeriodId}`)))
      const keySnapshots = await Promise.all(keyRefs.map(reference => transaction.get(reference)))
      let sequence = counterSnapshot.exists ? Number(counterSnapshot.data()?.lastSequence ?? 0) : 0
      if (!Number.isSafeInteger(sequence) || sequence < 0) serviceUnavailable('Counter nomor tagihan tidak valid.')
      const invoices: BillingInvoice[] = []
      const skippedStudentIds: string[] = []
      profiles.forEach((profile, index) => {
        if (keySnapshots[index]?.exists) {
          skippedStudentIds.push(profile.studentId)
          return
        }
        sequence += 1
        const invoiceId = opaqueId('invoice', `${profile.studentId}:${profile.currentPeriodId}`)
        const invoice = buildInvoice(plan, profile, invoiceId, `INV/${year}/${String(sequence).padStart(6, '0')}`, input.dueDate, context, now)
        invoices.push(invoice)
        transaction.create(db.collection('invoices').doc(invoice.id), invoice)
        transaction.create(keyRefs[index]!, { invoiceId: invoice.id, studentId: profile.studentId, periodId: profile.currentPeriodId, tariffPlanVersionId: plan.id, createdAt: now })
        const academicSnapshot = academicSnapshots[index]
        if (academicSnapshot?.exists) {
          const academic = { id: academicSnapshot.id, ...academicSnapshot.data() } as KrsStudentAcademicState
          const hold = financeHold(invoice.periodId, invoice.totalAmount, now)
          transaction.update(academicRefs[index]!, { holds: mergeFinanceHold(academic.holds, hold), version: academic.version + 1, updatedAt: now })
        }
      })
      const response: BatchInvoiceResult = { invoices, skippedStudentIds, replayed: false }
      transaction.set(counterRef, { key: 'invoice', year, lastSequence: sequence, updatedAt: now, updatedBy: context.uid })
      transaction.create(idemRef, idempotencyDocument(hash, response, now))
      return response
    })
    if (result.replayed) return result
  }
  const audit = await appendAudit({ actor: context, action: 'BILLING_INVOICE_BATCH_ISSUED', resourceType: 'billing_invoice_batch', resourceId: opaqueId('batch', namespace), after: { tariffPlanVersionId: input.tariffPlanVersionId, invoiceIds: result.invoices.map(invoice => invoice.id), skippedStudentIds: result.skippedStudentIds, totalAmountIdr: result.invoices.reduce((sum, invoice) => sum + invoice.totalAmount, 0) }, event })
  result.auditId = audit.id
  return result
}

async function loadAllInvoices(): Promise<BillingInvoice[]> {
  if (dataMode() === 'mock') return [...mockState().invoices.values()].map(hydrateMockInvoice)
  const rows = await loadCollection<BillingInvoice>('invoices')
  return Promise.all(rows.map(async row => {
    if (Array.isArray(row.lineItems) && typeof row.periodId === 'string') return row
    let profile: BillingStudentProfile | undefined
    try { profile = await loadBillingProfile(row.studentId) } catch { /* legacy invoice */ }
    return legacyBillingInvoice(row, profile)
  }))
}

async function loadRelatedBillingRecords(): Promise<RelatedBillingRecords> {
  if (dataMode() === 'mock') {
    return {
      adjustments: [...billingModuleState().adjustments.values()].map(clone),
      installmentPlans: [...billingModuleState().installmentPlans.values()].map(clone),
      proofs: [...billingModuleState().paymentProofs.values()].map(clone),
      payments: [...mockState().payments.values()].map(clone),
    }
  }
  const [adjustments, installmentPlans, proofs, payments] = await Promise.all([
    loadCollection<InvoiceAdjustment>('billingInvoiceAdjustments'),
    loadCollection<InstallmentPlan>('billingInstallmentPlans'),
    loadCollection<PaymentProof>('billingPaymentProofs'),
    loadCollection<PaymentRecord>('payments'),
  ])
  return { adjustments, installmentPlans, proofs, payments }
}

function installmentScheduleViews(plan: InstallmentPlan, paidAmount: number, clock: Date): InstallmentScheduleView[] {
  let cumulativeAmountIdr = 0
  return [...plan.schedules].sort((left, right) => left.sequence - right.sequence).map(schedule => {
    const previousCumulative = cumulativeAmountIdr
    cumulativeAmountIdr += schedule.amountIdr
    const coveredAmountIdr = Math.max(0, Math.min(schedule.amountIdr, paidAmount - previousCumulative))
    const status: InstallmentScheduleView['status'] = coveredAmountIdr === schedule.amountIdr
      ? 'PAID'
      : clock.getTime() > endOfJakartaDay(schedule.dueDate)
        ? 'OVERDUE'
        : clock.getTime() >= Date.parse(`${schedule.dueDate}T00:00:00+07:00`)
          ? 'DUE'
          : 'PENDING'
    return { ...schedule, cumulativeAmountIdr, coveredAmountIdr, status }
  })
}

function invoiceView(invoice: BillingInvoice, related: RelatedBillingRecords, clock: Date): BillingInvoiceView {
  const adjustments = related.adjustments.filter(item => item.invoiceId === invoice.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const plan = related.installmentPlans.find(item => item.invoiceId === invoice.id && item.status !== 'CANCELLED')
  const schedules = plan ? installmentScheduleViews(plan, invoice.paidAmount, clock) : undefined
  const outstandingAmountIdr = Math.max(0, invoice.totalAmount - invoice.paidAmount)
  const overdueAmountIdr = invoice.status === 'VOID' || invoice.status === 'PAID'
    ? 0
    : schedules
      ? schedules.filter(item => item.status === 'OVERDUE').reduce((sum, item) => sum + item.amountIdr - item.coveredAmountIdr, 0)
      : clock.getTime() > endOfJakartaDay(invoice.dueDate) ? outstandingAmountIdr : 0
  const overdueDates = schedules?.filter(item => item.status === 'OVERDUE').map(item => item.dueDate) || (overdueAmountIdr ? [invoice.dueDate] : [])
  const oldestDue = overdueDates.sort()[0]
  const daysOverdue = oldestDue ? Math.max(1, Math.floor((clock.getTime() - endOfJakartaDay(oldestDue)) / 86_400_000) + 1) : 0
  const calculatedStatus = invoice.status !== 'VOID' && invoice.status !== 'PAID' && overdueAmountIdr > 0 ? 'OVERDUE' : invoice.status
  return {
    ...clone(invoice),
    calculatedStatus,
    outstandingAmountIdr,
    overdueAmountIdr,
    daysOverdue,
    adjustments,
    ...(plan && schedules ? { installmentPlan: { ...clone(plan), schedules } } : {}),
    payments: related.payments.filter(item => item.invoiceId === invoice.id).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)),
    proofs: related.proofs.filter(item => item.invoiceId === invoice.id).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)),
  }
}

async function scopedInvoiceViews(context: AuthContext, query: BillingListQuery, clock: Date): Promise<BillingInvoiceView[]> {
  if (!hasRole(context, 'student', 'finance_staff')) forbidden('Anda tidak memiliki akses ke data tagihan.')
  if (query.studentId && hasRole(context, 'student') && !studentCandidates(context).includes(query.studentId)) forbidden('Mahasiswa hanya dapat melihat tagihan miliknya.')
  if (query.programStudyId && !context.scope.programStudyIds.includes(query.programStudyId)) forbidden('Program studi berada di luar lingkup Anda.')
  const [invoices, related] = await Promise.all([loadAllInvoices(), loadRelatedBillingRecords()])
  const needle = query.search?.toLocaleLowerCase('id-ID')
  return invoices
    .filter(invoice => canReadInvoice(context, invoice))
    .map(invoice => invoiceView(invoice, related, clock))
    .filter(invoice => (!query.studentId || invoice.studentId === query.studentId)
      && (!query.programStudyId || invoice.programStudyId === query.programStudyId)
      && (!query.periodId || invoice.periodId === query.periodId)
      && (!query.status || invoice.calculatedStatus === query.status || invoice.status === query.status)
      && (!needle || `${invoice.invoiceNumber} ${invoice.studentName} ${invoice.studentNumber}`.toLocaleLowerCase('id-ID').includes(needle)))
    .sort((left, right) => right.issuedAt.localeCompare(left.issuedAt) || right.invoiceNumber.localeCompare(left.invoiceNumber))
}

async function depositBalanceForContext(context: AuthContext, query: BillingListQuery): Promise<number> {
  let studentId = query.studentId
  if (hasRole(context, 'student')) {
    // An account can be activated before the academic/billing import creates
    // its denormalized billing profile. The dashboard must still open with an
    // empty ledger instead of treating incomplete onboarding as an
    // authorization failure. Mutations continue to require a billing profile
    // through loadBillingProfile.
    studentId = context.scope.studentIds[0] || context.uid
  }
  if (!studentId) return 0
  if (dataMode() === 'mock') return billingModuleState().depositAccounts.get(studentId)?.balanceIdr ?? 0
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan saldo deposit tidak tersedia.')
  const snapshot = await db.collection('billingDepositAccounts').doc(studentId).get()
  return snapshot.exists ? Number(snapshot.data()?.balanceIdr ?? 0) : 0
}

function summarize(views: BillingInvoiceView[], depositBalanceIdr: number): BillingSummary {
  return {
    currency: 'IDR',
    invoiceCount: views.length,
    billedAmountIdr: views.filter(item => item.status !== 'VOID').reduce((sum, item) => sum + item.totalAmount, 0),
    paidAmountIdr: views.filter(item => item.status !== 'VOID').reduce((sum, item) => sum + item.paidAmount, 0),
    outstandingAmountIdr: views.reduce((sum, item) => sum + item.outstandingAmountIdr, 0),
    overdueAmountIdr: views.reduce((sum, item) => sum + item.overdueAmountIdr, 0),
    overdueInvoiceCount: views.filter(item => item.calculatedStatus === 'OVERDUE').length,
    depositBalanceIdr,
  }
}

export async function getBillingDashboard(
  context: AuthContext,
  query: BillingListQuery,
  clock = new Date(),
): Promise<{ invoices: BillingListResult<BillingInvoiceView>; summary: BillingSummary }> {
  const views = await scopedInvoiceViews(context, query, clock)
  const depositBalanceIdr = await depositBalanceForContext(context, query)
  return { invoices: paginate(views, query), summary: summarize(views, depositBalanceIdr) }
}

export async function listBillingInvoices(context: AuthContext, query: BillingListQuery, clock = new Date()): Promise<BillingListResult<BillingInvoiceView>> {
  return (await getBillingDashboard(context, query, clock)).invoices
}

export async function getBillingInvoice(context: AuthContext, invoiceId: string, clock = new Date()): Promise<BillingInvoiceView> {
  const [invoice, related] = await Promise.all([loadInvoice(invoiceId), loadRelatedBillingRecords()])
  requireInvoiceRead(context, invoice)
  return invoiceView(invoice, related, clock)
}

function invoiceStatus(totalAmount: number, paidAmount: number, current: BillingInvoice['status']): BillingInvoice['status'] {
  if (current === 'VOID') return 'VOID'
  if (paidAmount === totalAmount) return 'PAID'
  return paidAmount > 0 ? 'PARTIALLY_PAID' : 'UNPAID'
}

function saveMockInvoice(invoice: BillingInvoice): void {
  billingModuleState().invoiceSnapshots.set(invoice.id, clone(invoice))
  mockState().invoices.set(invoice.id, clone(invoiceCore(invoice)))
}

function adjustmentDelta(type: InvoiceAdjustmentType, amountIdr: number): number {
  return type === 'PENALTY' ? amountIdr : -amountIdr
}

function parseAdjustment(value: unknown): {
  type: InvoiceAdjustmentType
  amountIdr: number
  reason: string
  reference?: string
  expectedVersion: number
} {
  const body = requireRecord(value)
  rejectUnknown(body, ['type', 'amountIdr', 'reason', 'reference', 'expectedVersion'])
  const type = requireString(body.type, 'type', { max: 30 }) as InvoiceAdjustmentType
  if (!ADJUSTMENT_TYPES.includes(type)) invalidInput('Jenis penyesuaian tagihan tidak didukung.')
  return {
    type,
    amountIdr: requireIdr(body.amountIdr, 'amountIdr', 1),
    reason: requireString(body.reason, 'reason', { min: 5, max: 500 }),
    ...(body.reference !== undefined ? { reference: requireString(body.reference, 'reference', { max: 160 }) } : {}),
    expectedVersion: requireInteger(body.expectedVersion, 'expectedVersion', 1),
  }
}

export async function addInvoiceAdjustment(
  context: AuthContext,
  invoiceId: string,
  value: unknown,
  idempotencyKey: string,
  event?: H3Event,
  clock = new Date(),
): Promise<BillingWriteResult<{ invoice: BillingInvoice; adjustment: InvoiceAdjustment }>> {
  requireFinanceRole(context)
  const input = parseAdjustment(value)
  const id = safeId(invoiceId, 'invoiceId')
  const hash = requestHash({ invoiceId: id, ...input })
  const namespace = `billing:adjustment:${context.uid}:${idempotencyKey}`
  const now = clock.toISOString()
  let result: BillingWriteResult<{ invoice: BillingInvoice; adjustment: InvoiceAdjustment }>
  const transition = (current: BillingInvoice) => {
    requireFinanceManage(context, current.programStudyId)
    if (current.status === 'VOID') conflict('INVOICE_VOID', 'Tagihan telah dibatalkan.')
    if (current.version !== input.expectedVersion) conflict('VERSION_CONFLICT', 'Tagihan telah berubah.', { currentVersion: current.version })
    const delta = adjustmentDelta(input.type, input.amountIdr)
    const totalAmount = current.totalAmount + delta
    if (!Number.isSafeInteger(totalAmount) || totalAmount < current.paidAmount || totalAmount < 0) conflict('ADJUSTMENT_EXCEEDS_BALANCE', 'Penyesuaian tidak boleh membuat total tagihan lebih kecil dari pembayaran yang telah diterima.')
    const adjustment: InvoiceAdjustment = {
      id: opaqueId('billing_adjustment', `${id}:${idempotencyKey}`), invoiceId: id, studentId: current.studentId,
      programStudyId: current.programStudyId, type: input.type, amountIdr: input.amountIdr, reason: input.reason,
      ...(input.reference ? { reference: input.reference } : {}), createdAt: now, createdBy: context.uid, immutable: true,
    }
    const invoice: BillingInvoice = {
      ...current, adjustmentAmountIdr: current.adjustmentAmountIdr + delta, totalAmount,
      status: invoiceStatus(totalAmount, current.paidAmount, current.status), version: current.version + 1, updatedAt: now,
    }
    return { invoice, adjustment }
  }
  if (dataMode() === 'mock') {
    const replay = mockReplay<typeof result>(namespace, hash)
    if (replay) return replay
    const next = transition(await loadInvoice(id))
    saveMockInvoice(next.invoice)
    billingModuleState().adjustments.set(next.adjustment.id, clone(next.adjustment))
    applyMockAcademicHold(next.invoice.studentId, financeHold(next.invoice.periodId, Math.max(0, next.invoice.totalAmount - next.invoice.paidAmount), now), now)
    result = { value: next, replayed: false }
    saveBillingReplay(namespace, hash, result, now)
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan penyesuaian tagihan tidak tersedia.')
    const invoiceRef = db.collection('invoices').doc(id)
    const adjustmentRef = db.collection('billingInvoiceAdjustments').doc(opaqueId('billing_adjustment', `${id}:${idempotencyKey}`))
    const idemRef = db.collection('idempotencyKeys').doc(opaqueId('idem', namespace))
    result = await db.runTransaction(async transaction => {
      const [prior, invoiceSnapshot] = await Promise.all([transaction.get(idemRef), transaction.get(invoiceRef)])
      if (prior.exists) {
        const stored = prior.data() as IdempotencyDocument<typeof result>
        if (stored.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk payload berbeda.')
        return { ...stored.response, replayed: true, auditId: undefined }
      }
      if (!invoiceSnapshot.exists) notFound('Tagihan')
      const current = { id: invoiceSnapshot.id, ...invoiceSnapshot.data() } as BillingInvoice
      const next = transition(current)
      const response = { value: next, replayed: false } satisfies BillingWriteResult<typeof next>
      transaction.update(invoiceRef, next.invoice)
      transaction.create(adjustmentRef, next.adjustment)
      transaction.create(idemRef, idempotencyDocument(hash, response, now))
      return response
    })
    if (result.replayed) return result
  }
  const audit = await appendAudit({ actor: context, action: 'BILLING_INVOICE_ADJUSTED', resourceType: 'invoice', resourceId: id, before: { version: input.expectedVersion }, after: { version: result.value.invoice.version, totalAmountIdr: result.value.invoice.totalAmount, type: result.value.adjustment.type, amountIdr: result.value.adjustment.amountIdr }, event })
  result.auditId = audit.id
  return result
}

function parseInstallmentPlan(value: unknown): { expectedVersion: number; schedules: InstallmentSchedule[] } {
  const body = requireRecord(value)
  rejectUnknown(body, ['expectedVersion', 'schedules'])
  if (!Array.isArray(body.schedules) || body.schedules.length < 2 || body.schedules.length > 12) invalidInput('schedules harus berisi 2-12 cicilan.')
  const schedules = body.schedules.map((raw, index) => {
    const item = requireRecord(raw, `schedules[${index}]`)
    rejectUnknown(item, ['dueDate', 'amountIdr'])
    return { id: `installment-${index + 1}`, sequence: index + 1, dueDate: requireDate(item.dueDate, `schedules[${index}].dueDate`), amountIdr: requireIdr(item.amountIdr, `schedules[${index}].amountIdr`, 1) }
  })
  if (schedules.some((item, index) => index > 0 && item.dueDate <= schedules[index - 1]!.dueDate)) invalidInput('Tanggal jatuh tempo cicilan harus meningkat secara ketat.')
  return { expectedVersion: requireInteger(body.expectedVersion, 'expectedVersion', 1), schedules }
}

export async function createInstallmentPlan(
  context: AuthContext,
  invoiceId: string,
  value: unknown,
  idempotencyKey: string,
  event?: H3Event,
  clock = new Date(),
): Promise<BillingWriteResult<{ invoice: BillingInvoice; plan: InstallmentPlan }>> {
  requireFinanceRole(context)
  const input = parseInstallmentPlan(value)
  const id = safeId(invoiceId, 'invoiceId')
  const hash = requestHash({ invoiceId: id, ...input })
  const namespace = `billing:installment:${context.uid}:${idempotencyKey}`
  const now = clock.toISOString()
  let result: BillingWriteResult<{ invoice: BillingInvoice; plan: InstallmentPlan }>
  const transition = (current: BillingInvoice) => {
    requireFinanceManage(context, current.programStudyId)
    if (current.status === 'VOID' || current.status === 'PAID') conflict('INVOICE_NOT_INSTALLMENT_ELIGIBLE', 'Hanya tagihan aktif yang belum lunas dapat dicicil.')
    if (current.version !== input.expectedVersion) conflict('VERSION_CONFLICT', 'Tagihan telah berubah.', { currentVersion: current.version })
    if (input.schedules.reduce((sum, item) => sum + item.amountIdr, 0) !== current.totalAmount) conflict('INSTALLMENT_TOTAL_MISMATCH', 'Total jadwal cicilan harus sama dengan total tagihan.')
    const plan: InstallmentPlan = { id: opaqueId('installment', `${id}:${idempotencyKey}`), invoiceId: id, studentId: current.studentId, programStudyId: current.programStudyId, schedules: clone(input.schedules), version: 1, status: 'ACTIVE', createdAt: now, createdBy: context.uid, immutable: true }
    const invoice: BillingInvoice = { ...current, installmentPlanId: plan.id, version: current.version + 1, updatedAt: now }
    return { invoice, plan }
  }
  if (dataMode() === 'mock') {
    const replay = mockReplay<typeof result>(namespace, hash)
    if (replay) return replay
    const existing = [...billingModuleState().installmentPlans.values()].find(item => item.invoiceId === id && item.status === 'ACTIVE')
    if (existing) conflict('INSTALLMENT_PLAN_EXISTS', 'Tagihan sudah memiliki rencana cicilan aktif.')
    const next = transition(await loadInvoice(id))
    saveMockInvoice(next.invoice); billingModuleState().installmentPlans.set(next.plan.id, clone(next.plan))
    result = { value: next, replayed: false }; saveBillingReplay(namespace, hash, result, now)
  } else {
    const db = firestoreAdmin(); if (!db) serviceUnavailable('Penyimpanan cicilan tidak tersedia.')
    const invoiceRef = db.collection('invoices').doc(id), planRef = db.collection('billingInstallmentPlans').doc(opaqueId('installment', `${id}:${idempotencyKey}`)), keyRef = db.collection('billingInstallmentKeys').doc(id), idemRef = db.collection('idempotencyKeys').doc(opaqueId('idem', namespace))
    result = await db.runTransaction(async transaction => {
      const [prior, invoiceSnapshot, keySnapshot] = await Promise.all([transaction.get(idemRef), transaction.get(invoiceRef), transaction.get(keyRef)])
      if (prior.exists) { const stored = prior.data() as IdempotencyDocument<typeof result>; if (stored.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk payload berbeda.'); return { ...stored.response, replayed: true, auditId: undefined } }
      if (keySnapshot.exists) conflict('INSTALLMENT_PLAN_EXISTS', 'Tagihan sudah memiliki rencana cicilan aktif.')
      if (!invoiceSnapshot.exists) notFound('Tagihan')
      const next = transition({ id: invoiceSnapshot.id, ...invoiceSnapshot.data() } as BillingInvoice)
      const response = { value: next, replayed: false } satisfies BillingWriteResult<typeof next>
      transaction.update(invoiceRef, next.invoice); transaction.create(planRef, next.plan); transaction.create(keyRef, { planId: next.plan.id, createdAt: now }); transaction.create(idemRef, idempotencyDocument(hash, response, now)); return response
    })
    if (result.replayed) return result
  }
  const audit = await appendAudit({ actor: context, action: 'BILLING_INSTALLMENT_PLAN_CREATED', resourceType: 'invoice', resourceId: id, after: { planId: result.value.plan.id, installmentCount: result.value.plan.schedules.length, totalAmountIdr: result.value.invoice.totalAmount }, event })
  result.auditId = audit.id
  return result
}

function parseDepositCredit(value: unknown): { studentId: string; amountIdr: number; sourceReference: string; expectedVersion: number } {
  const body = requireRecord(value)
  rejectUnknown(body, ['studentId', 'amountIdr', 'sourceReference', 'expectedVersion'])
  return {
    studentId: safeId(body.studentId, 'studentId'), amountIdr: requireIdr(body.amountIdr, 'amountIdr', 1),
    sourceReference: requireString(body.sourceReference, 'sourceReference', { min: 4, max: 160, pattern: /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/ }),
    expectedVersion: requireInteger(body.expectedVersion, 'expectedVersion', 0),
  }
}

export async function creditStudentDeposit(
  context: AuthContext,
  value: unknown,
  idempotencyKey: string,
  event?: H3Event,
  clock = new Date(),
): Promise<BillingWriteResult<{ account: DepositAccount; transaction: DepositTransaction }>> {
  requireFinanceRole(context)
  const input = parseDepositCredit(value)
  const profile = await loadBillingProfile(input.studentId)
  requireFinanceManage(context, profile.programStudyId)
  const hash = requestHash(input), namespace = `billing:deposit-credit:${context.uid}:${idempotencyKey}`, now = clock.toISOString()
  let result: BillingWriteResult<{ account: DepositAccount; transaction: DepositTransaction }>
  const transition = (current?: DepositAccount) => {
    const version = current?.version ?? 0
    if (version !== input.expectedVersion) conflict('VERSION_CONFLICT', 'Saldo deposit telah berubah.', { currentVersion: version })
    const balanceIdr = (current?.balanceIdr ?? 0) + input.amountIdr
    if (!Number.isSafeInteger(balanceIdr)) conflict('DEPOSIT_BALANCE_INVALID', 'Saldo deposit melampaui batas yang didukung.')
    const account: DepositAccount = { studentId: input.studentId, programStudyId: profile.programStudyId, balanceIdr, version: version + 1, updatedAt: now, updatedBy: context.uid }
    const transaction: DepositTransaction = { id: opaqueId('deposit_tx', input.sourceReference), studentId: input.studentId, programStudyId: profile.programStudyId, amountIdr: input.amountIdr, balanceAfterIdr: balanceIdr, kind: 'CREDIT', sourceReference: input.sourceReference, createdAt: now, createdBy: context.uid, immutable: true }
    return { account, transaction }
  }
  if (dataMode() === 'mock') {
    const replay = mockReplay<typeof result>(namespace, hash); if (replay) return replay
    if ([...billingModuleState().depositTransactions.values()].some(item => item.sourceReference === input.sourceReference)) conflict('DUPLICATE_EXTERNAL_REFERENCE', 'Referensi sumber deposit telah digunakan.')
    const next = transition(billingModuleState().depositAccounts.get(input.studentId))
    billingModuleState().depositAccounts.set(input.studentId, clone(next.account)); billingModuleState().depositTransactions.set(next.transaction.id, clone(next.transaction))
    result = { value: next, replayed: false }; saveBillingReplay(namespace, hash, result, now)
  } else {
    const db = firestoreAdmin(); if (!db) serviceUnavailable('Penyimpanan deposit tidak tersedia.')
    const accountRef = db.collection('billingDepositAccounts').doc(input.studentId), txRef = db.collection('billingDepositTransactions').doc(opaqueId('deposit_tx', input.sourceReference)), sourceRef = db.collection('billingDepositReferences').doc(opaqueId('deposit_ref', input.sourceReference)), idemRef = db.collection('idempotencyKeys').doc(opaqueId('idem', namespace))
    result = await db.runTransaction(async transaction => {
      const [prior, accountSnapshot, sourceSnapshot] = await Promise.all([transaction.get(idemRef), transaction.get(accountRef), transaction.get(sourceRef)])
      if (prior.exists) { const stored = prior.data() as IdempotencyDocument<typeof result>; if (stored.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk payload berbeda.'); return { ...stored.response, replayed: true, auditId: undefined } }
      if (sourceSnapshot.exists) conflict('DUPLICATE_EXTERNAL_REFERENCE', 'Referensi sumber deposit telah digunakan.')
      const next = transition(accountSnapshot.exists ? ({ studentId: accountSnapshot.id, ...accountSnapshot.data() } as DepositAccount) : undefined)
      const response = { value: next, replayed: false } satisfies BillingWriteResult<typeof next>
      transaction.set(accountRef, next.account); transaction.create(txRef, next.transaction); transaction.create(sourceRef, { transactionId: next.transaction.id, createdAt: now }); transaction.create(idemRef, idempotencyDocument(hash, response, now)); return response
    })
    if (result.replayed) return result
  }
  const audit = await appendAudit({ actor: context, action: 'BILLING_DEPOSIT_CREDITED', resourceType: 'billing_deposit', resourceId: input.studentId, after: { transactionId: result.value.transaction.id, amountIdr: input.amountIdr, balanceAfterIdr: result.value.account.balanceIdr, sourceReference: input.sourceReference }, event })
  result.auditId = audit.id
  return result
}

function parseDepositApplication(value: unknown): { amountIdr: number; expectedInvoiceVersion: number; expectedDepositVersion: number } {
  const body = requireRecord(value)
  rejectUnknown(body, ['amountIdr', 'expectedInvoiceVersion', 'expectedDepositVersion'])
  return { amountIdr: requireIdr(body.amountIdr, 'amountIdr', 1), expectedInvoiceVersion: requireInteger(body.expectedInvoiceVersion, 'expectedInvoiceVersion', 1), expectedDepositVersion: requireInteger(body.expectedDepositVersion, 'expectedDepositVersion', 1) }
}

export async function applyStudentDeposit(
  context: AuthContext,
  invoiceId: string,
  value: unknown,
  idempotencyKey: string,
  event?: H3Event,
  clock = new Date(),
): Promise<BillingWriteResult<{ invoice: BillingInvoice; account: DepositAccount; transaction: DepositTransaction; adjustment: InvoiceAdjustment }>> {
  const input = parseDepositApplication(value), id = safeId(invoiceId, 'invoiceId')
  const hash = requestHash({ invoiceId: id, ...input }), namespace = `billing:deposit-apply:${context.uid}:${idempotencyKey}`, now = clock.toISOString()
  let result: BillingWriteResult<{ invoice: BillingInvoice; account: DepositAccount; transaction: DepositTransaction; adjustment: InvoiceAdjustment }>
  const transition = (current: BillingInvoice, account: DepositAccount) => {
    if (!canReadInvoice(context, current) || !hasRole(context, 'student', 'finance_staff')) forbidden('Anda tidak dapat memakai deposit untuk tagihan ini.')
    if (hasRole(context, 'finance_staff')) requireFinanceManage(context, current.programStudyId)
    if (current.status === 'VOID' || current.status === 'PAID') conflict('INVOICE_NOT_PAYABLE', 'Tagihan tidak dapat dibayar dengan deposit.')
    if (current.version !== input.expectedInvoiceVersion) conflict('VERSION_CONFLICT', 'Tagihan telah berubah.', { currentVersion: current.version })
    if (account.version !== input.expectedDepositVersion) conflict('VERSION_CONFLICT', 'Saldo deposit telah berubah.', { currentVersion: account.version })
    if (account.studentId !== current.studentId || account.programStudyId !== current.programStudyId) conflict('DEPOSIT_OWNER_MISMATCH', 'Deposit dan tagihan tidak dimiliki mahasiswa yang sama.')
    const outstanding = current.totalAmount - current.paidAmount
    if (input.amountIdr > account.balanceIdr || input.amountIdr > outstanding) conflict('DEPOSIT_EXCEEDS_AVAILABLE', 'Nominal deposit melebihi saldo atau sisa tagihan.')
    const totalAmount = current.totalAmount - input.amountIdr
    const invoice: BillingInvoice = { ...current, adjustmentAmountIdr: current.adjustmentAmountIdr - input.amountIdr, totalAmount, status: invoiceStatus(totalAmount, current.paidAmount, current.status), version: current.version + 1, updatedAt: now }
    const nextAccount: DepositAccount = { ...account, balanceIdr: account.balanceIdr - input.amountIdr, version: account.version + 1, updatedAt: now, updatedBy: context.uid }
    const transaction: DepositTransaction = { id: opaqueId('deposit_tx', `${id}:${idempotencyKey}`), studentId: current.studentId, programStudyId: current.programStudyId, amountIdr: input.amountIdr, balanceAfterIdr: nextAccount.balanceIdr, kind: 'REDEMPTION', sourceReference: `invoice:${id}`, invoiceId: id, createdAt: now, createdBy: context.uid, immutable: true }
    const adjustment: InvoiceAdjustment = { id: opaqueId('billing_adjustment', `deposit:${id}:${idempotencyKey}`), invoiceId: id, studentId: current.studentId, programStudyId: current.programStudyId, type: 'DEPOSIT', amountIdr: input.amountIdr, reason: 'Pemakaian saldo deposit untuk tagihan.', reference: transaction.id, createdAt: now, createdBy: context.uid, immutable: true }
    return { invoice, account: nextAccount, transaction, adjustment }
  }
  if (dataMode() === 'mock') {
    const replay = mockReplay<typeof result>(namespace, hash); if (replay) return replay
    const current = await loadInvoice(id), account = billingModuleState().depositAccounts.get(current.studentId)
    if (!account) conflict('DEPOSIT_UNAVAILABLE', 'Mahasiswa belum memiliki saldo deposit.')
    const next = transition(current, clone(account)); saveMockInvoice(next.invoice); billingModuleState().depositAccounts.set(next.account.studentId, clone(next.account)); billingModuleState().depositTransactions.set(next.transaction.id, clone(next.transaction)); billingModuleState().adjustments.set(next.adjustment.id, clone(next.adjustment)); applyMockAcademicHold(next.invoice.studentId, financeHold(next.invoice.periodId, Math.max(0, next.invoice.totalAmount - next.invoice.paidAmount), now), now)
    result = { value: next, replayed: false }; saveBillingReplay(namespace, hash, result, now)
  } else {
    const db = firestoreAdmin(); if (!db) serviceUnavailable('Penyimpanan deposit tidak tersedia.')
    const invoiceRef = db.collection('invoices').doc(id), idemRef = db.collection('idempotencyKeys').doc(opaqueId('idem', namespace))
    result = await db.runTransaction(async transaction => {
      const [prior, invoiceSnapshot] = await Promise.all([transaction.get(idemRef), transaction.get(invoiceRef)])
      if (prior.exists) { const stored = prior.data() as IdempotencyDocument<typeof result>; if (stored.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk payload berbeda.'); return { ...stored.response, replayed: true, auditId: undefined } }
      if (!invoiceSnapshot.exists) notFound('Tagihan')
      const current = { id: invoiceSnapshot.id, ...invoiceSnapshot.data() } as BillingInvoice, accountRef = db.collection('billingDepositAccounts').doc(current.studentId), accountSnapshot = await transaction.get(accountRef)
      if (!accountSnapshot.exists) conflict('DEPOSIT_UNAVAILABLE', 'Mahasiswa belum memiliki saldo deposit.')
      const next = transition(current, { studentId: accountSnapshot.id, ...accountSnapshot.data() } as DepositAccount)
      const txRef = db.collection('billingDepositTransactions').doc(next.transaction.id), adjustmentRef = db.collection('billingInvoiceAdjustments').doc(next.adjustment.id)
      const response = { value: next, replayed: false } satisfies BillingWriteResult<typeof next>
      transaction.update(invoiceRef, next.invoice); transaction.update(accountRef, next.account); transaction.create(txRef, next.transaction); transaction.create(adjustmentRef, next.adjustment); transaction.create(idemRef, idempotencyDocument(hash, response, now)); return response
    })
    if (result.replayed) return result
  }
  const audit = await appendAudit({ actor: context, action: 'BILLING_DEPOSIT_APPLIED', resourceType: 'invoice', resourceId: id, after: { transactionId: result.value.transaction.id, amountIdr: input.amountIdr, invoiceTotalAmountIdr: result.value.invoice.totalAmount, depositBalanceIdr: result.value.account.balanceIdr }, event })
  result.auditId = audit.id
  return result
}

function parseVoucherRedemption(value: unknown): { code: string; expectedInvoiceVersion: number } {
  const body = requireRecord(value)
  rejectUnknown(body, ['code', 'expectedInvoiceVersion'])
  return { code: requireString(body.code, 'code', { min: 6, max: 64, pattern: /^[A-Za-z0-9_-]+$/ }).toUpperCase(), expectedInvoiceVersion: requireInteger(body.expectedInvoiceVersion, 'expectedInvoiceVersion', 1) }
}

export async function redeemBillingVoucher(
  context: AuthContext,
  invoiceId: string,
  value: unknown,
  idempotencyKey: string,
  event?: H3Event,
  clock = new Date(),
): Promise<BillingWriteResult<{ invoice: BillingInvoice; voucher: BillingVoucher; redemption: VoucherRedemption; adjustment: InvoiceAdjustment }>> {
  const input = parseVoucherRedemption(value), id = safeId(invoiceId, 'invoiceId'), codeHash = requestHash(input.code)
  const hash = requestHash({ invoiceId: id, codeHash, expectedInvoiceVersion: input.expectedInvoiceVersion }), namespace = `billing:voucher:${context.uid}:${idempotencyKey}`, now = clock.toISOString()
  let result: BillingWriteResult<{ invoice: BillingInvoice; voucher: BillingVoucher; redemption: VoucherRedemption; adjustment: InvoiceAdjustment }>
  const transition = (current: BillingInvoice, voucher: BillingVoucher) => {
    if (!canReadInvoice(context, current) || !hasRole(context, 'student', 'finance_staff')) forbidden('Anda tidak dapat memakai voucher untuk tagihan ini.')
    if (hasRole(context, 'finance_staff')) requireFinanceManage(context, current.programStudyId)
    if (current.version !== input.expectedInvoiceVersion) conflict('VERSION_CONFLICT', 'Tagihan telah berubah.', { currentVersion: current.version })
    if (current.status === 'VOID' || current.status === 'PAID') conflict('INVOICE_NOT_PAYABLE', 'Tagihan tidak dapat menerima voucher.')
    if (voucher.status !== 'ACTIVE' || Date.parse(now) < Date.parse(voucher.validFrom) || Date.parse(now) > Date.parse(voucher.validUntil)) conflict('VOUCHER_NOT_ACTIVE', 'Voucher tidak aktif pada waktu ini.')
    if (!voucher.programStudyIds.includes(current.programStudyId) || !voucher.periodIds.includes(current.periodId)) conflict('VOUCHER_NOT_APPLICABLE', 'Voucher tidak berlaku untuk program studi atau periode tagihan.')
    if (voucher.redemptionCount >= voucher.maxRedemptions) conflict('VOUCHER_LIMIT_REACHED', 'Kuota voucher telah habis.')
    const amountIdr = Math.min(voucher.amountIdr, current.totalAmount - current.paidAmount)
    if (amountIdr < 1) conflict('VOUCHER_NO_BALANCE', 'Tagihan tidak memiliki saldo yang dapat dipotong voucher.')
    const totalAmount = current.totalAmount - amountIdr
    const invoice: BillingInvoice = { ...current, adjustmentAmountIdr: current.adjustmentAmountIdr - amountIdr, totalAmount, status: invoiceStatus(totalAmount, current.paidAmount, current.status), version: current.version + 1, updatedAt: now }
    const adjustment: InvoiceAdjustment = { id: opaqueId('billing_adjustment', `voucher:${voucher.id}:${id}`), invoiceId: id, studentId: current.studentId, programStudyId: current.programStudyId, type: 'VOUCHER', amountIdr, reason: `Voucher ${voucher.label}`, reference: voucher.id, createdAt: now, createdBy: context.uid, immutable: true }
    const redemption: VoucherRedemption = { id: opaqueId('voucher_redemption', `${voucher.id}:${id}`), voucherId: voucher.id, invoiceId: id, studentId: current.studentId, amountIdr, adjustmentId: adjustment.id, redeemedAt: now, redeemedBy: context.uid, immutable: true }
    return { invoice, voucher: { ...voucher, redemptionCount: voucher.redemptionCount + 1, version: voucher.version + 1, updatedAt: now, updatedBy: context.uid }, redemption, adjustment }
  }
  if (dataMode() === 'mock') {
    const replay = mockReplay<typeof result>(namespace, hash); if (replay) return replay
    const voucher = [...billingModuleState().vouchers.values()].find(item => item.codeHash === codeHash)
    if (!voucher) notFound('Voucher')
    if ([...billingModuleState().voucherRedemptions.values()].some(item => item.voucherId === voucher.id && item.invoiceId === id)) conflict('VOUCHER_ALREADY_REDEEMED', 'Voucher sudah digunakan untuk tagihan ini.')
    const next = transition(await loadInvoice(id), clone(voucher)); saveMockInvoice(next.invoice); billingModuleState().vouchers.set(next.voucher.id, clone(next.voucher)); billingModuleState().voucherRedemptions.set(next.redemption.id, clone(next.redemption)); billingModuleState().adjustments.set(next.adjustment.id, clone(next.adjustment)); applyMockAcademicHold(next.invoice.studentId, financeHold(next.invoice.periodId, Math.max(0, next.invoice.totalAmount - next.invoice.paidAmount), now), now)
    result = { value: next, replayed: false }; saveBillingReplay(namespace, hash, result, now)
  } else {
    const db = firestoreAdmin(); if (!db) serviceUnavailable('Penyimpanan voucher tidak tersedia.')
    const query = await db.collection('billingVouchers').where('codeHash', '==', codeHash).limit(2).get()
    if (query.size !== 1) notFound('Voucher')
    const voucherRef = query.docs[0]!.ref, invoiceRef = db.collection('invoices').doc(id), redemptionKeyRef = db.collection('billingVoucherRedemptionKeys').doc(opaqueId('voucher_key', `${voucherRef.id}:${id}`)), idemRef = db.collection('idempotencyKeys').doc(opaqueId('idem', namespace))
    result = await db.runTransaction(async transaction => {
      const [prior, invoiceSnapshot, voucherSnapshot, keySnapshot] = await Promise.all([transaction.get(idemRef), transaction.get(invoiceRef), transaction.get(voucherRef), transaction.get(redemptionKeyRef)])
      if (prior.exists) { const stored = prior.data() as IdempotencyDocument<typeof result>; if (stored.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk payload berbeda.'); return { ...stored.response, replayed: true, auditId: undefined } }
      if (keySnapshot.exists) conflict('VOUCHER_ALREADY_REDEEMED', 'Voucher sudah digunakan untuk tagihan ini.')
      if (!invoiceSnapshot.exists || !voucherSnapshot.exists) notFound('Tagihan atau voucher')
      const next = transition({ id: invoiceSnapshot.id, ...invoiceSnapshot.data() } as BillingInvoice, { id: voucherSnapshot.id, ...voucherSnapshot.data() } as BillingVoucher)
      const redemptionRef = db.collection('billingVoucherRedemptions').doc(next.redemption.id), adjustmentRef = db.collection('billingInvoiceAdjustments').doc(next.adjustment.id)
      const response = { value: next, replayed: false } satisfies BillingWriteResult<typeof next>
      transaction.update(invoiceRef, next.invoice); transaction.update(voucherRef, next.voucher); transaction.create(redemptionRef, next.redemption); transaction.create(adjustmentRef, next.adjustment); transaction.create(redemptionKeyRef, { redemptionId: next.redemption.id, createdAt: now }); transaction.create(idemRef, idempotencyDocument(hash, response, now)); return response
    })
    if (result.replayed) return result
  }
  const audit = await appendAudit({ actor: context, action: 'BILLING_VOUCHER_REDEEMED', resourceType: 'invoice', resourceId: id, after: { voucherId: result.value.voucher.id, redemptionId: result.value.redemption.id, amountIdr: result.value.redemption.amountIdr, invoiceTotalAmountIdr: result.value.invoice.totalAmount }, event })
  result.auditId = audit.id
  return result
}

async function cleanPaymentProofFile(context: AuthContext, fileId: string): Promise<PaymentProofFileReference> {
  const detail = await getPrivateFileDetail(context, safeId(fileId, 'fileId'))
  if (detail.file.status !== 'CLEAN' || detail.file.deleted || !detail.file.currentVersion) conflict('FILE_NOT_CLEAN', 'Bukti pembayaran harus menggunakan file privat yang telah lulus pemindaian.')
  const version = detail.versions.find(item => item.version === detail.file.currentVersion)
  if (!version || version.status !== 'CLEAN' || !version.sha256 || !version.sizeBytes) conflict('FILE_NOT_CLEAN', 'Versi bukti pembayaran belum siap digunakan.')
  return { fileId: detail.file.id, version: version.version, fileName: detail.file.name, mimeType: detail.file.mimeType, sizeBytes: version.sizeBytes, sha256: version.sha256, scanStatus: 'CLEAN' }
}

function parsePaymentProof(value: unknown): { claimedAmountIdr: number; paidAt: string; bankReference: string; fileId: string } {
  const body = requireRecord(value)
  rejectUnknown(body, ['claimedAmountIdr', 'paidAt', 'bankReference', 'fileId'])
  return { claimedAmountIdr: requireIdr(body.claimedAmountIdr, 'claimedAmountIdr', 1), paidAt: normalizeIsoInstant(body.paidAt, 'paidAt', { maxFutureMs: 5 * 60 * 1000 }), bankReference: requireString(body.bankReference, 'bankReference', { min: 4, max: 160, pattern: /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/ }), fileId: safeId(body.fileId, 'fileId') }
}

export async function submitPaymentProof(
  context: AuthContext,
  invoiceId: string,
  value: unknown,
  idempotencyKey: string,
  event?: H3Event,
  clock = new Date(),
): Promise<BillingWriteResult<PaymentProof>> {
  if (!hasRole(context, 'student')) forbidden('Bukti pembayaran hanya dapat diajukan mahasiswa.')
  const input = parsePaymentProof(value), id = safeId(invoiceId, 'invoiceId'), invoice = await loadInvoice(id)
  if (!studentCandidates(context).includes(invoice.studentId)) forbidden('Tagihan bukan milik mahasiswa ini.')
  if (invoice.status === 'VOID' || invoice.status === 'PAID' || input.claimedAmountIdr > invoice.totalAmount - invoice.paidAmount) conflict('PROOF_AMOUNT_INVALID', 'Nominal bukti melebihi sisa tagihan atau tagihan tidak aktif.')
  const file = await cleanPaymentProofFile(context, input.fileId)
  const normalized = { invoiceId: id, ...input, file }, hash = requestHash(normalized), namespace = `billing:payment-proof:${context.uid}:${idempotencyKey}`, now = clock.toISOString()
  let result: BillingWriteResult<PaymentProof>
  const proof: PaymentProof = { id: opaqueId('payment_proof', `${id}:${idempotencyKey}`), invoiceId: id, studentId: invoice.studentId, programStudyId: invoice.programStudyId, claimedAmountIdr: input.claimedAmountIdr, paidAt: input.paidAt, bankReference: input.bankReference, file, status: 'SUBMITTED', version: 1, submittedAt: now, submittedBy: context.uid, updatedAt: now }
  if (dataMode() === 'mock') {
    const replay = mockReplay<typeof result>(namespace, hash); if (replay) return replay
    if ([...billingModuleState().paymentProofs.values()].some(item => item.bankReference === input.bankReference)) conflict('DUPLICATE_EXTERNAL_REFERENCE', 'Referensi bank sudah pernah diajukan.')
    billingModuleState().paymentProofs.set(proof.id, clone(proof)); result = { value: proof, replayed: false }; saveBillingReplay(namespace, hash, result, now)
  } else {
    const db = firestoreAdmin(); if (!db) serviceUnavailable('Penyimpanan bukti pembayaran tidak tersedia.')
    const proofRef = db.collection('billingPaymentProofs').doc(proof.id), bankRef = db.collection('billingPaymentProofReferences').doc(opaqueId('proof_ref', input.bankReference)), idemRef = db.collection('idempotencyKeys').doc(opaqueId('idem', namespace))
    result = await db.runTransaction(async transaction => {
      const [prior, duplicate] = await Promise.all([transaction.get(idemRef), transaction.get(bankRef)])
      if (prior.exists) { const stored = prior.data() as IdempotencyDocument<typeof result>; if (stored.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk payload berbeda.'); return { ...stored.response, replayed: true, auditId: undefined } }
      if (duplicate.exists) conflict('DUPLICATE_EXTERNAL_REFERENCE', 'Referensi bank sudah pernah diajukan.')
      const response = { value: proof, replayed: false } satisfies BillingWriteResult<PaymentProof>
      transaction.create(proofRef, proof); transaction.create(bankRef, { proofId: proof.id, createdAt: now }); transaction.create(idemRef, idempotencyDocument(hash, response, now)); return response
    })
    if (result.replayed) return result
  }
  const audit = await appendAudit({ actor: context, action: 'BILLING_PAYMENT_PROOF_SUBMITTED', resourceType: 'billing_payment_proof', resourceId: proof.id, after: { invoiceId: id, amountIdr: proof.claimedAmountIdr, fileId: file.fileId, fileVersion: file.version, bankReference: proof.bankReference }, event })
  result.auditId = audit.id
  return result
}

export async function reviewPaymentProof(
  context: AuthContext,
  proofId: string,
  value: unknown,
  event?: H3Event,
  clock = new Date(),
): Promise<BillingWriteResult<PaymentProof>> {
  requireFinanceRole(context)
  const body = requireRecord(value); rejectUnknown(body, ['status', 'reviewNote', 'expectedVersion'])
  const status = requireString(body.status, 'status', { max: 20 }) as PaymentProofStatus
  if (!PROOF_STATUSES.includes(status) || status === 'SUBMITTED') invalidInput('Status review bukti harus VERIFIED atau REJECTED.')
  const reviewNote = optionalString(body.reviewNote, 'reviewNote', 500)
  if (status === 'REJECTED' && !reviewNote) invalidInput('Alasan penolakan bukti wajib diisi.')
  const expectedVersion = requireInteger(body.expectedVersion, 'expectedVersion', 1), id = safeId(proofId, 'proofId'), now = clock.toISOString()
  let proof: PaymentProof
  if (dataMode() === 'mock') {
    const current = billingModuleState().paymentProofs.get(id); if (!current) notFound('Bukti pembayaran')
    requireFinanceManage(context, current.programStudyId); if (current.version !== expectedVersion) conflict('VERSION_CONFLICT', 'Bukti pembayaran telah berubah.', { currentVersion: current.version }); if (current.status !== 'SUBMITTED') conflict('PROOF_ALREADY_REVIEWED', 'Bukti pembayaran sudah ditinjau.')
    proof = { ...current, status, ...(reviewNote ? { reviewNote } : {}), version: current.version + 1, reviewedAt: now, reviewedBy: context.uid, updatedAt: now }; billingModuleState().paymentProofs.set(id, clone(proof))
  } else {
    const db = firestoreAdmin(); if (!db) serviceUnavailable('Penyimpanan bukti pembayaran tidak tersedia.')
    const ref = db.collection('billingPaymentProofs').doc(id)
    proof = await db.runTransaction(async transaction => { const snapshot = await transaction.get(ref); if (!snapshot.exists) notFound('Bukti pembayaran'); const current = { id: snapshot.id, ...snapshot.data() } as PaymentProof; requireFinanceManage(context, current.programStudyId); if (current.version !== expectedVersion) conflict('VERSION_CONFLICT', 'Bukti pembayaran telah berubah.', { currentVersion: current.version }); if (current.status !== 'SUBMITTED') conflict('PROOF_ALREADY_REVIEWED', 'Bukti pembayaran sudah ditinjau.'); const next: PaymentProof = { ...current, status, ...(reviewNote ? { reviewNote } : {}), version: current.version + 1, reviewedAt: now, reviewedBy: context.uid, updatedAt: now }; transaction.update(ref, next); return next })
  }
  const audit = await appendAudit({ actor: context, action: `BILLING_PAYMENT_PROOF_${status}`, resourceType: 'billing_payment_proof', resourceId: id, before: { status: 'SUBMITTED', version: expectedVersion }, after: { status, version: proof.version, invoiceId: proof.invoiceId, reviewNote }, event })
  return { value: proof, replayed: false, auditId: audit.id }
}
