import { getQuery, getRouterParam } from 'h3'
import { listLearningAssignmentSubmissionsPage } from '../../../../modules/learning'
import { requireAuth } from '../../../../utils/auth'
import { defineCampusHandler, markPrivateResponse } from '../../../../utils/security'
import { requireString } from '../../../../utils/validation'

export default defineCampusHandler(async event => {
  markPrivateResponse(event)
  const query = getQuery(event)
  const page = await listLearningAssignmentSubmissionsPage(
    await requireAuth(event),
    requireString(getRouterParam(event, 'id'), 'id', { max: 128 }),
    {
      cursor: typeof query.cursor === 'string' ? query.cursor : undefined,
      limit: typeof query.limit === 'string' ? Number(query.limit) : undefined,
    },
  )
  return { ...page, submissions: page.items }
})
