import { readBody } from 'h3'
import { deleteAcademicMaster } from '../../../services/academic-administration'
import { requireAuth } from '../../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse } from '../../../utils/security'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  enforceCsrf(event)
  return deleteAcademicMaster(await requireAuth(event), await readBody(event), event)
})
