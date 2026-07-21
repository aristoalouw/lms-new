import { getRouterParam, readBody } from 'h3'
import { changeTicketStatus } from '../../../services/tickets'
import type { TicketStatus } from '../../../types/communications'
import { requireAuth } from '../../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse } from '../../../utils/security'
import { requireInteger, requireRecord, requireString } from '../../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  enforceCsrf(event)
  const context = await requireAuth(event)
  const id = requireString(getRouterParam(event, 'id'), 'id', { max: 160, pattern: /^[A-Za-z0-9_-]+$/ })
  const body = requireRecord(await readBody(event))
  const expectedVersion = body.expectedVersion === undefined ? undefined : requireInteger(body.expectedVersion, 'expectedVersion', 1)
  return changeTicketStatus(context, id, {
    status: requireString(body.status, 'status', { max: 40 }) as TicketStatus,
    expectedVersion,
  }, event)
})
