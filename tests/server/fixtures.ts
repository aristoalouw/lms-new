import type { AuthContext, UserRole } from '../../server/types/auth'

export function authContext(
  uid: string,
  roles: UserRole[],
  programStudyIds: string[] = ['management-s1'],
): AuthContext {
  const now = Date.now()
  return {
    uid,
    email: `${uid}@example.test`,
    displayName: uid,
    roles,
    scope: { unitIds: ['faculty-economics'], programStudyIds, cohortYears: [], studentIds: [] },
    provider: 'demo',
    issuedAt: now,
    expiresAt: now + 60_000,
  }
}
