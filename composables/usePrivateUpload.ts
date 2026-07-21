import type { PrivateFileRecord } from '~/shared/contracts/lms'

interface UploadSessionResponse {
  file: PrivateFileRecord
  session: { id: string; expiresAt: string; version: number }
  upload: { url: string; method: 'PUT'; headers: Record<string, string> }
}

interface FileDetailResponse { file: PrivateFileRecord }

export const usePrivateUpload = () => {
  const { $api } = useNuxtApp()
  const progress = ref(0)
  const stage = ref('')
  const pending = ref(false)

  const send = (target: UploadSessionResponse['upload'], file: File): Promise<void> => new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open(target.method, target.url)
    request.withCredentials = target.url.startsWith('/')
    Object.entries(target.headers).forEach(([key, value]) => request.setRequestHeader(key, value))
    request.upload.addEventListener('progress', event => {
      if (event.lengthComputable) progress.value = Math.max(10, Math.round((event.loaded / event.total) * 75))
    })
    request.addEventListener('load', () => request.status >= 200 && request.status < 300 ? resolve() : reject(new Error('Penyimpanan menolak data unggahan.')))
    request.addEventListener('error', () => reject(new Error('Koneksi unggahan terputus.')))
    request.send(file)
  })

  const upload = async (file: File, learningSpaceId: string): Promise<PrivateFileRecord> => {
    pending.value = true
    progress.value = 5
    stage.value = 'Memesan ruang privat…'
    try {
      const { data } = await $api.post<UploadSessionResponse>('/files/upload-sessions', {
        name: file.name,
        declaredMimeType: file.type,
        sizeBytes: file.size,
        access: {
          visibility: 'SCOPED',
          allowedRoles: ['student', 'lecturer'],
          allowedUserIds: [],
          unitIds: [],
          programStudyIds: [],
          studentIds: [],
          learningSpaceIds: [learningSpaceId],
        },
      })
      stage.value = 'Mengunggah ke penyimpanan privat…'
      await send(data.upload, file)
      progress.value = 85
      stage.value = 'Memvalidasi format dan malware…'
      const finalized = await $api.post<FileDetailResponse>(`/files/upload-sessions/${encodeURIComponent(data.session.id)}/finalize`)
      progress.value = 100
      stage.value = finalized.data.file.status === 'CLEAN' ? 'File aman dan siap dipilih.' : 'File masih berada dalam karantina.'
      return finalized.data.file
    } finally {
      pending.value = false
    }
  }

  return { upload, progress: readonly(progress), stage: readonly(stage), pending: readonly(pending) }
}
