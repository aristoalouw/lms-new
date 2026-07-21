import { getRouterParam, readBody } from 'h3'
import { recordAdmissionFeeStatus } from '../../../../services/admissions'
import type { AdmissionFeeStatus } from '../../../../types/admissions'
import { requireAuth } from '../../../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse, requireIdempotencyKey } from '../../../../utils/security'
import { requireInteger, requireRecord, requireString } from '../../../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  enforceCsrf(event)
  const context = await requireAuth(event)
  const body = requireRecord(await readBody(event))
  return recordAdmissionFeeStatus(context, getRouterParam(event, 'id') || '', {
    status: requireString(body.status, 'status', { max: 20 }) as Exclude<AdmissionFeeStatus, 'UNPAID'>,
    externalReference: requireString(body.externalReference, 'externalReference', { max: 120 }),
    expectedVersion: requireInteger(body.expectedVersion, 'expectedVersion', 1),
  }, requireIdempotencyKey(event), event)
})
