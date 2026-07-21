import { getRouterParam, readBody } from 'h3'
import { convertAcceptedApplicant } from '../../../../services/admissions'
import { requireAuth } from '../../../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse, requireIdempotencyKey } from '../../../../utils/security'
import { requireInteger, requireRecord } from '../../../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  enforceCsrf(event)
  const context = await requireAuth(event)
  const body = requireRecord(await readBody(event))
  return convertAcceptedApplicant(context, getRouterParam(event, 'id') || '', {
    expectedVersion: requireInteger(body.expectedVersion, 'expectedVersion', 1),
  }, requireIdempotencyKey(event), event)
})
