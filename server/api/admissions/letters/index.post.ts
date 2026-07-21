import { readBody } from 'h3'
import { issueAdmissionLetterOfAcceptance } from '../../../services/admissions-selection'
import { requireAuth } from '../../../utils/auth'
import { invalidInput } from '../../../utils/errors'
import { defineCampusHandler, enforceCsrf, markPrivateResponse, requireIdempotencyKey } from '../../../utils/security'
import { requireInteger, requireRecord, requireString } from '../../../utils/validation'

export default defineCampusHandler(async event => {
  markPrivateResponse(event)
  enforceCsrf(event)
  const context = await requireAuth(event)
  const idempotencyKey = requireIdempotencyKey(event)
  const body = requireRecord(await readBody(event))
  const unknown = Object.keys(body).filter(key => !['applicationId', 'expectedVersion'].includes(key))
  if (unknown.length) invalidInput(`Field tidak didukung: ${unknown.join(', ')}.`)
  return issueAdmissionLetterOfAcceptance(
    context,
    requireString(body.applicationId, 'applicationId', { max: 128 }),
    requireInteger(body.expectedVersion, 'expectedVersion', 1),
    idempotencyKey,
    event,
  )
})
