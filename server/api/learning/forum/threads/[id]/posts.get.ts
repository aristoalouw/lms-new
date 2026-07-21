import { getQuery, getRouterParam } from 'h3'
import { listLearningForumPosts } from '../../../../../modules/learning'
import { requireAuth } from '../../../../../utils/auth'
import { defineCampusHandler, markPrivateResponse } from '../../../../../utils/security'
import { requireString } from '../../../../../utils/validation'

export default defineCampusHandler(async event => {
  markPrivateResponse(event); const query = getQuery(event)
  return listLearningForumPosts(await requireAuth(event), requireString(getRouterParam(event, 'id'), 'id', { max: 128 }), { cursor: typeof query.cursor === 'string' ? query.cursor : undefined, limit: typeof query.limit === 'string' ? Number(query.limit) : undefined })
})
