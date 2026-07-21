import { readBody } from 'h3'
import { updateNotificationPreferences } from '../../services/notifications'
import { NOTIFICATION_CATEGORIES, type NotificationCategory } from '../../types/communications'
import { requireAuth } from '../../utils/auth'
import { invalidInput } from '../../utils/errors'
import { defineCampusHandler, enforceCsrf, markPrivateResponse } from '../../utils/security'
import { optionalString, requireRecord } from '../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  enforceCsrf(event)
  const context = await requireAuth(event)
  const body = requireRecord(await readBody(event))
  if (typeof body.inAppEnabled !== 'boolean' || typeof body.emailEnabled !== 'boolean') invalidInput('Preferensi kanal harus berupa boolean.')
  const rawCategories = requireRecord(body.categoryEmail, 'categoryEmail')
  const categoryEmail = Object.fromEntries(NOTIFICATION_CATEGORIES.map(category => {
    if (typeof rawCategories[category] !== 'boolean') invalidInput(`Preferensi ${category} harus berupa boolean.`)
    return [category, rawCategories[category]]
  })) as Record<NotificationCategory, boolean>
  const quiet = body.quietHours === undefined ? undefined : requireRecord(body.quietHours, 'quietHours')
  return updateNotificationPreferences(context, {
    inAppEnabled: body.inAppEnabled,
    emailEnabled: body.emailEnabled,
    categoryEmail,
    ...(quiet ? { quietHours: {
      start: optionalString(quiet.start, 'quietHours.start', 5) ?? '',
      end: optionalString(quiet.end, 'quietHours.end', 5) ?? '',
      timezone: optionalString(quiet.timezone, 'quietHours.timezone', 50) ?? '',
    } } : {}),
  }, event)
})
