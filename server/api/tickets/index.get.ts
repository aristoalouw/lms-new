import { getQuery } from 'h3'
import { listTickets } from '../../services/tickets'
import { TICKET_CATEGORIES, TICKET_STATUSES, type TicketCategory, type TicketStatus } from '../../types/communications'
import { requireAuth } from '../../utils/auth'
import { invalidInput } from '../../utils/errors'
import { defineCampusHandler, markPrivateResponse } from '../../utils/security'
import { requireInteger } from '../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  const context = await requireAuth(event)
  const query = getQuery(event)
  const status = typeof query.status === 'string' ? query.status as TicketStatus : undefined
  const category = typeof query.category === 'string' ? query.category as TicketCategory : undefined
  if (status && !TICKET_STATUSES.includes(status)) invalidInput('Status tiket tidak valid.')
  if (category && !TICKET_CATEGORIES.includes(category)) invalidInput('Kategori tiket tidak valid.')
  const limit = query.limit === undefined ? undefined : requireInteger(Number(query.limit), 'limit', 1, 100)
  return { tickets: await listTickets(context, { status, category, limit }) }
})
