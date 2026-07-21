import { listGraduationParticipants } from '../../../services/graduation'
import { requireAuth } from '../../../utils/auth'
import { defineCampusHandler, markPrivateResponse } from '../../../utils/security'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  return { participants: await listGraduationParticipants(await requireAuth(event)) }
})
