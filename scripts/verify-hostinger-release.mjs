#!/usr/bin/env node

// Managed Hostinger applications may cold-start after an idle period.
const REQUEST_TIMEOUT_MS = 60_000
const MAX_RESPONSE_BYTES = 1_048_576
const VALID_PROFILES = new Set(['full-campus', 'lms-mvp'])

function usage() {
  return [
    'Usage:',
    '  npm run verify:hostinger -- --base-url=https://lms.example.ac.id --expected-version=<release> --expected-profile=full-campus',
    '',
    'Optional:',
    '  --private-api-path=/api/accounts',
  ].join('\n')
}

function parseArguments(argv) {
  const values = new Map()
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--help' || argument === '-h') return { help: true }
    if (!argument.startsWith('--')) throw new Error(`Unknown positional argument: ${argument}`)
    const separator = argument.indexOf('=')
    const name = separator >= 0 ? argument.slice(2, separator) : argument.slice(2)
    const inlineValue = separator >= 0 ? argument.slice(separator + 1) : undefined
    const value = inlineValue ?? argv[++index]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${name}.`)
    if (values.has(name)) throw new Error(`Duplicate argument --${name}.`)
    values.set(name, value)
  }

  const allowed = new Set(['base-url', 'expected-version', 'expected-profile', 'private-api-path'])
  for (const name of values.keys()) {
    if (!allowed.has(name)) throw new Error(`Unknown argument --${name}.`)
  }
  return { help: false, values }
}

function required(values, name) {
  const value = values.get(name)?.trim()
  if (!value) throw new Error(`--${name} is required.`)
  return value
}

function normalizedBaseUrl(rawValue) {
  let url
  try {
    url = new URL(rawValue)
  } catch {
    throw new Error('--base-url must be an absolute URL.')
  }
  const loopbackHttp = url.protocol === 'http:' && ['127.0.0.1', '::1', 'localhost'].includes(url.hostname)
  if (url.protocol !== 'https:' && !loopbackHttp) throw new Error('--base-url must use HTTPS (HTTP is allowed only for loopback tests).')
  if (url.username || url.password || url.search || url.hash) throw new Error('--base-url must not contain credentials, a query, or a fragment.')
  if (url.pathname !== '/' && url.pathname !== '') throw new Error('--base-url must be the application origin without a path.')
  return new URL(`${url.origin}/`)
}

function normalizedPrivatePath(rawValue) {
  if (!rawValue.startsWith('/api/')) throw new Error('--private-api-path must be an absolute application API path.')
  const parsed = new URL(rawValue, 'https://application.invalid')
  if (parsed.origin !== 'https://application.invalid' || parsed.search || parsed.hash || parsed.pathname !== rawValue) {
    throw new Error('--private-api-path must not contain an origin, query, or fragment.')
  }
  if (['/api/health', '/api/ready'].includes(parsed.pathname)) throw new Error('--private-api-path must identify a private API.')
  return parsed.pathname
}

async function request(baseUrl, path) {
  const url = new URL(path, baseUrl)
  if (url.origin !== baseUrl.origin) throw new Error(`Refusing cross-origin probe for ${path}.`)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
      headers: { accept: 'application/json, text/html;q=0.9' },
    })
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(`Probe timed out for ${path}.`, { cause: error })
    throw new Error(`Probe failed for ${path}: ${error instanceof Error ? error.message : 'network error'}.`, { cause: error })
  } finally {
    clearTimeout(timeout)
  }
}

async function limitedText(response, label) {
  const declaredLength = Number(response.headers.get('content-length') || 0)
  if (declaredLength > MAX_RESPONSE_BYTES) throw new Error(`${label} response is larger than the verifier limit.`)
  const body = await response.arrayBuffer()
  if (body.byteLength > MAX_RESPONSE_BYTES) throw new Error(`${label} response is larger than the verifier limit.`)
  return new TextDecoder().decode(body)
}

async function jsonBody(response, label) {
  const body = await limitedText(response, label)
  try {
    return JSON.parse(body)
  } catch {
    throw new Error(`${label} did not return valid JSON.`)
  }
}

function requireStatus(response, expected, label) {
  if (response.status !== expected) throw new Error(`${label} returned HTTP ${response.status}; expected ${expected}.`)
}

function requireHeader(response, name, predicate, label) {
  const value = response.headers.get(name) || ''
  if (!predicate(value)) throw new Error(`${label} has a missing or invalid ${name} header.`)
}

function verifySecurityHeaders(response, label) {
  requireHeader(response, 'strict-transport-security', value => /(?:^|;)\s*max-age=\d+/i.test(value), label)
  requireHeader(response, 'content-security-policy', value => /(?:^|;)\s*default-src\s/i.test(value), label)
  requireHeader(response, 'x-content-type-options', value => value.toLowerCase() === 'nosniff', label)
  requireHeader(response, 'x-frame-options', value => value.toUpperCase() === 'DENY', label)
  requireHeader(response, 'referrer-policy', value => value.length > 0, label)
  requireHeader(response, 'permissions-policy', value => value.length > 0, label)
  requireHeader(response, 'cross-origin-opener-policy', value => value.toLowerCase() === 'same-origin', label)
  requireHeader(response, 'cross-origin-resource-policy', value => value.toLowerCase() === 'same-origin', label)
  requireHeader(response, 'x-request-id', value => /^[A-Za-z0-9][A-Za-z0-9._:-]{15,99}$/.test(value), label)
  requireHeader(response, 'cache-control', value => /(?:^|,)\s*(?:private\s*,\s*)?no-store(?:\s*,|$)/i.test(value), label)
}

async function verify({ baseUrl, expectedVersion, expectedProfile, privateApiPath }) {
  const login = await request(baseUrl, '/login')
  requireStatus(login, 200, 'Login page')
  verifySecurityHeaders(login, 'Login page')
  const loginBody = await limitedText(login, 'Login page')
  const escapedProfile = expectedProfile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const publicProfilePattern = new RegExp(`(?:["']?featureProfile["']?)\\s*:\\s*["']${escapedProfile}["']`)
  if (!publicProfilePattern.test(loginBody)) throw new Error(`Login page does not expose the expected ${expectedProfile} feature profile.`)

  const health = await request(baseUrl, '/api/health')
  requireStatus(health, 200, 'Health endpoint')
  verifySecurityHeaders(health, 'Health endpoint')
  const healthPayload = await jsonBody(health, 'Health endpoint')
  if (healthPayload?.status !== 'ok') throw new Error('Health endpoint did not report status ok.')
  if (healthPayload?.version !== expectedVersion) {
    throw new Error(`Health endpoint reported version ${String(healthPayload?.version || '<missing>')}; expected ${expectedVersion}.`)
  }

  const ready = await request(baseUrl, '/api/ready')
  requireStatus(ready, 200, 'Readiness endpoint')
  verifySecurityHeaders(ready, 'Readiness endpoint')
  const readinessPayload = await jsonBody(ready, 'Readiness endpoint')
  if (readinessPayload?.status !== 'ready') throw new Error('Readiness endpoint did not report status ready.')

  const privateApi = await request(baseUrl, privateApiPath)
  requireStatus(privateApi, 401, 'Anonymous private API')
  verifySecurityHeaders(privateApi, 'Anonymous private API')

  return {
    origin: baseUrl.origin,
    version: expectedVersion,
    profile: expectedProfile,
    readiness: readinessPayload.status,
    privateStatus: privateApi.status,
  }
}

async function main() {
  const parsed = parseArguments(process.argv.slice(2))
  if (parsed.help) {
    console.log(usage())
    return
  }
  const baseUrl = normalizedBaseUrl(required(parsed.values, 'base-url'))
  const expectedVersion = required(parsed.values, 'expected-version')
  if (!/^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/.test(expectedVersion)) throw new Error('--expected-version has an invalid format.')
  const expectedProfile = required(parsed.values, 'expected-profile')
  if (!VALID_PROFILES.has(expectedProfile)) throw new Error('--expected-profile must be full-campus or lms-mvp.')
  const privateApiPath = normalizedPrivatePath(parsed.values.get('private-api-path') || '/api/accounts')
  const result = await verify({ baseUrl, expectedVersion, expectedProfile, privateApiPath })
  console.log(`Hostinger release verification passed for ${result.origin}.`)
  console.log(`Version: ${result.version}; profile: ${result.profile}; readiness: ${result.readiness}; anonymous private API: HTTP ${result.privateStatus}.`)
}

main().catch((error) => {
  console.error(`Hostinger release verification failed: ${error instanceof Error ? error.message : 'unknown error'}`)
  process.exitCode = 1
})
