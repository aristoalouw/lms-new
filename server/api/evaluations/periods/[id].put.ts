import { getRouterParam, readBody } from 'h3'
import { updateEvaluationPeriod } from '../../../services/evaluations'
import { requireAuth } from '../../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse } from '../../../utils/security'
import { requireInteger, requireRecord, requireString } from '../../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  enforceCsrf(event)
  const context = await requireAuth(event)
  const periodId = requireString(getRouterParam(event, 'id'), 'periodId', { max: 100, pattern: /^evalperiod_[a-f0-9]{24}$/ })
  const body = requireRecord(await readBody(event))
  return updateEvaluationPeriod(context, periodId, {
    expectedVersion: requireInteger(body.expectedVersion, 'expectedVersion', 1, 1_000_000),
    name: requireString(body.name, 'name', { max: 160 }),
    opensAt: requireString(body.opensAt, 'opensAt', { max: 48 }),
    closesAt: requireString(body.closesAt, 'closesAt', { max: 48 }),
    minimumResponses: requireInteger(body.minimumResponses, 'minimumResponses', 3, 50),
  }, event)
})
