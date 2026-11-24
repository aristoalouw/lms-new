export const FEATURE_PROFILES = ['full-campus', 'lms-mvp'] as const
export type FeatureProfile = (typeof FEATURE_PROFILES)[number]

export const FEATURES = [
  'auth', 'dashboard', 'accounts', 'classes', 'learning', 'files',
  'notifications', 'audit', 'health', 'academic-admin', 'krs', 'admissions',
  'finance', 'pddikti', 'student-affairs', 'evaluation', 'graduation',
  'tracer-study', 'services', 'imports',
] as const
export type Feature = (typeof FEATURES)[number]

const MVP_FEATURES: readonly Feature[] = [
  'auth', 'dashboard', 'accounts', 'classes', 'learning', 'files',
  'notifications', 'audit', 'health',
]

export function normalizeFeatureProfile(value: unknown, fallback: FeatureProfile = 'full-campus'): FeatureProfile {
  if (value === 'lms-mvp' || value === 'full-campus') return value
  return fallback
}

export function isFeatureEnabled(profile: FeatureProfile, feature: Feature): boolean {
  return profile === 'full-campus' || MVP_FEATURES.includes(feature)
}

const pagePrefixes: ReadonlyArray<readonly [string, Feature]> = [
  ['/admin/pengguna', 'accounts'], ['/admin/kelas', 'classes'],
  ['/akademik/kelas', 'classes'], ['/akademik/krs', 'krs'],
  ['/akademik', 'academic-admin'], ['/pembelajaran', 'learning'],
  ['/presensi', 'learning'], ['/pengguna', 'accounts'], ['/berkas', 'files'],
  ['/notifikasi', 'notifications'], ['/modul/notifikasi', 'notifications'],
  ['/modul/audit-backup', 'audit'], ['/modul/pengaturan', 'accounts'],
  ['/modul', 'services'],
  ['/pmb', 'admissions'], ['/keuangan', 'finance'], ['/pddikti', 'pddikti'],
  ['/kemahasiswaan', 'student-affairs'], ['/evaluasi', 'evaluation'],
  ['/kelulusan', 'graduation'], ['/tracer-study', 'tracer-study'],
  ['/layanan', 'services'], ['/impor', 'imports'], ['/profil', 'auth'], ['/login', 'auth'],
  ['/', 'dashboard'],
]

const apiPrefixes: ReadonlyArray<readonly [string, Feature]> = [
  ['/api/academic/classes', 'classes'], ['/api/accounts', 'accounts'],
  ['/api/auth', 'auth'], ['/api/dashboard', 'dashboard'], ['/api/learning', 'learning'],
  ['/api/files', 'files'], ['/api/internal', 'files'], ['/api/notifications', 'notifications'],
  ['/api/audit', 'audit'], ['/api/health', 'health'], ['/api/ready', 'health'],
  ['/api/krs', 'krs'], ['/api/academic', 'academic-admin'],
  ['/api/admissions', 'admissions'], ['/api/billing', 'finance'],
  ['/api/payments', 'finance'], ['/api/pddikti', 'pddikti'],
  ['/api/student-affairs', 'student-affairs'], ['/api/evaluations', 'evaluation'],
  ['/api/graduation', 'graduation'], ['/api/tracer-study', 'tracer-study'],
  ['/api/tickets', 'services'], ['/api/imports', 'imports'],
]

