import { getRouterParam, readBody } from 'h3'
import { approveImport } from '../../../services/imports'
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
  return approveImport(context, runId, {
    expectedVersion: requireInteger(body.expectedVersion, 'expectedVersion', 1),
    expectedChecksum: requireString(body.expectedChecksum, 'expectedChecksum', { min: 64, max: 64, pattern: /^[a-f0-9]{64}$/ }),
  }, idempotencyKey, event)
})
