import { getRouterParam, readBody } from 'h3'
import { submitKrs } from '../../../services/krs-enrollment'
import { requireAuth } from '../../../utils/auth'
import { invalidInput } from '../../../utils/errors'
import { defineCampusHandler, enforceCsrf, markPrivateResponse, requireIdempotencyKey } from '../../../utils/security'
import { requireInteger, requireRecord, requireString } from '../../../utils/validation'

export default defineCampusHandler(async event => {
  markPrivateResponse(event)
  enforceCsrf(event)
  const context = await requireAuth(event)
  const idempotencyKey = requireIdempotencyKey(event)
  const id = requireString(getRouterParam(event, 'id'), 'id', { max: 128, pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]*$/ })
  const body = requireRecord(await readBody(event))
  const unknown = Object.keys(body).filter(key => key !== 'expectedVersion')
  if (unknown.length) invalidInput(`Field tidak didukung: ${unknown.join(', ')}.`)
  const expectedVersion = requireInteger(body.expectedVersion, 'expectedVersion', 1)
  return submitKrs(context, id, { expectedVersion }, idempotencyKey, event)
})
