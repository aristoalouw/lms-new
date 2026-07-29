import { expect, test, type APIResponse, type Page } from '@playwright/test'

const APP_ORIGIN = 'http://127.0.0.1:4173'
const SPACE_ID = 'class-mgt-401-a'
const MODULE_ID = 'learning-module-strategy-foundations'

async function loginAs(page: Page, profileId: 'student' | 'advisor' | 'admin') {
  const response = await page.request.post('/api/auth/demo-login', {
    data: { profileId },
    headers: { Origin: APP_ORIGIN },
  })
  expect(response.ok()).toBeTruthy()
}

async function successfulJson<T>(response: APIResponse): Promise<T> {
  const body = await response.text()
  expect(response.ok(), `${response.url()} failed (${response.status()}): ${body}`).toBeTruthy()
  return JSON.parse(body) as T
}

test('konten penuh, review jawaban dosen, dan mode baca-saja admin konsisten', async ({ page }) => {
  test.setTimeout(120_000)
  const runId = Date.now().toString(36)
  let mutation = 0
  const headers = () => ({
    Origin: APP_ORIGIN,
    'Idempotency-Key': `e2e-content-${runId}-${++mutation}`,
  })

  await loginAs(page, 'advisor')
  const materialTitle = `Materi aman ${runId}`
  await successfulJson(await page.request.post(`/api/learning/spaces/${SPACE_ID}/materials`, {
    headers: headers(),
    data: {
      moduleId: MODULE_ID,
      kind: 'RICH_TEXT',
      title: materialTitle,
      summary: 'Ringkasan tidak menggantikan isi materi.',
      content: {
        format: 'QUILL_DELTA',
        ops: [
          { insert: `Tujuan lengkap ${runId}\n`, attributes: { header: 1 } },
          { insert: 'Paragraf penting ', attributes: { bold: true } },
          { insert: 'dan referensi resmi', attributes: { link: 'https://example.edu/panduan' } },
          { insert: '\n' },
        ],
      },
      order: 40,
      status: 'PUBLISHED',
    },
  }))

  const now = Date.now()
  const assignmentTitle = `Tugas review ${runId}`
  const assignment = await successfulJson<{ assignment: { id: string } }>(await page.request.post(`/api/learning/spaces/${SPACE_ID}/assignments`, {
    headers: headers(),
    data: {
      moduleId: MODULE_ID,
      title: assignmentTitle,
      instructions: { format: 'PLAIN_TEXT', text: 'Kirim jawaban yang dapat dibaca dosen.' },
      opensAt: new Date(now - 60 * 60_000).toISOString(),
      dueAt: new Date(now + 60 * 60_000).toISOString(),
      closesAt: new Date(now + 2 * 60 * 60_000).toISOString(),
      maximumPoints: 100,
      maximumAttempts: 1,
      maximumFiles: 0,
      status: 'PUBLISHED',
    },
  }))

  await loginAs(page, 'student')
  await page.goto(`/pembelajaran/${SPACE_ID}/materi`)
  await expect(page.getByText(materialTitle, { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: `Tujuan lengkap ${runId}` })).toBeVisible()
  await expect(page.getByText('Paragraf penting', { exact: false })).toBeVisible()
  await expect(page.getByRole('link', { name: 'dan referensi resmi' })).toHaveAttribute('href', 'https://example.edu/panduan')

  const answer = `Jawaban final ${runId} dengan argumen yang harus terlihat sebelum penilaian.`
  await page.goto(`/pembelajaran/${SPACE_ID}/tugas/${assignment.assignment.id}`)
  await page.getByLabel('Jawaban').fill(answer)
  await page.getByRole('button', { name: 'Simpan draf' }).click()
  await expect(page.getByRole('status')).toContainText('Draf tersimpan')
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Kirim final' }).click()
  await expect(page.getByRole('status')).toContainText('Attempt final berhasil dikirim')

  await loginAs(page, 'advisor')
  await page.goto(`/pembelajaran/${SPACE_ID}/tugas/${assignment.assignment.id}`)
  const review = page.locator('.review-row').filter({ hasText: 'student-001' })
  await expect(review).toBeVisible()
  await expect(review.getByRole('heading', { name: 'Jawaban final' })).toBeVisible()
  await expect(review.getByText(answer, { exact: true })).toBeVisible()
  await expect(review.getByRole('heading', { name: 'Lampiran' })).toBeVisible()
  await expect(review.getByText('Tidak ada lampiran.')).toBeVisible()

  await loginAs(page, 'admin')
  await page.goto(`/pembelajaran/${SPACE_ID}/tugas/${assignment.assignment.id}`)
  await expect(page.getByRole('heading', { name: 'Tampilan dukungan baca-saja' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Jawaban Anda' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Pengumpulan dan penilaian' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Kirim final' })).toHaveCount(0)

  await page.goto(`/pembelajaran/${SPACE_ID}/presensi`)
  await expect(page.getByRole('heading', { name: 'Tampilan dukungan baca-saja' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Buka halaman konfirmasi' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Presensi' })).toHaveCount(0)
})
