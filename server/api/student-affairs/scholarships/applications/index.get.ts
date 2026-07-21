import { getQuery } from 'h3'
import { listScholarshipApplications, parseStudentAffairsListQuery } from '../../../../services/student-affairs'
import { requireAuth } from '../../../../utils/auth'
import { defineCampusHandler, markPrivateResponse } from '../../../../utils/security'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  return listScholarshipApplications(await requireAuth(event), parseStudentAffairsListQuery(getQuery(event)))
})
