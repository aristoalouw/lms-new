import { getQuery } from 'h3'
import { listAcademicClassesPage } from '../../../modules/classes'
import { requireAuth } from '../../../utils/auth'
import { invalidInput } from '../../../utils/errors'
import { defineCampusHandler, markPrivateResponse } from '../../../utils/security'
import { requireInteger, requireString } from '../../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  const context = await requireAuth(event)
  const query = getQuery(event)
  const scalar = (value: unknown, label: string) => {
    if (value === undefined || value === '') return undefined
    if (Array.isArray(value)) invalidInput(`${label} hanya boleh memiliki satu nilai.`)
    return requireString(String(value), label, { max: 80, pattern: /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/ })
  }
  const page = await listAcademicClassesPage(context, {
    periodId: scalar(query.periodId, 'periodId'),
    programStudyId: scalar(query.programStudyId, 'programStudyId'),
    cursor: query.cursor === undefined ? undefined : requireString(String(query.cursor), 'cursor', { max: 500, pattern: /^[A-Za-z0-9_-]+$/ }),
    limit: query.limit === undefined ? 50 : requireInteger(Number(query.limit), 'limit', 1, 50),
  })
  return { ...page, classes: page.items }
})
