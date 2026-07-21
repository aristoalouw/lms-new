import { readBody } from 'h3'
import { createImportPreview } from '../../services/imports'
import { IMPORT_DATASETS, type ImportDataset } from '../../types/imports'
import { requireAuth } from '../../utils/auth'
import { invalidInput } from '../../utils/errors'
import { defineCampusHandler, enforceCsrf, markPrivateResponse, requireIdempotencyKey } from '../../utils/security'
import { requireRecord, requireString } from '../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  enforceCsrf(event)
  const context = await requireAuth(event)
  const idempotencyKey = requireIdempotencyKey(event)
  const body = requireRecord(await readBody(event))
  const dataset = requireString(body.dataset, 'dataset', { max: 30 }) as ImportDataset
  if (!IMPORT_DATASETS.includes(dataset)) invalidInput('Dataset impor tidak didukung.')
  const format = requireString(body.format, 'format', { max: 3 })
  if (format !== 'csv' && format !== 'tsv') invalidInput('Format impor harus csv atau tsv.')
  if (typeof body.content !== 'string') invalidInput('content harus berupa teks CSV/TSV.')
  return createImportPreview(context, {
    dataset,
    format,
    content: body.content,
    sourceName: requireString(body.sourceName, 'sourceName', { max: 120 }),
    programStudyId: requireString(body.programStudyId, 'programStudyId', { max: 80 }),
  }, idempotencyKey, event)
})
