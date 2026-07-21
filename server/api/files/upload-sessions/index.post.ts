import { readBody } from 'h3'
import { createFileUploadSession } from '../../../modules/files'
import type { FileAccessPolicy } from '../../../types/files'
import { requireAuth } from '../../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse, requireIdempotencyKey } from '../../../utils/security'
import { optionalString, requireInteger, requireRecord, requireString } from '../../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  enforceCsrf(event)
  const context = await requireAuth(event)
  const body = requireRecord(await readBody(event))
  const access = body.access === undefined ? undefined : requireRecord(body.access, 'access') as unknown as Partial<FileAccessPolicy>
  return createFileUploadSession(context, {
    fileId: optionalString(body.fileId, 'fileId', 100),
    name: requireString(body.name, 'name', { max: 180 }),
    declaredMimeType: requireString(body.declaredMimeType, 'declaredMimeType', { max: 80 }),
    sizeBytes: requireInteger(body.sizeBytes, 'sizeBytes', 1, 25 * 1024 * 1024),
    access,
  }, requireIdempotencyKey(event), event)
})
