import { beforeEach, describe, expect, it } from 'vitest'
import { dashboardSummary } from '../../server/services/dashboard'
import { CampusError } from '../../server/utils/errors'
import { authContext } from './fixtures'

describe('dashboard section filtering', () => {
  beforeEach(() => {
    process.env.CAMPUS_DATA_MODE = 'mock'
  })

  it('shows finance metrics only to authorized roles', async () => {
    const finance = await dashboardSummary(authContext('finance-001', ['finance_staff']))
    expect(finance.sections.finance?.currency).toBe('IDR')
    expect(finance.sections.academic).toBeUndefined()

    const academic = await dashboardSummary(authContext('academic-001', ['academic_staff']))
    expect(academic.sections.academic?.activeStudents).toBeGreaterThan(0)
    expect(academic.sections.finance).toBeUndefined()
  })

  it('rejects a requested program outside staff custom-claim scope', async () => {
    await expect(dashboardSummary(authContext('academic-001', ['academic_staff']), { programStudyId: 'informatics-s1' }))
      .rejects.toMatchObject({ statusCode: 403 } satisfies Partial<CampusError>)
  })

  it('shows outcomes and accreditation only to authorized operational roles', async () => {
    const leader = await dashboardSummary(authContext('leader-001', ['leader'], []))
    expect(leader.sections.outcomes?.respondents).toBeGreaterThan(0)
    expect(leader.sections.accreditation?.institutionStatus).toBeTruthy()
    const finance = await dashboardSummary(authContext('finance-001', ['finance_staff']))
    expect(finance.sections.outcomes).toBeUndefined()
    expect(finance.sections.accreditation).toBeUndefined()
  })
})
