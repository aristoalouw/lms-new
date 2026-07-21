import { beforeEach, describe, expect, it } from 'vitest'
import { getAdmissionDocumentWorkspace, reviewAdmissionDocument, submitAdmissionDocument } from '../../server/services/admissions-documents'
import { admissionModuleState, resetAdmissionModuleState } from '../../server/services/admissions-state'
import { reviewAdmissionApplication } from '../../server/services/admissions'
import { createFileUploadSession, finalizeFileUpload, getPrivateFileDetail, resetFileServiceForTests, storeMockUploadContent } from '../../server/services/files'
import { configureMalwareScanner, DevelopmentSignatureScanner } from '../../server/services/files-scanner'
import { resetFileStorageForTests } from '../../server/services/files-storage'
import type { AuthContext } from '../../server/types/auth'
import { authContext } from './fixtures'

const cleanPdf = Uint8Array.from(Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF', 'latin1'))
const applicant = (): AuthContext => ({ ...authContext('applicant-001', ['applicant'], ['management-s1']), email: 'anisa.candidate@example.test' })
const admissions = (programs = ['management-s1']) => authContext('admissions-001', ['admissions_staff'], programs)

async function upload(name: string, shared = true) {
  const owner = applicant()
  const created = await createFileUploadSession(owner, { name, declaredMimeType: 'application/pdf', sizeBytes: cleanPdf.byteLength, access: shared ? { visibility: 'SCOPED', allowedRoles: ['admissions_staff'], programStudyIds: ['management-s1'] } : { visibility: 'OWNER' } })
  await storeMockUploadContent(owner, created.session.id, cleanPdf, 'application/pdf')
  await finalizeFileUpload(owner, created.session.id)
  return created.file.id
}

describe('admission private document workflow', () => {
  beforeEach(() => {
    process.env.CAMPUS_DATA_MODE = 'mock'
    resetAdmissionModuleState(); resetFileServiceForTests(); resetFileStorageForTests(); configureMalwareScanner(new DevelopmentSignatureScanner())
    const seeded = admissionModuleState().applications.get('admission-demo-001')!
    admissionModuleState().applications.set(seeded.id, { ...seeded, status: 'UNDER_REVIEW', version: 1, reviewedAt: undefined, reviewedBy: undefined })
  })

  it('links only clean applicant-owned files shared to the scoped admissions role', async () => {
    const fileId = await upload('identitas.pdf')
    const first = await submitAdmissionDocument(applicant(), 'admission-demo-001', { documentType: 'IDENTITY', fileId }, 'admission-document-0001')
    const replay = await submitAdmissionDocument(applicant(), 'admission-demo-001', { documentType: 'IDENTITY', fileId }, 'admission-document-0001')
    expect(first.document).toMatchObject({ status: 'PENDING', fileId, fileVersion: 1, documentType: 'IDENTITY' })
    expect(first.document.checksumSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(replay).toMatchObject({ replayed: true, document: { id: first.document.id } })
    expect((await getPrivateFileDetail(admissions(), fileId)).file.id).toBe(fileId)

    const privateFileId = await upload('hanya-pemilik.pdf', false)
    await expect(submitAdmissionDocument(applicant(), 'admission-demo-001', { documentType: 'DIPLOMA', fileId: privateFileId }, 'admission-document-0002')).rejects.toMatchObject({ statusCode: 400 })
  })

  it('enforces ownership, application binding, and program review scope', async () => {
    const fileId = await upload('identitas.pdf')
    const submitted = await submitAdmissionDocument(applicant(), 'admission-demo-001', { documentType: 'IDENTITY', fileId }, 'admission-document-0003')
    await expect(getAdmissionDocumentWorkspace(authContext('other-applicant', ['applicant']), 'admission-demo-001')).rejects.toMatchObject({ statusCode: 403 })
    await expect(reviewAdmissionDocument(admissions(['informatics-s1']), 'admission-demo-001', submitted.document.id, { status: 'VERIFIED', reviewNote: 'Dokumen sesuai sumber resmi.', expectedVersion: 1 })).rejects.toMatchObject({ statusCode: 403 })
  })

  it('requires every path-specific document before completing application document verification', async () => {
    const identity = await submitAdmissionDocument(applicant(), 'admission-demo-001', { documentType: 'IDENTITY', fileId: await upload('identitas.pdf') }, 'admission-document-0004')
    const verifiedIdentity = await reviewAdmissionDocument(admissions(), 'admission-demo-001', identity.document.id, { status: 'VERIFIED', reviewNote: 'Identitas sesuai dan terbaca.', expectedVersion: 1 })
    expect(verifiedIdentity.complete).toBe(false)
    await expect(reviewAdmissionApplication(admissions(), 'admission-demo-001', { status: 'DOCUMENTS_VERIFIED', expectedVersion: 1 }, 'admission-review-docs-0001')).rejects.toMatchObject({ statusCode: 409, code: 'ADMISSION_DOCUMENTS_INCOMPLETE' })

    const diploma = await submitAdmissionDocument(applicant(), 'admission-demo-001', { documentType: 'DIPLOMA', fileId: await upload('ijazah.pdf') }, 'admission-document-0005')
    const verifiedDiploma = await reviewAdmissionDocument(admissions(), 'admission-demo-001', diploma.document.id, { status: 'VERIFIED', reviewNote: 'Ijazah sesuai dan terbaca.', expectedVersion: 1 })
    expect(verifiedDiploma.complete).toBe(true)
    const application = await reviewAdmissionApplication(admissions(), 'admission-demo-001', { status: 'DOCUMENTS_VERIFIED', expectedVersion: 1 }, 'admission-review-docs-0002')
    expect(application.application.status).toBe('DOCUMENTS_VERIFIED')
  })

  it('supports rejection and a safe replacement upload', async () => {
    const first = await submitAdmissionDocument(applicant(), 'admission-demo-001', { documentType: 'IDENTITY', fileId: await upload('identitas-buram.pdf') }, 'admission-document-0006')
    await reviewAdmissionDocument(admissions(), 'admission-demo-001', first.document.id, { status: 'REJECTED', reviewNote: 'Dokumen buram dan tidak terbaca.', expectedVersion: 1 })
    const replacement = await submitAdmissionDocument(applicant(), 'admission-demo-001', { documentType: 'IDENTITY', fileId: await upload('identitas-jelas.pdf') }, 'admission-document-0007')
    expect(replacement.document).toMatchObject({ status: 'PENDING', documentType: 'IDENTITY' })
  })
})
