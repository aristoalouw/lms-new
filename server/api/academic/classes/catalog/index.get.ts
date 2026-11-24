import { getQuery } from 'h3'
import { listLmsAcademicCatalog } from '../../../../modules/classes'
import { requireAuth } from '../../../../utils/auth'
import { defineCampusHandler, markPrivateResponse } from '../../../../utils/security'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  const query = getQuery(event)
  return listLmsAcademicCatalog(await requireAuth(event), query.includeDeleted === 'true')
})
