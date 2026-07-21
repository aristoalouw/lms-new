import { getQuery } from 'h3'
import { listPddiktiJobs } from '../../../services/pddikti'
import type { PddiktiJobStatus } from '../../../types/domain'
import { requireAuth } from '../../../utils/auth'
import { invalidInput } from '../../../utils/errors'
import { defineCampusHandler, markPrivateResponse } from '../../../utils/security'
import { optionalString, requireInteger } from '../../../utils/validation'

const STATUSES: PddiktiJobStatus[] = ['QUEUED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'DEAD_LETTER']

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  const context = await requireAuth(event)
  const query = getQuery(event)
  const status = typeof query.status === 'string' ? query.status as PddiktiJobStatus : undefined
  if (status && !STATUSES.includes(status)) invalidInput('status job tidak valid.')
  const limit = query.limit === undefined ? undefined : requireInteger(Number(query.limit), 'limit', 1, 100)
  const programStudyId = optionalString(query.programStudyId, 'programStudyId', 80)
  return { jobs: await listPddiktiJobs(context, { status, limit, programStudyId }) }
})
