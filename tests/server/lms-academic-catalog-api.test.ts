import { createServer, request as nodeRequest, type IncomingHttpHeaders } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createApp, toNodeListener, type EventHandler } from 'h3'
import { beforeEach, describe, expect, it } from 'vitest'
import catalogHandler from '../../server/api/academic/classes/catalog/index.get'
import courseHandler from '../../server/api/academic/classes/catalog/courses.post'
import periodHandler from '../../server/api/academic/classes/catalog/periods.post'
import { resetAcademicAdministrationStateForTests } from '../../server/services/academic-administration'
import { createDemoSession, SESSION_COOKIE_NAME } from '../../server/utils/auth'
import { featureForApiPath, isFeatureEnabled } from '../../shared/features'

interface ApiRequest {
  method?: string
  headers?: Record<string, string>
  body?: string
}

interface ApiResponse {
  status: number
  headers: IncomingHttpHeaders
  json: () => Promise<unknown>
}

async function request(handler: EventHandler, init: ApiRequest = {}): Promise<ApiResponse> {
  const app = createApp()
  app.use(handler)
  const server = createServer(toNodeListener(app))
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const { port } = server.address() as AddressInfo
  try {
    return await new Promise<ApiResponse>((resolve, reject) => {
      const outgoing = nodeRequest({
        hostname: '127.0.0.1',
        port,
        path: '/api/academic/classes/catalog',
        method: init.method ?? 'GET',
        headers: init.headers,
      }, (incoming) => {
        const chunks: Buffer[] = []
        incoming.on('data', chunk => chunks.push(Buffer.from(chunk)))
        incoming.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8')
          resolve({
            status: incoming.statusCode ?? 0,
            headers: incoming.headers,
            json: async () => JSON.parse(body),
          })
        })
      })
      outgoing.once('error', reject)
      outgoing.end(init.body)
    })
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
}

function adminCookie(): string {
  const { token } = createDemoSession('admin')
  return `${SESSION_COOKIE_NAME}=${token}`
}

describe('LMS academic catalog API', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test'
    process.env.CAMPUS_DATA_MODE = 'mock'
    process.env.APP_FEATURE_PROFILE = 'lms-mvp'
    resetAcademicAdministrationStateForTests()
  })

  it('is reachable through the enabled classes namespace and remains private', async () => {
    const feature = featureForApiPath('/api/academic/classes/catalog')
    expect(feature).toBe('classes')
    expect(isFeatureEnabled('lms-mvp', feature!)).toBe(true)

    const response = await request(catalogHandler, {
      headers: { cookie: adminCookie() },
    })
    const payload = await response.json() as {
      programs: Array<{ id: string }>
      periods: Array<{ id: string; active: boolean }>
      courses: Array<{ id: string; immutable: boolean }>
    }

    expect(response.status).toBe(200)
    expect(response.headers['cache-control']).toContain('no-store')
    expect(payload).toMatchObject({
      programs: [expect.objectContaining({ id: 'management-s1' })],
      periods: [expect.objectContaining({ id: '2025-2026-2', active: true })],
      courses: [expect.objectContaining({ id: 'course-mgt401_v1', immutable: true })],
    })
  })

  it('requires an administrator session', async () => {
    const response = await request(catalogHandler)
    expect(response.status).toBe(401)
    expect(response.headers['cache-control']).toContain('no-store')
  })

  it('creates period and course versions with CSRF/idempotency guards', async () => {
    const headers = {
      cookie: adminCookie(),
      'content-type': 'application/json',
      'idempotency-key': 'lms-catalog-api-0001',
    }
    const periodResponse = await request(periodHandler, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        id: '2026-2027-1',
        academicYear: '2026/2027',
        term: 'ODD',
        startsAt: '2026-09-01T00:00:00.000Z',
        endsAt: '2027-01-31T16:59:59.000Z',
        krsOpensAt: '2026-08-10T00:00:00.000Z',
        krsClosesAt: '2026-08-21T16:59:59.000Z',
        active: true,
        expectedVersion: 0,
      }),
    })
    expect(periodResponse.status).toBe(200)
    await expect(periodResponse.json()).resolves.toMatchObject({ value: { id: '2026-2027-1', active: true } })

    const courseResponse = await request(courseHandler, {
      method: 'POST',
      headers: { ...headers, 'idempotency-key': 'lms-catalog-api-0002' },
      body: JSON.stringify({
        courseId: 'course-lms-api',
        code: 'LMS101',
        name: 'Pengantar LMS',
        programStudyId: 'management-s1',
        credits: 3,
        semesterRecommendation: 1,
        prerequisiteCourseCodes: [],
        equivalentCourseCodes: [],
        status: 'ACTIVE',
        expectedCurrentVersion: 0,
      }),
    })
    expect(courseResponse.status).toBe(200)
    await expect(courseResponse.json()).resolves.toMatchObject({
      value: { id: 'course-lms-api_v1', status: 'ACTIVE', immutable: true },
    })

    const catalogResponse = await request(catalogHandler, { headers: { cookie: adminCookie() } })
    const catalog = await catalogResponse.json() as {
      periods: Array<{ id: string }>
      courses: Array<{ id: string }>
    }
    expect(catalog.periods.map((item: { id: string }) => item.id)).toContain('2026-2027-1')
    expect(catalog.courses.map((item: { id: string }) => item.id)).toContain('course-lms-api_v1')
  })
})
