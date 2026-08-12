import { expect, test, type Browser, type Page } from '@playwright/test'

const APP_ORIGIN = 'http://127.0.0.1:4174'

type DemoProfile =
  | 'applicant'
  | 'student'
  | 'advisor'
  | 'academic'
  | 'finance'
  | 'admissions'
  | 'leader'
  | 'admin'

const hydrationFailure = /hydration (?:completed but contains mismatches|node mismatch|text content mismatch)|hydration mismatch/i

async function loginAs(page: Page, profileId: DemoProfile) {
  const response = await page.request.post('/api/auth/demo-login', {
    data: { profileId },
    headers: { Origin: APP_ORIGIN },
  })
  expect(response.ok(), `${profileId} demo session failed: ${await response.text()}`).toBeTruthy()
}

async function expectHealthyPage(page: Page, path: string) {
  const hydrationMessages: string[] = []
  const runtimeErrors: string[] = []
  const serverErrors: string[] = []
  const onConsole = (message: { type: () => string; text: () => string }) => {
    const text = message.text()
    if (hydrationFailure.test(text)) hydrationMessages.push(text)
    if (message.type() === 'error' && !/^Failed to load resource:/i.test(text)) runtimeErrors.push(text)
  }
  const onPageError = (error: Error) => runtimeErrors.push(error.message)
  const onResponse = (response: { status: () => number; url: () => string }) => {
    if (response.status() >= 500) serverErrors.push(`${response.status()} ${response.url()}`)
  }
  page.on('console', onConsole)
  page.on('pageerror', onPageError)
  page.on('response', onResponse)
  try {
    const response = await page.goto(path, { waitUntil: 'domcontentloaded' })
    expect(response?.status(), `${path} did not render successfully`).toBe(200)
    await expect(page.locator('main').first()).toBeVisible()
    await expect(page.locator('h1')).toHaveCount(1)
    await expect(page.locator('h1')).toBeVisible()
    await page.waitForTimeout(500)
    expect(hydrationMessages, `${path} emitted hydration mismatch`).toEqual([])
    expect(runtimeErrors, `${path} emitted browser errors`).toEqual([])
    expect(serverErrors, `${path} emitted server errors`).toEqual([])
  } finally {
    page.off('console', onConsole)
    page.off('pageerror', onPageError)
    page.off('response', onResponse)
  }
}

async function verifyRoleRoutes(browser: Browser, profileId: DemoProfile, routes: string[]) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await loginAs(page, profileId)
  for (const route of routes) await expectHealthyPage(page, route)
  await context.close()
}

test('halaman publik full-campus bebas error hydration', async ({ page }) => {
  await expectHealthyPage(page, '/login')
  await expectHealthyPage(page, '/pmb/informasi')
})

test('seluruh role membuka ruang kerja full-campus tanpa hydration mismatch', async ({ browser }) => {
  await verifyRoleRoutes(browser, 'applicant', ['/pmb/status', '/pmb/dokumen'])
  await verifyRoleRoutes(browser, 'student', ['/akademik/krs', '/akademik/administrasi', '/keuangan', '/pembelajaran', '/kemahasiswaan', '/layanan'])
  await verifyRoleRoutes(browser, 'advisor', ['/akademik/kelas', '/akademik/administrasi', '/pembelajaran'])
  await verifyRoleRoutes(browser, 'academic', ['/akademik', '/akademik/master', '/akademik/mahasiswa', '/akademik/administrasi', '/admin/kelas'])
  await verifyRoleRoutes(browser, 'finance', ['/keuangan', '/keuangan/rekonsiliasi'])
  await verifyRoleRoutes(browser, 'admissions', ['/pmb', '/pmb/kelola', '/pmb/seleksi'])
  await verifyRoleRoutes(browser, 'leader', ['/', '/pddikti', '/tracer-study'])
  await verifyRoleRoutes(browser, 'admin', ['/admin/pengguna', '/modul/pengaturan', '/pmb/pengaturan', '/kelulusan', '/tracer-study', '/pddikti', '/modul/audit-backup'])
})

test('dashboard mahasiswa tetap responsif pada lebar 360 px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 })
  await loginAs(page, 'student')
  await expectHealthyPage(page, '/akademik/krs')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true)
})
