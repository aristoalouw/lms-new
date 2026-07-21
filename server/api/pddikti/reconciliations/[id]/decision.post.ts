import { getRouterParam, readBody } from 'h3'
import { decidePddiktiReconciliation } from '../../../../services/pddikti-reconciliation'
import { requireAuth } from '../../../../utils/auth'
import { invalidInput } from '../../../../utils/errors'
import { defineCampusHandler, enforceCsrf, markPrivateResponse, requireIdempotencyKey } from '../../../../utils/security'
import { requireInteger, requireRecord, requireString, requireStringArray } from '../../../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  enforceCsrf(event)
  const context = await requireAuth(event)
  const id = requireString(getRouterParam(event, 'id'), 'id', { max: 100, pattern: /^[A-Za-z0-9_-]+$/ })
  const body = requireRecord(await readBody(event))
  const decision = requireString(body.decision, 'decision', { max: 30 })
  if (decision !== 'QUEUE_INTERNAL' && decision !== 'ACKNOWLEDGE_REMOTE') invalidInput('Keputusan rekonsiliasi tidak valid.')
  return decidePddiktiReconciliation(context, id, {
    expectedVersion: requireInteger(body.expectedVersion, 'expectedVersion', 1),
    rowKeys: requireStringArray(body.rowKeys, 'rowKeys', 200),
    decision,
  }, requireIdempotencyKey(event), event)
})
