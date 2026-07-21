import { readBody } from 'h3'
import { queuePddiktiSync } from '../../services/pddikti'
import { PDDIKTI_ENTITY_TYPES, type PddiktiEntityType } from '../../types/domain'
import { requireAuth } from '../../utils/auth'
import { invalidInput } from '../../utils/errors'
import { defineCampusHandler, enforceCsrf, markPrivateResponse, requireIdempotencyKey } from '../../utils/security'
import { requireRecord, requireString, requireStringArray } from '../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  enforceCsrf(event)
  const context = await requireAuth(event)
  const idempotencyKey = requireIdempotencyKey(event)
  const body = requireRecord(await readBody(event))
  const entityType = requireString(body.entityType, 'entityType', { max: 40 }) as PddiktiEntityType
  if (!PDDIKTI_ENTITY_TYPES.includes(entityType)) invalidInput('entityType PDDIKTI tidak didukung.')
  const entityIds = requireStringArray(body.entityIds, 'entityIds', 500)
  const programStudyId = requireString(body.programStudyId, 'programStudyId', { max: 80, pattern: /^[A-Za-z0-9._-]+$/ })
  const periodId = requireString(body.periodId, 'periodId', { max: 40, pattern: /^[A-Za-z0-9._/-]+$/ })
  return queuePddiktiSync(context, { entityType, entityIds, programStudyId, periodId }, idempotencyKey, event)
})
