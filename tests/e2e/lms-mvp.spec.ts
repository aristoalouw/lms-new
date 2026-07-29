import { expect, test, type APIResponse, type Page } from '@playwright/test'

const APP_ORIGIN = 'http://127.0.0.1:4173'

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

async function expectPageQuality(page: Page) {
  await expect(page.locator('main').first()).toBeVisible()
  await expect(page.locator('h1')).toHaveCount(1)
  await expect(page.locator('h1')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true)
  expect(await page.evaluate(() => {
    const ids = [...document.querySelectorAll<HTMLElement>('[id]')].map(element => element.id)
    return ids.length === new Set(ids).size
  })).toBe(true)
  expect(await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('button, a[href]')].every(element => {
    const label = element.getAttribute('aria-label')
      || element.getAttribute('aria-labelledby')
      || element.getAttribute('title')
      || element.textContent
    return Boolean(label?.trim())
  }))).toBe(true)
  expect(await page.evaluate(() => [...document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
    'input:not([type="hidden"]), select, textarea',
  )].every(element => Boolean(
    element.getAttribute('aria-label')
    || element.getAttribute('aria-labelledby')
    || element.closest('label')
    || (element.id && document.querySelector(`label[for="${CSS.escape(element.id)}"]`)),
  )))).toBe(true)
  await page.keyboard.press('Tab')
  expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true)
}

test('anonymous API ditolak dan modul non-MVP menjadi 404', async ({ request }) => {
  expect((await request.get('/api/learning/spaces')).status()).toBe(401)
  expect((await request.get('/api/dashboard/summary')).status()).toBe(404)
  expect((await request.get('/api/dashboard/export')).status()).toBe(404)
  expect((await request.get('/api/billing/invoices')).status()).toBe(404)
  expect((await request.get('/keuangan')).status()).toBe(404)
  expect((await request.post('/api/learning/spaces', { data: {} })).status()).toBe(404)
  expect((await request.put('/api/learning/spaces/class-a/gamification', { data: {} })).status()).toBe(404)
  expect((await request.post('/api/academic/classes/class-a/grades/publish', { data: {} })).status()).toBe(404)
  expect((await request.get('/api/notifications/preferences')).status()).toBe(401)
  expect((await request.get('/api/notifications/templates')).status()).toBe(401)
  expect((await request.get('/api/notifications/outbox')).status()).toBe(401)
  expect((await request.post('/api/notifications/outbox', { data: {} })).status()).toBe(404)
  expect((await request.put('/api/notifications/templates/template-a', { data: {} })).status()).toBe(404)
  expect((await request.post('/api/internal/notifications/outbox/process', { data: {} })).status()).toBe(403)
})

test('halaman privat dan operasional mengikuti role', async ({ browser }) => {
  const anonymousContext = await browser.newContext()
  const anonymousPage = await anonymousContext.newPage()
  await anonymousPage.goto('/berkas')
  await expect(anonymousPage).toHaveURL(/\/login(?:\?|$)/)
  await anonymousContext.close()

  const studentContext = await browser.newContext()
  const studentPage = await studentContext.newPage()
  await loginAs(studentPage, 'student')
  const auditResponse = await studentPage.goto('/modul/audit-backup')
  expect(auditResponse?.status()).toBe(403)
  await expect(studentPage.getByRole('heading', { name: '403' })).toBeVisible()
  await studentContext.close()
})

