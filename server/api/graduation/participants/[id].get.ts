import { getRouterParam } from 'h3'
import { getGraduationParticipant } from '../../../services/graduation'
import { requireAuth } from '../../../utils/auth'
import { defineCampusHandler, markPrivateResponse } from '../../../utils/security'
import { requireString } from '../../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  const id = requireString(getRouterParam(event, 'id'), 'id', { max: 128 })
  return { participant: await getGraduationParticipant(await requireAuth(event), id) }
})
