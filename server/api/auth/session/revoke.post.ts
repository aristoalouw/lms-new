import { FieldValue } from 'firebase-admin/firestore'
import { clearSessionCookie, requireAuth } from '../../../utils/auth'
import { appendAudit } from '../../../utils/audit'
import { serviceUnavailable } from '../../../utils/errors'
import { authAdmin, firestoreAdmin } from '../../../utils/firebase-admin'
import { defineCampusHandler, enforceCsrf, markPrivateResponse } from '../../../utils/security'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  enforceCsrf(event)
  const context = await requireAuth(event)
  if (context.provider === 'firebase') {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan akun tidak tersedia.')
    const now = Date.now()
    await db.collection('accounts').doc(context.uid).update({
      version: FieldValue.increment(1),
      sessionValidAfter: Math.ceil((now + 1) / 1000) * 1000,
      updatedAt: new Date(now).toISOString(),
      updatedBy: context.uid,
    })
    const authentication = authAdmin()
    if (!authentication) serviceUnavailable('Layanan autentikasi tidak tersedia.')
    await authentication.revokeRefreshTokens(context.uid)
  }
  clearSessionCookie(event)
  await appendAudit({ actor: context, action: 'AUTH_SESSIONS_REVOKED', resourceType: 'session', resourceId: context.uid, event })
  return { revoked: true, scope: context.provider === 'firebase' ? 'all-application-sessions' : 'current-demo-session' }
})
