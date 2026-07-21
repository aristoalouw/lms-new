import { clearSessionCookie } from '../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse } from '../../utils/security'

export default defineCampusHandler((event) => {
  markPrivateResponse(event)
  enforceCsrf(event)
  clearSessionCookie(event)
  return { signedOut: true }
})
