import { getQuery } from 'h3'
import { listRequirementDocuments, parseStudentAffairsListQuery } from '../../../services/student-affairs'
import { requireAuth } from '../../../utils/auth'
import { defineCampusHandler, markPrivateResponse } from '../../../utils/security'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  return listRequirementDocuments(await requireAuth(event), parseStudentAffairsListQuery(getQuery(event)))
})
