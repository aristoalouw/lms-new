import { getRouterParam } from 'h3'
import { getPddiktiReconciliation } from '../../../services/pddikti-reconciliation'
import { requireAuth } from '../../../utils/auth'
import { defineCampusHandler, markPrivateResponse } from '../../../utils/security'
import { requireString } from '../../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  const id = requireString(getRouterParam(event, 'id'), 'id', { max: 100, pattern: /^[A-Za-z0-9_-]+$/ })
  return { reconciliation: await getPddiktiReconciliation(await requireAuth(event), id) }
})
