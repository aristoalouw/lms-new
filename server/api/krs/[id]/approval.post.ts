import { getRouterParam, readBody } from 'h3'
import { reviewKrs } from '../../../services/krs'
import { requireAuth } from '../../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse, requireIdempotencyKey } from '../../../utils/security'
import { invalidInput } from '../../../utils/errors'
import { optionalString, requireInteger, requireRecord, requireString } from '../../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  enforceCsrf(event)
  const context = await requireAuth(event)
  const idempotencyKey = requireIdempotencyKey(event)
  const krsId = requireString(getRouterParam(event, 'id'), 'id', { max: 100, pattern: /^[A-Za-z0-9_-]+$/ })
  const body = requireRecord(await readBody(event))
  const decision = requireString(body.decision, 'decision', { max: 10 })
  if (decision !== 'APPROVE' && decision !== 'REJECT') invalidInput('decision harus APPROVE atau REJECT.')
  const notes = optionalString(body.notes, 'notes', 1_000)
  if (decision === 'REJECT' && !notes) invalidInput('notes wajib diisi saat menolak KRS.')
  const expectedVersion = body.expectedVersion === undefined
    ? undefined
    : requireInteger(body.expectedVersion, 'expectedVersion', 0)
  return reviewKrs(krsId, context, { decision, notes, expectedVersion }, event, idempotencyKey)
})
