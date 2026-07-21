import { getQuery, setResponseHeader } from 'h3'
import { dashboardSummary } from '../../services/dashboard'
import { requireAuth } from '../../utils/auth'
import { invalidInput } from '../../utils/errors'
import { defineCampusHandler, markPrivateResponse } from '../../utils/security'
import { simpleTextPdf } from '../../utils/simple-pdf'
import { optionalString } from '../../utils/validation'

function rows(summary: Awaited<ReturnType<typeof dashboardSummary>>): Array<[string, string]> {
  const output: Array<[string, string]> = [['Periode', summary.periodId], ['Diperbarui', summary.updatedAt]]
  for (const [section, values] of Object.entries(summary.sections)) {
    for (const [metric, value] of Object.entries(values || {})) output.push([`${section}.${metric}`, String(value ?? '')])
  }
  return output
}

function csvCell(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value
  return `"${safe.replaceAll('"', '""')}"`
}

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  const query = getQuery(event)
  const format = optionalString(query.format, 'format', 8) || 'csv'
  if (!['csv', 'pdf'].includes(format)) invalidInput('format harus csv atau pdf.')
  const summary = await dashboardSummary(await requireAuth(event), {
    periodId: optionalString(query.periodId, 'periodId', 40),
    programStudyId: optionalString(query.programStudyId, 'programStudyId', 80),
  })
  const filename = `dashboard-${summary.periodId.replace(/[^A-Za-z0-9._-]/g, '-')}`
  if (format === 'csv') {
    setResponseHeader(event, 'Content-Type', 'text/csv; charset=utf-8')
    setResponseHeader(event, 'Content-Disposition', `attachment; filename="${filename}.csv"`)
    return `\uFEFF${[['metric', 'value'], ...rows(summary)].map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`
  }
  setResponseHeader(event, 'Content-Type', 'application/pdf')
  setResponseHeader(event, 'Content-Disposition', `attachment; filename="${filename}.pdf"`)
  return simpleTextPdf(`Nusa Campus - Dashboard ${summary.periodId}`, rows(summary).map(([label, value]) => `${label}: ${value}`))
})
