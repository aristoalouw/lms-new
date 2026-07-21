import { readBody } from 'h3'
import { createDemoSession, publicSession, setSessionCookie } from '../../utils/auth'
import { enforceAuthIpBurst, enforceAuthUserLimit } from '../../utils/auth-rate-limit'
import { clientAddress, defineCampusHandler, enforceCsrf, markPrivateResponse } from '../../utils/security'
import { requireRecord, requireString } from '../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  enforceCsrf(event)
  await enforceAuthIpBurst(clientAddress(event) || 'unknown')
  const body = requireRecord(await readBody(event))
  const profileId = requireString(body.profileId, 'profileId', { max: 40, pattern: /^[a-z][a-z0-9_-]*$/ })
  const { context, token } = createDemoSession(profileId)
  await enforceAuthUserLimit('demo', context.uid)
  setSessionCookie(event, token)
  return { session: publicSession(context) }
})
