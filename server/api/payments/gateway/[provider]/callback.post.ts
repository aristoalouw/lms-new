import { getHeader, getRouterParam, readRawBody } from 'h3'
import { processGatewayEvent, verifyGatewayWebhook } from '../../../../services/payment-gateway'
import { defineCampusHandler, markPrivateResponse } from '../../../../utils/security'
import { requireString } from '../../../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  const provider = requireString(getRouterParam(event, 'provider'), 'provider', { max: 40, pattern: /^[a-z][a-z0-9_-]+$/ })
  const rawBody = await readRawBody(event, 'utf8') || ''
  const verified = verifyGatewayWebhook({
    provider,
    rawBody,
    signature: getHeader(event, 'x-payment-signature'),
    timestamp: getHeader(event, 'x-payment-timestamp'),
    eventIdHeader: getHeader(event, 'x-payment-event-id'),
  })
  const result = await processGatewayEvent(verified, event)
  return {
    accepted: true,
    eventId: result.event.eventId,
    status: result.event.status,
    replayed: result.replayed,
  }
})
