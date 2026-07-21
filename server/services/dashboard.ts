import { MOCK_DASHBOARD } from '../data/mock-data'
import type { AuthContext } from '../types/auth'
import type { DashboardSnapshot } from '../types/domain'
import { notFound, serviceUnavailable } from '../utils/errors'
import { dataMode, firestoreAdmin } from '../utils/firebase-admin'
import { can, filterProgramScope, requirePermission } from '../utils/rbac'
import { normalizeFeatureProfile } from '../../shared/features'

export interface DashboardSummary {
  periodId: string
  updatedAt: string
  filter: { programStudyId?: string }
  sections: Partial<Pick<DashboardSnapshot, 'academic' | 'finance' | 'admissions' | 'pddikti' | 'outcomes' | 'accreditation'>>
}

export async function dashboardSummary(
  context: AuthContext,
  filter: { periodId?: string; programStudyId?: string } = {},
): Promise<DashboardSummary> {
  requirePermission(context, 'dashboard:view')
  const periodId = filter.periodId || MOCK_DASHBOARD.periodId
  const programStudyId = filterProgramScope(context, filter.programStudyId)

  let snapshot: DashboardSnapshot
  if (dataMode() === 'mock') {
    snapshot = structuredClone({ ...MOCK_DASHBOARD, periodId })
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan dashboard tidak tersedia.')
    const suffix = programStudyId ? `__${programStudyId}` : ''
    const document = await db.collection('dashboardSnapshots').doc(`${periodId}${suffix}`).get()
    if (!document.exists) notFound('Snapshot dashboard')
    snapshot = document.data() as DashboardSnapshot
  }

  const sections: DashboardSummary['sections'] = {}
  if (can(context, 'dashboard:view_academic')) sections.academic = snapshot.academic
  if (normalizeFeatureProfile(process.env.APP_FEATURE_PROFILE) === 'lms-mvp') {
    return {
      periodId: snapshot.periodId,
      updatedAt: snapshot.updatedAt,
      filter: { ...(programStudyId ? { programStudyId } : {}) },
      sections,
    }
  }
  if (can(context, 'dashboard:view_finance')) sections.finance = snapshot.finance
  if (can(context, 'dashboard:view_admissions')) sections.admissions = snapshot.admissions
  if (can(context, 'dashboard:view_pddikti')) sections.pddikti = snapshot.pddikti
  if (can(context, 'dashboard:view_outcomes')) sections.outcomes = snapshot.outcomes
  if (can(context, 'dashboard:view_accreditation')) sections.accreditation = snapshot.accreditation

  return {
    periodId: snapshot.periodId,
    updatedAt: snapshot.updatedAt,
    filter: { ...(programStudyId ? { programStudyId } : {}) },
    sections,
  }
}
