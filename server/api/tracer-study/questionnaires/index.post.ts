import { readBody } from 'h3'
import { createTracerQuestionnaire } from '../../../services/tracer-study'
import type { TracerQuestionDefinition } from '../../../types/tracer-study'
import { requireAuth } from '../../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse, requireIdempotencyKey } from '../../../utils/security'
import { optionalString, requireRecord, requireString } from '../../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  enforceCsrf(event)
  const body = requireRecord(await readBody(event))
  return createTracerQuestionnaire(await requireAuth(event), {
    name: requireString(body.name, 'name', { max: 160 }),
    description: optionalString(body.description, 'description', 1_000),
    programStudyId: requireString(body.programStudyId, 'programStudyId', { max: 80 }),
    questions: body.questions as TracerQuestionDefinition[],
  }, requireIdempotencyKey(event), event)
})
