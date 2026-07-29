import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const repositoryRoot = resolve(process.cwd())
const temporaryDirectories: string[] = []
const powerShellExecutable = ['pwsh', 'powershell'].find(executable => spawnSync(
  executable,
  ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'],
  { encoding: 'utf8' },
).status === 0)

function rotatedSecret(offset: number): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
  return alphabet.slice(offset) + alphabet.slice(0, offset)
}

function hostingerEnvironment(): Record<string, string> {
  const projectId = 'campus-production'
  const release = 'release-2026.07.27'
  const serviceAccount = Buffer.from(JSON.stringify({
    type: 'service_account',
    project_id: projectId,
    client_email: `runtime@${projectId}.iam.gserviceaccount.com`,
    private_key: '-----BEGIN PRIVATE KEY-----\ncontract-test-only\n-----END PRIVATE KEY-----\n',
  }), 'utf8').toString('base64')
  return {
    NODE_ENV: 'production',
    DEPLOYMENT_TARGET: 'hostinger',
    TRUSTED_PROXY_HOPS: '1',
    APP_FEATURE_PROFILE: 'full-campus',
    NUXT_PUBLIC_FEATURE_PROFILE: 'full-campus',
    APP_VERSION: release,
    NUXT_PUBLIC_APP_ENVIRONMENT: 'production',
    NUXT_PUBLIC_API_BASE_URL: '/api',
    NUXT_PUBLIC_DEMO_MODE: 'false',
    ENABLE_DEMO_AUTH: 'false',
    NUXT_SESSION_SECRET: rotatedSecret(0),
    RATE_LIMIT_KEY_SECRET: rotatedSecret(1),
    FILE_UPLOADS_ENABLED: 'true',
    EMAIL_DELIVERY_ENABLED: 'true',
    SENTRY_ENABLED: 'true',
    PASSWORD_RESET_CONTINUE_URL: 'https://lms.campus.ac.id/login',
    EMAIL_DELIVERY_ENDPOINT: 'https://mail.campus.ac.id/v1/send',
    EMAIL_DELIVERY_BEARER_TOKEN: rotatedSecret(2),
    EMAIL_FROM: 'noreply@campus.ac.id',
    EMAIL_WORKER_SECRET: rotatedSecret(3),
    FIREBASE_PROJECT_ID: projectId,
    FIREBASE_USE_APPLICATION_DEFAULT: 'false',
    FIREBASE_SERVICE_ACCOUNT_BASE64: serviceAccount,
    FIREBASE_SERVICE_ACCOUNT_JSON: '',
    FIREBASE_CLIENT_EMAIL: '',
    FIREBASE_PRIVATE_KEY: '',
    FIREBASE_ADMIN_CREDENTIALS_FILE: '',
    GOOGLE_APPLICATION_CREDENTIALS: '',
    FIREBASE_STORAGE_BUCKET: `${projectId}.firebasestorage.app`,
    FIRESTORE_EMULATOR_HOST: '',
    CAMPUS_DATA_MODE: 'firebase',
    ALLOW_PRODUCTION_MOCK: 'false',
    RATE_LIMIT_BACKEND: 'firestore',
    NUXT_PUBLIC_FIREBASE_API_KEY: 'public-firebase-api-key',
    NUXT_PUBLIC_FIREBASE_AUTH_DOMAIN: `${projectId}.firebaseapp.com`,
    NUXT_PUBLIC_FIREBASE_PROJECT_ID: projectId,
    NUXT_PUBLIC_FIREBASE_STORAGE_BUCKET: `${projectId}.firebasestorage.app`,
    NUXT_PUBLIC_FIREBASE_APP_ID: '1:123456789:web:abcdef',
    FILE_CURSOR_SECRET: rotatedSecret(4),
    FILE_QUOTA_BYTES: '262144000',
    CLAMAV_HOST: 'scanner.campus.internal',
    CLAMAV_PORT: '3310',
    SENTRY_DSN: 'https://server@example.ingest.sentry.io/1',
    NUXT_PUBLIC_SENTRY_DSN: 'https://browser@example.ingest.sentry.io/2',
    SENTRY_ENVIRONMENT: 'production',
    SENTRY_RELEASE: release,
    NUXT_PUBLIC_SENTRY_RELEASE: release,
    NUXT_PUBLIC_ANALYTICS_ENABLED: 'false',
    NUXT_PUBLIC_ANALYTICS_PRIVATE_ENABLED: 'false',
    PMB_PII_HASH_SECRET: rotatedSecret(5),
    TRACER_STUDY_PUBLIC_URL: 'https://tracer.campus.ac.id/respond',
    PAYMENT_GATEWAY_PROVIDER_ID: 'campus_bank',
    PAYMENT_GATEWAY_WEBHOOK_SECRET: rotatedSecret(6),
    PDDIKTI_CONTRACT_VERSION: 'campus-pddikti-gateway/2026-01',
    PDDIKTI_OPERATION_MAP_JSON: '{"student":"student-v1","lecturer":"lecturer-v1","course":"course-v1","class":"class-v1","grade":"grade-v1","student_activity":"student-activity-v1","graduation":"graduation-v1"}',
    PDDIKTI_ADAPTER_BASE_URL: 'https://pddikti-gateway.campus.ac.id/v1',
    PDDIKTI_ADAPTER_BEARER_TOKEN: rotatedSecret(7),
    PDDIKTI_WORKER_SECRET: rotatedSecret(8),
    APP_IMAGE: '',
    SERVER_NAME: '',
    TLS_FULLCHAIN_FILE: '',
    TLS_PRIVATE_KEY_FILE: '',
  }
}

