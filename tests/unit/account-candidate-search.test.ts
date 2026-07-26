import { effectScope, nextTick } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  studentAccountSearchParams,
  useAccountCandidateSearch,
  type AccountCandidatePage,
} from '../../composables/useAccountCandidateSearch'

describe('student enrolment candidate search', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps role, status, program, and bounded server paging filters', () => {
    expect(studentAccountSearchParams('  Nabila  ', 'management-s1', 100)).toEqual({
      page: 1,
      pageSize: 50,
      role: 'student',
      status: 'active',
      search: 'Nabila',
      programStudyId: 'management-s1',
    })
  })

  it('debounces lookup and exposes loading, result, and cleared states', async () => {
    vi.useFakeTimers()
    let resolveRequest!: (page: AccountCandidatePage) => void
    const fetcher = vi.fn(() => new Promise<AccountCandidatePage>(resolve => {
      resolveRequest = resolve
    }))
    const scope = effectScope()
    const search = scope.run(() => useAccountCandidateSearch(fetcher, { debounceMs: 300 }))!

    search.query.value = 'nabila'
    await nextTick()
    await vi.advanceTimersByTimeAsync(299)
    expect(fetcher).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(fetcher).toHaveBeenCalledWith('nabila')
    expect(search.loading.value).toBe(true)

    resolveRequest({
      items: [{
        id: 'student-001',
        displayName: 'Nabila Putri',
        email: 'nabila@example.test',
        roles: ['student'],
        scope: { programStudyIds: ['management-s1'], studentIds: ['student-001'] },
      }],
      total: 101,
    })
    await Promise.resolve()

    expect(search.loading.value).toBe(false)
    expect(search.searched.value).toBe(true)
    expect(search.total.value).toBe(101)
    expect(search.items.value[0]?.id).toBe('student-001')

    search.query.value = ''
    await nextTick()
    expect(search.items.value).toEqual([])
    expect(search.searched.value).toBe(false)
    scope.stop()
  })

  it('surfaces a retryable lookup error without retaining stale candidates', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn().mockRejectedValue(new Error('network'))
    const scope = effectScope()
    const search = scope.run(() => useAccountCandidateSearch(fetcher, {
      debounceMs: 10,
      errorMessage: () => 'Pencarian akun gagal.',
    }))!

    search.query.value = 'student-099'
    await nextTick()
    await vi.advanceTimersByTimeAsync(10)
    await Promise.resolve()

    expect(search.loading.value).toBe(false)
    expect(search.searched.value).toBe(true)
    expect(search.items.value).toEqual([])
    expect(search.error.value).toBe('Pencarian akun gagal.')
    scope.stop()
  })
})
