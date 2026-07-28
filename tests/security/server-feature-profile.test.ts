import { afterEach, describe, expect, it } from 'vitest'
import { isPageRequestPath, serverFeatureProfile } from '../../server/utils/feature-profile'

const originalNodeEnvironment = process.env.NODE_ENV
const originalFeatureProfile = process.env.APP_FEATURE_PROFILE

afterEach(() => {
  if (originalNodeEnvironment === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = originalNodeEnvironment
  if (originalFeatureProfile === undefined) delete process.env.APP_FEATURE_PROFILE
  else process.env.APP_FEATURE_PROFILE = originalFeatureProfile
})

describe('server feature profile resolution', () => {
  it('fails closed to LMS MVP in production when the value is missing or invalid', () => {
    process.env.NODE_ENV = 'production'
    delete process.env.APP_FEATURE_PROFILE
    expect(serverFeatureProfile()).toBe('lms-mvp')

    process.env.APP_FEATURE_PROFILE = 'typo'
    expect(serverFeatureProfile()).toBe('lms-mvp')
  })

  it('allows full campus only when explicitly configured in production', () => {
    process.env.NODE_ENV = 'production'
    process.env.APP_FEATURE_PROFILE = 'full-campus'
    expect(serverFeatureProfile()).toBe('full-campus')
  })

  it('recognizes extensionless page requests without trusting the Accept header', () => {
    expect(isPageRequestPath('/keuangan', 'GET')).toBe(true)
    expect(isPageRequestPath('/pmb/informasi', 'HEAD')).toBe(true)
    expect(isPageRequestPath('/layanan/dokumen.pdf', 'GET')).toBe(true)
    expect(isPageRequestPath('/_nuxt/app.js', 'GET')).toBe(false)
    expect(isPageRequestPath('/vendor/unicons/font.woff2', 'GET')).toBe(false)
    expect(isPageRequestPath('/api/health', 'GET')).toBe(false)
    expect(isPageRequestPath('/pmb', 'POST')).toBe(false)
  })
})
