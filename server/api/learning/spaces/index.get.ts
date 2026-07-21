import { getQuery } from 'h3'
import { listLearningSpacesPage } from '../../../modules/learning'
import { requireAuth } from '../../../utils/auth'
import { defineCampusHandler, markPrivateResponse } from '../../../utils/security'

export default defineCampusHandler(async event => {
  markPrivateResponse(event)
  const query = getQuery(event)
  const page = await listLearningSpacesPage(await requireAuth(event), {
    limit: typeof query.limit === 'string' ? Number(query.limit) : undefined,
    cursor: typeof query.cursor === 'string' ? query.cursor : undefined,
  })
  return { ...page, spaces: page.items }
})
