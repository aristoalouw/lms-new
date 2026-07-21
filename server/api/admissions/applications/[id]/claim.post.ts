import { getRouterParam, readBody } from 'h3'
import { claimAdmissionApplication } from '../../../../services/admissions'
import { requireAuth } from '../../../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse } from '../../../../utils/security'
import { requireInteger, requireRecord, requireString } from '../../../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  enforceCsrf(event)
  const context = await requireAuth(event)
  const body = requireRecord(await readBody(event))
  return claimAdmissionApplication(
    context,
    getRouterParam(event, 'id') || '',
    requireString(body.registrationNumber, 'registrationNumber', { max: 40 }),
    requireInteger(body.expectedVersion, 'expectedVersion', 1),
    event,
  )
})
