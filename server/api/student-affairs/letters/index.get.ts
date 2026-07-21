import { getQuery } from 'h3'
import { listLetterRequests, parseStudentAffairsListQuery } from '../../../services/student-affairs'
import { requireAuth } from '../../../utils/auth'
import { defineCampusHandler, markPrivateResponse } from '../../../utils/security'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  return listLetterRequests(await requireAuth(event), parseStudentAffairsListQuery(getQuery(event)))
})
