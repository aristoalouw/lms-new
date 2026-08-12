import { spawn } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const repositoryRoot = resolve(process.cwd())
const openServers: Server[] = []

function securityHeaders() {
  return {
    'cache-control': 'private, no-store, max-age=0',
    'content-security-policy': "default-src 'self'; frame-ancestors 'none'",
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
    'permissions-policy': 'camera=(), microphone=()',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'strict-transport-security': 'max-age=31536000; includeSubDomains',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'x-request-id': 'req_0123456789abcdef0123456789abcdef',
  }
}

async function fixtureServer(options: { version?: string; profile?: string; privateStatus?: number; privateLocation?: string } = {}) {
  const requests: string[] = []
  const server = createServer((request, response) => {
    requests.push(request.url || '')
    const headers = securityHeaders()
    if (request.url === '/login') {
      response.writeHead(200, { ...headers, 'content-type': 'text/html; charset=utf-8' })
      response.end(`<script>window.__NUXT__={config:{public:{featureProfile:"${options.profile || 'full-campus'}"}}}</script>`)
      return
    }
    if (request.url === '/api/health') {
      response.writeHead(200, { ...headers, 'content-type': 'application/json' })
      response.end(JSON.stringify({ status: 'ok', version: options.version || 'release-abc123', timestamp: new Date().toISOString() }))
      return
    }
    if (request.url === '/api/ready') {
      response.writeHead(200, { ...headers, 'content-type': 'application/json' })
      response.end(JSON.stringify({ status: 'ready', timestamp: new Date().toISOString() }))
      return
    }
    if (request.url === '/api/accounts') {
      response.writeHead(options.privateStatus || 401, {
        ...headers,
        'content-type': 'application/json',
        ...(options.privateLocation ? { location: options.privateLocation } : {}),
      })
      response.end(JSON.stringify({ statusCode: options.privateStatus || 401 }))
      return
    }
    response.writeHead(404, headers)
    response.end()
  })
  openServers.push(server)
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Fixture server did not bind to a TCP port.')
  return { baseUrl: `http://127.0.0.1:${address.port}`, requests }
}

function runVerifier(baseUrl: string, extraArguments: string[] = []) {
  return new Promise<{ status: number | null; stdout: string; stderr: string }>((resolveRun, reject) => {
    const child = spawn(process.execPath, [
      resolve(repositoryRoot, 'scripts', 'verify-hostinger-release.mjs'),
      `--base-url=${baseUrl}`,
      '--expected-version=release-abc123',
      '--expected-profile=full-campus',
      ...extraArguments,
    ], { cwd: repositoryRoot, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk })
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk })
    child.once('error', reject)
    child.once('close', status => resolveRun({ status, stdout, stderr }))
  })
}

afterEach(async () => {
  await Promise.all(openServers.splice(0).map(server => new Promise<void>((resolveClose, reject) => {
    server.close(error => error ? reject(error) : resolveClose())
  })))
})

describe('Hostinger release verifier', () => {
  it('checks one origin without credentials and validates the release contract', async () => {
    const fixture = await fixtureServer()
    const result = await runVerifier(fixture.baseUrl)

    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('Hostinger release verification passed')
    expect(result.stdout).toContain('Version: release-abc123; profile: full-campus; readiness: ready; anonymous private API: HTTP 401.')
    expect(fixture.requests).toEqual(['/login', '/api/health', '/api/ready', '/api/accounts'])
  })

  it('fails closed when the deployed version differs', async () => {
    const fixture = await fixtureServer({ version: 'release-wrong' })
    const result = await runVerifier(fixture.baseUrl)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('reported version release-wrong; expected release-abc123')
    expect(fixture.requests).toEqual(['/login', '/api/health'])
  })

  it('does not follow a redirect from the selected private API', async () => {
    const fixture = await fixtureServer({ privateStatus: 302, privateLocation: 'https://other-domain.invalid/private' })
    const result = await runVerifier(fixture.baseUrl)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Anonymous private API returned HTTP 302; expected 401')
    expect(fixture.requests).toEqual(['/login', '/api/health', '/api/ready', '/api/accounts'])
  })

  it('rejects cleartext non-loopback targets before making a request', async () => {
    const result = await runVerifier('http://campus.example.invalid')

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('must use HTTPS')
  })
})
