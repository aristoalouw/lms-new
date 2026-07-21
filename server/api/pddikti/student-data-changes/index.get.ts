import { getQuery } from 'h3'
import { listStudentDataChanges } from '../../../services/pddikti-student-data'
import { requireAuth } from '../../../utils/auth'
import { defineCampusHandler, markPrivateResponse } from '../../../utils/security'
import { optionalString, requireString } from '../../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  const query = getQuery(event)
  return { items: await listStudentDataChanges(await requireAuth(event), { programStudyId: requireString(query.programStudyId, 'programStudyId', { max: 128 }), status: optionalString(query.status, 'status', 20), studentId: optionalString(query.studentId, 'studentId', 128) }) }
})
