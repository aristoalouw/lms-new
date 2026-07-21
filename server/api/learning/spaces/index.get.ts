import { getQuery } from 'h3'
import { listLearningSpaces } from '../../../services/learning'
import { requireAuth } from '../../../utils/auth'
import { defineCampusHandler, markPrivateResponse } from '../../../utils/security'

export default defineCampusHandler(async event => {
  markPrivateResponse(event)
  const query = getQuery(event)
  return { spaces: await listLearningSpaces(await requireAuth(event), { limit: typeof query.limit === 'string' ? Number(query.limit) : undefined }) }
})
