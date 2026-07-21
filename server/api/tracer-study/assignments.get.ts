import { listOwnTracerAssignments } from '../../services/tracer-study'
import { requireAuth } from '../../utils/auth'
import { defineCampusHandler, markPrivateResponse } from '../../utils/security'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  return { assignments: await listOwnTracerAssignments(await requireAuth(event)) }
})
