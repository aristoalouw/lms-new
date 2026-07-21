import { getRouterParam, readBody } from 'h3'
import { addMbkmLog } from '../../../../services/academic-administration'
import { requireAuth } from '../../../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse, requireIdempotencyKey } from '../../../../utils/security'
import { requireString } from '../../../../utils/validation'

export default defineCampusHandler(async (event) => { markPrivateResponse(event); enforceCsrf(event); return addMbkmLog(await requireAuth(event), requireString(getRouterParam(event, 'id'), 'id', { max: 128 }), await readBody(event), requireIdempotencyKey(event), event) })
