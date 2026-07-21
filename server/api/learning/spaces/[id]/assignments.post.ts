import { getRouterParam, readBody } from 'h3'
import { createLearningAssignment } from '../../../../services/learning'
import type { LearningAssignment, SafeRichContent } from '../../../../types/learning'
import { requireAuth } from '../../../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse, requireIdempotencyKey } from '../../../../utils/security'
import { optionalString, requireInteger, requireRecord, requireString } from '../../../../utils/validation'

export default defineCampusHandler(async event => {
  markPrivateResponse(event); enforceCsrf(event); const body = requireRecord(await readBody(event))
  return createLearningAssignment(await requireAuth(event), {
    spaceId: requireString(getRouterParam(event, 'id'), 'id', { max: 128 }), moduleId: optionalString(body.moduleId, 'moduleId', 128),
    title: requireString(body.title, 'title', { max: 180 }), instructions: body.instructions as SafeRichContent,
    opensAt: requireString(body.opensAt, 'opensAt', { max: 48 }), dueAt: requireString(body.dueAt, 'dueAt', { max: 48 }), closesAt: requireString(body.closesAt, 'closesAt', { max: 48 }),
    maximumPoints: requireInteger(body.maximumPoints, 'maximumPoints', 1, 1_000), maximumAttempts: requireInteger(body.maximumAttempts, 'maximumAttempts', 1, 10),
    maximumFiles: requireInteger(body.maximumFiles, 'maximumFiles', 0, 10), status: requireString(body.status, 'status', { max: 20 }) as LearningAssignment['status'],
  }, requireIdempotencyKey(event), event)
})
