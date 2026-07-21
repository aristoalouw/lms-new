import { afterEach, describe, expect, it } from 'vitest'
import {
  createDemoSession,
  isDemoAuthEnabled,
  verifyDemoSessionToken,
} from '../../server/utils/auth'

const originalNodeEnv = process.env.NODE_ENV
const originalDemoFlag = process.env.ENABLE_DEMO_AUTH

afterEach(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = originalNodeEnv
  if (originalDemoFlag === undefined) delete process.env.ENABLE_DEMO_AUTH
  else process.env.ENABLE_DEMO_AUTH = originalDemoFlag
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
})
