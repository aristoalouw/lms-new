import { getRouterParam, readBody } from 'h3'
import { submitAdmissionDocument } from '../../../../../services/admissions-documents'
import { requireAuth } from '../../../../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse, requireIdempotencyKey } from '../../../../../utils/security'
import { requireString } from '../../../../../utils/validation'

export default defineCampusHandler(async (event) => { markPrivateResponse(event); enforceCsrf(event); return submitAdmissionDocument(await requireAuth(event), requireString(getRouterParam(event, 'id'), 'id', { max: 128 }), await readBody(event), requireIdempotencyKey(event), event) })
