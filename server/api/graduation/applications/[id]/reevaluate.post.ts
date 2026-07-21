import { getRouterParam, readBody } from 'h3'
import { reevaluateGraduationApplication } from '../../../../services/graduation'
import { requireAuth } from '../../../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse, requireIdempotencyKey } from '../../../../utils/security'
import { requireInteger, requireRecord, requireString } from '../../../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  enforceCsrf(event)
  const context = await requireAuth(event)
  const id = requireString(getRouterParam(event, 'id'), 'id', { max: 128 })
  const body = requireRecord(await readBody(event))
  return reevaluateGraduationApplication(context, id, requireInteger(body.expectedVersion, 'expectedVersion', 1), requireIdempotencyKey(event), event)
})
