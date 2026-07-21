import { listGraduationTemplates } from '../../../services/graduation-documents'
import { requireAuth } from '../../../utils/auth'
import { defineCampusHandler, markPrivateResponse } from '../../../utils/security'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  return { templates: await listGraduationTemplates(await requireAuth(event)) }
})
