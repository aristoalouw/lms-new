import type { H3Event } from 'h3'
import type { AuthContext } from '../types/auth'
import type {
  TracerEmploymentStatus,
  TracerIncomeRange,
  TracerOutcomeGroup,
  TracerOutcomeReport,
  TracerReportGroupBy,
  TracerResponse,
} from '../types/tracer-study'
import { appendAudit } from '../utils/audit'
import { forbidden, invalidInput, serviceUnavailable } from '../utils/errors'
import { dataMode, firestoreAdmin } from '../utils/firebase-admin'
import { hasProgramAccess, hasRole } from '../utils/rbac'
import { loadTracerPeriod, requireAggregateReader } from './tracer-study'
import { tracerStudyMockState } from './tracer-study-mock'

export interface TracerReportFilter {
  periodId: string
  groupBy: TracerReportGroupBy
  programStudyId?: string
  graduationYear?: number
}

function cleanId(value: string, label: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{1,127}$/.test(value)) invalidInput(`${label} tidak valid.`)
  return value
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

function mean(values: number[]): number | null {
  return values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : null
}

async function periodResponses(periodId: string): Promise<TracerResponse[]> {
  if (dataMode() === 'mock') return [...tracerStudyMockState().responses.values()].filter(item => item.periodId === periodId).map(item => structuredClone(item))
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan respons tracer study tidak tersedia.')
  const snapshot = await db.collection('tracerResponses').where('periodId', '==', periodId).limit(5_000).get()
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as TracerResponse)
}

function distribution<T extends string>(values: T[]): Partial<Record<T, { count: number; percent: number }>> {
  const counts = new Map<T, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return Object.fromEntries([...counts.entries()].map(([key, count]) => [key, { count, percent: round(count * 100 / values.length) }])) as Partial<Record<T, { count: number; percent: number }>>
}

function groupKey(response: TracerResponse, groupBy: TracerReportGroupBy): string {
  return groupBy === 'program' ? response.programStudyId : String(response.graduationYear)
}

function aggregateGroup(key: string, records: TracerResponse[], minimumCellSize: number): TracerOutcomeGroup {
  if (records.length < minimumCellSize) {
    return {
      key, label: key, suppressed: true, responseCount: null,
      employmentStatus: {}, incomeRange: {}, averageWaitMonths: null, averageFieldAlignment: null,
    }
  }
  const careers = records.flatMap(record => record.career ? [record.career] : [])
  return {
    key, label: key, suppressed: false, responseCount: records.length,
    employmentStatus: distribution<TracerEmploymentStatus>(careers.map(career => career.employmentStatus)),
    incomeRange: distribution<TracerIncomeRange>(careers.flatMap(career => career.incomeRange ? [career.incomeRange] : [])),
    averageWaitMonths: mean(careers.flatMap(career => career.waitMonths === undefined ? [] : [career.waitMonths])),
    averageFieldAlignment: mean(careers.flatMap(career => career.fieldAlignment === undefined ? [] : [career.fieldAlignment])),
  }
}

