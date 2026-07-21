import { getQuery } from 'h3'
import { generateEvaluationReport } from '../../../services/evaluations-reporting'
import type { EvaluationReportGroupBy } from '../../../types/evaluations'
import { requireAuth } from '../../../utils/auth'
import { defineCampusHandler, markPrivateResponse } from '../../../utils/security'
import { optionalString, requireString } from '../../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  const context = await requireAuth(event)
  const query = getQuery(event)
  return generateEvaluationReport(context, {
    evaluationPeriodId: requireString(query.evaluationPeriodId, 'evaluationPeriodId', { max: 100 }),
    groupBy: requireString(query.groupBy, 'groupBy', { max: 20 }) as EvaluationReportGroupBy,
    programStudyId: optionalString(query.programStudyId, 'programStudyId', 100),
    lecturerId: optionalString(query.lecturerId, 'lecturerId', 100),
    courseId: optionalString(query.courseId, 'courseId', 100),
    classId: optionalString(query.classId, 'classId', 100),
  }, event)
})
