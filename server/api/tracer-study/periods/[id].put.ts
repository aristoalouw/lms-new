import { getRouterParam, readBody } from 'h3'
import { updateTracerPeriod } from '../../../services/tracer-study'
import type { TracerDistributionPeriod } from '../../../types/tracer-study'
import { requireAuth } from '../../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse } from '../../../utils/security'
import { requireInteger, requireRecord, requireString, requireStringArray } from '../../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  enforceCsrf(event)
  const body = requireRecord(await readBody(event))
  return updateTracerPeriod(await requireAuth(event), requireString(getRouterParam(event, 'id'), 'id', { max: 128 }), {
    expectedVersion: requireInteger(body.expectedVersion, 'expectedVersion', 1, 10_000),
    name: requireString(body.name, 'name', { max: 160 }),
    programStudyIds: requireStringArray(body.programStudyIds, 'programStudyIds', 30),
    graduationYearFrom: requireInteger(body.graduationYearFrom, 'graduationYearFrom', 1990, 2200),
    graduationYearTo: requireInteger(body.graduationYearTo, 'graduationYearTo', 1990, 2200),
    opensAt: requireString(body.opensAt, 'opensAt', { max: 48 }),
    closesAt: requireString(body.closesAt, 'closesAt', { max: 48 }),
    accessTokenTtlHours: requireInteger(body.accessTokenTtlHours, 'accessTokenTtlHours', 1, 720),
    minimumCellSize: requireInteger(body.minimumCellSize, 'minimumCellSize', 3, 50),
    consentVersion: requireString(body.consentVersion, 'consentVersion', { max: 80 }),
    consentNotice: requireString(body.consentNotice, 'consentNotice', { max: 2_000 }),
    status: body.status as TracerDistributionPeriod['status'],
  }, event)
})
