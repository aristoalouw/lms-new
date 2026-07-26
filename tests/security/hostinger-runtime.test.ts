import type { H3Event } from 'h3'
import { afterEach, describe, expect, it } from 'vitest'
import {
  applicationSecurityHeaders,
  clientAddress,
  requestAuditMetadata,
  trustedRequestId,
} from '../../server/utils/security'

function event(headers: Record<string, string> = {}, remoteAddress = '10.0.0.5'): H3Event {
  return {
    context: {},
    node: {
      req: { headers, socket: { remoteAddress } },
    },
  } as unknown as H3Event
}

describe('Hostinger edge security boundary', () => {
  const previousTarget = process.env.DEPLOYMENT_TARGET
  const previousProxyHops = process.env.TRUSTED_PROXY_HOPS

  afterEach(() => {
    if (previousTarget === undefined) delete process.env.DEPLOYMENT_TARGET
    else process.env.DEPLOYMENT_TARGET = previousTarget
    if (previousProxyHops === undefined) delete process.env.TRUSTED_PROXY_HOPS
    else process.env.TRUSTED_PROXY_HOPS = previousProxyHops
  })

  it('emits the application security baseline with HSTS only in production', () => {
    const production = applicationSecurityHeaders(true)
    expect(production).toMatchObject({
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'strict-origin-when-cross-origin',
      'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
      'strict-transport-security': 'max-age=31536000; includeSubDomains',
    })
    expect(production['content-security-policy']).toContain("default-src 'self'")
    expect(production['content-security-policy']).toContain("frame-ancestors 'none'")
    expect(production['content-security-policy']).not.toContain("'unsafe-eval'")
    const development = applicationSecurityHeaders(false)
    expect(development).not.toHaveProperty('strict-transport-security')
    expect(development['content-security-policy']).toContain("'unsafe-eval'")
  })

  it('ignores a client-supplied request ID on Hostinger and reuses its own trusted ID', () => {
    process.env.DEPLOYMENT_TARGET = 'hostinger'
    const request = event({ 'x-request-id': 'client_spoofed_request_id_0001' })
    const generated = trustedRequestId(request)
    expect(generated).toMatch(/^req_[a-f0-9]{32}$/)
    expect(generated).not.toBe('client_spoofed_request_id_0001')
    expect(trustedRequestId(request)).toBe(generated)
    expect(requestAuditMetadata(request).requestId).toBe(generated)
  })

  it('accepts only the repository-owned Nginx request ID on the Docker target', () => {
    process.env.DEPLOYMENT_TARGET = 'docker'
    const request = event({ 'x-request-id': '0123456789abcdef0123456789abcdef' })
    expect(trustedRequestId(request)).toBe('0123456789abcdef0123456789abcdef')
  })

  it('derives the client IP by removing the configured trusted proxy hop', () => {
    process.env.DEPLOYMENT_TARGET = 'hostinger'
    process.env.TRUSTED_PROXY_HOPS = '1'
    expect(clientAddress(event({ 'x-forwarded-for': '203.0.113.44' }))).toBe('203.0.113.44')
    expect(clientAddress(event({ 'x-forwarded-for': 'spoofed, 203.0.113.44' }))).toBe('203.0.113.44')
  })
})
