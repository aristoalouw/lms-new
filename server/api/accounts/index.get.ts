import { getQuery } from 'h3'
import { listAccounts, parseAccountListQuery } from '../../services/accounts'
import { requireAuth } from '../../utils/auth'
import { defineCampusHandler, markPrivateResponse } from '../../utils/security'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  const context = await requireAuth(event)
  return listAccounts(context, parseAccountListQuery(getQuery(event)))
})
