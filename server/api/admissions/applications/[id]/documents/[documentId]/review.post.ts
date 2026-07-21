import { getRouterParam, readBody } from 'h3'
import { reviewAdmissionDocument } from '../../../../../../services/admissions-documents'
import { requireAuth } from '../../../../../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse } from '../../../../../../utils/security'
import { requireString } from '../../../../../../utils/validation'

export default defineCampusHandler(async (event) => { markPrivateResponse(event); enforceCsrf(event); return reviewAdmissionDocument(await requireAuth(event), requireString(getRouterParam(event, 'id'), 'id', { max: 128 }), requireString(getRouterParam(event, 'documentId'), 'documentId', { max: 128 }), await readBody(event), event) })