test('mahasiswa hanya melihat alur belajar dan submission miliknya', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 })
  await loginAs(page, 'student')
  await page.goto('/pembelajaran')
  await expect(page.getByRole('heading', { name: 'Ruang pembelajaran' })).toBeVisible()
  await page.getByRole('link', { name: /Manajemen Strategik/ }).click()
  await expect(page.getByRole('link', { name: 'Kelola' })).toHaveCount(0)
  await page.goto('/pembelajaran/class-mgt-401-a/tugas')
  await page.getByRole('link', { name: /Analisis kasus strategi/ }).click()
  await expect(page.getByRole('heading', { name: 'Jawaban Anda' })).toBeVisible()
  await page.goto('/notifikasi')
  await expect(page.getByText('Kotak masuk', { exact: true }).first()).toBeVisible()
  await page.locator('.notification-tabs').getByRole('button', { name: /Preferensi/ }).click()
  await expect(page.getByText('Ringkasan melalui email')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Operasional' })).toHaveCount(0)
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
  await page.goto('/notifikasi')
  await page.getByRole('button', { name: 'Operasional' }).click()
  await expect(page.getByText('Baca-saja', { exact: true })).toBeVisible()
  await expect(page.getByText('Pengumuman kelas diterbitkan')).toBeVisible()
  await expect(page.getByText('Tiket layanan dibuat')).toHaveCount(0)
  const response = await page.request.post('/api/learning/spaces/class-mgt-401-a/modules', {
    headers: { Origin: 'http://127.0.0.1:4173', 'Idempotency-Key': `e2e-admin-denied-${Date.now()}` },
    data: { title: 'Tidak boleh', order: 99, status: 'DRAFT' },
  })
  expect(response.status()).toBe(403)
})

test('endpoint sensitif menolak role yang tidak berwenang', async ({ page }) => {
  const mutationHeaders = (purpose: string) => ({
    Origin: APP_ORIGIN,
    'Idempotency-Key': `e2e-negative-${purpose}-${Date.now()}`,
  })

  await loginAs(page, 'student')
  expect((await page.request.get('/api/accounts')).status()).toBe(403)
  expect((await page.request.get('/api/academic/classes/class-mgt-401-a/enrollments')).status()).toBe(403)
  expect((await page.request.post('/api/academic/classes/class-mgt-401-a/attendance/challenges', {
    headers: mutationHeaders('student-attendance-issue'),
    data: { meetingNumber: 1, ttlSeconds: 120 },
  })).status()).toBe(403)
  expect((await page.request.post('/api/learning/spaces/class-mgt-401-a/modules', {
    headers: mutationHeaders('student-module'),
    data: {},
  })).status()).toBe(403)
  expect((await page.request.post('/api/learning/forum/posts/unknown-post/moderate', {
    headers: mutationHeaders('student-moderate'),
    data: {},
  })).status()).toBe(403)

  await loginAs(page, 'advisor')
  expect((await page.request.get('/api/accounts')).status()).toBe(403)
  expect((await page.request.post('/api/academic/classes/class-mgt-401-a/enrollments', {
    headers: mutationHeaders('lecturer-enrollment'),
    data: {
      studentId: 'student-002',
      studentUid: 'student-002',
      studentNumber: '23011002',
      studentName: 'Bima Pratama',
      programStudyId: 'management-s1',
      reason: 'Dosen tidak boleh membuat enrolment.',
      sourceRef: 'negative-role-test',
    },
  })).status()).toBe(403)
  expect((await page.request.post('/api/learning/spaces/class-mgt-401-a/modules', {
    headers: mutationHeaders('lecturer-valid-role'),
    data: {},
  })).status()).toBe(400)

  await loginAs(page, 'admin')
  expect((await page.request.post('/api/learning/assignments/learning-assignment-case-analysis/submit', {
    headers: mutationHeaders('admin-submit'),
    data: { expectedVersion: 0 },
  })).status()).toBe(403)
  expect((await page.request.put('/api/learning/attempts/unknown-attempt/grade', {
    headers: mutationHeaders('admin-grade'),
    data: {},
  })).status()).toBe(403)
  expect((await page.request.post('/api/learning/spaces/class-mgt-401-a/forum/threads', {
    headers: mutationHeaders('admin-forum'),
    data: {},
  })).status()).toBe(403)
  expect((await page.request.post('/api/academic/classes/class-mgt-401-a/attendance/challenges', {
    headers: mutationHeaders('admin-attendance-issue'),
    data: { meetingNumber: 1, ttlSeconds: 120 },
  })).status()).toBe(403)
})

