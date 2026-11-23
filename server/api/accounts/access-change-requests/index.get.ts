import { getQuery } from 'h3'
import {
  ACCOUNT_ACCESS_REQUEST_STATUSES,
  listAccountAccessChangeRequests,
  type AccountAccessRequestStatus,
} from '../../../services/accounts'
import { requireAuth } from '../../../utils/auth'
import { invalidInput } from '../../../utils/errors'
import { defineCampusHandler, markPrivateResponse } from '../../../utils/security'
import { optionalString, requireInteger } from '../../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  const context = await requireAuth(event)
  const query = getQuery(event)
  const status = optionalString(query.status, 'status', 20) as AccountAccessRequestStatus | undefined
  if (status && !ACCOUNT_ACCESS_REQUEST_STATUSES.includes(status)) invalidInput('Status permintaan akses tidak valid.')
  const limit = query.limit === undefined ? undefined : requireInteger(Number(query.limit), 'limit', 1, 50)
  const cursor = optionalString(query.cursor, 'cursor', 128)
  return listAccountAccessChangeRequests(context, {
    ...(status ? { status } : {}),
    ...(limit ? { limit } : {}),
    ...(cursor ? { cursor } : {}),
  })
})
