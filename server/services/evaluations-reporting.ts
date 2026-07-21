import type { H3Event } from 'h3'
import type { AuthContext } from '../types/auth'
import type {
  AnonymousEvaluationResponse,
  EvaluationFormVersion,
  EvaluationQuestionDefinition,
  EvaluationQuestionStatistic,
  EvaluationReport,
  EvaluationReportFilters,
  EvaluationReportGroup,
  EvaluationReportGroupBy,
} from '../types/evaluations'
import { appendAudit } from '../utils/audit'
import { forbidden, invalidInput } from '../utils/errors'
import {
  getEvaluationFormVersion,
  getEvaluationPeriodRecord,
  listAnonymousEvaluationResponses,
} from './evaluations'
import {
  normalizeEvaluationId,
  requireEvaluationReportAccess,
} from './evaluations-validation'

const GROUPS: EvaluationReportGroupBy[] = ['lecturer', 'course', 'class', 'program']

function round(value: number): number {
  return Math.round(value * 100) / 100
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

function questionStatistic(
  question: EvaluationQuestionDefinition,
  responses: AnonymousEvaluationResponse[],
): EvaluationQuestionStatistic {
  const values = responses.flatMap((response) => {
    const answer = response.answers.find(item => item.questionId === question.id)
    return answer ? [answer.value] : []
  })
  const base: EvaluationQuestionStatistic = {
    questionId: question.id,
    label: question.label,
    type: question.type,
    answeredCount: values.length,
  }
  if (question.type === 'TEXT' || values.length === 0) return base
  if (question.type === 'BOOLEAN') {
    const booleans = values.filter((value): value is boolean => typeof value === 'boolean')
    return { ...base, truePercent: booleans.length ? round((booleans.filter(Boolean).length / booleans.length) * 100) : 0 }
  }
  const numbers = values.filter((value): value is number => typeof value === 'number')
  if (!numbers.length) return base
  return {
    ...base,
    mean: round(numbers.reduce((sum, value) => sum + value, 0) / numbers.length),
    median: round(median(numbers)),
    minimum: Math.min(...numbers),
    maximum: Math.max(...numbers),
    favorablePercent: round((numbers.filter(value => value >= 4).length / numbers.length) * 100),
    distribution: Object.fromEntries([1, 2, 3, 4, 5].map(value => [String(value), numbers.filter(item => item === value).length])),
  }
}

function groupKey(response: AnonymousEvaluationResponse, groupBy: EvaluationReportGroupBy): string {
  if (groupBy === 'lecturer') return response.lecturerId
  if (groupBy === 'course') return response.courseId
  if (groupBy === 'class') return response.classId
  return response.programStudyId
}

function groupLabel(response: AnonymousEvaluationResponse, groupBy: EvaluationReportGroupBy): string {
  if (groupBy === 'lecturer') return response.lecturerName
  if (groupBy === 'course') return `${response.courseCode} · ${response.courseName}`
  if (groupBy === 'class') return `${response.className} · ${response.courseCode}`
  return response.programStudyId
}

function aggregateGroup(
  responses: AnonymousEvaluationResponse[],
  definition: EvaluationFormVersion,
  groupBy: EvaluationReportGroupBy,
  minimumResponses: number,
): EvaluationReportGroup {
  const first = responses[0]!
  const base: EvaluationReportGroup = {
    key: groupKey(first, groupBy),
    label: groupLabel(first, groupBy),
    ...(groupBy === 'lecturer' || groupBy === 'class'
      ? { lecturerId: first.lecturerId, lecturerName: first.lecturerName }
      : {}),
    ...(groupBy === 'course' || groupBy === 'class'
      ? { courseId: first.courseId, courseCode: first.courseCode, courseName: first.courseName }
      : {}),
    ...(groupBy === 'class' ? { classId: first.classId, className: first.className } : {}),
    programStudyId: first.programStudyId,
    suppressed: responses.length < minimumResponses,
    responseCount: responses.length < minimumResponses ? null : responses.length,
    minimumResponses,
    questions: [],
  }
  if (base.suppressed) return base
  const questions = definition.questions.map(question => questionStatistic(question, responses))
  const likertStats = questions.filter(question => question.type === 'LIKERT_1_5' && question.mean !== undefined && question.answeredCount > 0)
  const likertAnswerCount = likertStats.reduce((sum, question) => sum + question.answeredCount, 0)
  return {
    ...base,
    ...(likertAnswerCount
      ? { overallMean: round(likertStats.reduce((sum, question) => sum + question.mean! * question.answeredCount, 0) / likertAnswerCount) }
      : {}),
    questions,
  }
}

function normalizeReportFilters(context: AuthContext, input: EvaluationReportFilters): EvaluationReportFilters {
  const evaluationPeriodId = normalizeEvaluationId(input.evaluationPeriodId, 'evaluationPeriodId', /^evalperiod_[a-f0-9]{24}$/)
  if (!GROUPS.includes(input.groupBy)) invalidInput('groupBy laporan tidak valid.')
  const lecturerId = input.lecturerId ? normalizeEvaluationId(input.lecturerId, 'lecturerId') : undefined
  return {
    evaluationPeriodId,
    groupBy: input.groupBy,
    ...(input.programStudyId ? { programStudyId: normalizeEvaluationId(input.programStudyId, 'programStudyId') } : {}),
    ...(context.roles.includes('lecturer') ? { lecturerId: context.uid } : lecturerId ? { lecturerId } : {}),
    ...(input.courseId ? { courseId: normalizeEvaluationId(input.courseId, 'courseId') } : {}),
    ...(input.classId ? { classId: normalizeEvaluationId(input.classId, 'classId') } : {}),
  }
}

export async function generateEvaluationReport(
  context: AuthContext,
  rawFilters: EvaluationReportFilters,
  event?: H3Event,
): Promise<EvaluationReport> {
  const filters = normalizeReportFilters(context, rawFilters)
  const period = await getEvaluationPeriodRecord(filters.evaluationPeriodId)
  if (filters.programStudyId && filters.programStudyId !== period.programStudyId) invalidInput('programStudyId tidak sesuai dengan periode evaluasi.')
  requireEvaluationReportAccess(context, period.programStudyId, filters.lecturerId)
  if (context.roles.includes('lecturer') && filters.lecturerId !== context.uid) forbidden('Dosen hanya dapat melihat agregat evaluasi miliknya sendiri.')
  const [definition, storedResponses] = await Promise.all([
    getEvaluationFormVersion(period.formId, period.formVersion),
    listAnonymousEvaluationResponses(period.id),
  ])
  const responses = storedResponses.filter(response => response.programStudyId === period.programStudyId
    && (!filters.lecturerId || response.lecturerId === filters.lecturerId)
    && (!filters.courseId || response.courseId === filters.courseId)
    && (!filters.classId || response.classId === filters.classId))
  const grouped = new Map<string, AnonymousEvaluationResponse[]>()
  for (const response of responses) {
    const key = groupKey(response, filters.groupBy)
    grouped.set(key, [...(grouped.get(key) || []), response])
  }
  const report: EvaluationReport = {
    evaluationPeriod: {
      id: period.id,
      name: period.name,
      academicPeriodId: period.academicPeriodId,
      programStudyId: period.programStudyId,
      minimumResponses: period.minimumResponses,
      opensAt: period.opensAt,
      closesAt: period.closesAt,
    },
    groupBy: filters.groupBy,
    generatedAt: new Date().toISOString(),
    groups: [...grouped.values()]
      .map(items => aggregateGroup(items, definition, filters.groupBy, period.minimumResponses))
      .sort((left, right) => left.label.localeCompare(right.label, 'id-ID')),
    confidentiality: {
      respondentIdentityIncluded: false,
      smallCohortsSuppressed: true,
      freeTextExcluded: true,
    },
  }
  await appendAudit({
    actor: context,
    action: 'EVALUATION_REPORT_VIEWED',
    resourceType: 'evaluation_period',
    resourceId: period.id,
    metadata: { groupBy: filters.groupBy, programStudyId: period.programStudyId, lecturerId: filters.lecturerId, courseId: filters.courseId, classId: filters.classId },
    event,
  })
  return report
}

export function safeCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  let text = String(value).replace(/\0/g, '')
  if (/^[\s]*[=+\-@\t\r]/.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}

export function evaluationReportToCsv(report: EvaluationReport): string {
  const header = [
    'Kelompok', 'Dosen', 'Mata kuliah', 'Kelas', 'Program studi', 'Status kerahasiaan',
    'Jumlah respons', 'Ambang minimum', 'Rata-rata keseluruhan', 'ID pertanyaan', 'Pertanyaan',
    'Tipe', 'Terjawab', 'Rata-rata', 'Median', 'Minimum', 'Maksimum', 'Persen favorable', 'Persen ya',
  ]
  const rows: Array<Array<string | number | null | undefined>> = [header]
  for (const group of report.groups) {
    if (group.suppressed) {
      rows.push([
        group.label, group.lecturerName, group.courseCode ? `${group.courseCode} ${group.courseName || ''}`.trim() : '',
        group.className, group.programStudyId, 'DITEKAN_AMBANG_MINIMUM', null, group.minimumResponses,
        null, null, null, null, null, null, null, null, null, null, null,
      ])
      continue
    }
    for (const question of group.questions) {
      rows.push([
        group.label, group.lecturerName, group.courseCode ? `${group.courseCode} ${group.courseName || ''}`.trim() : '',
        group.className, group.programStudyId, 'TERSEDIA', group.responseCount, group.minimumResponses,
        group.overallMean, question.questionId, question.label, question.type, question.answeredCount,
        question.mean, question.median, question.minimum, question.maximum, question.favorablePercent, question.truePercent,
      ])
    }
  }
  return `\uFEFF${rows.map(row => row.map(safeCsvCell).join(',')).join('\r\n')}\r\n`
}

export async function exportEvaluationReportCsv(
  context: AuthContext,
  filters: EvaluationReportFilters,
  event?: H3Event,
): Promise<{ content: string; fileName: string; auditId: string }> {
  const report = await generateEvaluationReport(context, filters, event)
  const content = evaluationReportToCsv(report)
  const audit = await appendAudit({
    actor: context,
    action: 'EVALUATION_REPORT_EXPORTED',
    resourceType: 'evaluation_period',
    resourceId: report.evaluationPeriod.id,
    metadata: { groupBy: report.groupBy, groupCount: report.groups.length, format: 'CSV' },
    event,
  })
  return {
    content,
    fileName: `evaluasi-${report.evaluationPeriod.academicPeriodId}-${report.groupBy}.csv`,
    auditId: audit.id,
  }
}
