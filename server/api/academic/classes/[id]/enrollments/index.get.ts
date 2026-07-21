import { getQuery, getRouterParam } from 'h3'
import { listClassEnrollments } from '../../../../../modules/enrollments'
import { requireAuth } from '../../../../../utils/auth'
import { defineCampusHandler, markPrivateResponse } from '../../../../../utils/security'
import { requireInteger, requireString } from '../../../../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  const context = await requireAuth(event)
  const classId = requireString(getRouterParam(event, 'id'), 'id', { max: 128, pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]*$/ })
  const query = getQuery(event)
  const cursor = query.cursor === undefined || query.cursor === ''
    ? undefined
    : requireString(Array.isArray(query.cursor) ? query.cursor[0] : String(query.cursor), 'cursor', { max: 500 })
  const limit = query.limit === undefined || query.limit === ''
    ? undefined
    : requireInteger(Number(Array.isArray(query.limit) ? query.limit[0] : query.limit), 'limit', 1, 50)
  return listClassEnrollments(context, classId, { cursor, limit })
})
