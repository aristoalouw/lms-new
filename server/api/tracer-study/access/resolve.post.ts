import { readBody } from 'h3'
import { resolveTracerAccessToken } from '../../../services/tracer-study'
import { defineCampusHandler, enforceCsrf, markPrivateResponse } from '../../../utils/security'
import { requireRecord, requireString } from '../../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  enforceCsrf(event)
  const body = requireRecord(await readBody(event))
  return resolveTracerAccessToken(requireString(body.accessToken, 'accessToken', { min: 32, max: 128 }), { markOpened: true })
})
