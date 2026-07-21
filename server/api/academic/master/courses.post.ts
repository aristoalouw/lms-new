import { readBody } from 'h3'
import { createAcademicCourseVersion } from '../../../services/academic-administration'
import { requireAuth } from '../../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse, requireIdempotencyKey } from '../../../utils/security'
export default defineCampusHandler(async event => { markPrivateResponse(event); enforceCsrf(event); return createAcademicCourseVersion(await requireAuth(event), await readBody(event), requireIdempotencyKey(event), event) })