function featureForPrefix(path: string, prefixes: ReadonlyArray<readonly [string, Feature]>): Feature | undefined {
  return prefixes.find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`))?.[1]
}

export function featureForPagePath(path: string): Feature | undefined {
  return featureForPrefix(path, pagePrefixes)
}

export function featureForApiPath(path: string): Feature | undefined {
  return featureForPrefix(path, apiPrefixes)
}

export const MVP_ALLOWED_PAGE_ROUTES = [
  '/',
  '/login',
  '/profil',
  '/admin/pengguna',
  '/admin/kelas',
  '/admin/kelas/:classId',
  '/berkas',
  '/notifikasi',
  '/pembelajaran',
  '/pembelajaran/:spaceId',
  '/pembelajaran/:spaceId/materi',
  '/pembelajaran/:spaceId/tugas',
  '/pembelajaran/:spaceId/tugas/:assignmentId',
  '/pembelajaran/:spaceId/diskusi',
  '/pembelajaran/:spaceId/presensi',
  '/pembelajaran/:spaceId/kelola',
  '/presensi',
  '/modul/audit-backup',
] as const

export const MVP_PAGE_REDIRECTS = {
  '/pengguna': '/admin/pengguna',
  '/akademik/kelas': '/admin/kelas',
} as const

export const MVP_ALLOWED_API_ROUTES = [
  'GET /api/accounts',
  'POST /api/accounts',
  'PATCH /api/accounts/:id',
  'GET /api/accounts/access-change-requests',
  'POST /api/accounts/access-change-requests/:requestId/approve',
  'POST /api/accounts/access-change-requests/:requestId/reject',
  'POST /api/accounts/:id/access-change-requests',
  'GET /api/academic/classes',
  'POST /api/academic/classes',
  'GET /api/academic/classes/catalog',
  'POST /api/academic/classes/catalog/programs',
  'POST /api/academic/classes/catalog/courses',
  'POST /api/academic/classes/catalog/periods',
  'GET /api/academic/classes/:id',
  'PATCH /api/academic/classes/:id',
  'GET /api/academic/classes/:id/attendance',
  'GET /api/academic/classes/:id/export',
  'POST /api/academic/classes/:id/attendance/challenges',
  'POST /api/academic/classes/:id/attendance/check-in',
  'POST /api/academic/classes/:id/attendance/corrections',
  'GET /api/academic/classes/:id/enrollments',
  'POST /api/academic/classes/:id/enrollments',
  'PATCH /api/academic/classes/:id/enrollments/:studentId',
  'GET /api/audit',
  'POST /api/auth/demo-login',
  'GET /api/auth/demo-profiles',
  'POST /api/auth/logout',
  'POST /api/auth/password-reset/request',
  'DELETE /api/auth/session',
  'GET /api/auth/session',
  'POST /api/auth/session',
  'POST /api/auth/session/revoke',
  'GET /api/files',
  'DELETE /api/files/:id',
  'GET /api/files/:id',
  'POST /api/files/:id/download',
  'POST /api/files/:id/scan',
  'GET /api/files/downloads/:token',
  'GET /api/files/policy',
  'POST /api/files/upload-sessions',
  'PUT /api/files/upload-sessions/:id/content',
  'POST /api/files/upload-sessions/:id/finalize',
  'GET /api/health',
  'POST /api/internal/notifications/outbox/process',
  'PATCH /api/learning/announcements/:id',
  'PUT /api/learning/assignments/:id',
  'GET /api/learning/assignments/:id/attempts',
  'PUT /api/learning/assignments/:id/draft',
  'GET /api/learning/assignments/:id/submissions',
  'POST /api/learning/assignments/:id/submit',
  'PUT /api/learning/attempts/:id/grade',
  'PUT /api/learning/forum/posts/:id',
  'POST /api/learning/forum/posts/:id/moderate',
  'PUT /api/learning/forum/threads/:id',
  'POST /api/learning/forum/threads/:id/moderate',
  'GET /api/learning/forum/threads/:id/posts',
  'POST /api/learning/forum/threads/:id/posts',
  'PUT /api/learning/materials/:id',
  'PUT /api/learning/modules/:id',
  'GET /api/learning/spaces',
  'GET /api/learning/spaces/:id',
  'POST /api/learning/spaces/:id/announcements',
  'POST /api/learning/spaces/:id/assignments',
  'GET /api/learning/spaces/:id/dashboard',
  'GET /api/learning/spaces/:id/forum/threads',
  'POST /api/learning/spaces/:id/forum/threads',
  'POST /api/learning/spaces/:id/materials',
  'POST /api/learning/spaces/:id/modules',
  'GET /api/notifications',
  'GET /api/notifications/:id',
  'POST /api/notifications/:id/read',
  'GET /api/notifications/outbox',
  'POST /api/notifications/outbox/:id/retry',
  'GET /api/notifications/preferences',
  'PUT /api/notifications/preferences',
  'GET /api/notifications/templates',
  'GET /api/ready',
] as const

export const MVP_DENIED_API_ROUTES = [
  'GET /api/dashboard/export',
  'GET /api/dashboard/summary',
  'PUT /api/academic/classes/:id/grade-components',
  'PUT /api/academic/classes/:id/grades/:studentId',
  'POST /api/academic/classes/:id/grades/publish',
  'POST /api/academic/classes/:id/journals',
  'GET /api/academic/classes/:id/results/me',
  'POST /api/learning/materials/:id/duplicate',
  'POST /api/learning/spaces',
  'PUT /api/learning/spaces/:id/gamification',
  'POST /api/notifications/outbox',
  'PUT /api/notifications/templates/:key',
] as const

export type MvpApiDecision = 'allowed' | 'denied' | 'feature-disabled' | 'unknown'

function routeTemplatePattern(template: string): RegExp {
  const pattern = template
    .split('/')
    .map(segment => segment.startsWith(':') ? '[^/]+' : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('/')
  return new RegExp(`^${pattern}/?$`)
}

function compileApiPolicies(keys: readonly string[], decision: 'allowed' | 'denied') {
  return keys.map((key) => {
    const separator = key.indexOf(' ')
    return {
      method: key.slice(0, separator),
      pattern: routeTemplatePattern(key.slice(separator + 1)),
      decision,
    }
  })
}

const mvpApiPolicies = [
  ...compileApiPolicies(MVP_DENIED_API_ROUTES, 'denied'),
  ...compileApiPolicies(MVP_ALLOWED_API_ROUTES, 'allowed'),
]

const mvpPagePatterns = MVP_ALLOWED_PAGE_ROUTES.map(routeTemplatePattern)

export function isMvpPageAllowed(path: string): boolean {
  return mvpPagePatterns.some(pattern => pattern.test(path))
}

export function mvpApiDecision(path: string, method = 'GET'): MvpApiDecision {
  const normalizedMethod = method.toUpperCase() === 'HEAD' ? 'GET' : method.toUpperCase()
  const policy = mvpApiPolicies.find(candidate => candidate.method === normalizedMethod && candidate.pattern.test(path))
  if (policy) return policy.decision
  const feature = featureForApiPath(path)
  if (feature && !isFeatureEnabled('lms-mvp', feature)) return 'feature-disabled'
  return 'unknown'
}

export function isMvpApiAllowed(path: string, method = 'GET'): boolean {
  return mvpApiDecision(path, method) === 'allowed'
}
