import { afterEach, describe, expect, it } from 'vitest'
import {
  createDemoSession,
  isDemoAuthEnabled,
  verifyDemoSessionToken,
} from '../../server/utils/auth'

const originalNodeEnv = process.env.NODE_ENV
const originalDemoFlag = process.env.ENABLE_DEMO_AUTH
const originalFeatureProfile = process.env.APP_FEATURE_PROFILE

afterEach(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = originalNodeEnv
  if (originalDemoFlag === undefined) delete process.env.ENABLE_DEMO_AUTH
  else process.env.ENABLE_DEMO_AUTH = originalDemoFlag
  if (originalFeatureProfile === undefined) delete process.env.APP_FEATURE_PROFILE
  else process.env.APP_FEATURE_PROFILE = originalFeatureProfile
})

describe('demo authentication safety', () => {
  it('signs only allowlisted profiles and rejects a tampered session', () => {
    process.env.NODE_ENV = 'test'
    process.env.ENABLE_DEMO_AUTH = 'true'
    const { context, token } = createDemoSession('advisor')
    expect(context).toMatchObject({ uid: 'advisor-001', roles: ['lecturer', 'advisor'], provider: 'demo' })
    expect(verifyDemoSessionToken(token)?.uid).toBe('advisor-001')

    const tampered = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`
    expect(verifyDemoSessionToken(tampered)).toBeNull()
  })

  it('cannot be enabled in production', () => {
    process.env.NODE_ENV = 'production'
    process.env.ENABLE_DEMO_AUTH = 'true'
    expect(isDemoAuthEnabled()).toBe(false)
    expect(() => createDemoSession('admin')).toThrow()
  })

  it('filters every authenticated context to the three LMS MVP roles', () => {
    process.env.NODE_ENV = 'test'
    process.env.ENABLE_DEMO_AUTH = 'true'
    process.env.APP_FEATURE_PROFILE = 'lms-mvp'

    const { context, token } = createDemoSession('advisor')
    expect(context.roles).toEqual(['lecturer'])
    expect(verifyDemoSessionToken(token)?.roles).toEqual(['lecturer'])
    expect(() => createDemoSession('academic')).toThrowError(/tidak memiliki role/)
  })
})
