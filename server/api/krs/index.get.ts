import { getQuery } from 'h3'
import type { KrsStatus } from '../../types/domain'
import { listKrsForReview } from '../../services/krs'
import { requireAuth } from '../../utils/auth'
import { invalidInput } from '../../utils/errors'
import { defineCampusHandler, markPrivateResponse } from '../../utils/security'
import { optionalString } from '../../utils/validation'

const ALLOWED_STATUSES = new Set(['ALL', 'DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'])

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  const context = await requireAuth(event)
  const query = getQuery(event)
  const periodId = optionalString(query.periodId, 'periodId', 120)
  const programStudyId = optionalString(query.programStudyId, 'programStudyId', 120)
  const rawStatus = optionalString(query.status, 'status', 20)?.toUpperCase()
  if (rawStatus && !ALLOWED_STATUSES.has(rawStatus)) {
    invalidInput('status harus ALL, DRAFT, SUBMITTED, APPROVED, atau REJECTED.')
  }
  return listKrsForReview(context, {
    periodId,
    programStudyId,
    status: (rawStatus as KrsStatus | 'ALL' | undefined) ?? 'ALL',
  })
})
