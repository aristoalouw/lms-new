import { createServer, request as nodeRequest, type IncomingHttpHeaders } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createApp, eventHandler, toNodeListener, type EventHandler } from 'h3'
import { beforeEach, describe, expect, it } from 'vitest'
import exportHandler from '../../server/api/academic/classes/[id]/export.get'
import { resetAcademicClassStateForTests } from '../../server/services/academic-classes'
import { resetLearningMockState } from '../../server/services/learning-mock'
import { createDemoSession, SESSION_COOKIE_NAME } from '../../server/utils/auth'
import { resetMockState } from '../../server/utils/mock-store'

const classId = 'class-mgt-401-a'

interface ApiResponse {
  status: number
  headers: IncomingHttpHeaders
  text: string
}

async function request(handler: EventHandler, cookie?: string): Promise<ApiResponse> {
  const app = createApp()
  app.use(eventHandler(event => {
    event.context.params = { id: classId }
    return handler(event)
  }))
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
        path: `/api/academic/classes/${classId}/export`,
        method: 'GET',
        headers: cookie ? { cookie } : undefined,
      }, (incoming) => {
        const chunks: Buffer[] = []
        incoming.on('data', chunk => chunks.push(Buffer.from(chunk)))
        incoming.on('end', () => resolve({
          status: incoming.statusCode ?? 0,
          headers: incoming.headers,
          text: Buffer.concat(chunks).toString('utf8'),
        }))
      })
      outgoing.once('error', reject)
      outgoing.end()
    })
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close(error => error ? reject(error) : resolve()))
  }
}

function cookie(profile: 'admin' | 'student'): string {
  const { token } = createDemoSession(profile)
  return `${SESSION_COOKIE_NAME}=${token}`
}

describe('LMS class export API', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test'
    process.env.CAMPUS_DATA_MODE = 'mock'
    process.env.APP_FEATURE_PROFILE = 'lms-mvp'
    resetMockState()
    resetAcademicClassStateForTests()
    resetLearningMockState()
  })

  it('serves an audited, non-cacheable CSV attachment to an administrator', async () => {
    const response = await request(exportHandler, cookie('admin'))
    expect(response.status).toBe(200)
    expect(response.headers['cache-control']).toContain('no-store')
    expect(response.headers['content-type']).toContain('text/csv')
    expect(response.headers['content-disposition']).toContain('attachment;')
    expect(response.headers['x-content-type-options']).toBe('nosniff')
    expect(response.text.startsWith('\uFEFF')).toBe(true)
    expect(response.text).toContain('"CLASS"')
    expect(response.text).not.toContain('attendance_status')
  })

  it('rejects anonymous and student requests without cacheable error responses', async () => {
    const anonymous = await request(exportHandler)
    expect(anonymous.status).toBe(401)
    expect(anonymous.headers['cache-control']).toContain('no-store')

    const learner = await request(exportHandler, cookie('student'))
    expect(learner.status).toBe(403)
    expect(learner.headers['cache-control']).toContain('no-store')
  })
})
