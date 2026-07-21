import { getQuery } from 'h3'
import { listGraduationApplications } from '../../../services/graduation'
import type { GraduationApplicationStatus } from '../../../types/graduation'
import { requireAuth } from '../../../utils/auth'
import { defineCampusHandler, markPrivateResponse } from '../../../utils/security'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  const query = getQuery(event)
  return {
    applications: await listGraduationApplications(await requireAuth(event), {
      ...(typeof query.periodId === 'string' ? { periodId: query.periodId.slice(0, 128) } : {}),
      ...(typeof query.status === 'string' ? { status: query.status as GraduationApplicationStatus } : {}),
    }),
  }
})
