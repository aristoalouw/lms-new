import { getRouterParam } from 'h3'
import { getStudentOnboarding } from '../../../../services/student-onboarding'
import { requireAuth } from '../../../../utils/auth'
import { defineCampusHandler, markPrivateResponse } from '../../../../utils/security'
import { requireString } from '../../../../utils/validation'

export default defineCampusHandler(async event => {
  markPrivateResponse(event)
  return getStudentOnboarding(
    await requireAuth(event),
    requireString(getRouterParam(event, 'studentId'), 'studentId', { max: 128 }),
  )
})
