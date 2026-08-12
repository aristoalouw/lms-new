import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  featureForApiPath,
  featureForPagePath,
  isFeatureEnabled,
  isMvpApiAllowed,
  isMvpPageAllowed,
  mvpApiDecision,
  normalizeFeatureProfile,
} from '../../shared/features'
import { permissionsForLmsMvpRole } from '../../shared/auth'
import { sanitizeSentryEvent } from '../../shared/observability/sentry'
import { navigationCommandsForAccess } from '../../config/navigation'

describe('LMS MVP profile and telemetry invariants', () => {
  it('supports an explicit fail-closed LMS fallback for a missing or invalid profile value', () => {
    expect(normalizeFeatureProfile(undefined, 'lms-mvp')).toBe('lms-mvp')
    expect(normalizeFeatureProfile('typo', 'lms-mvp')).toBe('lms-mvp')
    expect(normalizeFeatureProfile('full-campus')).toBe('full-campus')
  })

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
    expect(isMvpApiAllowed('/api/notifications/outbox', 'GET')).toBe(true)
    expect(isMvpApiAllowed('/api/notifications/outbox/email-a/retry', 'POST')).toBe(true)
    expect(isMvpApiAllowed('/api/notifications/preferences', 'GET')).toBe(true)
    expect(isMvpApiAllowed('/api/notifications/preferences', 'PUT')).toBe(true)
    expect(isMvpApiAllowed('/api/notifications/templates', 'GET')).toBe(true)
    expect(isMvpApiAllowed('/api/notifications/templates/template-a', 'PUT')).toBe(false)
    expect(isMvpApiAllowed('/api/notifications/outbox', 'POST')).toBe(false)
    expect(isMvpApiAllowed('/api/internal/notifications/outbox/process', 'POST')).toBe(true)
    expect(isMvpApiAllowed('/api/academic/classes/class-a/attendance/check-in', 'POST')).toBe(true)
    expect(isMvpApiAllowed('/api/academic/classes/class-a/attendance', 'GET')).toBe(true)
    expect(isMvpApiAllowed('/api/academic/classes/catalog', 'GET')).toBe(true)
    expect(isMvpApiAllowed('/api/academic/classes/catalog/programs', 'POST')).toBe(true)
    expect(isMvpApiAllowed('/api/academic/classes/catalog/courses', 'POST')).toBe(true)
    expect(isMvpApiAllowed('/api/academic/classes/catalog/periods', 'POST')).toBe(true)
    expect(isMvpApiAllowed('/api/files/upload-sessions/file-a/content', 'PUT')).toBe(true)
    expect(isMvpApiAllowed('/api/learning/assignments/assignment-a/submit', 'POST')).toBe(true)
    expect(isMvpApiAllowed('/api/notifications/notification-a/read', 'POST')).toBe(true)
    expect(mvpApiDecision('/api/learning/new-private-handler', 'GET')).toBe('unknown')
    expect(mvpApiDecision('/api/internal/new-worker', 'POST')).toBe('unknown')
    expect(mvpApiDecision('/api/unknown/private', 'GET')).toBe('unknown')
    expect(isMvpApiAllowed('/api/learning/new-private-handler', 'GET')).toBe(false)
    expect(isMvpApiAllowed('/api/unknown/private', 'GET')).toBe(false)
    expect(isMvpPageAllowed('/')).toBe(true)
    expect(isMvpPageAllowed('/admin/kelas/class-a')).toBe(true)
    expect(isMvpPageAllowed('/pembelajaran/class-a/tugas/assignment-a')).toBe(true)
    expect(isMvpPageAllowed('/modul/route-baru')).toBe(false)
    expect(isMvpPageAllowed('/route-privat-baru')).toBe(false)
  })

  it('keeps administrator outside submit and grade permissions', () => {
    const permissions = permissionsForLmsMvpRole('administrator')
    expect(permissions).toContain('classes:manage')
    expect(permissions).toContain('enrollments:manage')
    expect(permissions).not.toContain('learning:submit')
    expect(permissions).not.toContain('learning:grade')
    expect(permissions).not.toContain('learning.write')
  })

  it('keeps every rendered LMS navigation command on the page allowlist', () => {
    const commands = navigationCommandsForAccess(
      feature => isFeatureEnabled('lms-mvp', feature),
      () => true,
      path => isMvpPageAllowed(path),
    )
    expect(commands.length).toBeGreaterThan(0)
    expect(commands.every(item => isMvpPageAllowed(item.to))).toBe(true)
    expect(commands.map(item => item.to)).not.toContain('/modul/pengaturan')
    expect(commands.map(item => item.to)).not.toContain('/pmb')
  })

  it('never seeds production notification state with demonstration records', () => {
    const source = readFileSync(resolve(process.cwd(), 'pages/notifikasi/index.vue'), 'utf8')
    expect(source).toContain('config.public.demoMode ? demoNotifications : []')
    expect(source).toContain('config.public.demoMode ? demoTemplates : []')
    expect(source).toContain('config.public.demoMode ? demoOutbox : []')
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
    expect(event.message).toBeUndefined()
    expect(event.breadcrumbs).toEqual([{}])
    expect(event.extra).toBeUndefined()
    expect(event.exception?.values?.[0]?.value).toBe('[Pesan teknis disaring]')
    expect(JSON.stringify(event)).not.toContain('student@example.test')
    expect(JSON.stringify(event)).not.toContain('abc.def.ghi')
  })
})
