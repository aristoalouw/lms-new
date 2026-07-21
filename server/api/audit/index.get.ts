import { getQuery } from 'h3'
import { listAuditEntries } from '../../utils/audit'
import { requireAuth } from '../../utils/auth'
import { requirePermission } from '../../utils/rbac'
import { defineCampusHandler, markPrivateResponse } from '../../utils/security'
import { requireInteger } from '../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  const context = await requireAuth(event)
  requirePermission(context, 'audit:view')
  const query = getQuery(event)
  const limit = query.limit === undefined ? 50 : requireInteger(Number(query.limit), 'limit', 1, 100)
  return { entries: await listAuditEntries(limit) }
})
