import { getRouterParam, readBody } from 'h3'
import { restoreEvaluationPeriod } from '../../../../services/evaluations'
import { requireAuth } from '../../../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse } from '../../../../utils/security'
import { requireInteger, requireRecord, requireString } from '../../../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  enforceCsrf(event)
  const context = await requireAuth(event)
  const periodId = requireString(getRouterParam(event, 'id'), 'periodId', { max: 100, pattern: /^evalperiod_[a-f0-9]{24}$/ })
  const raw = await readBody(event).catch(() => ({}))
  const body = raw && typeof raw === 'object' ? requireRecord(raw) : {}
  const expectedVersion = body.expectedVersion === undefined ? undefined : requireInteger(body.expectedVersion, 'expectedVersion', 1, 1_000_000)
  return restoreEvaluationPeriod(context, periodId, expectedVersion, event)
})
