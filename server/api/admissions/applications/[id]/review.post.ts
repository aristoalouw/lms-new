import { getRouterParam, readBody } from 'h3'
import { reviewAdmissionApplication } from '../../../../services/admissions'
import type { AdmissionStatus } from '../../../../types/admissions'
import { requireAuth } from '../../../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse, requireIdempotencyKey } from '../../../../utils/security'
import { requireInteger, requireRecord, requireString } from '../../../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  enforceCsrf(event)
  const context = await requireAuth(event)
  const body = requireRecord(await readBody(event))
  return reviewAdmissionApplication(context, getRouterParam(event, 'id') || '', {
    status: requireString(body.status, 'status', { max: 40 }) as AdmissionStatus,
    expectedVersion: requireInteger(body.expectedVersion, 'expectedVersion', 1),
    ...(typeof body.notes === 'string' ? { notes: body.notes } : {}),
  }, requireIdempotencyKey(event), event)
})
