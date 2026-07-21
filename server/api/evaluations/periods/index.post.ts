import { readBody } from 'h3'
import { createEvaluationPeriod } from '../../../services/evaluations'
import { requireAuth } from '../../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse, requireIdempotencyKey } from '../../../utils/security'
import { requireInteger, requireRecord, requireString } from '../../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  enforceCsrf(event)
  const context = await requireAuth(event)
  const idempotencyKey = requireIdempotencyKey(event)
  const body = requireRecord(await readBody(event))
  return createEvaluationPeriod(context, {
    name: requireString(body.name, 'name', { max: 160 }),
    academicPeriodId: requireString(body.academicPeriodId, 'academicPeriodId', { max: 100 }),
    programStudyId: requireString(body.programStudyId, 'programStudyId', { max: 100 }),
    formId: requireString(body.formId, 'formId', { max: 100 }),
    formVersion: requireInteger(body.formVersion, 'formVersion', 1, 1_000_000),
    opensAt: requireString(body.opensAt, 'opensAt', { max: 48 }),
    closesAt: requireString(body.closesAt, 'closesAt', { max: 48 }),
    minimumResponses: requireInteger(body.minimumResponses, 'minimumResponses', 3, 50),
  }, idempotencyKey, event)
})
