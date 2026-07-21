import { readBody } from 'h3'
import { sendTracerCampaign } from '../../../services/tracer-study-campaigns'
import type { TracerCampaignKind } from '../../../types/tracer-study'
import { requireAuth } from '../../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse, requireIdempotencyKey } from '../../../utils/security'
import { requireInteger, requireRecord, requireString } from '../../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  enforceCsrf(event)
  const body = requireRecord(await readBody(event))
  return sendTracerCampaign(await requireAuth(event), {
    periodId: requireString(body.periodId, 'periodId', { max: 128 }),
    kind: requireString(body.kind, 'kind', { max: 20 }) as TracerCampaignKind,
    ...(body.reminderSequence === undefined ? {} : { reminderSequence: requireInteger(body.reminderSequence, 'reminderSequence', 1, 20) }),
  }, requireIdempotencyKey(event), event)
})
