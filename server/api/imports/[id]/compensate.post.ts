import { getRouterParam, readBody } from 'h3'
import { compensateImport } from '../../../services/imports'
import { requireAuth } from '../../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse, requireIdempotencyKey } from '../../../utils/security'
import { requireInteger, requireRecord, requireString } from '../../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  enforceCsrf(event)
  const context = await requireAuth(event)
  const idempotencyKey = requireIdempotencyKey(event)
  const runId = requireString(getRouterParam(event, 'id'), 'id', { max: 100, pattern: /^[A-Za-z0-9_-]+$/ })
  const body = requireRecord(await readBody(event))
  return compensateImport(context, runId, {
    expectedVersion: requireInteger(body.expectedVersion, 'expectedVersion', 1),
    reason: requireString(body.reason, 'reason', { min: 10, max: 500 }),
  }, idempotencyKey, event)
})
