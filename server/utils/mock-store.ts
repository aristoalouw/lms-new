import type { AuditEntry, InvoiceRecord, KrsRecord, PaymentRecord, PddiktiSyncJob } from '../types/domain'
import type { PaymentGatewayEventRecord } from '../types/payment-gateway'
import { MOCK_INVOICES, MOCK_KRS, MOCK_PDDIKTI_JOBS } from '../data/mock-data'

interface IdempotencyEntry<T = unknown> {
  requestHash: string
  response: T
  createdAt: string
}

export interface MockState {
  krs: Map<string, KrsRecord>
  invoices: Map<string, InvoiceRecord>
  payments: Map<string, PaymentRecord>
  paymentGatewayEvents: Map<string, PaymentGatewayEventRecord>
  pddiktiJobs: Map<string, PddiktiSyncJob>
  idempotency: Map<string, IdempotencyEntry>
  auditEntries: AuditEntry[]
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function initialState(): MockState {
  return {
    krs: new Map(MOCK_KRS.map((record) => [record.id, clone(record)])),
    invoices: new Map(MOCK_INVOICES.map((record) => [record.id, clone(record)])),
    payments: new Map(),
    paymentGatewayEvents: new Map(),
    pddiktiJobs: new Map(MOCK_PDDIKTI_JOBS.map((record) => [record.id, clone(record)])),
    idempotency: new Map(),
    auditEntries: [],
  }
}

let state = initialState()

export function mockState(): MockState {
  return state
}

export function cloneValue<T>(value: T): T {
  return clone(value)
}

export function resetMockState(): void {
  state = initialState()
}
