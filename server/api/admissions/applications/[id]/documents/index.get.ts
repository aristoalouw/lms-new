import { getRouterParam } from 'h3'
import { getAdmissionDocumentWorkspace } from '../../../../../services/admissions-documents'
import { requireAuth } from '../../../../../utils/auth'
import { defineCampusHandler, markPrivateResponse } from '../../../../../utils/security'
import { requireString } from '../../../../../utils/validation'

export default defineCampusHandler(async (event) => { markPrivateResponse(event); return getAdmissionDocumentWorkspace(await requireAuth(event), requireString(getRouterParam(event, 'id'), 'id', { max: 128 })) })
