import { getRouterParam } from 'h3'
import { getPointLedger } from '../../../services/student-affairs'
import { requireAuth } from '../../../utils/auth'
import { defineCampusHandler, markPrivateResponse } from '../../../utils/security'
import { requireString } from '../../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  const studentId = requireString(getRouterParam(event, 'studentId'), 'studentId', { max: 128, pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]*$/ })
  return getPointLedger(await requireAuth(event), studentId)
})
