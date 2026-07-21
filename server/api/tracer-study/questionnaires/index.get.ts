import { listTracerQuestionnaires } from '../../../services/tracer-study'
import { requireAuth } from '../../../utils/auth'
import { defineCampusHandler, markPrivateResponse } from '../../../utils/security'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  return { questionnaires: await listTracerQuestionnaires(await requireAuth(event)) }
})
