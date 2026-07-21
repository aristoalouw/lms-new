import { readBody } from 'h3'
import { createMbkmActivity } from '../../../services/academic-administration'
import { requireAuth } from '../../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse, requireIdempotencyKey } from '../../../utils/security'

export default defineCampusHandler(async (event) => { markPrivateResponse(event); enforceCsrf(event); return createMbkmActivity(await requireAuth(event), await readBody(event), requireIdempotencyKey(event), event) })
