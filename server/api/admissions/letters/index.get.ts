import { listAdmissionLetters } from '../../../services/admissions-selection'
import { requireAuth } from '../../../utils/auth'
import { defineCampusHandler, markPrivateResponse } from '../../../utils/security'

export default defineCampusHandler(async event => {
  markPrivateResponse(event)
  return { letters: await listAdmissionLetters(await requireAuth(event)) }
})
