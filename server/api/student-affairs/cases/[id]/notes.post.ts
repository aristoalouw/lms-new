import { getRouterParam, readBody } from 'h3'
import { addCaseStaffNote } from '../../../../services/student-affairs'
import { requireAuth } from '../../../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse, requireIdempotencyKey } from '../../../../utils/security'
import { requireString } from '../../../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  enforceCsrf(event)
  const id = requireString(getRouterParam(event, 'id'), 'id', { max: 128, pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]*$/ })
  return addCaseStaffNote(await requireAuth(event), id, await readBody(event), requireIdempotencyKey(event), event)
})
