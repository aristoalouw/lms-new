import { getRouterParam } from 'h3'
import { getGraduationDocument } from '../../../services/graduation-documents'
import { requireAuth } from '../../../utils/auth'
import { defineCampusHandler, markPrivateResponse } from '../../../utils/security'
import { requireString } from '../../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  const id = requireString(getRouterParam(event, 'id'), 'id', { max: 128 })
  return { document: await getGraduationDocument(await requireAuth(event), id) }
})