test('administrator menambah mahasiswa dari UI tanpa scope unit lama', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  const runId = Date.now().toString(36)
  await loginAs(page, 'admin')
  await page.goto('/admin/pengguna')
  await page.getByRole('button', { name: 'Hanya esensial' }).click()
  const addUser = page.getByRole('button', { name: 'Tambah pengguna' })
  await expect(addUser).toBeVisible()
  await page.waitForTimeout(500)
  await addUser.click()
  await expect(page.getByRole('heading', { name: 'Tambah pengguna' })).toBeVisible()
  await page.getByLabel('Nama lengkap').fill(`Mahasiswa UI ${runId}`)
  await page.getByLabel('Email institusi / pribadi').fill(`student.ui.${runId}@example.test`)
  await page.getByLabel('Program studi (wajib)').selectOption('management-s1')
  await page.getByLabel('NIM / ID mahasiswa unik (wajib)').fill(`UI${runId.toUpperCase()}`)
  await page.getByLabel('Angkatan (opsional)').fill('2026')
  await page.getByRole('button', { name: 'Simpan akun' }).click()

  await expect(page.getByRole('status')).toContainText(`Akun Mahasiswa UI ${runId} berhasil dibuat.`)
  await expect(page.getByText('scope.unitIds', { exact: false })).toHaveCount(0)
  expect(pageErrors).toEqual([])
})

