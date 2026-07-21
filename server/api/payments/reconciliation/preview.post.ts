import { readBody } from 'h3'
import { reconcileGatewayReport } from '../../../services/payment-gateway'
import type { GatewayReconciliationRow } from '../../../types/payment-gateway'
import { requireAuth } from '../../../utils/auth'
import { invalidInput } from '../../../utils/errors'
import { defineCampusHandler, enforceCsrf, markPrivateResponse } from '../../../utils/security'
import { normalizeIsoInstant, optionalString, requirePositiveNumber, requireRecord, requireString } from '../../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  enforceCsrf(event)
  const context = await requireAuth(event)
  const body = requireRecord(await readBody(event))
  if (!Array.isArray(body.rows) || body.rows.length < 1 || body.rows.length > 2_000) {
    invalidInput('rows harus berisi 1-2.000 baris rekonsiliasi.')
  }
  const rows: GatewayReconciliationRow[] = body.rows.map((value, index) => {
    const row = requireRecord(value, `rows[${index}]`)
    const amount = requirePositiveNumber(row.amount, `rows[${index}].amount`, 10_000_000_000)
    if (!Number.isInteger(amount)) invalidInput(`rows[${index}].amount harus berupa rupiah bulat.`)
    const currency = requireString(row.currency, `rows[${index}].currency`, { min: 3, max: 3 })
    if (currency !== 'IDR') invalidInput(`rows[${index}].currency harus IDR.`)
    return {
      eventId: requireString(row.eventId, `rows[${index}].eventId`, { max: 100, pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]+$/ }),
      transactionId: requireString(row.transactionId, `rows[${index}].transactionId`, { max: 120, pattern: /^[A-Za-z0-9][A-Za-z0-9._:/-]+$/ }),
      amount,
      currency: 'IDR',
      occurredAt: normalizeIsoInstant(row.occurredAt, `rows[${index}].occurredAt`, { maxFutureMs: 5 * 60 * 1000 }),
    }
  })
  return reconcileGatewayReport(context, {
    provider: requireString(body.provider, 'provider', { max: 40, pattern: /^[a-z][a-z0-9_-]+$/ }),
    periodStart: normalizeIsoInstant(body.periodStart, 'periodStart', { maxFutureMs: 5 * 60 * 1000 }),
    periodEnd: normalizeIsoInstant(body.periodEnd, 'periodEnd', { maxFutureMs: 5 * 60 * 1000 }),
    ...(optionalString(body.programStudyId, 'programStudyId', 80) ? { programStudyId: String(body.programStudyId) } : {}),
    rows,
  })
})
