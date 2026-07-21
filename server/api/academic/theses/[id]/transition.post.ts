import { getRouterParam, readBody } from 'h3'
import { transitionThesis } from '../../../../services/academic-administration'
import { requireAuth } from '../../../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse } from '../../../../utils/security'
import { requireString } from '../../../../utils/validation'

export default defineCampusHandler(async (event) => { markPrivateResponse(event); enforceCsrf(event); return transitionThesis(await requireAuth(event), requireString(getRouterParam(event, 'id'), 'id', { max: 128 }), await readBody(event), event) })
