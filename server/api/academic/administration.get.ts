import { getQuery } from 'h3'
import { getAcademicAdministrationWorkspace } from '../../services/academic-administration'
import { requireAuth } from '../../utils/auth'
import { defineCampusHandler, markPrivateResponse } from '../../utils/security'
import { optionalString } from '../../utils/validation'

export default defineCampusHandler(async (event) => { markPrivateResponse(event); return getAcademicAdministrationWorkspace(await requireAuth(event), optionalString(getQuery(event).studentId, 'studentId', 128)) })
