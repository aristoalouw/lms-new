import { getQuery } from 'h3'
import { listPrivateFiles } from '../../modules/files'
import { FILE_MIME_TYPES, FILE_STATES, type AllowedFileMimeType, type FileState } from '../../types/files'
import { requireAuth } from '../../utils/auth'
import { invalidInput } from '../../utils/errors'
import { defineCampusHandler, markPrivateResponse } from '../../utils/security'
import { requireInteger, requireString } from '../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  const context = await requireAuth(event)
  const query = getQuery(event)
  const status = query.status === undefined ? undefined : requireString(query.status, 'status', { max: 20 }) as FileState
  if (status && !FILE_STATES.includes(status)) invalidInput('status file tidak valid.')
  const mimeType = query.mimeType === undefined
    ? undefined
    : requireString(query.mimeType, 'mimeType', { max: 80 }) as AllowedFileMimeType
  if (mimeType && !FILE_MIME_TYPES.includes(mimeType)) invalidInput('mimeType file tidak valid.')
  const scope = query.scope === undefined ? 'owned' : requireString(query.scope, 'scope', { max: 20 })
  if (!['owned', 'accessible', 'all'].includes(scope)) invalidInput('scope daftar file tidak valid.')
  const limit = query.limit === undefined ? 20 : requireInteger(Number(query.limit), 'limit', 1, 50)
  const search = query.search === undefined ? undefined : requireString(query.search, 'search', { max: 100 })
  const cursor = query.cursor === undefined ? undefined : requireString(query.cursor, 'cursor', { max: 500 })
  const includeDeleted = query.includeDeleted === 'true'
  return listPrivateFiles(context, {
    status,
    mimeType,
    scope: scope as 'owned' | 'accessible' | 'all',
    limit,
    search,
    cursor,
    includeDeleted,
  })
})
