import { beforeEach, describe, expect, it, vi } from 'vitest'
import { permissionsForLmsMvpRole, type Permission } from '../../shared/auth'
import { navigationCommandsForAccess } from '../../config/navigation'
import { isFeatureEnabled, normalizeFeatureProfile } from '../../shared/features'
import { usePrivateUpload } from '../../composables/usePrivateUpload'

class SuccessfulUploadRequest {
  status = 200
  withCredentials = false
  upload = { addEventListener: vi.fn() }
  private listeners = new Map<string, () => void>()

  open = vi.fn()
  setRequestHeader = vi.fn()

  addEventListener(event: string, listener: () => void) {
    this.listeners.set(event, listener)
  }

  send = vi.fn(() => {
    this.listeners.get('load')?.()
  })
}

describe('private LMS uploads', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.stubGlobal('ref', <T>(value: T) => ({ value }))
    vi.stubGlobal('readonly', <T>(value: T) => value)
    vi.stubGlobal('XMLHttpRequest', SuccessfulUploadRequest)
  })

  it('creates every upload session with a unique valid idempotency key', async () => {
    const post = vi.fn()
      .mockResolvedValueOnce({
        data: {
          file: { id: 'file-1' },
          session: { id: 'session-1', expiresAt: '2026-07-28T00:00:00.000Z', version: 1 },
          upload: { url: '/upload-target-1', method: 'PUT', headers: {} },
        },
      })
      .mockResolvedValueOnce({ data: { file: { id: 'file-1', status: 'CLEAN' } } })
      .mockResolvedValueOnce({
        data: {
          file: { id: 'file-2' },
          session: { id: 'session-2', expiresAt: '2026-07-28T00:00:00.000Z', version: 1 },
          upload: { url: '/upload-target-2', method: 'PUT', headers: {} },
        },
      })
      .mockResolvedValueOnce({ data: { file: { id: 'file-2', status: 'CLEAN' } } })
    vi.stubGlobal('useNuxtApp', () => ({ $api: { post } }))

    const { upload } = usePrivateUpload()
    await upload(new File(['first'], 'first.pdf', { type: 'application/pdf' }), 'class-1')
    await upload(new File(['second'], 'second.pdf', { type: 'application/pdf' }), 'class-1')

    const firstKey = post.mock.calls[0]?.[2]?.headers?.['Idempotency-Key']
    const secondKey = post.mock.calls[2]?.[2]?.headers?.['Idempotency-Key']
    const validKey = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/

    expect(firstKey).toMatch(validKey)
    expect(secondKey).toMatch(validKey)
    expect(secondKey).not.toBe(firstKey)
  })
})

describe('command palette authorization', () => {
  it('requires both an enabled feature and permission from the active role', () => {
    const profile = normalizeFeatureProfile('lms-mvp')
    const studentPermissions = new Set<Permission>(permissionsForLmsMvpRole('student'))
    const studentCommands = navigationCommandsForAccess(
      feature => isFeatureEnabled(profile, feature),
      permission => !permission || studentPermissions.has(permission as Permission),
    )

    expect(studentCommands.map(item => item.to)).toEqual(expect.arrayContaining([
      '/',
      '/pembelajaran',
      '/notifikasi',
      '/berkas',
    ]))
    expect(studentCommands.map(item => item.to)).not.toEqual(expect.arrayContaining([
      '/admin/kelas',
      '/admin/pengguna',
      '/keuangan',
    ]))

    const administratorPermissions = new Set<Permission>(permissionsForLmsMvpRole('administrator'))
    const administratorCommands = navigationCommandsForAccess(
      feature => isFeatureEnabled(profile, feature),
      permission => !permission || administratorPermissions.has(permission as Permission),
    )

    expect(administratorCommands.map(item => item.to)).toEqual(expect.arrayContaining([
      '/admin/kelas',
      '/admin/pengguna',
    ]))
  })
})
