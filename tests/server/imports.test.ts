import { beforeEach, describe, expect, it } from 'vitest'
import {
  approveImport,
  commitImport,
  compensateImport,
  createImportPreview,
  importTargetForTests,
  listImportRuns,
  resetImportStateForTests,
  seedImportTargetForTests,
} from '../../server/services/imports'
import type { ImportTargetRecord } from '../../server/types/imports'
import { CampusError } from '../../server/utils/errors'
import { parseDelimitedSource, parseImportSource } from '../../server/utils/import-parser'
import { resetMockState } from '../../server/utils/mock-store'
import { requestHash } from '../../server/utils/security'
import { authContext } from './fixtures'

const source = [
  'student_id,full_name,email,program_study_id,cohort_year,status',
  '261011001,Nadia Baru,nadia@example.test,management-s1,2026,ACTIVE',
  '261011002,Bima Tetap,bima@example.test,management-s1,2026,ACTIVE',
  '261011003,Salsa Baru,salsa@example.test,management-s1,2026,ACTIVE',
].join('\n')

const academic = authContext('academic-creator', ['academic_staff'])
const academicApprover = authContext('academic-approver', ['academic_staff'])

function target(id: string, data: ImportTargetRecord['data'], version = 1): ImportTargetRecord {
  return {
    id,
    dataset: 'students',
    programStudyId: 'management-s1',
    data,
    fingerprint: requestHash(data),
    version,
    importRunId: 'seed',
    importedAt: '2026-07-20T00:00:00.000Z',
    importedBy: 'seed',
  }
}

const originalNadia = {
  studentId: '261011001', fullName: 'Nadia Lama', email: 'nadia@example.test',
  programStudyId: 'management-s1', cohortYear: 2026, status: 'ACTIVE',
}
const unchangedBima = {
  studentId: '261011002', fullName: 'Bima Tetap', email: 'bima@example.test',
  programStudyId: 'management-s1', cohortYear: 2026, status: 'ACTIVE',
}

async function preparedRun() {
  seedImportTargetForTests(target('261011001', originalNadia, 4))
  seedImportTargetForTests(target('261011002', unchangedBima, 2))
  const preview = await createImportPreview(academic, {
    dataset: 'students', sourceName: 'mahasiswa-2026.csv', format: 'csv', content: source,
    programStudyId: 'management-s1',
  }, 'preview-import-0001')
  const approval = await approveImport(academicApprover, preview.run.id, {
    expectedVersion: preview.run.version, expectedChecksum: preview.run.checksum,
  }, 'approve-import-0001')
  return { preview, approval }
}

