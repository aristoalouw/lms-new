import { removeResponseHeader, setResponseHeaders } from 'h3'
import { applicationSecurityHeaders, trustedRequestId } from '../utils/security'

export default defineEventHandler((event) => {
  setResponseHeaders(event, {
    ...applicationSecurityHeaders(),
    'x-request-id': trustedRequestId(event),
  })
  removeResponseHeader(event, 'x-powered-by')
})
