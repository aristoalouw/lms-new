import type { AxiosError } from 'axios'
import type { LearningSpaceDetail, SafeRichContent } from '~/shared/contracts/lms'

export function learningRequestKey(prefix: string): string {
  const suffix = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `${prefix}:${suffix}`
}

export function learningErrorMessage(error: unknown): string {
  const data = (error as AxiosError<{ statusMessage?: string; message?: string }>).response?.data
  return data?.statusMessage || data?.message || (error instanceof Error ? error.message : 'Permintaan pembelajaran gagal diproses.')
}

export function learningPlainText(content?: SafeRichContent | { readonly format: 'PLAIN_TEXT'; readonly text: string } | { readonly format: 'QUILL_DELTA'; readonly ops: readonly { readonly insert: string }[] }): string {
  if (!content) return ''
  return content.format === 'PLAIN_TEXT' ? content.text : content.ops.map(operation => operation.insert).join('')
}

export function useLearningSpace(spaceId: MaybeRefOrGetter<string>) {
  const { $api } = useNuxtApp()
  const detail = ref<LearningSpaceDetail | null>(null)
  const loading = ref(false)
  const error = ref('')

  async function load() {
    const id = toValue(spaceId)
    if (!id) return
    loading.value = true
    error.value = ''
    try {
      const response = await $api.get<LearningSpaceDetail>(`/learning/spaces/${encodeURIComponent(id)}`)
      detail.value = response.data
    } catch (cause) {
      detail.value = null
      error.value = learningErrorMessage(cause)
    } finally {
      loading.value = false
    }
  }

  onMounted(load)
  watch(() => toValue(spaceId), load)

  return {
    detail,
    loading: readonly(loading),
    error: readonly(error),
    refresh: load,
  }
}
