import { getRouterParam, readBody } from 'h3'
import { updateAdmissionWave } from '../../../../services/admissions-catalog'
import type { AdmissionWaveInput } from '../../../../types/admissions'
import { requireAuth } from '../../../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse } from '../../../../utils/security'
import { requireInteger, requireRecord, requireString, requireStringArray } from '../../../../utils/validation'
import { invalidInput } from '../../../../utils/errors'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  enforceCsrf(event)
  const context = await requireAuth(event)
  const id = requireString(getRouterParam(event, 'id'), 'id', { max: 80 })
  const body = requireRecord(await readBody(event))
  if (typeof body.active !== 'boolean') invalidInput('active wajib berupa boolean.')
  const input: AdmissionWaveInput & { expectedVersion: number } = {
    id,
    academicYear: requireString(body.academicYear, 'academicYear', { max: 9 }),
    label: requireString(body.label, 'label', { max: 120 }),
    opensAt: requireString(body.opensAt, 'opensAt', { max: 48 }),
    closesAt: requireString(body.closesAt, 'closesAt', { max: 48 }),
    registrationFee: requireInteger(body.registrationFee, 'registrationFee', 0, 1_000_000_000),
    active: body.active === true,
    programStudyIds: requireStringArray(body.programStudyIds, 'programStudyIds', 100),
    capacity: requireInteger(body.capacity, 'capacity', 1, 100_000),
    expectedVersion: requireInteger(body.expectedVersion, 'expectedVersion', 1, 100_000),
  }
  return updateAdmissionWave(context, id, input, event)
})
