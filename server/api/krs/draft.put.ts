import { readBody } from 'h3'
import { saveKrsDraft } from '../../services/krs-enrollment'
import { requireAuth } from '../../utils/auth'
import { invalidInput } from '../../utils/errors'
import { defineCampusHandler, enforceCsrf, markPrivateResponse, requireIdempotencyKey } from '../../utils/security'
import { requireInteger, requireRecord, requireString, requireStringArray } from '../../utils/validation'

export default defineCampusHandler(async event => {
  markPrivateResponse(event)
  enforceCsrf(event)
  const context = await requireAuth(event)
  const idempotencyKey = requireIdempotencyKey(event)
  const body = requireRecord(await readBody(event))
  const unknown = Object.keys(body).filter(key => !['periodId', 'classIds', 'expectedVersion'].includes(key))
  if (unknown.length) invalidInput(`Field tidak didukung: ${unknown.join(', ')}.`)
  const periodId = requireString(body.periodId, 'periodId', { max: 128, pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]*$/ })
  const classIds = requireStringArray(body.classIds, 'classIds', 16)
  classIds.forEach(classId => requireString(classId, 'classId', { max: 128, pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]*$/ }))
  const expectedVersion = requireInteger(body.expectedVersion, 'expectedVersion', 0)
  return saveKrsDraft(context, { periodId, classIds, expectedVersion }, idempotencyKey, event)
})
