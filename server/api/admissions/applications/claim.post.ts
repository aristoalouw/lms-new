import { readBody } from 'h3'
import { claimAdmissionApplicationByNumber } from '../../../services/admissions'
import { requireAuth } from '../../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse } from '../../../utils/security'
import { requireRecord, requireString } from '../../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  enforceCsrf(event)
  const context = await requireAuth(event)
  const body = requireRecord(await readBody(event))
  return claimAdmissionApplicationByNumber(
    context,
    requireString(body.registrationNumber, 'registrationNumber', { max: 40 }),
    event,
  )
})
