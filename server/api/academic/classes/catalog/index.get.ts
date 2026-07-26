import { listLmsAcademicCatalog } from '../../../../modules/classes'
import { requireAuth } from '../../../../utils/auth'
import { defineCampusHandler, markPrivateResponse } from '../../../../utils/security'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  return listLmsAcademicCatalog(await requireAuth(event))
})
