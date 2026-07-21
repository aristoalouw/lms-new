import { getRouterParam, send, setHeader } from 'h3'
import { resolveMockDownload } from '../../../services/files-storage'
import { defineCampusHandler, markPrivateResponse } from '../../../utils/security'
import { requireString } from '../../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  const token = requireString(getRouterParam(event, 'token'), 'token', { min: 40, max: 100, pattern: /^[A-Za-z0-9_-]+$/ })
  const download = resolveMockDownload(token)
  const asciiName = download.fileName.replace(/[^A-Za-z0-9._ -]/g, '_').replace(/["\\]/g, '_') || 'download'
  setHeader(event, 'content-type', download.contentType)
  setHeader(event, 'content-length', download.bytes.byteLength)
  setHeader(event, 'content-disposition', `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(download.fileName)}`)
  setHeader(event, 'x-content-type-options', 'nosniff')
  return send(event, Buffer.from(download.bytes))
})
