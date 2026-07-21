import { listOwnAdmissionApplications } from '../../../services/admissions'
import { requireAuth } from '../../../utils/auth'
import { defineCampusHandler, markPrivateResponse } from '../../../utils/security'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  return { items: await listOwnAdmissionApplications(await requireAuth(event)) }
})
