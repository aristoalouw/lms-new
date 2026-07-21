import { listGraduationPeriods } from '../../../services/graduation'
import { requireAuth } from '../../../utils/auth'
import { defineCampusHandler, markPrivateResponse } from '../../../utils/security'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  return { periods: await listGraduationPeriods(await requireAuth(event)) }
})
