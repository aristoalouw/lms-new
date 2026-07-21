import { authAdmin } from '../../../utils/firebase-admin'
import { clearSessionCookie, requireAuth } from '../../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse } from '../../../utils/security'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  enforceCsrf(event)
  const context = await requireAuth(event)
  if (context.provider === 'firebase') await authAdmin()?.revokeRefreshTokens(context.uid)
  clearSessionCookie(event)
  return { revoked: true, scope: context.provider === 'firebase' ? 'all-sessions' : 'current-demo-session' }
})
