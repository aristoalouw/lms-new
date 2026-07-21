import { getQuery, setHeader } from 'h3'
import { exportEvaluationReportCsv } from '../../../services/evaluations-reporting'
import type { EvaluationReportGroupBy } from '../../../types/evaluations'
import { requireAuth } from '../../../utils/auth'
import { defineCampusHandler, markPrivateResponse } from '../../../utils/security'
import { optionalString, requireString } from '../../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  const context = await requireAuth(event)
  const query = getQuery(event)
  const result = await exportEvaluationReportCsv(context, {
    evaluationPeriodId: requireString(query.evaluationPeriodId, 'evaluationPeriodId', { max: 100 }),
    groupBy: requireString(query.groupBy, 'groupBy', { max: 20 }) as EvaluationReportGroupBy,
    programStudyId: optionalString(query.programStudyId, 'programStudyId', 100),
    lecturerId: optionalString(query.lecturerId, 'lecturerId', 100),
    courseId: optionalString(query.courseId, 'courseId', 100),
    classId: optionalString(query.classId, 'classId', 100),
  }, event)
  const safeName = result.fileName.replace(/[^A-Za-z0-9._-]/g, '_')
  setHeader(event, 'content-type', 'text/csv; charset=utf-8')
  setHeader(event, 'content-disposition', `attachment; filename="${safeName}"`)
  setHeader(event, 'x-content-type-options', 'nosniff')
  return result.content
})
