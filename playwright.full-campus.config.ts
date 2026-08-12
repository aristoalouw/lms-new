import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'full-campus.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['github']] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4174',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4174',
    url: 'http://127.0.0.1:4174/login',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...process.env,
      APP_FEATURE_PROFILE: 'full-campus',
      NUXT_PUBLIC_FEATURE_PROFILE: 'full-campus',
      CAMPUS_DATA_MODE: 'mock',
      ENABLE_DEMO_AUTH: 'true',
      NUXT_PUBLIC_DEMO_MODE: 'true',
      NUXT_PUBLIC_APP_ENVIRONMENT: 'test',
      FILE_UPLOADS_ENABLED: 'false',
      EMAIL_DELIVERY_ENABLED: 'false',
      SENTRY_ENABLED: 'false',
      EMAIL_WORKER_SECRET: 'playwright-email-worker-secret-not-for-production',
    },
  },
})