function validateEnvironment(values: Record<string, string>) {
  const directory = mkdtempSync(join(tmpdir(), 'lms-hostinger-env-'))
  temporaryDirectories.push(directory)
  const file = join(directory, 'production.env')
  writeFileSync(file, Object.entries(values).map(([name, value]) => `${name}=${value}`).join('\n'), 'utf8')
  return spawnSync(powerShellExecutable!, [
    '-NoProfile',
    '-File',
    join(repositoryRoot, 'scripts', 'validate-env.ps1'),
    '-Path',
    file,
  ], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  })
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    if (resolve(directory).startsWith(resolve(tmpdir()))) rmSync(directory, { recursive: true, force: true })
  }
})

describe('Hostinger Nitro artifact contract', () => {
  it('pins the managed Node.js start entry and node-server output', () => {
    const packageJson = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
      engines: Record<string, string>
    }
    const nuxtConfig = readFileSync(join(repositoryRoot, 'nuxt.config.ts'), 'utf8')
    const template = readFileSync(join(repositoryRoot, 'config', 'hostinger.env.example'), 'utf8')
    const runbook = readFileSync(join(repositoryRoot, 'docs', 'hostinger-node-deployment.md'), 'utf8')

    expect(packageJson.scripts.start).toBe('node .output/server/index.mjs')
    expect(packageJson.engines.node).toContain('20.19.0')
    expect(nuxtConfig).toContain("preset: 'node-server'")
    expect(template).toContain('DEPLOYMENT_TARGET=hostinger')
    expect(template).toContain('NUXT_PUBLIC_FEATURE_PROFILE=full-campus')
    expect(template).toContain('FIREBASE_SERVICE_ACCOUNT_BASE64=')
    expect(template).not.toMatch(/^(?:PORT|NITRO_PORT)=/m)
    expect(runbook).toContain('Node.js `22.x`')
    expect(runbook).toContain('Hostinger injects `PORT`')
    expect(runbook).not.toContain('Install Nginx')
  })

  it('keeps the production PMB dashboard on live API data instead of workflow fixtures', () => {
    const dashboard = readFileSync(join(repositoryRoot, 'pages', 'pmb', 'index.vue'), 'utf8')

    expect(dashboard).toContain("'/admissions/applications'")
    expect(dashboard).toContain("'/admissions/catalog'")
    expect(dashboard).not.toContain("~/data/workflows")
    expect(dashboard).not.toContain('158 pendaftar')
  })
})

