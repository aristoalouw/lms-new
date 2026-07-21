import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createFileUploadSession,
  expireUploadSessions,
  fileMockStateForTests,
  finalizeFileUpload,
  getPrivateFileDetail,
  issuePrivateFileDownload,
  listPrivateFiles,
  resetFileServiceForTests,
  softDeletePrivateFile,
  storeMockUploadContent,
} from '../../server/services/files'
import {
  configureMalwareScanner,
  DevelopmentSignatureScanner,
  FailClosedMalwareScanner,
  malwareScanner,
  type MalwareScanner,
} from '../../server/services/files-scanner'
import { resetFileStorageForTests } from '../../server/services/files-storage'
import { CampusError } from '../../server/utils/errors'
import { resetMockState } from '../../server/utils/mock-store'
import { resetAcademicClassStateForTests, updateClassEnrollment } from '../../server/services/academic-classes'
import { resetLearningMockState } from '../../server/services/learning-mock'
import { authContext } from './fixtures'

function bytes(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, 'latin1'))
}

const cleanPdf = bytes('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF')
const cleanPng = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])

async function uploadPdf(owner = authContext('student-owner', ['student'])) {
  const created = await createFileUploadSession(owner, {
    name: 'Kartu Rencana Studi.pdf',
    declaredMimeType: 'application/pdf',
    sizeBytes: cleanPdf.byteLength,
  })
  await storeMockUploadContent(owner, created.session.id, cleanPdf, 'application/pdf')
  const finalized = await finalizeFileUpload(owner, created.session.id)
  return { owner, created, finalized }
}

