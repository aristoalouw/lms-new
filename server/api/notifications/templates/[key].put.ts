import { getRouterParam, readBody } from 'h3'
import { upsertNotificationTemplate } from '../../../services/notifications'
import type { NotificationCategory } from '../../../types/communications'
import { requireAuth } from '../../../utils/auth'
import { invalidInput } from '../../../utils/errors'
import { defineCampusHandler, enforceCsrf, markPrivateResponse } from '../../../utils/security'
import { requireInteger, requireRecord, requireString } from '../../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  enforceCsrf(event)
  const context = await requireAuth(event)
  const key = requireString(getRouterParam(event, 'key'), 'key', { max: 80, pattern: /^[a-z][a-z0-9-]+$/ })
  const body = requireRecord(await readBody(event))
  if (!Array.isArray(body.channels) || body.channels.some(channel => channel !== 'IN_APP' && channel !== 'EMAIL')) invalidInput('channels tidak valid.')
  if (typeof body.active !== 'boolean') invalidInput('active harus berupa boolean.')
  return upsertNotificationTemplate(context, key, {
    name: requireString(body.name, 'name', { max: 120 }), category: requireString(body.category, 'category', { max: 30 }) as NotificationCategory,
    titleTemplate: requireString(body.titleTemplate, 'titleTemplate', { max: 180 }), bodyTemplate: requireString(body.bodyTemplate, 'bodyTemplate', { max: 1_000 }),
    emailSubjectTemplate: requireString(body.emailSubjectTemplate, 'emailSubjectTemplate', { max: 180 }),
    emailBodyTemplate: requireString(body.emailBodyTemplate, 'emailBodyTemplate', { max: 4_000 }),
    channels: body.channels as Array<'IN_APP' | 'EMAIL'>, active: body.active,
    expectedVersion: body.expectedVersion === undefined ? undefined : requireInteger(body.expectedVersion, 'expectedVersion', 0),
  }, event)
})
