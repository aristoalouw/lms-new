import { getRouterParam, getHeader } from 'h3'
import { getMockUploadLimit, storeMockUploadContent } from '../../../../services/files'
import { requireAuth } from '../../../../utils/auth'
import { CampusError, invalidInput } from '../../../../utils/errors'
import { defineCampusHandler, enforceCsrf, markPrivateResponse } from '../../../../utils/security'
import { requireString } from '../../../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  enforceCsrf(event)
  const context = await requireAuth(event)
  const sessionId = requireString(getRouterParam(event, 'id'), 'sessionId', { max: 100, pattern: /^upload_[a-f0-9]{24}$/ })
  const limit = await getMockUploadLimit(context, sessionId)
  const declaredLength = Number(getHeader(event, 'content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    throw new CampusError(413, 'UPLOAD_TOO_LARGE', 'Data unggahan melebihi ukuran yang dipesan.')
  }
  const chunks: Buffer[] = []
  let received = 0
  for await (const chunk of event.node.req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    received += bytes.byteLength
    if (received > limit) throw new CampusError(413, 'UPLOAD_TOO_LARGE', 'Data unggahan melebihi ukuran yang dipesan.')
    chunks.push(bytes)
  }
  if (received === 0) invalidInput('Isi file tidak boleh kosong.')
  const contentType = requireString(getHeader(event, 'content-type')?.split(';')[0], 'content-type', { max: 80 })
  await storeMockUploadContent(context, sessionId, Uint8Array.from(Buffer.concat(chunks, received)), contentType)
  return { uploaded: true, sizeBytes: received }
})
