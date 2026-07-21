import { readBody } from 'h3'
import { createAdmissionSelectionSession } from '../../../../services/admissions-selection'
import type { AdmissionSelectionKind } from '../../../../types/admissions-selection'
import { requireAuth } from '../../../../utils/auth'
import { invalidInput } from '../../../../utils/errors'
import { defineCampusHandler, enforceCsrf, markPrivateResponse, requireIdempotencyKey } from '../../../../utils/security'
import { requireInteger, requireRecord, requireString, requireStringArray } from '../../../../utils/validation'

export default defineCampusHandler(async event => {
  markPrivateResponse(event)
  enforceCsrf(event)
  const context = await requireAuth(event)
  const idempotencyKey = requireIdempotencyKey(event)
  const body = requireRecord(await readBody(event))
  const allowed = ['name', 'kind', 'waveId', 'programStudyId', 'location', 'startsAt', 'endsAt', 'capacity', 'examinerIds']
  const unknown = Object.keys(body).filter(key => !allowed.includes(key))
  if (unknown.length) invalidInput(`Field tidak didukung: ${unknown.join(', ')}.`)
  return createAdmissionSelectionSession(context, {
    name: requireString(body.name, 'name', { max: 160 }),
    kind: requireString(body.kind, 'kind', { max: 30 }) as AdmissionSelectionKind,
    waveId: requireString(body.waveId, 'waveId', { max: 128 }),
    programStudyId: requireString(body.programStudyId, 'programStudyId', { max: 128 }),
    location: requireString(body.location, 'location', { max: 200 }),
    startsAt: requireString(body.startsAt, 'startsAt', { max: 48 }),
    endsAt: requireString(body.endsAt, 'endsAt', { max: 48 }),
    capacity: requireInteger(body.capacity, 'capacity', 1, 1_000),
    examinerIds: requireStringArray(body.examinerIds, 'examinerIds', 20),
  }, idempotencyKey, event)
})