export async function generateTracerOutcomeReport(
  context: AuthContext,
  filter: TracerReportFilter,
  event?: H3Event,
): Promise<TracerOutcomeReport> {
  requireAggregateReader(context)
  const periodId = cleanId(filter.periodId, 'Periode')
  if (!['program', 'graduation_year'].includes(filter.groupBy)) invalidInput('Pengelompokan laporan tidak valid.')
  const period = await loadTracerPeriod(periodId)
  const requestedProgram = filter.programStudyId ? cleanId(filter.programStudyId, 'Program studi') : undefined
  if (requestedProgram && !period.programStudyIds.includes(requestedProgram)) invalidInput('Program studi tidak termasuk periode.')
  if (!hasRole(context, 'leader')) {
    if (requestedProgram && !hasProgramAccess(context, requestedProgram)) forbidden('Program studi berada di luar lingkup akses Anda.')
    if (!period.programStudyIds.some(id => hasProgramAccess(context, id))) forbidden('Periode berada di luar lingkup akses Anda.')
  }
  if (filter.graduationYear !== undefined && (!Number.isInteger(filter.graduationYear)
    || filter.graduationYear < period.graduationYearFrom || filter.graduationYear > period.graduationYearTo)) invalidInput('Tahun lulus tidak valid.')
  const allowedPrograms = hasRole(context, 'leader') ? period.programStudyIds : period.programStudyIds.filter(id => hasProgramAccess(context, id))
  const responses = (await periodResponses(period.id)).filter(response => response.status === 'SUBMITTED' && Boolean(response.career)
    && allowedPrograms.includes(response.programStudyId)
    && (!requestedProgram || response.programStudyId === requestedProgram)
    && (filter.graduationYear === undefined || response.graduationYear === filter.graduationYear))
  const grouped = new Map<string, TracerResponse[]>()
  for (const response of responses) {
    const key = groupKey(response, filter.groupBy)
    grouped.set(key, [...(grouped.get(key) ?? []), response])
  }
  const report: TracerOutcomeReport = {
    periodId: period.id, periodName: period.name, groupBy: filter.groupBy, generatedAt: new Date().toISOString(),
    groups: [...grouped.entries()].map(([key, records]) => aggregateGroup(key, records, period.minimumCellSize)).sort((left, right) => left.key.localeCompare(right.key)),
    confidentiality: { respondentIdentityIncluded: false, freeTextIncluded: false, smallCellsSuppressed: true, minimumCellSize: period.minimumCellSize },
    method: 'DESCRIPTIVE_ONLY',
  }
  await appendAudit({ actor: context, action: 'TRACER_AGGREGATE_VIEWED', resourceType: 'tracer_distribution_period', resourceId: period.id, after: { groupBy: filter.groupBy, programStudyId: requestedProgram, graduationYear: filter.graduationYear, groupCount: report.groups.length }, event })
  return report
}

export function safeTracerCsvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value)
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}

export function tracerOutcomeReportToCsv(report: TracerOutcomeReport): string {
  const headers = ['period_id', 'group_by', 'group', 'suppressed', 'response_count', 'employment_status', 'employment_count', 'employment_percent', 'average_wait_months', 'average_field_alignment', 'income_range', 'income_count', 'income_percent']
  const rows: unknown[][] = [headers]
  for (const group of report.groups) {
    if (group.suppressed) {
      rows.push([report.periodId, report.groupBy, group.label, true, '', '', '', '', '', '', '', '', ''])
      continue
    }
    const employmentEntries = Object.entries(group.employmentStatus)
    const incomeEntries = Object.entries(group.incomeRange)
    const length = Math.max(1, employmentEntries.length, incomeEntries.length)
    for (let index = 0; index < length; index++) {
      const employment = employmentEntries[index]
      const income = incomeEntries[index]
      rows.push([
        report.periodId, report.groupBy, group.label, false, group.responseCount,
        employment?.[0] ?? '', employment?.[1].count ?? '', employment?.[1].percent ?? '',
        index === 0 ? group.averageWaitMonths : '', index === 0 ? group.averageFieldAlignment : '',
        income?.[0] ?? '', income?.[1].count ?? '', income?.[1].percent ?? '',
      ])
    }
  }
  return `\uFEFF${rows.map(row => row.map(safeTracerCsvCell).join(',')).join('\r\n')}\r\n`
}

export async function exportTracerOutcomeCsv(
  context: AuthContext,
  filter: TracerReportFilter,
  event?: H3Event,
): Promise<{ fileName: string; csv: string }> {
  const report = await generateTracerOutcomeReport(context, filter, event)
  return {
    fileName: `tracer-study-${report.periodId}-${report.groupBy}.csv`,
    csv: tracerOutcomeReportToCsv(report),
  }
}
