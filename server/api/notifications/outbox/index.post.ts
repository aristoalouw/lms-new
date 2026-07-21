import { readBody } from 'h3'
import { enqueueNotification } from '../../../services/notifications'
import { requireAuth } from '../../../utils/auth'
import { invalidInput } from '../../../utils/errors'
import { defineCampusHandler, enforceCsrf, markPrivateResponse, requireIdempotencyKey } from '../../../utils/security'
import { optionalString, requireRecord, requireString } from '../../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  enforceCsrf(event)
  const context = await requireAuth(event)
  const body = requireRecord(await readBody(event))
  const rawVariables = requireRecord(body.variables, 'variables')
  const variables: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(rawVariables)) {
    if (!['string', 'number', 'boolean'].includes(typeof value)) invalidInput(`Variabel ${key} tidak valid.`)
    variables[key] = value as string | number | boolean
  }
  return enqueueNotification(context, {
    recipientUid: requireString(body.recipientUid, 'recipientUid', { max: 128 }),
    recipientEmail: optionalString(body.recipientEmail, 'recipientEmail', 254),
    programStudyId: optionalString(body.programStudyId, 'programStudyId', 100),
    templateKey: requireString(body.templateKey, 'templateKey', { max: 80 }), variables,
    actionPath: optionalString(body.actionPath, 'actionPath', 300),
  }, requireIdempotencyKey(event), event)
})
