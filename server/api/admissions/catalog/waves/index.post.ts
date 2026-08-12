import { readBody } from 'h3'
import { createAdmissionWave } from '../../../../services/admissions-catalog'
import type { AdmissionWaveInput } from '../../../../types/admissions'
import { requireAuth } from '../../../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse, requireIdempotencyKey } from '../../../../utils/security'
import { requireInteger, requireRecord, requireString, requireStringArray } from '../../../../utils/validation'
import { invalidInput } from '../../../../utils/errors'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  enforceCsrf(event)
  const context = await requireAuth(event)
  const body = requireRecord(await readBody(event))
  if (typeof body.active !== 'boolean') invalidInput('active wajib berupa boolean.')
  const input: AdmissionWaveInput = {
    id: requireString(body.id, 'id', { max: 80 }),
    academicYear: requireString(body.academicYear, 'academicYear', { max: 9 }),
    label: requireString(body.label, 'label', { max: 120 }),
    opensAt: requireString(body.opensAt, 'opensAt', { max: 48 }),
    closesAt: requireString(body.closesAt, 'closesAt', { max: 48 }),
    registrationFee: requireInteger(body.registrationFee, 'registrationFee', 0, 1_000_000_000),
    active: body.active === true,
    programStudyIds: requireStringArray(body.programStudyIds, 'programStudyIds', 100),
    capacity: requireInteger(body.capacity, 'capacity', 1, 100_000),
  }
  return createAdmissionWave(context, input, requireIdempotencyKey(event), event)
})
