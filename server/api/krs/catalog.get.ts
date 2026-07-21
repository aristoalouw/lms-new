import { getQuery } from 'h3'
import { listKrsCatalog } from '../../services/krs-enrollment'
import { requireAuth } from '../../utils/auth'
import { defineCampusHandler, markPrivateResponse } from '../../utils/security'
import { requireString } from '../../utils/validation'

export default defineCampusHandler(async event => {
  markPrivateResponse(event)
  const context = await requireAuth(event)
  const periodId = requireString(getQuery(event).periodId, 'periodId', { max: 128, pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]*$/ })
  return listKrsCatalog(context, periodId)
})
