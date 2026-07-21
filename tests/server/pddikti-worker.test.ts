import { beforeEach, describe, expect, it } from 'vitest'
import { mockPddiktiContract } from '../../server/services/pddikti-adapter'
import { getPddiktiJobDetail, queuePddiktiSync } from '../../server/services/pddikti'
import { pddiktiModuleState, resetPddiktiModuleState } from '../../server/services/pddikti-state'
import {
  claimPddiktiJobs,
  runPddiktiWorker,
  verifyPddiktiWorkerSecret,
} from '../../server/services/pddikti-worker'
import type { PddiktiAdapterContract, PddiktiFeederAdapter, PddiktiPushBatchRequest } from '../../server/types/pddikti'
import { CampusError } from '../../server/utils/errors'
import { mockState, resetMockState } from '../../server/utils/mock-store'
import { authContext } from './fixtures'

const staff = () => authContext('academic-001', ['academic_staff'], ['management-s1'])
const periodId = '2025-2026-2'

function acceptingAdapter(contract: PddiktiAdapterContract, requests: PddiktiPushBatchRequest[] = []): PddiktiFeederAdapter {
  return {
    contractVersion: contract.version,
    async health() { return { configured: true, reachable: true, contractVersion: contract.version, checkedAt: new Date().toISOString() } },
    async pushBatch(request) {
      requests.push(structuredClone(request))
      return { items: request.records.map(record => ({ internalId: record.internalId, status: 'ACCEPTED', remoteId: `remote-${record.internalId}`, remoteVersion: '1' })) }
    },
    async fetchSnapshot() { return [] },
  }
}

async function queue(ids: string[], key: string, contract: PddiktiAdapterContract, now = new Date('2026-07-21T02:00:00.000Z')) {
  return queuePddiktiSync(staff(), {
    entityType: 'grade', entityIds: ids, programStudyId: 'management-s1', periodId,
  }, key, undefined, { contract, now })
}