test('journey primer LMS selesai dari pembuatan akun hingga nilai terbit', async ({ page }) => {
  test.setTimeout(180_000)
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  const runId = Date.now().toString(36)
  let mutationSequence = 0
  const mutationHeaders = (label: string) => ({
    Origin: APP_ORIGIN,
    'Idempotency-Key': `e2e-${label}-${runId}-${++mutationSequence}`,
  })

  await loginAs(page, 'admin')
  const emptyScope = { unitIds: [], programStudyIds: [], cohortYears: [], studentIds: [] }
  const createdStudent = await successfulJson<{ account: { id: string } }>(await page.request.post('/api/accounts', {
    headers: mutationHeaders('create-student'),
    data: {
      email: `student.${runId}@example.test`,
      displayName: `Mahasiswa E2E ${runId}`,
      roles: ['student'],
      scope: {
        unitIds: [],
        programStudyIds: ['management-s1'],
        cohortYears: [2026],
        studentIds: [`student-${runId}`],
      },
      status: 'active',
      guardianStudentIds: [],
    },
  }))
  const createdLecturer = await successfulJson<{ account: { id: string } }>(await page.request.post('/api/accounts', {
    headers: mutationHeaders('create-lecturer'),
    data: {
      email: `lecturer.${runId}@example.test`,
      displayName: `Dosen E2E ${runId}`,
      roles: ['lecturer'],
      scope: {
        unitIds: [],
        programStudyIds: ['management-s1'],
        cohortYears: [],
        studentIds: [],
      },
      status: 'active',
      guardianStudentIds: [],
    },
  }))
  await successfulJson(await page.request.post('/api/accounts', {
    headers: mutationHeaders('create-admin'),
    data: {
      email: `admin.${runId}@example.test`,
      displayName: `Admin E2E ${runId}`,
      roles: ['administrator'],
      scope: emptyScope,
      status: 'active',
      guardianStudentIds: [],
    },
  }))

  const catalog = await successfulJson<{
    periods: Array<{ id: string }>
    courses: Array<{ id: string; programStudyId: string }>
  }>(await page.request.get('/api/academic/classes/catalog'))
  const course = catalog.courses.find(item => item.programStudyId === 'management-s1')
  expect(course).toBeTruthy()
  expect(catalog.periods[0]).toBeTruthy()

  const now = Date.now()
  const section = `E2E${runId.slice(-10)}`.toUpperCase()
  const createdClass = await successfulJson<{
    value: { classRecord: { id: string }; learningSpace: { id: string } }
  }>(await page.request.post('/api/academic/classes', {
    headers: mutationHeaders('create-class'),
    data: {
      courseVersionId: course!.id,
      section,
      periodId: catalog.periods[0]!.id,
      lecturerIds: ['advisor-001', createdLecturer.account.id],
      lecturerNames: ['Dr. Budi Santoso', `Dosen E2E ${runId}`],
      capacity: 10,
      firstMeetingStartsAt: new Date(now - 2 * 60_000).toISOString(),
      meetingCount: 2,
      meetingDurationMinutes: 120,
    },
  }))
  const classId = createdClass.value.classRecord.id
  expect(createdClass.value.learningSpace.id).toBe(classId)

  await successfulJson(await page.request.post(`/api/academic/classes/${classId}/enrollments`, {
    headers: mutationHeaders('enrol-primary-student'),
    data: {
      studentId: 'student-001',
      studentUid: 'student-001',
      studentNumber: '23011001',
      studentName: 'Nabila Putri',
      programStudyId: 'management-s1',
      reason: 'Enrolment E2E untuk verifikasi journey primer LMS.',
      sourceRef: `e2e-${runId}`,
    },
  }))
  await successfulJson(await page.request.post(`/api/academic/classes/${classId}/enrollments`, {
    headers: mutationHeaders('enrol-created-student'),
    data: {
      studentId: `student-${runId}`,
      studentUid: createdStudent.account.id,
      studentNumber: `E2E${runId.toUpperCase()}`,
      studentName: `Mahasiswa E2E ${runId}`,
      programStudyId: 'management-s1',
      reason: 'Enrolment akun sintetis yang dibuat administrator untuk verifikasi.',
      sourceRef: `e2e-created-${runId}`,
    },
  }))

  await loginAs(page, 'advisor')
  const moduleResult = await successfulJson<{ module: { id: string } }>(await page.request.post(`/api/learning/spaces/${classId}/modules`, {
    headers: mutationHeaders('create-module'),
    data: {
      title: `Fondasi MVP ${runId}`,
      description: { format: 'PLAIN_TEXT', text: 'Modul terbit untuk journey primer LMS.' },
      order: 1,
      status: 'PUBLISHED',
    },
  }))
  const materialTitle = `Materi primer ${runId}`
  await successfulJson(await page.request.post(`/api/learning/spaces/${classId}/materials`, {
    headers: mutationHeaders('create-material'),
    data: {
      moduleId: moduleResult.module.id,
      kind: 'RICH_TEXT',
      title: materialTitle,
      summary: 'Materi yang hanya dapat dibaca peserta aktif.',
      content: { format: 'PLAIN_TEXT', text: 'Konten pembelajaran terbit dan tersanitasi.' },
      order: 1,
      status: 'PUBLISHED',
    },
  }))
  const assignmentTitle = `Tugas primer ${runId}`
  const assignmentResult = await successfulJson<{ assignment: { id: string } }>(await page.request.post(`/api/learning/spaces/${classId}/assignments`, {
    headers: mutationHeaders('create-assignment'),
    data: {
      moduleId: moduleResult.module.id,
      title: assignmentTitle,
      instructions: { format: 'PLAIN_TEXT', text: 'Kirim analisis ringkas untuk verifikasi journey.' },
      opensAt: new Date(now - 60 * 60_000).toISOString(),
      dueAt: new Date(now + 24 * 60 * 60_000).toISOString(),
      closesAt: new Date(now + 48 * 60 * 60_000).toISOString(),
      maximumPoints: 100,
      maximumAttempts: 2,
      maximumFiles: 0,
      status: 'PUBLISHED',
    },
  }))
  const assignmentId = assignmentResult.assignment.id
  const challenge = await successfulJson<{ value: { challengeToken: string } }>(await page.request.post(`/api/academic/classes/${classId}/attendance/challenges`, {
    headers: mutationHeaders('issue-attendance'),
    data: { meetingNumber: 1, ttlSeconds: 300 },
  }))

  await loginAs(page, 'student')
  const learnerSpace = await successfulJson<{
    space: { id: string }
    materials: Array<{ id: string; title: string }>
    assignments: Array<{ id: string; title: string }>
  }>(await page.request.get(`/api/learning/spaces/${classId}`))
  expect(learnerSpace.space.id).toBe(classId)
  expect(learnerSpace.materials).toEqual(expect.arrayContaining([expect.objectContaining({ title: materialTitle })]))
  expect(learnerSpace.assignments).toEqual(expect.arrayContaining([expect.objectContaining({ id: assignmentId })]))
  await page.setViewportSize({ width: 360, height: 800 })
  await page.goto(`/pembelajaran/${classId}/materi`)
  await page.waitForTimeout(500)
  expect(pageErrors).toEqual([])
  await expect(page.getByText(materialTitle, { exact: true })).toBeVisible()
  await expectPageQuality(page)

  await page.goto(`/pembelajaran/${classId}/tugas/${assignmentId}`)
  await expect(page.getByRole('heading', { name: assignmentTitle })).toBeVisible()
  await page.getByLabel('Jawaban').fill(`Jawaban E2E ${runId} yang siap dinilai.`)
  await page.getByRole('button', { name: 'Simpan draf' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Draf tersimpan' })).toBeVisible()
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Kirim final' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Attempt final berhasil dikirim' })).toBeVisible()
  const ownHistory = await successfulJson<{
    attempts: Array<{ id: string; attemptNumber: number }>
  }>(await page.request.get(`/api/learning/assignments/${assignmentId}/attempts`))
  expect(ownHistory.attempts).toEqual([expect.objectContaining({ attemptNumber: 1 })])
  const attemptId = ownHistory.attempts[0]!.id
  const studentGradeAttempt = await page.request.put(`/api/learning/attempts/${attemptId}/grade`, {
    headers: { Origin: APP_ORIGIN },
    data: {
      expectedVersion: 0,
      score: 100,
      feedback: { format: 'PLAIN_TEXT', text: 'Mahasiswa tidak boleh menilai submission.' },
      status: 'PUBLISHED',
    },
  })
  expect(studentGradeAttempt.status()).toBe(403)

  await page.goto(`/presensi#${challenge.value.challengeToken}`)
  await expect(page.getByRole('heading', { name: 'Presensi berhasil dicatat' })).toBeVisible()
  expect(new URL(page.url()).hash).toBe('')
  expect(await page.evaluate(() => sessionStorage.getItem('lms-attendance-challenge'))).toBeNull()

  await loginAs(page, 'admin')
  const administratorGradeAttempt = await page.request.put(`/api/learning/attempts/${attemptId}/grade`, {
    headers: { Origin: APP_ORIGIN },
    data: {
      expectedVersion: 0,
      score: 100,
      feedback: { format: 'PLAIN_TEXT', text: 'Administrator tidak boleh menilai submission.' },
      status: 'PUBLISHED',
    },
  })
  expect(administratorGradeAttempt.status()).toBe(403)

  await loginAs(page, 'advisor')
  await page.setViewportSize({ width: 768, height: 1024 })
  await page.goto(`/pembelajaran/${classId}/tugas/${assignmentId}`)
  const review = page.locator('.review-row').filter({ hasText: 'student-001' })
  await expect(review).toBeVisible()
  await review.locator('input[type="number"]').fill('92')
  await review.locator('textarea').fill('Analisis kuat, terstruktur, dan menggunakan bukti yang tepat.')
  await review.locator('select').selectOption('PUBLISHED')
  await review.getByRole('button', { name: 'Simpan' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Nilai dan feedback diterbitkan' })).toBeVisible()
  await expectPageQuality(page)

  await loginAs(page, 'student')
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto(`/pembelajaran/${classId}/tugas/${assignmentId}`)
  const publishedGrade = page.locator('.published-grade')
  await expect(publishedGrade).toContainText('92 / 100')
  await expect(publishedGrade).toContainText('Analisis kuat')
  await expect(page.getByText('Attempt 1', { exact: true })).toBeVisible()
  const historyResponse = await successfulJson<{
    publishedGrade?: { attemptId: string; score: number; status: string }
  }>(await page.request.get(`/api/learning/assignments/${assignmentId}/attempts`))
  expect(historyResponse.publishedGrade).toMatchObject({ attemptId, score: 92, status: 'PUBLISHED' })
  await expectPageQuality(page)
  expect(pageErrors).toEqual([])
})
