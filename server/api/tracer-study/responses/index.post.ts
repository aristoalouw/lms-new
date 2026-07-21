import { readBody } from 'h3'
import { submitTracerResponse } from '../../../services/tracer-study'
import type { TracerAnswer, TracerCareerData } from '../../../types/tracer-study'
import { authenticate } from '../../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse, requireIdempotencyKey } from '../../../utils/security'
import { optionalString, requireRecord, requireString } from '../../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  enforceCsrf(event)
  const body = requireRecord(await readBody(event))
  return submitTracerResponse(await authenticate(event), {
    accessToken: optionalString(body.accessToken, 'accessToken', 128),
    recipientId: optionalString(body.recipientId, 'recipientId', 128),
    consentAccepted: body.consentAccepted === true,
    consentVersion: requireString(body.consentVersion, 'consentVersion', { max: 80 }),
    career: body.career as TracerCareerData,
    answers: body.answers as TracerAnswer[],
  }, requireIdempotencyKey(event), event)
})
