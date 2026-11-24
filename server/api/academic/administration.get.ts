import { getQuery } from 'h3'
import { getAcademicAdministrationWorkspace } from '../../services/academic-administration'
import { requireAuth } from '../../utils/auth'
import { defineCampusHandler, markPrivateResponse } from '../../utils/security'
import { optionalString } from '../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  const query = getQuery(event)
  const includeAll = query.includeAll === 'true' || query.includeDeleted === 'true'
  return getAcademicAdministrationWorkspace(await requireAuth(event), optionalString(query.studentId, 'studentId', 128), { includeAll })
})
