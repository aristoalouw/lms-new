import { readBody } from 'h3'
import { createLearningSpace } from '../../../services/learning'
import type { LearningSpace } from '../../../types/learning'
import { requireAuth } from '../../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse, requireIdempotencyKey } from '../../../utils/security'
import { optionalString, requireRecord, requireString } from '../../../utils/validation'

export default defineCampusHandler(async event => {
  markPrivateResponse(event); enforceCsrf(event)
  const body = requireRecord(await readBody(event))
  return createLearningSpace(await requireAuth(event), {
    kind: requireString(body.kind, 'kind', { max: 30 }) as LearningSpace['kind'], title: requireString(body.title, 'title', { max: 160 }),
    description: optionalString(body.description, 'description', 1_000), academicClassId: optionalString(body.academicClassId, 'academicClassId', 128),
    programStudyId: optionalString(body.programStudyId, 'programStudyId', 128), unitId: optionalString(body.unitId, 'unitId', 128),
    lecturerIds: body.lecturerIds as string[] | undefined, participantUserIds: body.participantUserIds as string[] | undefined,
    gamificationAvailable: body.gamificationAvailable === true,
  }, requireIdempotencyKey(event), event)
})
