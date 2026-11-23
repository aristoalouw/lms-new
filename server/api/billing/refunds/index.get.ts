import { getQuery } from 'h3'
import { listDepositRefunds } from '../../../services/billing-refunds'
import type { BillingRefundRequest } from '../../../types/billing'
import { requireAuth } from '../../../utils/auth'
import { invalidInput } from '../../../utils/errors'
import { defineCampusHandler, markPrivateResponse } from '../../../utils/security'
import { optionalString, requireInteger } from '../../../utils/validation'

const STATUSES: BillingRefundRequest['status'][] = ['PENDING', 'DISBURSED', 'REJECTED']

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  const context = await requireAuth(event)
  const query = getQuery(event)
  const status = optionalString(query.status, 'status', 20) as BillingRefundRequest['status'] | undefined
  if (status && !STATUSES.includes(status)) invalidInput('Status refund tidak didukung.')
  return listDepositRefunds(context, {
    ...(optionalString(query.programStudyId, 'programStudyId', 128) ? { programStudyId: String(query.programStudyId) } : {}),
    ...(status ? { status } : {}),
    ...(query.limit !== undefined ? { limit: requireInteger(Number(query.limit), 'limit', 1, 100) } : {}),
  })
})
