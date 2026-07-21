import { getRouterParam, readBody } from 'h3'
import { updateTracerQuestionnaire } from '../../../services/tracer-study'
import type { TracerQuestionDefinition, TracerQuestionnaire } from '../../../types/tracer-study'
import { requireAuth } from '../../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse } from '../../../utils/security'
import { optionalString, requireInteger, requireRecord, requireString } from '../../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  enforceCsrf(event)
  const body = requireRecord(await readBody(event))
  return updateTracerQuestionnaire(await requireAuth(event), requireString(getRouterParam(event, 'id'), 'id', { max: 128 }), {
    expectedVersion: requireInteger(body.expectedVersion, 'expectedVersion', 1, 10_000),
    name: requireString(body.name, 'name', { max: 160 }),
    description: optionalString(body.description, 'description', 1_000),
    programStudyId: requireString(body.programStudyId, 'programStudyId', { max: 80 }),
    questions: body.questions as TracerQuestionDefinition[],
    status: body.status as TracerQuestionnaire['status'],
  }, event)
})
