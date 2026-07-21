import { getQuery, getRouterParam } from 'h3'
import { getSemesterResult } from '../../../services/academic-administration'
import { requireAuth } from '../../../utils/auth'
import { defineCampusHandler, markPrivateResponse } from '../../../utils/security'
import { requireString } from '../../../utils/validation'

export default defineCampusHandler(async (event) => { markPrivateResponse(event); return getSemesterResult(await requireAuth(event), requireString(getRouterParam(event, 'studentId'), 'studentId', { max: 128 }), requireString(getQuery(event).periodId, 'periodId', { max: 40 })) })
