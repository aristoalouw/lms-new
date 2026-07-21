import { readBody } from 'h3'
import { submitStudentDataChange } from '../../../services/pddikti-student-data'
import { requireAuth } from '../../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse, requireIdempotencyKey } from '../../../utils/security'

export default defineCampusHandler(async (event) => { markPrivateResponse(event); enforceCsrf(event); return submitStudentDataChange(await requireAuth(event), await readBody(event), requireIdempotencyKey(event), event) })
