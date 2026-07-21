import { describe, expect, it } from 'vitest'
import { featureForApiPath, featureForPagePath, isFeatureEnabled, isMvpApiAllowed, normalizeFeatureProfile } from '../../shared/features'
import { permissionsForRole } from '../../shared/auth'
import { sanitizeSentryEvent } from '../../shared/observability/sentry'

describe('LMS MVP profile and telemetry invariants', () => {
  it('blocks every non-MVP domain while retaining required routes', () => {
    const profile = normalizeFeatureProfile('lms-mvp')
    expect(isFeatureEnabled(profile, featureForPagePath('/pembelajaran/class-a/tugas')!)).toBe(true)
    expect(isFeatureEnabled(profile, featureForApiPath('/api/academic/classes/class-a/enrollments')!)).toBe(true)
    expect(isFeatureEnabled(profile, featureForPagePath('/keuangan')!)).toBe(false)
    expect(isFeatureEnabled(profile, featureForApiPath('/api/pddikti/jobs')!)).toBe(false)
    expect(isFeatureEnabled(profile, featureForPagePath('/modul/keuangan')!)).toBe(false)
    expect(isMvpApiAllowed('/api/learning/spaces', 'POST')).toBe(false)
    expect(isMvpApiAllowed('/api/learning/spaces/class-a/gamification', 'PUT')).toBe(false)
    expect(isMvpApiAllowed('/api/academic/classes/class-a/grades/publish', 'POST')).toBe(false)
    expect(isMvpApiAllowed('/api/notifications/outbox', 'GET')).toBe(false)
    expect(isMvpApiAllowed('/api/notifications/templates', 'GET')).toBe(false)
    expect(isMvpApiAllowed('/api/internal/notifications/outbox/process', 'POST')).toBe(false)
    expect(isMvpApiAllowed('/api/academic/classes/class-a/attendance/check-in', 'POST')).toBe(true)
  })

  it('keeps administrator outside submit and grade permissions', () => {
    const permissions = permissionsForRole('administrator')
    expect(permissions).toContain('classes:manage')
    expect(permissions).toContain('enrollments:manage')
    expect(permissions).not.toContain('learning:submit')
    expect(permissions).not.toContain('learning:grade')
    expect(permissions).not.toContain('learning.write')
  })

  it('scrubs credentials and student learning data from Sentry events', () => {
    const event = sanitizeSentryEvent({
      user: { email: 'student@example.test' },
      request: { url: 'https://campus.test/api/files/private-file-123/download?token=secret#fragment', headers: { authorization: 'Bearer secret' }, data: { submission: 'answer' }, cookies: { session: 'secret' }, env: { secret: 'value' } },
      message: 'Upload gagal untuk student@example.test',
      breadcrumbs: [{ message: 'Submission student@example.test', data: { fileId: 'private-file-123' } }],
      extra: { email: 'student@example.test', grade: 95, nested: { message: 'Bearer abc.def.ghi' } },
      exception: { values: [{ value: 'Failed for student@example.test token=secret' }] },
    })
    expect(event.user).toBeUndefined()
    expect(event.request).toEqual({ url: 'https://campus.test/api/files/[ID disaring]/download' })
    expect(event.breadcrumbs).toEqual([{ message: 'Submission [Email disaring]', data: { fileId: '[Disaring]' } }])
    expect(event.extra).toEqual({ email: '[Disaring]', grade: '[Disaring]', nested: { message: 'Bearer [Disaring]' } })
    expect(JSON.stringify(event)).not.toContain('student@example.test')
    expect(JSON.stringify(event)).not.toContain('abc.def.ghi')
  })
})