describe.runIf(Boolean(powerShellExecutable))('Hostinger production environment validation', () => {
  it('accepts base64 Firebase credentials without Docker image, TLS files, or mounted ADC', () => {
    const values = hostingerEnvironment()
    const result = validateEnvironment(values)
    const output = `${result.stdout}\n${result.stderr}`
    expect(result.status, output).toBe(0)
    expect(output).toContain('Production environment contract for hostinger is valid.')
    expect(output).not.toContain(values.FIREBASE_SERVICE_ACCOUNT_BASE64)
  })

  it('rejects malformed base64 credentials without echoing the supplied value', () => {
    const values = { ...hostingerEnvironment(), FIREBASE_SERVICE_ACCOUNT_BASE64: 'not-a-service-account' }
    const result = validateEnvironment(values)
    const output = `${result.stdout}\n${result.stderr}`
    expect(result.status).toBe(1)
    expect(output).toMatch(/FIREBASE_SERVICE_ACCOUNT_BASE64 must be valid\s+base64-encoded JSON\./)
    expect(output).not.toContain('not-a-service-account')
  })

  it('accepts a Firebase Spark pilot with uploads, email, and Sentry disabled', () => {
    const values = {
      ...hostingerEnvironment(),
      FILE_UPLOADS_ENABLED: 'false',
      EMAIL_DELIVERY_ENABLED: 'false',
      SENTRY_ENABLED: 'false',
      PASSWORD_RESET_CONTINUE_URL: '',
      EMAIL_DELIVERY_ENDPOINT: '',
      EMAIL_DELIVERY_BEARER_TOKEN: '',
      EMAIL_FROM: '',
      EMAIL_WORKER_SECRET: '',
      FIREBASE_STORAGE_BUCKET: '',
      NUXT_PUBLIC_FIREBASE_STORAGE_BUCKET: '',
      CLAMAV_HOST: '',
      SENTRY_DSN: '',
      NUXT_PUBLIC_SENTRY_DSN: '',
      SENTRY_RELEASE: '',
      NUXT_PUBLIC_SENTRY_RELEASE: '',
      TRACER_STUDY_PUBLIC_URL: '',
      PAYMENT_GATEWAY_PROVIDER_ID: '',
      PAYMENT_GATEWAY_WEBHOOK_SECRET: '',
      PDDIKTI_CONTRACT_VERSION: '',
      PDDIKTI_OPERATION_MAP_JSON: '',
      PDDIKTI_ADAPTER_BASE_URL: '',
      PDDIKTI_ADAPTER_BEARER_TOKEN: '',
      PDDIKTI_WORKER_SECRET: '',
    }
    const result = validateEnvironment(values)
    const output = `${result.stdout}\n${result.stderr}`
    expect(result.status, output).toBe(0)
    expect(output).toContain('Production environment contract for hostinger is valid.')
  })

  it('rejects capability casing that would be disabled by the runtime parser', () => {
    const values = {
      ...hostingerEnvironment(),
      FILE_UPLOADS_ENABLED: 'True',
    }
    const result = validateEnvironment(values)
    const output = `${result.stdout}\n${result.stderr}`
    expect(result.status).toBe(1)
    expect(output).toContain('FILE_UPLOADS_ENABLED must be true or false.')
  })

  it('rejects feature-profile casing that would diverge from exact runtime parsing', () => {
    const values = {
      ...hostingerEnvironment(),
      APP_FEATURE_PROFILE: 'LMS-MVP',
      NUXT_PUBLIC_FEATURE_PROFILE: 'LMS-MVP',
    }
    const result = validateEnvironment(values)
    const output = `${result.stdout}\n${result.stderr}`
    expect(result.status).toBe(1)
    expect(output).toContain('APP_FEATURE_PROFILE must be lms-mvp or full-campus.')
  })

  it('retains the immutable image and mounted-file requirements for Docker', () => {
    const values = {
      ...hostingerEnvironment(),
      DEPLOYMENT_TARGET: 'docker',
      FIREBASE_USE_APPLICATION_DEFAULT: 'true',
      FIREBASE_SERVICE_ACCOUNT_BASE64: '',
    }
    const result = validateEnvironment(values)
    const output = `${result.stdout}\n${result.stderr}`
    expect(result.status).toBe(1)
    expect(output).toContain('APP_IMAGE is required.')
    expect(output).toContain('FIREBASE_ADMIN_CREDENTIALS_FILE is required.')
    expect(output).toContain('TLS_FULLCHAIN_FILE is required.')
  })
})
