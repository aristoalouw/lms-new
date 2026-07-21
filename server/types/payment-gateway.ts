import type { PaymentRecord } from './domain'

export const PAYMENT_GATEWAY_EVENT_TYPES = ['payment.settled', 'payment.reversed'] as const
export type PaymentGatewayEventType = (typeof PAYMENT_GATEWAY_EVENT_TYPES)[number]

export interface PaymentGatewayPayload {
  eventId: string
  eventType: PaymentGatewayEventType
  transactionId: string
  invoiceId: string
  amount: number
  currency: 'IDR'
  channel: Exclude<PaymentRecord['channel'], 'cash'>
  occurredAt: string
  originalExternalReference?: string
  reason?: string
}

export interface VerifiedGatewayEvent {
  provider: string
  payload: PaymentGatewayPayload
  payloadHash: string
  signatureTimestamp: string
}

export interface PaymentGatewayEventRecord {
  id: string
  provider: string
  eventId: string
  eventType: PaymentGatewayEventType
  payloadHash: string
  transactionId: string
  invoiceId: string
  programStudyId?: string
  amount: number
  currency: 'IDR'
  occurredAt: string
  receivedAt: string
  status: 'PROCESSED' | 'FAILED'
  paymentId?: string
  replayed?: boolean
  failureCode?: string
}

export interface GatewayReconciliationRow {
  eventId: string
  transactionId: string
  amount: number
  currency: 'IDR'
  occurredAt: string
}

export interface GatewayReconciliationResultRow extends GatewayReconciliationRow {
  status: 'MATCHED' | 'MISSING_INTERNAL' | 'MISMATCH' | 'MISSING_PROVIDER'
  internalEventId?: string
  note: string
}

export interface GatewayReconciliationResult {
  provider: string
  periodStart: string
  periodEnd: string
  counts: {
    providerRows: number
    internalRows: number
    matched: number
    missingInternal: number
    missingProvider: number
    mismatched: number
  }
  rows: GatewayReconciliationResultRow[]
}
