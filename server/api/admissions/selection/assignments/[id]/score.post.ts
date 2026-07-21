import { getRouterParam, readBody } from 'h3'
import { finalizeAdmissionSelectionScore } from '../../../../../services/admissions-selection'
import type { AdmissionScoreComponent, AdmissionSelectionScore } from '../../../../../types/admissions-selection'
import { requireAuth } from '../../../../../utils/auth'
import { invalidInput } from '../../../../../utils/errors'
import { defineCampusHandler, enforceCsrf, markPrivateResponse, requireIdempotencyKey } from '../../../../../utils/security'
import { requireRecord, requireString } from '../../../../../utils/validation'

export default defineCampusHandler(async event => {
  markPrivateResponse(event)
  enforceCsrf(event)
  const context = await requireAuth(event)
  const idempotencyKey = requireIdempotencyKey(event)
  const assignmentId = requireString(getRouterParam(event, 'id'), 'assignmentId', { max: 128 })
  const body = requireRecord(await readBody(event))
  const unknown = Object.keys(body).filter(key => !['components', 'recommendation'].includes(key))
  if (unknown.length) invalidInput(`Field tidak didukung: ${unknown.join(', ')}.`)
  if (!Array.isArray(body.components)) invalidInput('components harus berupa array.')
  return finalizeAdmissionSelectionScore(context, assignmentId, {
    components: body.components as AdmissionScoreComponent[],
    recommendation: requireString(body.recommendation, 'recommendation', { max: 20 }) as AdmissionSelectionScore['recommendation'],
  }, idempotencyKey, event)
})
