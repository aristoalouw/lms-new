import { getRouterParam } from 'h3'
import { getGraduationApplication } from '../../../services/graduation'
import { requireAuth } from '../../../utils/auth'
import { defineCampusHandler, markPrivateResponse } from '../../../utils/security'
import { requireString } from '../../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  const id = requireString(getRouterParam(event, 'id'), 'id', { max: 128 })
  return { application: await getGraduationApplication(await requireAuth(event), id) }
})
