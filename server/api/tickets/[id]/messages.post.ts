import { getRouterParam, readBody } from 'h3'
import { addTicketMessage } from '../../../services/tickets'
import type { AttachmentReference } from '../../../types/communications'
import { requireAuth } from '../../../utils/auth'
import { invalidInput } from '../../../utils/errors'
import { defineCampusHandler, enforceCsrf, markPrivateResponse } from '../../../utils/security'
import { requireInteger, requireRecord, requireString } from '../../../utils/validation'

function attachments(value: unknown): AttachmentReference[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) invalidInput('attachments harus berupa daftar.')
  return value.map((item, index) => {
    const record = requireRecord(item, `attachments[${index}]`)
    return {
      fileId: requireString(record.fileId, `attachments[${index}].fileId`, { max: 160 }),
      fileName: requireString(record.fileName, `attachments[${index}].fileName`, { max: 180 }),
      contentType: requireString(record.contentType, `attachments[${index}].contentType`, { max: 40 }) as AttachmentReference['contentType'],
      sizeBytes: requireInteger(record.sizeBytes, `attachments[${index}].sizeBytes`, 1, 10 * 1024 * 1024),
    }
  })
}

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  enforceCsrf(event)
  const context = await requireAuth(event)
  const id = requireString(getRouterParam(event, 'id'), 'id', { max: 160, pattern: /^[A-Za-z0-9_-]+$/ })
  const body = requireRecord(await readBody(event))
  return addTicketMessage(context, id, {
    message: requireString(body.message, 'message', { max: 5_000 }),
    attachments: attachments(body.attachments),
  }, event)
})