describe('private file management', () => {
  beforeEach(() => {
    process.env.CAMPUS_DATA_MODE = 'mock'
    delete process.env.FILE_QUOTA_BYTES
    resetMockState()
    resetAcademicClassStateForTests()
    resetLearningMockState()
    resetFileServiceForTests()
    resetFileStorageForTests()
    configureMalwareScanner(new DevelopmentSignatureScanner())
  })

  afterEach(() => {
    delete process.env.FILE_QUOTA_BYTES
    configureMalwareScanner(undefined)
    resetFileStorageForTests()
  })

  it('reserves quota, verifies bytes, quarantines, scans, and accepts a clean upload', async () => {
    const { owner, created, finalized } = await uploadPdf()

    expect(Date.parse(created.session.expiresAt) - Date.parse(created.session.createdAt)).toBe(10 * 60 * 1000)
    expect(created.quota).toMatchObject({ usedBytes: 0, reservedBytes: cleanPdf.byteLength })
    expect(finalized.file).toMatchObject({ status: 'CLEAN', currentVersion: 1, versionCount: 1, sizeBytes: cleanPdf.byteLength })
    expect(finalized.versions[0]).toMatchObject({ status: 'CLEAN', detectedMimeType: 'application/pdf', scanResult: 'CLEAN' })
    expect(finalized.quota).toMatchObject({ usedBytes: cleanPdf.byteLength, reservedBytes: 0 })
    expect(await listPrivateFiles(owner)).toMatchObject({ items: [{ id: created.file.id, status: 'CLEAN' }] })

    const actions = (await import('../../server/utils/mock-store')).mockState().auditEntries.map(entry => entry.action)
    expect(actions).toEqual(expect.arrayContaining(['FILE_UPLOAD_RESERVED', 'FILE_QUARANTINED', 'FILE_ACCEPTED']))
  })

  it('replays an upload reservation by idempotency key without double-reserving quota', async () => {
    const owner = authContext('student-owner', ['student'])
    const input = { name: 'Materi kelas.pdf', declaredMimeType: 'application/pdf', sizeBytes: cleanPdf.byteLength }
    const first = await createFileUploadSession(owner, input, 'file-upload-idem-0001')
    const replay = await createFileUploadSession(owner, input, 'file-upload-idem-0001')

    expect(replay.session.id).toBe(first.session.id)
    expect(replay.file.id).toBe(first.file.id)
    expect(replay.quota.reservedBytes).toBe(cleanPdf.byteLength)
    expect(fileMockStateForTests().sessions.size).toBe(1)
    await expect(createFileUploadSession(owner, { ...input, name: 'File berbeda.pdf' }, 'file-upload-idem-0001'))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' } satisfies Partial<CampusError>)
  })

  it('revalidates class membership on every class-scoped download, including for the owner', async () => {
    const owner = authContext('student-001', ['student'], ['management-s1'])
    owner.scope.studentIds = ['student-001']
    const created = await createFileUploadSession(owner, {
      name: 'Tugas kelas.pdf', declaredMimeType: 'application/pdf', sizeBytes: cleanPdf.byteLength,
      access: {
        visibility: 'SCOPED', allowedRoles: ['student', 'lecturer'], allowedUserIds: [],
        unitIds: [], programStudyIds: [], studentIds: [], learningSpaceIds: ['class-mgt-401-a'],
      },
    })
    await storeMockUploadContent(owner, created.session.id, cleanPdf, 'application/pdf')
    await finalizeFileUpload(owner, created.session.id)
    await expect(issuePrivateFileDownload(owner, created.file.id)).resolves.toMatchObject({ fileName: 'Tugas kelas.pdf' })

    await updateClassEnrollment(authContext('admin-001', ['administrator'], []), 'class-mgt-401-a', 'student-001', {
      status: 'WITHDRAWN', reason: 'Akses ditarik untuk pengujian membership terbaru.', expectedVersion: 1,
    }, 'file-membership-withdraw-0001')
    await expect(issuePrivateFileDownload(owner, created.file.id))
      .rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' } satisfies Partial<CampusError>)
  })

  it('rejects extension/MIME mismatch before reserving quota', async () => {
    const owner = authContext('student-owner', ['student'])
    await expect(createFileUploadSession(owner, {
      name: 'dokumen.png',
      declaredMimeType: 'application/pdf',
      sizeBytes: cleanPdf.byteLength,
    })).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_INPUT' } satisfies Partial<CampusError>)
    expect((await listPrivateFiles(owner)).items).toHaveLength(0)
  })

  it('rejects a spoofed magic signature and releases the quota reservation', async () => {
    const owner = authContext('student-owner', ['student'])
    const fake = bytes('not-a-real-pdf')
    const created = await createFileUploadSession(owner, {
      name: 'transkrip.pdf',
      declaredMimeType: 'application/pdf',
      sizeBytes: fake.byteLength,
    })
    await storeMockUploadContent(owner, created.session.id, fake, 'application/pdf')
    await expect(finalizeFileUpload(owner, created.session.id))
      .rejects.toMatchObject({ statusCode: 400, code: 'INVALID_INPUT' } satisfies Partial<CampusError>)

    const detail = await getPrivateFileDetail(owner, created.file.id)
    expect(detail.file.status).toBe('REJECTED')
    expect(detail.versions[0]).toMatchObject({ status: 'REJECTED', rejectionCode: 'INVALID_INPUT' })
    expect(detail.quota).toMatchObject({ usedBytes: 0, reservedBytes: 0 })
  })

  it('rejects a storage content-type mismatch even when the extension is valid', async () => {
    const owner = authContext('student-owner', ['student'])
    const created = await createFileUploadSession(owner, {
      name: 'transkrip.pdf', declaredMimeType: 'application/pdf', sizeBytes: cleanPdf.byteLength,
    })
    await storeMockUploadContent(owner, created.session.id, cleanPdf, 'image/png')
    await expect(finalizeFileUpload(owner, created.session.id))
      .rejects.toMatchObject({ code: 'FILE_MIME_MISMATCH' } satisfies Partial<CampusError>)
  })

  it('accounts concurrent reservations against a fixed quota', async () => {
    process.env.FILE_QUOTA_BYTES = String(1024 * 1024)
    const owner = authContext('student-owner', ['student'])
    const firstSize = 700 * 1024
    await createFileUploadSession(owner, {
      name: 'scan-satu.png', declaredMimeType: 'image/png', sizeBytes: firstSize,
    })
    await expect(createFileUploadSession(owner, {
      name: 'scan-dua.png', declaredMimeType: 'image/png', sizeBytes: 400 * 1024,
    })).rejects.toMatchObject({ statusCode: 409, code: 'FILE_QUOTA_EXCEEDED' } satisfies Partial<CampusError>)
    const listed = await listPrivateFiles(owner)
    expect(listed.quota).toMatchObject({ usedBytes: 0, reservedBytes: firstSize, limitBytes: 1024 * 1024 })
  })

  it('expires short-lived upload sessions and releases their reservations', async () => {
    const owner = authContext('student-owner', ['student'])
    const created = await createFileUploadSession(owner, {
      name: 'sementara.pdf', declaredMimeType: 'application/pdf', sizeBytes: cleanPdf.byteLength,
    })
    const stored = fileMockStateForTests().sessions.get(created.session.id)!
    fileMockStateForTests().sessions.set(stored.id, { ...stored, expiresAt: '2020-01-01T00:00:00.000Z' })
    expect(await expireUploadSessions(owner)).toBe(1)
    const detail = await getPrivateFileDetail(owner, created.file.id)
    expect(detail.quota.reservedBytes).toBe(0)
    expect(detail.versions[0]).toMatchObject({ status: 'REJECTED', rejectionCode: 'UPLOAD_SESSION_EXPIRED' })
  })

  it('fails closed and keeps the file quarantined when no production scanner is available', async () => {
    configureMalwareScanner(new FailClosedMalwareScanner())
    const owner = authContext('student-owner', ['student'])
    const created = await createFileUploadSession(owner, {
      name: 'ijazah.pdf', declaredMimeType: 'application/pdf', sizeBytes: cleanPdf.byteLength,
    })
    await storeMockUploadContent(owner, created.session.id, cleanPdf, 'application/pdf')
    await expect(finalizeFileUpload(owner, created.session.id))
      .rejects.toMatchObject({ statusCode: 503, code: 'MALWARE_SCANNER_UNAVAILABLE' } satisfies Partial<CampusError>)

    const detail = await getPrivateFileDetail(owner, created.file.id)
    expect(detail.file.status).toBe('QUARANTINED')
    expect(detail.versions[0]).toMatchObject({ status: 'QUARANTINED', scanResult: 'UNAVAILABLE' })
    await expect(issuePrivateFileDownload(owner, created.file.id))
      .rejects.toMatchObject({ code: 'FILE_NOT_READY' } satisfies Partial<CampusError>)
  })

  it('selects the fail-closed scanner by default in production without ClamAV configuration', () => {
    const previousNodeEnv = process.env.NODE_ENV
    const previousHost = process.env.CLAMAV_HOST
    configureMalwareScanner(undefined)
    process.env.NODE_ENV = 'production'
    delete process.env.CLAMAV_HOST
    try {
      expect(malwareScanner()).toBeInstanceOf(FailClosedMalwareScanner)
    } finally {
      process.env.NODE_ENV = previousNodeEnv
      if (previousHost === undefined) delete process.env.CLAMAV_HOST
      else process.env.CLAMAV_HOST = previousHost
      configureMalwareScanner(new DevelopmentSignatureScanner())
    }
  })

  it('rejects infected content, removes its quota usage, and never issues a download', async () => {
    const infectedScanner: MalwareScanner = {
      async scan(input) {
        for await (const _chunk of input.stream) { /* consume the stream */ }
        return { verdict: 'INFECTED', engine: 'test-scanner', message: 'EICAR', sha256: 'a'.repeat(64) }
      },
    }
    configureMalwareScanner(infectedScanner)
    const owner = authContext('student-owner', ['student'])
    const created = await createFileUploadSession(owner, {
      name: 'lampiran.pdf', declaredMimeType: 'application/pdf', sizeBytes: cleanPdf.byteLength,
    })
    await storeMockUploadContent(owner, created.session.id, cleanPdf, 'application/pdf')
    const finalized = await finalizeFileUpload(owner, created.session.id)
    expect(finalized.file.status).toBe('REJECTED')
    expect(finalized.quota.usedBytes).toBe(0)
    await expect(issuePrivateFileDownload(owner, created.file.id))
      .rejects.toMatchObject({ code: 'FILE_NOT_READY' } satisfies Partial<CampusError>)
  })

  it('authorizes audited signed downloads by owner, explicit scope, and administrator only', async () => {
    const staff = authContext('academic-owner', ['academic_staff'])
    const created = await createFileUploadSession(staff, {
      name: 'Panduan Akademik.pdf',
      declaredMimeType: 'application/pdf',
      sizeBytes: cleanPdf.byteLength,
      access: { visibility: 'SCOPED', allowedRoles: ['student'], programStudyIds: ['management-s1'] },
    })
    await storeMockUploadContent(staff, created.session.id, cleanPdf, 'application/pdf')
    await finalizeFileUpload(staff, created.session.id)

    const student = authContext('student-reader', ['student'], ['management-s1'])
    const outsider = authContext('student-outsider', ['student'], ['informatics-s1'])
    const admin = authContext('admin-reader', ['administrator'], [])
    const signed = await issuePrivateFileDownload(student, created.file.id)
    expect(signed.url).toMatch(/^\/api\/files\/downloads\/[A-Za-z0-9_-]+$/)
    expect(Date.parse(signed.expiresAt)).toBeGreaterThan(Date.now())
    expect(signed.auditId).toMatch(/^audit_/)
    await expect(issuePrivateFileDownload(outsider, created.file.id))
      .rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' } satisfies Partial<CampusError>)
    await expect(issuePrivateFileDownload(admin, created.file.id)).resolves.toMatchObject({ version: 1 })
  })

  it('promotes clean versions and soft-deletes without exposing the retained object', async () => {
    const { owner, created } = await uploadPdf()
    const second = await createFileUploadSession(owner, {
      fileId: created.file.id,
      name: 'Kartu Rencana Studi revisi.pdf',
      declaredMimeType: 'application/pdf',
      sizeBytes: cleanPdf.byteLength,
    })
    await storeMockUploadContent(owner, second.session.id, cleanPdf, 'application/pdf')
    const updated = await finalizeFileUpload(owner, second.session.id)
    expect(updated.file).toMatchObject({ currentVersion: 2, versionCount: 2, status: 'CLEAN' })
    expect(updated.versions.map(version => version.version)).toEqual([2, 1])

    const deleted = await softDeletePrivateFile(owner, created.file.id)
    expect(deleted.file).toMatchObject({ deleted: true, status: 'DELETED' })
    expect((await listPrivateFiles(owner)).items).toHaveLength(0)
    expect((await listPrivateFiles(owner, { includeDeleted: true })).items).toHaveLength(1)
    await expect(issuePrivateFileDownload(owner, created.file.id))
      .rejects.toMatchObject({ statusCode: 410, code: 'FILE_DELETED' } satisfies Partial<CampusError>)
  })

  it('paginates and filters private records without leaking another owner files', async () => {
    const owner = authContext('student-owner', ['student'])
    const outsider = authContext('student-outsider', ['student'])
    for (const [name, data, mime] of [
      ['alpha.pdf', cleanPdf, 'application/pdf'],
      ['beta.png', cleanPng, 'image/png'],
      ['gamma.pdf', cleanPdf, 'application/pdf'],
    ] as const) {
      const created = await createFileUploadSession(owner, { name, declaredMimeType: mime, sizeBytes: data.byteLength })
      await storeMockUploadContent(owner, created.session.id, data, mime)
      await finalizeFileUpload(owner, created.session.id)
    }
    await createFileUploadSession(outsider, {
      name: 'rahasia.pdf', declaredMimeType: 'application/pdf', sizeBytes: cleanPdf.byteLength,
    })

    const first = await listPrivateFiles(owner, { limit: 2 })
    expect(first.items).toHaveLength(2)
    expect(first.nextCursor).toBeTruthy()
    const second = await listPrivateFiles(owner, { limit: 2, cursor: first.nextCursor })
    expect(second.items).toHaveLength(1)
    expect([...first.items, ...second.items].every(file => file.ownerUid === owner.uid)).toBe(true)
    const pdfs = await listPrivateFiles(owner, { mimeType: 'application/pdf', search: 'a' })
    expect(pdfs.items).toHaveLength(2)
    expect(pdfs.items.every(file => file.mimeType === 'application/pdf')).toBe(true)
  })
})
