import { listAdmissionSelectionAssignments } from '../../../../services/admissions-selection'
import { requireAuth } from '../../../../utils/auth'
import { defineCampusHandler, markPrivateResponse } from '../../../../utils/security'

export default defineCampusHandler(async event => {
  markPrivateResponse(event)
  return { assignments: await listAdmissionSelectionAssignments(await requireAuth(event)) }
})
