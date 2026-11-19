import { describe, expect, it } from 'vitest'
import { publicHealthPayload, publicReadinessPayload } from '../../server/utils/health'

describe('public health payload privacy', () => {
  it('returns only generic liveness fields', () => {
    const payload = publicHealthPayload(new Date('2026-07-21T00:00:00.000Z'), 'c8f3c6e')
    expect(payload).toEqual({
      status: 'ok',
      timestamp: '2026-07-21T00:00:00.000Z',
      version: 'c8f3c6e',
    })
    expect(JSON.stringify(payload)).not.toMatch(/firebase|credential|pddikti|datastore|project/i)
  })

  it('returns no dependency identity or failure detail from readiness', () => {
    expect(publicReadinessPayload(false, new Date('2026-07-21T00:00:00.000Z'))).toEqual({
      status: 'not_ready',
      timestamp: '2026-07-21T00:00:00.000Z',
    })
  })
})
