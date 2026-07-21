import { getRouterParam } from 'h3'
import { listLearningAssignmentSubmissions } from '../../../../services/learning-submissions'
import { requireAuth } from '../../../../utils/auth'
import { defineCampusHandler, markPrivateResponse } from '../../../../utils/security'
import { requireString } from '../../../../utils/validation'

export default defineCampusHandler(async event => {
  markPrivateResponse(event)
  return { submissions: await listLearningAssignmentSubmissions(await requireAuth(event), requireString(getRouterParam(event, 'id'), 'id', { max: 128 })) }
})
