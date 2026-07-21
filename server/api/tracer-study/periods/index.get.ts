import { listTracerPeriods } from '../../../services/tracer-study'
import { requireAuth } from '../../../utils/auth'
import { defineCampusHandler, markPrivateResponse } from '../../../utils/security'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  return { periods: await listTracerPeriods(await requireAuth(event)) }
})
