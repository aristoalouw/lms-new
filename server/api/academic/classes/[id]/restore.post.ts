import { getRouterParam, readBody } from 'h3'
import { restoreAcademicClass } from '../../../../modules/classes'
import { requireAuth } from '../../../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse } from '../../../../utils/security'
import { requireString } from '../../../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  enforceCsrf(event)
  const context = await requireAuth(event)
  const classId = requireString(getRouterParam(event, 'id'), 'id', { max: 128, pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]*$/ })
  const body = await readBody(event).catch(() => ({}))
  return restoreAcademicClass(context, classId, body, event)
})
