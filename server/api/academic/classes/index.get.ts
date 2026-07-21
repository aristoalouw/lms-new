import { getQuery } from 'h3'
import { listAcademicClasses } from '../../../services/academic-classes'
import { requireAuth } from '../../../utils/auth'
import { invalidInput } from '../../../utils/errors'
import { defineCampusHandler, markPrivateResponse } from '../../../utils/security'
import { requireString } from '../../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  const context = await requireAuth(event)
  const query = getQuery(event)
  const scalar = (value: unknown, label: string) => {
    if (value === undefined || value === '') return undefined
    if (Array.isArray(value)) invalidInput(`${label} hanya boleh memiliki satu nilai.`)
    return requireString(String(value), label, { max: 80, pattern: /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/ })
  }
  return {
    classes: await listAcademicClasses(context, {
      periodId: scalar(query.periodId, 'periodId'),
      programStudyId: scalar(query.programStudyId, 'programStudyId'),
    }),
  }
})
