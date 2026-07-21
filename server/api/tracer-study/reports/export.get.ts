import { getQuery, setHeader } from 'h3'
import { exportTracerOutcomeCsv } from '../../../services/tracer-study-reporting'
import type { TracerReportGroupBy } from '../../../types/tracer-study'
import { requireAuth } from '../../../utils/auth'
import { defineCampusHandler, markPrivateResponse } from '../../../utils/security'
import { optionalString, requireString } from '../../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  const query = getQuery(event)
  const result = await exportTracerOutcomeCsv(await requireAuth(event), {
    periodId: requireString(query.periodId, 'periodId', { max: 128 }),
    groupBy: requireString(query.groupBy, 'groupBy', { max: 30 }) as TracerReportGroupBy,
    programStudyId: optionalString(query.programStudyId, 'programStudyId', 80),
    graduationYear: typeof query.graduationYear === 'string' && query.graduationYear ? Number(query.graduationYear) : undefined,
  }, event)
  setHeader(event, 'content-type', 'text/csv; charset=utf-8')
  setHeader(event, 'content-disposition', `attachment; filename="${result.fileName}"`)
  return result.csv
})
