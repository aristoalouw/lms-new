import { getQuery } from 'h3'
import { listViolationCases, parseStudentAffairsListQuery } from '../../../services/student-affairs'
import { requireAuth } from '../../../utils/auth'
import { defineCampusHandler, markPrivateResponse } from '../../../utils/security'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  return listViolationCases(await requireAuth(event), parseStudentAffairsListQuery(getQuery(event)))
})
