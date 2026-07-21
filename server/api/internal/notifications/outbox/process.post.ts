import { createHash, timingSafeEqual } from 'node:crypto'
import { getHeader, readBody } from 'h3'
import { emailDeliveryAdapterFromEnvironment, emailWorkerSecretFingerprint } from '../../../../services/email-delivery'
import { deliverEmailOutboxRecord, listDeliverableEmailOutboxIds } from '../../../../services/notifications'
import { forbidden } from '../../../../utils/errors'
import { defineCampusHandler, markPrivateResponse } from '../../../../utils/security'
import { requireInteger, requireRecord } from '../../../../utils/validation'

function authenticateWorker(event: Parameters<typeof getHeader>[0]): void {
  const provided = getHeader(event, 'authorization')?.match(/^Bearer\s+(.+)$/i)?.[1] || ''
  const actual = Buffer.from(createHash('sha256').update(provided).digest('hex'))
  const expected = Buffer.from(emailWorkerSecretFingerprint())
  if (!provided || actual.length !== expected.length || !timingSafeEqual(actual, expected)) forbidden('Kredensial worker email tidak valid.')
}

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  authenticateWorker(event)
  const raw = await readBody(event)
  const body = raw === undefined || raw === null || raw === '' ? {} : requireRecord(raw)
  const limit = body.limit === undefined ? 5 : requireInteger(body.limit, 'limit', 1, 10)
  const ids = await listDeliverableEmailOutboxIds(limit)
  const adapter = emailDeliveryAdapterFromEnvironment()
  const results = await Promise.all(ids.map(async (id): Promise<{ id: string; status: string }> => {
    try {
      const record = await deliverEmailOutboxRecord(id, adapter)
      return { id, status: record.status }
    } catch {
      return { id, status: 'SKIPPED' }
    }
  }))
  return {
    processed: results.length,
    sent: results.filter(result => result.status === 'SENT').length,
    deferred: results.filter(result => result.status !== 'SENT').length,
    results,
  }
})
