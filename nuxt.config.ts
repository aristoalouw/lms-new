const publicCapabilityEnabled = (name: string) => {
  const configured = process.env[name]
  if (configured === 'true') return true
  if (configured === 'false') return false
  return process.env.NODE_ENV !== 'production'
}

const featureProfileFallback = 'full-campus'
const resolveFeatureProfile = (value: string | undefined) => value === 'full-campus' || value === 'lms-mvp'
  ? value
  : featureProfileFallback
const serverFeatureProfile = resolveFeatureProfile(process.env.APP_FEATURE_PROFILE)
const publicFeatureProfile = resolveFeatureProfile(process.env.NUXT_PUBLIC_FEATURE_PROFILE || serverFeatureProfile)
const publicAppName = process.env.NUXT_PUBLIC_APP_NAME || 'Nusa Campus'

export default defineNuxtConfig({
  compatibilityDate: '2026-01-15',
  builder: 'webpack',
  ssr: true,
  devtools: { enabled: false },
  components: [{ path: '~/components', pathPrefix: false }],
  css: [
    'bootstrap/dist/css/bootstrap.min.css',
    'choices.js/public/assets/styles/choices.min.css',
    'select2/dist/css/select2.min.css',
    'quill/dist/quill.snow.css',
    '~/assets/css/main.css',
  ],
  app: {
    head: {
      htmlAttrs: { lang: 'id' },
      titleTemplate: `%s · ${publicAppName}`,
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        { name: 'description', content: 'Sistem informasi kampus terpadu untuk layanan akademik, pembelajaran, keuangan, dan pelaporan.' },
        { name: 'theme-color', content: '#593660' },
        { name: 'referrer', content: 'strict-origin-when-cross-origin' },
      ],
      link: [
        { rel: 'stylesheet', href: '/vendor/unicons/css/line.css' },
      ],
    },
  },
  runtimeConfig: {
    appVersion: process.env.APP_VERSION || process.env.SENTRY_RELEASE || 'development',
    featureProfile: serverFeatureProfile,
    sessionSecret: process.env.NUXT_SESSION_SECRET || '',
    firebaseProjectId: process.env.FIREBASE_PROJECT_ID || '',
    firebaseClientEmail: process.env.FIREBASE_CLIENT_EMAIL || '',
    firebasePrivateKey: process.env.FIREBASE_PRIVATE_KEY || '',
    neoFeederBaseUrl: process.env.NEO_FEEDER_BASE_URL || '',
    neoFeederUsername: process.env.NEO_FEEDER_USERNAME || '',
    neoFeederPassword: process.env.NEO_FEEDER_PASSWORD || '',
    sentryDsn: process.env.SENTRY_DSN || '',
    sentryEnvironment: process.env.SENTRY_ENVIRONMENT || process.env.NUXT_PUBLIC_APP_ENVIRONMENT || 'development',
    sentryRelease: process.env.SENTRY_RELEASE || process.env.APP_VERSION || '',
    public: {
      featureProfile: publicFeatureProfile,
      appName: publicAppName,
      appEnvironment: process.env.NUXT_PUBLIC_APP_ENVIRONMENT || (process.env.NODE_ENV === 'production' ? 'production' : 'development'),
      supportEmail: process.env.NUXT_PUBLIC_SUPPORT_EMAIL || '',
      supportPhone: process.env.NUXT_PUBLIC_SUPPORT_PHONE || '',
      admissionsEmail: process.env.NUXT_PUBLIC_ADMISSIONS_EMAIL || '',
      privacyUrl: process.env.NUXT_PUBLIC_PRIVACY_URL || '',
      demoMode: process.env.NODE_ENV !== 'production' && process.env.NUXT_PUBLIC_DEMO_MODE !== 'false',
      apiBaseUrl: process.env.NUXT_PUBLIC_API_BASE_URL || '/api',
      firebaseApiKey: process.env.NUXT_PUBLIC_FIREBASE_API_KEY || '',
      firebaseAuthDomain: process.env.NUXT_PUBLIC_FIREBASE_AUTH_DOMAIN || '',
      firebaseProjectId: process.env.NUXT_PUBLIC_FIREBASE_PROJECT_ID || '',
      firebaseStorageBucket: process.env.NUXT_PUBLIC_FIREBASE_STORAGE_BUCKET || '',
      firebaseMessagingSenderId: process.env.NUXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '',
      firebaseAppId: process.env.NUXT_PUBLIC_FIREBASE_APP_ID || '',
      fileUploadsEnabled: publicCapabilityEnabled('FILE_UPLOADS_ENABLED'),
      emailDeliveryEnabled: publicCapabilityEnabled('EMAIL_DELIVERY_ENABLED'),
      sentryEnabled: publicCapabilityEnabled('SENTRY_ENABLED'),
      sentryDsn: process.env.NUXT_PUBLIC_SENTRY_DSN || '',
      sentryRelease: process.env.NUXT_PUBLIC_SENTRY_RELEASE || process.env.SENTRY_RELEASE || process.env.APP_VERSION || '',
      analyticsEnabled: process.env.NUXT_PUBLIC_ANALYTICS_ENABLED === 'true',
      analyticsPrivateEnabled: process.env.NUXT_PUBLIC_ANALYTICS_PRIVATE_ENABLED === 'true',
      googleAnalyticsId: process.env.NUXT_PUBLIC_GOOGLE_ANALYTICS_ID || '',
      googleTagManagerId: process.env.NUXT_PUBLIC_GOOGLE_TAG_MANAGER_ID || '',
      microsoftClarityId: process.env.NUXT_PUBLIC_MICROSOFT_CLARITY_ID || '',
      googleFontsEnabled: process.env.NUXT_PUBLIC_GOOGLE_FONTS_ENABLED === 'true',
    },
  },
  routeRules: {
    '/login': { headers: { 'cache-control': 'no-store, max-age=0' } },
    '/admin/**': { headers: { 'cache-control': 'no-store, private, max-age=0' } },
    '/akademik/**': { headers: { 'cache-control': 'no-store, private, max-age=0' } },
    '/evaluasi/**': { headers: { 'cache-control': 'no-store, private, max-age=0' } },
    '/impor/**': { headers: { 'cache-control': 'no-store, private, max-age=0' } },
    '/kelulusan/**': { headers: { 'cache-control': 'no-store, private, max-age=0' } },
    '/kemahasiswaan/**': { headers: { 'cache-control': 'no-store, private, max-age=0' } },
    '/keuangan/**': { headers: { 'cache-control': 'no-store, private, max-age=0' } },
    '/layanan/**': { headers: { 'cache-control': 'no-store, private, max-age=0' } },
    '/modul/**': { headers: { 'cache-control': 'no-store, private, max-age=0' } },
    '/pddikti/**': { headers: { 'cache-control': 'no-store, private, max-age=0' } },
    '/pembelajaran/**': { headers: { 'cache-control': 'no-store, private, max-age=0' } },
    '/pengguna/**': { headers: { 'cache-control': 'no-store, private, max-age=0' } },
    '/pmb/status': { headers: { 'cache-control': 'no-store, private, max-age=0' } },
    '/pmb/dokumen': { headers: { 'cache-control': 'no-store, private, max-age=0' } },
    '/pmb/kelola': { headers: { 'cache-control': 'no-store, private, max-age=0' } },
    '/pmb/seleksi': { headers: { 'cache-control': 'no-store, private, max-age=0' } },
    '/pmb/pengaturan': { headers: { 'cache-control': 'no-store, private, max-age=0' } },
    '/tracer-study/**': { headers: { 'cache-control': 'no-store, private, max-age=0' } },
    '/presensi': { headers: { 'cache-control': 'no-store, private, max-age=0' } },
    '/berkas/**': { headers: { 'cache-control': 'no-store, private, max-age=0' } },
    '/notifikasi/**': { headers: { 'cache-control': 'no-store, private, max-age=0' } },
    '/api/**': { headers: { 'cache-control': 'no-store, max-age=0' } },
    '/_nuxt/**': { headers: { 'cache-control': 'public, max-age=31536000, immutable' } },
  },
  nitro: {
    preset: 'node-server',
    compressPublicAssets: true,
  },
  webpack: {
    analyze: false,
    extractCSS: true,
    optimization: {
      splitChunks: {
        chunks: 'all',
      },
    },
  },
  typescript: {
    strict: true,
    typeCheck: false,
    tsConfig: {
      compilerOptions: {
        noUncheckedIndexedAccess: true,
        exactOptionalPropertyTypes: false,
      },
    },
  },
  sourcemap: {
    client: process.env.NUXT_PUBLIC_APP_ENVIRONMENT !== 'production',
    server: false,
  },
})
