import { getQuery } from 'h3'
import { verifyGraduationDocument } from '../../../services/graduation-documents'
import { requireAuth } from '../../../utils/auth'
import { defineCampusHandler, markPrivateResponse } from '../../../utils/security'
import { requireString } from '../../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  const query = getQuery(event)
  return verifyGraduationDocument(await requireAuth(event), requireString(query.code, 'code', { max: 40 }))
})
