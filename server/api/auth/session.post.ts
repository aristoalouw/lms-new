import { readBody } from 'h3'
import { createFirebaseSession, publicSession, setSessionCookie } from '../../utils/auth'
import { enforceAuthIpBurst, enforceAuthUserLimit } from '../../utils/auth-rate-limit'
import { clientAddress, defineCampusHandler, enforceCsrf, markPrivateResponse } from '../../utils/security'
import { requireRecord, requireString } from '../../utils/validation'
import { appendAudit } from '../../utils/audit'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  enforceCsrf(event)
  await enforceAuthIpBurst(clientAddress(event) || 'unknown')
  const body = requireRecord(await readBody(event))
  const idToken = requireString(body.idToken, 'idToken', { min: 100, max: 10_000 })
  const remember = body.remember === true
  const { context, token } = await createFirebaseSession(idToken, {
    remember,
    onVerified: verifiedContext => enforceAuthUserLimit('firebase', verifiedContext.uid),
  })
  await appendAudit({ actor: context, action: 'AUTH_LOGIN_SUCCEEDED', resourceType: 'session', resourceId: context.uid, metadata: { remember }, event })
  setSessionCookie(event, token, remember)
  return { session: publicSession(context) }
})
