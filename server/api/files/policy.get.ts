import { filePolicyDescriptor } from '../../modules/files'
import { requireAuth } from '../../utils/auth'
import { defineCampusHandler, markPrivateResponse } from '../../utils/security'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  await requireAuth(event)
  return filePolicyDescriptor()
})
