import { getQuery } from 'h3'
import { listAdmissionApplications } from '../../../services/admissions'
import type { AdmissionStatus } from '../../../types/admissions'
import { requireAuth } from '../../../utils/auth'
import { defineCampusHandler, markPrivateResponse } from '../../../utils/security'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  const context = await requireAuth(event)
  const query = getQuery(event)
  return listAdmissionApplications(context, {
    ...(typeof query.programStudyId === 'string' ? { programStudyId: query.programStudyId } : {}),
    ...(typeof query.status === 'string' ? { status: query.status as AdmissionStatus } : {}),
    ...(typeof query.waveId === 'string' ? { waveId: query.waveId } : {}),
    ...(typeof query.cursor === 'string' ? { cursor: query.cursor } : {}),
    ...(typeof query.limit === 'string' ? { limit: Number(query.limit) } : {}),
  })
})
