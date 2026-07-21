import { getRouterParam } from 'h3'
import { getAdmissionApplication } from '../../../services/admissions'
import { requireAuth } from '../../../utils/auth'
import { defineCampusHandler, markPrivateResponse } from '../../../utils/security'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  const context = await requireAuth(event)
  return { application: await getAdmissionApplication(context, getRouterParam(event, 'id') || '') }
})
