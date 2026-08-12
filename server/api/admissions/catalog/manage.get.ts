import { admissionCatalog } from '../../../services/admissions-catalog'
import { requireAuth } from '../../../utils/auth'
import { requirePermission } from '../../../utils/rbac'
import { defineCampusHandler, markPrivateResponse } from '../../../utils/security'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  const context = await requireAuth(event)
  requirePermission(context, 'pmb.write')
  return admissionCatalog({ includeInactive: true })
})
