import { listAdmissionSelectionSessions } from '../../../../services/admissions-selection'
import { requireAuth } from '../../../../utils/auth'
import { defineCampusHandler, markPrivateResponse } from '../../../../utils/security'

export default defineCampusHandler(async event => {
  markPrivateResponse(event)
  return { sessions: await listAdmissionSelectionSessions(await requireAuth(event)) }
})
