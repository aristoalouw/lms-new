import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('production public identity and contact invariants', () => {
  it('does not publish fictional support contacts or empty public links', () => {
    const login = source('pages/login.vue')
    const registration = source('pages/pmb/daftar.vue')
    const admissions = source('pages/pmb/informasi.vue')

    expect(login).not.toContain('helpdesk@kampus.ac.id')
    expect(login).not.toContain('(021) 555-0124')
    expect(registration).not.toContain('pmb@kampus.ac.id')
    expect(admissions).not.toContain('href="#"')
  })

  it('renders public branding and contacts from deployment configuration', () => {
    const nuxtConfig = source('nuxt.config.ts')
    const publicSurfaces = [
      source('components/AppSidebar.vue'),
      source('pages/login.vue'),
      source('pages/pmb/daftar.vue'),
      source('pages/pmb/informasi.vue'),
    ].join('\n')

    expect(nuxtConfig).toContain('NUXT_PUBLIC_SUPPORT_EMAIL')
    expect(nuxtConfig).toContain('NUXT_PUBLIC_ADMISSIONS_EMAIL')
    expect(nuxtConfig).toContain('NUXT_PUBLIC_PRIVACY_URL')
    expect(publicSurfaces).toContain('config.public.appName')
    expect(publicSurfaces).toContain('config.public.supportEmail')
    expect(publicSurfaces).toContain('config.public.admissionsEmail')
  })
})