describe('production-style PDDIKTI worker', () => {
  beforeEach(() => {
    process.env.CAMPUS_DATA_MODE = 'mock'
    process.env.NODE_ENV = 'test'
    process.env.NEO_FEEDER_MAX_ATTEMPTS = '5'
    resetMockState()
    resetPddiktiModuleState()
  })

  it('rejects ineligible source data and freezes a stable mapped payload fingerprint', async () => {
    const contract = mockPddiktiContract()
    await expect(queue(['grade-blocked-001'], 'pddikti-blocked-key-0001', contract))
      .rejects.toMatchObject({ code: 'PDDIKTI_PAYLOAD_INELIGIBLE' } satisfies Partial<CampusError>)

    const first = await queue(['grade-101'], 'pddikti-fingerprint-key-0001', contract)
    const payload = pddiktiModuleState().jobPayloads.get(first.job.id)!
    pddiktiModuleState().sourceRecords.get('grade:grade-101')!.data.finalGrade = 40
    const replay = await queue(['grade-101'], 'pddikti-fingerprint-key-0001', contract, new Date('2026-07-21T03:00:00.000Z'))

    expect(replay.replayed).toBe(true)
    expect(replay.job.payloadFingerprint).toBe(first.job.payloadFingerprint)
    expect(payload.records[0]?.fields.finalGrade).toBe(86)
  })

  it('claims each job once under concurrent workers and recovers an abandoned lease', async () => {
    const contract = mockPddiktiContract()
    await queue(['grade-101'], 'pddikti-claim-key-0001', contract)
    await queue(['grade-102'], 'pddikti-claim-key-0002', contract)
    const now = new Date('2026-07-21T02:00:00.000Z')
    const [left, right] = await Promise.all([
      claimPddiktiJobs('worker-left', { now, limit: 1, leaseMs: 30_000 }),
      claimPddiktiJobs('worker-right', { now, limit: 1, leaseMs: 30_000 }),
    ])

    expect(new Set([...left, ...right].map(job => job.id)).size).toBe(2)
    expect([...left, ...right].every(job => job.status === 'PROCESSING')).toBe(true)
    const abandoned = left[0]!
    const recovered = await claimPddiktiJobs('worker-recovery', {
      now: new Date('2026-07-21T02:00:31.000Z'), limit: 1, leaseMs: 30_000,
    })
    expect(recovered[0]).toMatchObject({ id: abandoned.id, leaseOwner: 'worker-recovery', leaseRecoveries: 1 })
    expect(recovered[0]?.leaseToken).not.toBe(abandoned.leaseToken)
    expect(recovered[0]?.history.map(event => event.type)).toContain('LEASE_RECOVERED')
  })

  it('honors batch bounds, persists result history, and creates entity mappings', async () => {
    const contract = mockPddiktiContract({ maxBatchSize: 1, timeoutMs: 500 })
    const requests: PddiktiPushBatchRequest[] = []
    const queued = await queue(['grade-101', 'grade-102'], 'pddikti-worker-success-0001', contract)
    const run = await runPddiktiWorker({
      workerId: 'worker-success', maxJobs: 1, now: new Date('2026-07-21T02:00:00.000Z'), contract, adapter: acceptingAdapter(contract, requests),
    })
    const detail = await getPddiktiJobDetail(staff(), queued.job.id)

    expect(run).toMatchObject({ claimed: 1, succeeded: 1, retried: 0, deadLettered: 0 })
    expect(detail.job).toMatchObject({ status: 'SUCCEEDED', attempts: 1, acceptedCount: 2, rejectedCount: 0 })
    expect(requests).toHaveLength(2)
    expect(requests.every(request => request.records.length === 1)).toBe(true)
    expect(new Set(requests.map(request => request.idempotencyKey)).size).toBe(2)
    expect(detail.results).toHaveLength(2)
    expect(detail.mappings.map(mapping => mapping.remoteId).sort()).toEqual(['remote-grade-101', 'remote-grade-102'])
  })

  it('sanitizes failures, backs off, and reaches dead letter at the configured bound', async () => {
    process.env.NEO_FEEDER_MAX_ATTEMPTS = '2'
    const contract = mockPddiktiContract({ timeoutMs: 100 })
    const adapter: PddiktiFeederAdapter = {
      contractVersion: contract.version,
      async health() { return { configured: true, reachable: false, contractVersion: contract.version, checkedAt: new Date().toISOString() } },
      async pushBatch() { throw Object.assign(new Error('Bearer abc.def token=my-token password=hunter2'), { code: 'REMOTE_TIMEOUT' }) },
      async fetchSnapshot() { return [] },
    }
    const queued = await queue(['grade-101'], 'pddikti-worker-failure-0001', contract)
    await runPddiktiWorker({ workerId: 'worker-failure-1', maxJobs: 1, now: new Date('2026-07-21T02:00:00.000Z'), contract, adapter })
    const first = mockState().pddiktiJobs.get(queued.job.id)!
    expect(first).toMatchObject({ status: 'QUEUED', attempts: 1 })
    expect(first.lastError?.message).not.toMatch(/abc\.def|my-token|hunter2/)

    await runPddiktiWorker({ workerId: 'worker-failure-2', maxJobs: 1, now: new Date(first.nextAttemptAt), contract, adapter })
    const second = mockState().pddiktiJobs.get(queued.job.id)!
    expect(second).toMatchObject({ status: 'DEAD_LETTER', attempts: 2 })
    expect((second as typeof second & { history: Array<{ type: string }> }).history.at(-1)?.type).toBe('DEAD_LETTERED')
  })

  it('requires an independent worker secret of at least 32 bytes', () => {
    const secret = 'pddikti-worker-secret-32-bytes-minimum-value'
    expect(verifyPddiktiWorkerSecret(secret, secret)).toBe(true)
    expect(verifyPddiktiWorkerSecret(`${secret}x`, secret)).toBe(false)
    expect(verifyPddiktiWorkerSecret('short', 'short')).toBe(false)
    expect(verifyPddiktiWorkerSecret(undefined, secret)).toBe(false)
  })
})
