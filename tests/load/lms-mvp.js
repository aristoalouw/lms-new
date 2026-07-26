import http from 'k6/http'
import { check, fail } from 'k6'
import { SharedArray } from 'k6/data'
import exec from 'k6/execution'

const fixturesPath = __ENV.LMS_SESSION_FIXTURES
if (!fixturesPath) throw new Error('Set LMS_SESSION_FIXTURES ke file JSON lokal berisi 100 sesi sintetis.')
const sessions = new SharedArray('lms-session-fixtures', () => JSON.parse(open(fixturesPath)))
const baseUrl = (__ENV.LMS_BASE_URL || '').replace(/\/$/, '')
if (!baseUrl.startsWith('https://')) throw new Error('LMS_BASE_URL harus HTTPS.')

export const options = {
  scenarios: {
    reads: { executor: 'constant-vus', exec: 'readFlow', vus: 90, duration: '5m' },
    mutations: { executor: 'constant-vus', exec: 'mutationFlow', vus: 10, duration: '5m' },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{operation:read}': ['p(95)<1000'],
    'http_req_duration{operation:mutation}': ['p(95)<2000'],
  },
}

export function setup() {
  if (sessions.length < 100) fail('Fixture harus memuat sedikitnya 100 sesi pengguna sintetis yang berbeda.')
}

function fixture() {
  return sessions[(exec.vu.idInTest - 1) % sessions.length]
}

function requestParams(operation, item = fixture()) {
  return {
    headers: {
      Cookie: `campus_session=${item.sessionCookie}`,
      Origin: baseUrl,
      'Content-Type': 'application/json',
    },
    tags: { operation },
  }
}

export function readFlow() {
  const item = fixture()
  const list = http.get(`${baseUrl}/api/learning/spaces?limit=24`, requestParams('read', item))
  const detail = http.get(`${baseUrl}/api/learning/spaces/${encodeURIComponent(item.spaceId)}`, requestParams('read', item))
  check(list, { 'list 200': response => response.status === 200 })
  check(detail, { 'detail 200': response => response.status === 200 })
}

export function mutationFlow() {
  const item = fixture()
  const detail = http.get(`${baseUrl}/api/learning/spaces/${encodeURIComponent(item.spaceId)}`, requestParams('read', item))
  if (detail.status !== 200) return
  const data = detail.json()
  const submission = data.ownSubmissions.find(value => value.assignmentId === item.assignmentId)
  const response = http.put(`${baseUrl}/api/learning/assignments/${encodeURIComponent(item.assignmentId)}/draft`, JSON.stringify({
    expectedVersion: submission?.version || 0,
    content: { format: 'PLAIN_TEXT', text: `Synthetic load ${exec.vu.idInTest}/${exec.scenario.iterationInTest}` },
    fileIds: [],
  }), {
    ...requestParams('mutation', item),
    headers: {
      ...requestParams('mutation', item).headers,
      'Idempotency-Key': `load-${exec.vu.idInTest}-${exec.scenario.iterationInTest}-${Date.now()}`,
    },
  })
  check(response, { 'draft 200': value => value.status === 200 })
}
