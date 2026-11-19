import { readBody } from 'h3'
import type { BulkStudentOnboardingInput } from '../../../types/student-onboarding'
import { bulkOnboardStudents } from '../../../services/student-onboarding-bulk'
import { requireAuth } from '../../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse, requireIdempotencyKey } from '../../../utils/security'

export default defineCampusHandler(async event => {
  markPrivateResponse(event)
  enforceCsrf(event)
  return bulkOnboardStudents(
    await requireAuth(event),
    await readBody<BulkStudentOnboardingInput>(event),
    requireIdempotencyKey(event),
    event,
  )
})
