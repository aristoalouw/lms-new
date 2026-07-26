import { getCurrentScope, onScopeDispose, readonly, ref, watch } from 'vue'

export interface AccountCandidate {
  id: string
  displayName: string
  email: string
  roles: string[]
  scope: {
    programStudyIds: string[]
    studentIds: string[]
  }
}

export interface AccountCandidatePage {
  items: AccountCandidate[]
  total: number
}

export interface StudentAccountSearchParams {
  page: number
  pageSize: number
  role: 'student'
  status: 'active'
  search: string
  programStudyId: string
}

export function studentAccountSearchParams(
  search: string,
  programStudyId: string,
  pageSize = 50,
): StudentAccountSearchParams {
  return {
    page: 1,
    pageSize: Math.min(Math.max(pageSize, 1), 50),
    role: 'student',
    status: 'active',
    search: search.trim(),
    programStudyId,
  }
}

export function useAccountCandidateSearch(
  fetcher: (search: string) => Promise<AccountCandidatePage>,
  options: {
    debounceMs?: number
    minimumLength?: number
    errorMessage?: (error: unknown) => string
  } = {},
) {
  const debounceMs = Math.max(options.debounceMs ?? 300, 0)
  const minimumLength = Math.max(options.minimumLength ?? 2, 1)
  const query = ref('')
  const items = ref<AccountCandidate[]>([])
  const total = ref(0)
  const loading = ref(false)
  const searched = ref(false)
  const error = ref('')
  let timer: ReturnType<typeof setTimeout> | undefined
  let requestVersion = 0

  const clearResults = () => {
    items.value = []
    total.value = 0
    loading.value = false
    searched.value = false
    error.value = ''
  }

  const run = async () => {
    const search = query.value.trim()
    if (search.length < minimumLength) {
      requestVersion += 1
      clearResults()
      return
    }

    const currentRequest = ++requestVersion
    loading.value = true
    searched.value = false
    error.value = ''
    try {
      const page = await fetcher(search)
      if (currentRequest !== requestVersion) return
      items.value = page.items
      total.value = page.total
      searched.value = true
    } catch (cause) {
      if (currentRequest !== requestVersion) return
      items.value = []
      total.value = 0
      searched.value = true
      error.value = options.errorMessage?.(cause) || 'Kandidat mahasiswa belum dapat dimuat.'
    } finally {
      if (currentRequest === requestVersion) loading.value = false
    }
  }

  const stop = watch(query, value => {
    if (timer) clearTimeout(timer)
    requestVersion += 1
    clearResults()
    if (value.trim().length < minimumLength) return
    timer = setTimeout(() => void run(), debounceMs)
  })

  const reset = () => {
    if (timer) clearTimeout(timer)
    requestVersion += 1
    query.value = ''
    clearResults()
  }

  if (getCurrentScope()) {
    onScopeDispose(() => {
      if (timer) clearTimeout(timer)
      requestVersion += 1
      stop()
    })
  }

  return {
    query,
    items: readonly(items),
    total: readonly(total),
    loading: readonly(loading),
    searched: readonly(searched),
    error: readonly(error),
    retry: run,
    reset,
  }
}
