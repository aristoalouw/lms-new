import { getRouterParam, setHeader } from 'h3'
import { exportLmsClassDataCsv } from '../../../../modules/classes'
import { requireAuth } from '../../../../utils/auth'
import { defineCampusHandler, markPrivateResponse } from '../../../../utils/security'
import { requireString } from '../../../../utils/validation'

export default defineCampusHandler(async event => {
  markPrivateResponse(event)
  const result = await exportLmsClassDataCsv(
    await requireAuth(event),
    requireString(getRouterParam(event, 'id'), 'id', {
      max: 128,
      pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]*$/,
    }),
    event,
  )
  const safeName = result.fileName.replace(/[^A-Za-z0-9._-]/g, '_')
  setHeader(event, 'content-type', 'text/csv; charset=utf-8')
  setHeader(event, 'content-disposition', `attachment; filename="${safeName}"`)
  setHeader(event, 'x-content-type-options', 'nosniff')
  return result.content
})
