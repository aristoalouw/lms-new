import { readBody } from 'h3'
import { createTracerPeriod } from '../../../services/tracer-study'
import { requireAuth } from '../../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse, requireIdempotencyKey } from '../../../utils/security'
import { requireInteger, requireRecord, requireString, requireStringArray } from '../../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  enforceCsrf(event)
  const body = requireRecord(await readBody(event))
  return createTracerPeriod(await requireAuth(event), {
    name: requireString(body.name, 'name', { max: 160 }),
    questionnaireId: requireString(body.questionnaireId, 'questionnaireId', { max: 80 }),
    questionnaireVersion: requireInteger(body.questionnaireVersion, 'questionnaireVersion', 1, 10_000),
    programStudyIds: requireStringArray(body.programStudyIds, 'programStudyIds', 30),
    graduationYearFrom: requireInteger(body.graduationYearFrom, 'graduationYearFrom', 1990, 2200),
    graduationYearTo: requireInteger(body.graduationYearTo, 'graduationYearTo', 1990, 2200),
    opensAt: requireString(body.opensAt, 'opensAt', { max: 48 }),
    closesAt: requireString(body.closesAt, 'closesAt', { max: 48 }),
    accessTokenTtlHours: requireInteger(body.accessTokenTtlHours, 'accessTokenTtlHours', 1, 720),
    minimumCellSize: requireInteger(body.minimumCellSize, 'minimumCellSize', 3, 50),
    consentVersion: requireString(body.consentVersion, 'consentVersion', { max: 80 }),
    consentNotice: requireString(body.consentNotice, 'consentNotice', { max: 2_000 }),
  }, requireIdempotencyKey(event), event)
})
