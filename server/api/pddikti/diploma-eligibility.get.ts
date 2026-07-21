import { getQuery } from 'h3'
import { getDiplomaNumberEligibility } from '../../services/pddikti-student-data'
import { requireAuth } from '../../utils/auth'
import { defineCampusHandler, markPrivateResponse } from '../../utils/security'
import { requireString } from '../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  const query = getQuery(event)
  return getDiplomaNumberEligibility(await requireAuth(event), { studentId: requireString(query.studentId, 'studentId', { max: 128 }), programStudyId: requireString(query.programStudyId, 'programStudyId', { max: 128 }), periodId: requireString(query.periodId, 'periodId', { max: 128 }) })
})
