import { getQuery } from 'h3'
import { listImportRuns } from '../../services/imports'
import { IMPORT_DATASETS, IMPORT_STATUSES, type ImportDataset, type ImportStatus } from '../../types/imports'
import { requireAuth } from '../../utils/auth'
import { invalidInput } from '../../utils/errors'
import { defineCampusHandler, markPrivateResponse } from '../../utils/security'
import { optionalString, requireInteger } from '../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  const context = await requireAuth(event)
  const query = getQuery(event)
  const dataset = optionalString(query.dataset, 'dataset', 30) as ImportDataset | undefined
  if (dataset && !IMPORT_DATASETS.includes(dataset)) invalidInput('Dataset impor tidak didukung.')
  const status = optionalString(query.status, 'status', 30) as ImportStatus | undefined
  if (status && !IMPORT_STATUSES.includes(status)) invalidInput('Status impor tidak didukung.')
  const limit = query.limit === undefined ? undefined : requireInteger(Number(query.limit), 'limit', 1, 100)
  return listImportRuns(context, {
    ...(dataset ? { dataset } : {}),
    ...(status ? { status } : {}),
    ...(limit ? { limit } : {}),
    ...(optionalString(query.programStudyId, 'programStudyId', 80) ? { programStudyId: String(query.programStudyId) } : {}),
    ...(optionalString(query.cursor, 'cursor', 100) ? { cursor: String(query.cursor) } : {}),
  })
})
