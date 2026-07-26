import { getQuery, getRouterParam } from 'h3'
import { listClassAttendancePage } from '../../../../../modules/classes'
import { requireAuth } from '../../../../../utils/auth'
import { defineCampusHandler, markPrivateResponse } from '../../../../../utils/security'
import { optionalString, requireInteger, requireString } from '../../../../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  const query = getQuery(event)
  const classId = requireString(getRouterParam(event, 'id'), 'id', { max: 128, pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]*$/ })
  return listClassAttendancePage(await requireAuth(event), classId, {
    ...(query.meetingNumber === undefined ? {} : { meetingNumber: requireInteger(query.meetingNumber, 'meetingNumber', 1, 40) }),
    ...(query.studentId === undefined ? {} : { studentId: requireString(query.studentId, 'studentId', { max: 128, pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]*$/ }) }),
    ...(query.cursor === undefined ? {} : { cursor: optionalString(query.cursor, 'cursor', 512) }),
    ...(query.limit === undefined ? {} : { limit: requireInteger(query.limit, 'limit', 1, 50) }),
  })
})
