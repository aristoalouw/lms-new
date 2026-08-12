import { authenticate, clearSessionCookie } from '../../utils/auth'
import { appendAudit } from '../../utils/audit'
import { defineCampusHandler, enforceCsrf, markPrivateResponse } from '../../utils/security'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  enforceCsrf(event)
  const context = await authenticate(event)
  clearSessionCookie(event)
  if (context) {
    await appendAudit({ actor: context, action: 'AUTH_LOGOUT', resourceType: 'session', resourceId: context.uid, event })
  }
  return { signedOut: true }
})
