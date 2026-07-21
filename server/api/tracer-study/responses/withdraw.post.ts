import { readBody } from 'h3'
import { withdrawTracerConsent } from '../../../services/tracer-study'
import { authenticate } from '../../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse, requireIdempotencyKey } from '../../../utils/security'
import { optionalString, requireInteger, requireRecord } from '../../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  enforceCsrf(event)
  const body = requireRecord(await readBody(event))
  return withdrawTracerConsent(await authenticate(event), {
    withdrawalToken: optionalString(body.withdrawalToken, 'withdrawalToken', 128),
    responseId: optionalString(body.responseId, 'responseId', 128),
    expectedConsentVersion: requireInteger(body.expectedConsentVersion, 'expectedConsentVersion', 1, 10_000),
  }, requireIdempotencyKey(event), event)
})
