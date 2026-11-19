import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('production real-data invariants', () => {
  it('cannot expose demo mode in a production build', () => {
    const config = source('nuxt.config.ts')
    expect(config).toContain("process.env.NODE_ENV !== 'production' && process.env.NUXT_PUBLIC_DEMO_MODE !== 'false'")
  })

  it('fails closed instead of falling back to mock data in production', () => {
    const firebaseAdmin = source('server/utils/firebase-admin.ts')
    expect(firebaseAdmin).toContain("process.env.NODE_ENV === 'production' && process.env.ALLOW_PRODUCTION_MOCK !== 'true'")
    expect(firebaseAdmin).toContain("return process.env.NODE_ENV === 'production' ? 'unavailable' : 'mock'")
  })

  it('loads PMB dashboard records and catalog from authenticated APIs', () => {
    const pmb = source('pages/pmb/index.vue')
    expect(pmb).toContain('const applications = ref<AdmissionApplicationView[]>([])')
    expect(pmb).toContain("$api.get<AdmissionListResult>('/admissions/applications'")
    expect(pmb).toContain("$api.get<AdmissionCatalogResponse>('/admissions/catalog')")
    expect(pmb).toContain('Data Firebase aktual')
  })

  it('initializes full-campus operational screens empty outside demo mode', () => {
    const notifications = source('pages/notifikasi/index.vue')
    const pddikti = source('pages/pddikti/index.vue')
    const graduation = source('pages/kelulusan/index.vue')
    expect(notifications).toContain('config.public.demoMode ? demoNotifications : []')
    expect(pddikti).toContain('config.public.demoMode ? [demoJob(')
    expect(pddikti).toContain('config.public.demoMode ? [demoReconciliation] : []')
    expect(graduation).toContain('config.public.demoMode ? [demoDocument] : []')
  })
})
