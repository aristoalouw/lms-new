import { describe, expect, it } from 'vitest'
import {
  createHttpPddiktiAdapter,
  pddiktiContractFromEnvironment,
  sanitizePddiktiError,
} from '../../server/services/pddikti-adapter'

describe('version-pinned PDDIKTI gateway adapter contract', () => {
  it('uses only an operator-configured opaque operation key and pinned contract version', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const contract = pddiktiContractFromEnvironment({
      PDDIKTI_CONTRACT_VERSION: 'verified-campus-contract/7',
      PDDIKTI_OPERATION_MAP_JSON: JSON.stringify({ grade: 'operator-verified-operation-key' }),
      PDDIKTI_MAX_BATCH_SIZE: '2',
      PDDIKTI_ADAPTER_TIMEOUT_MS: '4000',
    } as NodeJS.ProcessEnv)
    const adapter = createHttpPddiktiAdapter(contract, {
      baseUrl: 'https://gateway.example.test',
      bearerToken: 'server-only-adapter-token',
      fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
        requests.push({ url: String(url), init })
        return new Response(JSON.stringify({
          requestId: 'gateway-request-001',
          items: [{ internalId: 'grade-101', status: 'ACCEPTED', remoteId: 'remote-grade-101', remoteVersion: '3' }],
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }) as typeof fetch,
    })

    const result = await adapter.pushBatch({
      contractVersion: contract.version,
      operationKey: contract.operationKeys.grade!,
      entityType: 'grade',
      programStudyId: 'management-s1',
      periodId: '2025-2026-2',
      idempotencyKey: 'stable-fingerprint:1:0',
      records: [{ internalId: 'grade-101', internalVersion: 4, mappingVersion: 'grade-mapping-v1', fingerprint: 'abc', fields: { finalGrade: 86 } }],
    }, new AbortController().signal)

    expect(result.items[0]).toMatchObject({ status: 'ACCEPTED', remoteId: 'remote-grade-101' })
    expect(requests[0]?.url).toBe('https://gateway.example.test/batches')
    const requestBody = JSON.parse(String(requests[0]?.init?.body)) as Record<string, unknown>
    expect(requestBody).toMatchObject({ contractVersion: 'verified-campus-contract/7', operationKey: 'operator-verified-operation-key' })
    expect(String(requests[0]?.init?.body)).not.toMatch(/Insert|Update|GetList|NeoFeeder/i)
    expect((requests[0]?.init?.headers as Record<string, string>).authorization).toBe('Bearer server-only-adapter-token')
  })

  it('rejects a batch that does not match the pinned version or bound', async () => {
    const contract = pddiktiContractFromEnvironment({
      PDDIKTI_CONTRACT_VERSION: 'contract/1',
      PDDIKTI_OPERATION_MAP_JSON: '{"grade":"verified"}',
      PDDIKTI_MAX_BATCH_SIZE: '1',
    } as NodeJS.ProcessEnv)
    const adapter = createHttpPddiktiAdapter(contract, {
      baseUrl: 'http://127.0.0.1:9999', bearerToken: 'test-token',
      fetchImpl: (async () => new Response('{}')) as typeof fetch,
    })
    await expect(adapter.pushBatch({
      contractVersion: 'contract/2', operationKey: 'verified', entityType: 'grade', programStudyId: 'management-s1', periodId: 'p', idempotencyKey: 'key', records: [],
    }, new AbortController().signal)).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('redacts credentials and line breaks from adapter failures', () => {
    const sanitized = sanitizePddiktiError(Object.assign(new Error('Bearer abc.def token=mytoken\npassword=hunter2&next=1'), { code: 'vendor auth error' }))
    expect(sanitized.code).toBe('VENDOR_AUTH_ERROR')
    expect(sanitized.message).not.toContain('abc.def')
    expect(sanitized.message).not.toContain('mytoken')
    expect(sanitized.message).not.toContain('hunter2')
    expect(sanitized.message).not.toMatch(/[\r\n]/)
  })
})
