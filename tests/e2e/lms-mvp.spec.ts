import { expect, test, type Page } from '@playwright/test'

async function loginAs(page: Page, profileId: 'student' | 'advisor' | 'admin') {
  await page.goto('/login')
  const response = await page.request.post('/api/auth/demo-login', {
    data: { profileId },
    headers: { Origin: 'http://127.0.0.1:4173' },
  })
  expect(response.ok()).toBeTruthy()
}

test('anonymous API ditolak dan modul non-MVP menjadi 404', async ({ request }) => {
  expect((await request.get('/api/learning/spaces')).status()).toBe(401)
  expect((await request.get('/api/billing/invoices')).status()).toBe(404)
  expect((await request.get('/keuangan')).status()).toBe(404)
  expect((await request.post('/api/learning/spaces', { data: {} })).status()).toBe(404)
  expect((await request.put('/api/learning/spaces/class-a/gamification', { data: {} })).status()).toBe(404)
  expect((await request.post('/api/academic/classes/class-a/grades/publish', { data: {} })).status()).toBe(404)
  expect((await request.get('/api/notifications/templates')).status()).toBe(404)
  expect((await request.get('/api/notifications/outbox')).status()).toBe(404)
  expect((await request.post('/api/internal/notifications/outbox/process', { data: {} })).status()).toBe(404)
})

test('mahasiswa hanya melihat alur belajar dan submission miliknya', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 })
  await loginAs(page, 'student')
  await page.goto('/pembelajaran')
  await expect(page.getByRole('heading', { name: 'Ruang pembelajaran' })).toBeVisible()
  await page.getByRole('link', { name: /Manajemen Strategik/ }).click()
  await expect(page.getByRole('link', { name: 'Kelola' })).toHaveCount(0)
  await page.getByRole('link', { name: 'Tugas' }).click()
  await page.getByRole('link', { name: /Analisis kasus strategi/ }).click()
  await expect(page.getByRole('heading', { name: 'Jawaban Anda' })).toBeVisible()
  await page.goto('/notifikasi')
  await expect(page.getByText('Kotak masuk', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('Ringkasan melalui email')).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true)
})

test('dosen pengampu melihat pengelolaan kelas', async ({ page }) => {
  await loginAs(page, 'advisor')
  await page.goto('/pembelajaran/class-mgt-401-a')
  await expect(page.getByRole('link', { name: 'Kelola' })).toBeVisible()
  await page.getByRole('link', { name: 'Kelola' }).click()
  await expect(page.getByRole('heading', { name: 'Modul' })).toBeVisible()
})

test('administrator mengelola kelas tetapi tidak dapat membuat konten LMS', async ({ page }) => {
  await loginAs(page, 'admin')
  await page.goto('/admin/kelas')
  await expect(page.getByRole('heading', { name: /Kelas/ })).toBeVisible()
  await page.goto('/modul/audit-backup')
  await expect(page.getByRole('heading', { name: 'Audit & backup' })).toBeVisible()
  await expect(page.getByText('Liveness')).toBeVisible()
  const response = await page.request.post('/api/learning/spaces/class-mgt-401-a/modules', {
    headers: { Origin: 'http://127.0.0.1:4173', 'Idempotency-Key': `e2e-admin-denied-${Date.now()}` },
    data: { title: 'Tidak boleh', order: 99, status: 'DRAFT' },
  })
  expect(response.status()).toBe(403)
})
