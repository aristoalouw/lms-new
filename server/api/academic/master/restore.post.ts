import { readBody } from 'h3'
import { restoreAcademicMaster } from '../../../services/academic-administration'
import { requireAuth } from '../../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse } from '../../../utils/security'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  enforceCsrf(event)
  return restoreAcademicMaster(await requireAuth(event), await readBody(event), event)
})
