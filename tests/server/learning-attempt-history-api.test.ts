import { createServer, request as nodeRequest, type IncomingHttpHeaders } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createApp, eventHandler, toNodeListener, type EventHandler } from 'h3'
import { beforeEach, describe, expect, it } from 'vitest'
import attemptsHandler from '../../server/api/learning/assignments/[id]/attempts.get'
import { resetAcademicClassStateForTests } from '../../server/services/academic-classes'
import { resetLearningMockState } from '../../server/services/learning-mock'
import {
  finalizeLearningSubmission,
  saveLearningSubmissionDraft,
} from '../../server/services/learning-submissions'
import { createDemoSession, SESSION_COOKIE_NAME } from '../../server/utils/auth'
import { resetMockState } from '../../server/utils/mock-store'

const assignmentId = 'learning-assignment-case-analysis'
const openedAt = Date.parse('2026-07-22T03:00:00.000Z')

interface ApiResponse {
  status: number
  headers: IncomingHttpHeaders
  json: () => Promise<unknown>
}

async function request(handler: EventHandler, cookie?: string): Promise<ApiResponse> {
  const app = createApp()
  app.use(eventHandler(event => {
    event.context.params = { id: assignmentId }
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
        path: `/api/learning/assignments/${assignmentId}/attempts`,
        method: 'GET',
        headers: cookie ? { cookie } : undefined,
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
      outgoing.end()
    })
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close(error => error ? reject(error) : resolve()))
  }
}

describe('learner assignment attempt-history API', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test'
    process.env.CAMPUS_DATA_MODE = 'mock'
    process.env.APP_FEATURE_PROFILE = 'lms-mvp'
    resetMockState()
    resetAcademicClassStateForTests()
    resetLearningMockState()
  })

  it('returns only the authenticated learner history with private cache headers', async () => {
    const { context, token } = createDemoSession('student')
    const draft = await saveLearningSubmissionDraft(
      context,
      {
        assignmentId,
        expectedVersion: 0,
        content: { format: 'PLAIN_TEXT', text: 'Jawaban melalui kontrak API.' },
        fileIds: [],
      },
      'attempt-history-api-draft-0001',
      undefined,
      openedAt,
    )
    const final = await finalizeLearningSubmission(
      context,
      { assignmentId, expectedVersion: draft.submission.version },
      'attempt-history-api-final-0001',
      undefined,
      openedAt,
    )

    const response = await request(
      attemptsHandler,
      `${SESSION_COOKIE_NAME}=${token}`,
    )
    expect(response.status).toBe(200)
    expect(response.headers['cache-control']).toContain('no-store')
    await expect(response.json()).resolves.toMatchObject({
      assignmentId,
      submission: { studentId: 'student-001' },
      attempts: [{ id: final.attempt.id, studentId: 'student-001' }],
    })
  })

  it('rejects anonymous and non-learner sessions', async () => {
    const anonymous = await request(attemptsHandler)
    expect(anonymous.status).toBe(401)
    expect(anonymous.headers['cache-control']).toContain('no-store')

    const { token } = createDemoSession('advisor')
    const advisor = await request(attemptsHandler, `${SESSION_COOKIE_NAME}=${token}`)
    expect(advisor.status).toBe(403)
  })
})
