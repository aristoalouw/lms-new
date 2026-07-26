import { getQuery } from 'h3'
import { auditEntrySummary, listAuditEntriesPage } from '../../modules/audit'
import { requireAuth } from '../../utils/auth'
import { requirePermission } from '../../utils/rbac'
import { defineCampusHandler, markPrivateResponse } from '../../utils/security'
import { requireInteger } from '../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  const context = await requireAuth(event)
  requirePermission(context, 'audit:view')
  const query = getQuery(event)
  const limit = query.limit === undefined ? 50 : requireInteger(Number(query.limit), 'limit', 1, 50)
  const page = await listAuditEntriesPage({ limit, cursor: typeof query.cursor === 'string' ? query.cursor : undefined })
  const entries = page.items.map(auditEntrySummary)
  return { items: entries, entries, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) }
})
