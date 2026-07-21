import { readBody } from 'h3'
import { createRpsVersion } from '../../../services/academic-administration'
import { requireAuth } from '../../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse, requireIdempotencyKey } from '../../../utils/security'

export default defineCampusHandler(async (event) => { markPrivateResponse(event); enforceCsrf(event); return createRpsVersion(await requireAuth(event), await readBody(event), requireIdempotencyKey(event), event) })
