import { getRouterParam, readBody } from 'h3'
import { transitionGraduationApplication } from '../../../../services/graduation'
import { parseGraduationTransition } from '../../../../services/graduation-input'
import { requireAuth } from '../../../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse, requireIdempotencyKey } from '../../../../utils/security'
import { requireString } from '../../../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  enforceCsrf(event)
  const context = await requireAuth(event)
  const id = requireString(getRouterParam(event, 'id'), 'id', { max: 128 })
  return transitionGraduationApplication(context, id, parseGraduationTransition(await readBody(event)), requireIdempotencyKey(event), event)
})
