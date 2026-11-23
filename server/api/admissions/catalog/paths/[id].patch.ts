import { getRouterParam, readBody } from 'h3'
import { updateAdmissionPathPolicy } from '../../../../services/admissions-catalog'
import type { AdmissionDocumentType, AdmissionPathId, AdmissionPathPolicyInput, StudyModeId } from '../../../../types/admissions'
import { requireAuth } from '../../../../utils/auth'
import { invalidInput } from '../../../../utils/errors'
import { defineCampusHandler, enforceCsrf, markPrivateResponse } from '../../../../utils/security'
import { requireInteger, requireRecord, requireString, requireStringArray } from '../../../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  enforceCsrf(event)
  const context = await requireAuth(event)
  const id = requireString(getRouterParam(event, 'id'), 'id', { max: 40 }) as AdmissionPathId
  const body = requireRecord(await readBody(event))
  if (typeof body.active !== 'boolean') invalidInput('active wajib berupa boolean.')
  const effectiveUntil = body.effectiveUntil === undefined || body.effectiveUntil === ''
    ? undefined
    : requireString(body.effectiveUntil, 'effectiveUntil', { max: 48 })
  const input: AdmissionPathPolicyInput & { expectedVersion: number } = {
    id,
    label: requireString(body.label, 'label', { max: 100 }),
    description: requireString(body.description, 'description', { max: 500 }),
    active: body.active,
    programStudyIds: requireStringArray(body.programStudyIds, 'programStudyIds', 100),
    studyModeIds: requireStringArray(body.studyModeIds, 'studyModeIds', 10) as StudyModeId[],
    requiredDocumentTypes: requireStringArray(body.requiredDocumentTypes, 'requiredDocumentTypes', 10) as AdmissionDocumentType[],
    registrationFee: requireInteger(body.registrationFee, 'registrationFee', 0, 1_000_000_000),
    effectiveFrom: requireString(body.effectiveFrom, 'effectiveFrom', { max: 48 }),
    ...(effectiveUntil ? { effectiveUntil } : {}),
    expectedVersion: requireInteger(body.expectedVersion, 'expectedVersion', 1, 100_000),
  }
  return updateAdmissionPathPolicy(context, id, input, event)
})
