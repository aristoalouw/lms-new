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

export function normalizeFeatureProfile(value: unknown): FeatureProfile {
  return value === 'lms-mvp' ? 'lms-mvp' : 'full-campus'
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
  ['/layanan', 'services'], ['/impor', 'imports'], ['/login', 'auth'],
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

const MVP_EXCLUDED_API_PATTERNS: readonly RegExp[] = [
  /^\/api\/learning\/spaces\/[^/]+\/gamification$/,
  /^\/api\/learning\/materials\/[^/]+\/duplicate$/,
  /^\/api\/academic\/classes\/[^/]+\/(?:journals|grade-components|grades|results)(?:\/|$)/,
  /^\/api\/notifications\/(?:outbox|templates|preferences)(?:\/|$)/,
  /^\/api\/internal\/notifications\/outbox(?:\/|$)/,
]

export function isMvpApiAllowed(path: string, method = 'GET'): boolean {
  if (method.toUpperCase() === 'POST' && path === '/api/learning/spaces') return false
  return !MVP_EXCLUDED_API_PATTERNS.some(pattern => pattern.test(path))
}