describe('staged spreadsheet import', () => {
  beforeEach(() => {
    process.env.CAMPUS_DATA_MODE = 'mock'
    process.env.IMPORT_REQUIRE_DUAL_APPROVAL = 'true'
    resetImportStateForTests()
    resetMockState()
  })

  it('parses quoted CSV safely, including delimiters and escaped quotes', () => {
    expect(parseDelimitedSource('id,name\n1,"Sari, Putri"\n2,"Bima ""B"""', ','))
      .toEqual([['id', 'name'], ['1', 'Sari, Putri'], ['2', 'Bima "B"']])
  })

  it('rejects spreadsheet formula-like cells and duplicate stable identifiers', () => {
    const parsed = parseImportSource({
      dataset: 'students', format: 'csv', programStudyId: 'management-s1',
      content: [
        'nim,nama,email,prodi_id,angkatan',
        '261011001,=HYPERLINK("bad"),one@example.test,management-s1,2026',
        '261011001,Nama Aman,two@example.test,management-s1,2026',
      ].join('\n'),
    })
    expect(parsed.counts.errors).toBeGreaterThanOrEqual(2)
    expect(parsed.issues.map(item => item.code)).toEqual(expect.arrayContaining(['POTENTIAL_FORMULA', 'DUPLICATE_SOURCE_ID']))
    expect(parsed.rows.every(row => row.action === 'INVALID')).toBe(true)
  })

  it('classifies creates, updates, and unchanged rows without storing the raw source', async () => {
    const { preview } = await preparedRun()
    expect(preview.run.counts).toMatchObject({ total: 3, valid: 3, errors: 0, creates: 1, updates: 1, skips: 1 })
    expect(preview.sampleRows.map(row => row.action)).toEqual(['UPDATE', 'SKIP', 'CREATE'])
    expect(preview.run).not.toHaveProperty('content')
    expect(preview.run.checksum).toMatch(/^[a-f0-9]{64}$/)

    const replay = await createImportPreview(academic, {
      dataset: 'students', sourceName: 'mahasiswa-2026.csv', format: 'csv', content: source,
      programStudyId: 'management-s1',
    }, 'preview-import-0001')
    expect(replay.replayed).toBe(true)
    expect(replay.run.id).toBe(preview.run.id)
  })

  it('enforces program scope and separation of approval duties', async () => {
    const outsider = authContext('academic-other', ['academic_staff'], ['informatics-s1'])
    await expect(createImportPreview(outsider, {
      dataset: 'students', sourceName: 'mahasiswa.csv', format: 'csv', content: source,
      programStudyId: 'management-s1',
    }, 'preview-scope-0001')).rejects.toMatchObject({ statusCode: 403 } satisfies Partial<CampusError>)

    const preview = await createImportPreview(academic, {
      dataset: 'students', sourceName: 'mahasiswa.csv', format: 'csv', content: source,
      programStudyId: 'management-s1',
    }, 'preview-self-0001')
    await expect(approveImport(academic, preview.run.id, {
      expectedVersion: preview.run.version, expectedChecksum: preview.run.checksum,
    }, 'approve-self-0001')).rejects.toMatchObject({ code: 'SECOND_APPROVER_REQUIRED' } satisfies Partial<CampusError>)
    await expect(createImportPreview(authContext('admin-technical', ['administrator']), {
      dataset: 'students', sourceName: 'mahasiswa.csv', format: 'csv', content: source,
      programStudyId: 'management-s1',
    }, 'preview-admin-denied')).rejects.toMatchObject({ statusCode: 403 } satisfies Partial<CampusError>)
  })

  it('blocks approval while preview errors remain', async () => {
    const preview = await createImportPreview(academic, {
      dataset: 'students', sourceName: 'invalid.csv', format: 'csv',
      content: 'nim,nama,email,prodi_id,angkatan\n261011004,,invalid,management-s1,2026',
      programStudyId: 'management-s1',
    }, 'preview-invalid-001')
    expect(preview.run.counts.errors).toBeGreaterThan(0)
    await expect(approveImport(academicApprover, preview.run.id, {
      expectedVersion: preview.run.version, expectedChecksum: preview.run.checksum,
    }, 'approve-invalid-001')).rejects.toMatchObject({ code: 'IMPORT_HAS_ERRORS' } satisfies Partial<CampusError>)
  })

  it('commits atomically in mock mode and replays an idempotency key', async () => {
    const { approval } = await preparedRun()
    const committed = await commitImport(academicApprover, approval.run.id, {
      expectedVersion: approval.run.version,
    }, 'commit-import-0001')
    expect(committed.run).toMatchObject({ status: 'COMMITTED', counts: { committed: 2 } })
    expect(importTargetForTests('students', '261011001')).toMatchObject({ version: 5, data: { fullName: 'Nadia Baru' } })
    expect(importTargetForTests('students', '261011002')).toMatchObject({ version: 2 })
    expect(importTargetForTests('students', '261011003')).toMatchObject({ version: 1 })

    const replay = await commitImport(academicApprover, approval.run.id, {
      expectedVersion: approval.run.version,
    }, 'commit-import-0001')
    expect(replay.replayed).toBe(true)
    expect(importTargetForTests('students', '261011001')?.version).toBe(5)
  })

  it('detects a stale target before applying any staged mutation', async () => {
    const { approval } = await preparedRun()
    const changed = { ...unchangedBima, fullName: 'Diubah Setelah Preview' }
    seedImportTargetForTests(target('261011002', changed, 3))
    await expect(commitImport(academicApprover, approval.run.id, {
      expectedVersion: approval.run.version,
    }, 'commit-stale-0001')).rejects.toMatchObject({ code: 'IMPORT_TARGET_CHANGED' } satisfies Partial<CampusError>)
    expect(importTargetForTests('students', '261011001')?.data.fullName).toBe('Nadia Lama')
    expect(importTargetForTests('students', '261011003')).toBeUndefined()
  })

  it('compensates created and updated records without overwriting later changes', async () => {
    const { approval } = await preparedRun()
    const committed = await commitImport(academicApprover, approval.run.id, {
      expectedVersion: approval.run.version,
    }, 'commit-compensate-0001')
    const compensated = await compensateImport(academicApprover, committed.run.id, {
      expectedVersion: committed.run.version, reason: 'Dataset sumber salah periode dan harus dipulihkan.',
    }, 'compensate-import-0001')
    expect(compensated.run).toMatchObject({ status: 'COMPENSATED', counts: { compensated: 2, compensationConflicts: 0 } })
    expect(importTargetForTests('students', '261011001')?.data.fullName).toBe('Nadia Lama')
    expect(importTargetForTests('students', '261011003')).toBeUndefined()
  })

  it('reports a partial compensation when a target changed after commit', async () => {
    const { approval } = await preparedRun()
    const committed = await commitImport(academicApprover, approval.run.id, {
      expectedVersion: approval.run.version,
    }, 'commit-conflict-0001')
    const laterData = {
      studentId: '261011001', fullName: 'Perubahan Resmi Sesudah Impor', email: 'nadia@example.test',
      programStudyId: 'management-s1', cohortYear: 2026, status: 'ACTIVE',
    }
    seedImportTargetForTests(target('261011001', laterData, 6))
    const compensated = await compensateImport(academicApprover, committed.run.id, {
      expectedVersion: committed.run.version, reason: 'Batalkan bagian impor yang masih aman untuk dipulihkan.',
    }, 'compensate-conflict-0001')
    expect(compensated.run.status).toBe('PARTIALLY_COMPENSATED')
    expect(compensated.run.counts).toMatchObject({ compensated: 1, compensationConflicts: 1 })
    expect(importTargetForTests('students', '261011001')?.data.fullName).toBe('Perubahan Resmi Sesudah Impor')
    expect(importTargetForTests('students', '261011003')).toBeUndefined()
  })

  it('lists only imports inside an academic operator scope', async () => {
    await createImportPreview(academic, {
      dataset: 'students', sourceName: 'mahasiswa.csv', format: 'csv', content: source,
      programStudyId: 'management-s1',
    }, 'preview-list-0001')
    const result = await listImportRuns(academic, { limit: 10 })
    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.programStudyId).toBe('management-s1')
  })
})
