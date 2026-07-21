import { getRouterParam, readBody } from 'h3'
import { assignApplicantToSelectionSession } from '../../../../../services/admissions-selection'
import { requireAuth } from '../../../../../utils/auth'
import { invalidInput } from '../../../../../utils/errors'
import { defineCampusHandler, enforceCsrf, markPrivateResponse, requireIdempotencyKey } from '../../../../../utils/security'
import { requireRecord, requireString } from '../../../../../utils/validation'

export default defineCampusHandler(async event => {
  markPrivateResponse(event)
  enforceCsrf(event)
  const context = await requireAuth(event)
  const idempotencyKey = requireIdempotencyKey(event)
  const sessionId = requireString(getRouterParam(event, 'id'), 'sessionId', { max: 128 })
  const body = requireRecord(await readBody(event))
  const unknown = Object.keys(body).filter(key => key !== 'applicationId')
  if (unknown.length) invalidInput(`Field tidak didukung: ${unknown.join(', ')}.`)
  const applicationId = requireString(body.applicationId, 'applicationId', { max: 128 })
  return assignApplicantToSelectionSession(context, sessionId, applicationId, idempotencyKey, event)
})
