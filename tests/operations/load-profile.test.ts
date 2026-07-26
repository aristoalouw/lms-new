import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('LMS pilot load profile', () => {
  it('models 100 concurrent users with the accepted latency and error thresholds', () => {
    const script = readFileSync(resolve(process.cwd(), 'tests/load/lms-mvp.js'), 'utf8')

    expect(script).toContain("reads: { executor: 'constant-vus', exec: 'readFlow', vus: 90, duration: '5m' }")
    expect(script).toContain("mutations: { executor: 'constant-vus', exec: 'mutationFlow', vus: 10, duration: '5m' }")
    expect(script).toContain("sessions.length < 100")
    expect(script).toContain("http_req_failed: ['rate<0.01']")
    expect(script).toContain("'http_req_duration{operation:read}': ['p(95)<1000']")
    expect(script).toContain("'http_req_duration{operation:mutation}': ['p(95)<2000']")
  })
})
