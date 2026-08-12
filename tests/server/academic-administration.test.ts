import { beforeEach, describe, expect, it } from 'vitest'
import {
  addMbkmLog,
  addThesisGuidance,
  createMbkmActivity,
  createRpsVersion,
  createThesisProposal,
  evaluateMbkmActivity,
  getAcademicAdministrationWorkspace,
  getProvisionalTranscript,
  getSemesterResult,
  requestAdvisingSession,
  reviewLeaveRequest,
  submitLeaveRequest,
  transitionMbkmActivity,
  transitionThesis,
  updateAdvisingSession,
} from '../../server/services/academic-administration'
import { resetAcademicAdministrationStateForTests } from '../../server/services/academic-administration-state'
import { krsModuleState, resetKrsModuleState } from '../../server/services/krs-state'
import { CampusError } from '../../server/utils/errors'
import { resetMockState } from '../../server/utils/mock-store'
import { authContext } from './fixtures'

const learner = () => authContext('student-001', ['student'], ['management-s1'])
const advisor = () => authContext('advisor-001', ['advisor', 'lecturer'], ['management-s1'])
const academic = () => authContext('academic-001', ['academic_staff'], ['management-s1'])
const clock = new Date('2026-07-22T03:00:00.000Z')

describe('academic administration workflows', () => {
  beforeEach(() => { process.env.CAMPUS_DATA_MODE = 'mock'; resetMockState(); resetKrsModuleState(); resetAcademicAdministrationStateForTests() })

  it('returns stable master data and a scoped student academic history', async () => {
    const workspace = await getAcademicAdministrationWorkspace(learner())
    expect(workspace.profile).toMatchObject({ studentId: 'student-001', pathway: 'REGULAR', curriculumVersionId: 'curriculum-mgt-2023_v1' })
    expect(workspace.courses[0]).toMatchObject({ code: 'MGT401', prerequisiteCourseCodes: ['MGT301'], immutable: true })
    expect(workspace.calendar).toHaveLength(2)
    await expect(getAcademicAdministrationWorkspace(authContext('student-003', ['student'], ['informatics-s1']))).rejects.toMatchObject({ statusCode: 403 } satisfies Partial<CampusError>)
  })

  it('derives KHS and provisional transcript only from immutable published grade records', async () => {
    const khs = await getSemesterResult(learner(), 'student-001', '2025-2026-1')
    expect(khs).toMatchObject({ attemptedCredits: 6, earnedCredits: 6, semesterGpa: 3.75 })
    expect(khs.rows.every(row => row.immutable && row.publicationId)).toBe(true)
    const transcript = await getProvisionalTranscript(learner(), 'student-001')
    expect(transcript).toMatchObject({ status: 'PROVISIONAL', totalEarnedCredits: 6, cumulativeGpa: 3.75 })
    await expect(getProvisionalTranscript(authContext('student-003', ['student'], ['informatics-s1']), 'student-001')).rejects.toMatchObject({ statusCode: 403 } satisfies Partial<CampusError>)
  })

  it('submits leave idempotently and updates status history atomically on approval', async () => {
    const input = { periodId: '2025-2026-2', reason: 'Saya memerlukan cuti akademik karena pemulihan kesehatan keluarga yang memerlukan pendampingan.' }
    const first = await submitLeaveRequest(learner(), input, 'academic-leave-key-0001', undefined, clock)
    expect((await submitLeaveRequest(learner(), input, 'academic-leave-key-0001', undefined, clock)).replayed).toBe(true)
    await expect(reviewLeaveRequest(authContext('admin-001', ['administrator'], []), first.request.id, { decision: 'APPROVED', reviewNote: 'Administrator tidak boleh menyetujui proses bisnis.', expectedVersion: 1 }, undefined, clock))
      .rejects.toMatchObject({ statusCode: 403 } satisfies Partial<CampusError>)
    const reviewed = await reviewLeaveRequest(academic(), first.request.id, { decision: 'APPROVED', reviewNote: 'Dokumen dan konsultasi dosen wali telah lengkap.', expectedVersion: 1 }, undefined, clock)
    expect(reviewed).toMatchObject({ request: { status: 'APPROVED', version: 2 }, profile: { status: 'LEAVE', version: 2 } })
    expect(reviewed.profile.statusHistory.at(-1)).toMatchObject({ status: 'LEAVE', periodId: '2025-2026-2' })
  })

  it('blocks leave when an active finance hold exists', async () => {
    const seeded = structuredClone(krsModuleState().students.get('student-010')!)
    krsModuleState().students.set('student-001', { ...seeded, id: 'student-001', studentUid: 'student-001', holds: [{ id: 'billing-2025', type: 'FINANCE', reason: 'Belum lunas', active: true }] })
    await expect(submitLeaveRequest(learner(), { periodId: '2025-2026-2', reason: 'Pengajuan cuti akademik dengan kewajiban pembayaran yang masih aktif.' }, 'academic-leave-key-0002', undefined, clock)).rejects.toMatchObject({ code: 'LEAVE_FINANCE_HOLD' } satisfies Partial<CampusError>)
  })

  it('keeps advisor private notes out of the student response', async () => {
    const requested = await requestAdvisingSession(learner(), { topic: 'Diskusi beban studi dan rencana mata kuliah semester berikutnya.', requestedAt: '2026-07-25T03:00:00.000Z' }, 'academic-advising-0001', undefined, clock)
    const scheduled = await updateAdvisingSession(advisor(), requested.session.id, { status: 'SCHEDULED', scheduledAt: '2026-07-25T03:00:00.000Z', channel: 'VIDEO', privateAdvisorNote: 'Perhatikan beban kerja mahasiswa; jangan tampilkan catatan ini.', expectedVersion: 1 }, undefined, clock)
    expect(scheduled.session.privateAdvisorNote).toBeTruthy()
    expect((await getAcademicAdministrationWorkspace(learner())).advisingSessions[0]?.privateAdvisorNote).toBeUndefined()
    expect((await getAcademicAdministrationWorkspace(advisor(), 'student-001')).advisingSessions[0]?.privateAdvisorNote).toBeTruthy()
  })

  it('creates manual immutable RPS versions and enforces published weights', async () => {
    const base = { courseVersionId: 'course-mgt401_v1', programStudyId: 'management-s1', periodId: '2025-2026-2', lecturerIds: ['advisor-001'], expectedCurrentVersion: 0, title: 'RPS Manajemen Strategik', description: { format: 'PLAIN_TEXT' as const, text: 'Rencana pembelajaran semester disusun manual.' }, courseLearningOutcomes: ['Mampu menganalisis posisi strategis organisasi.'], sections: [{ week: 1, learningOutcome: 'Memahami konsep strategi.', topic: 'Fondasi strategi', method: 'Diskusi kasus', assessment: 'Partisipasi', references: ['Buku strategi edisi terbaru'] }], assessmentWeights: [{ label: 'Partisipasi', weight: 20 }, { label: 'Proyek', weight: 80 }], status: 'PUBLISHED' as const }
    const first = await createRpsVersion(advisor(), base, 'academic-rps-key-00001', undefined, clock)
    expect(first).toMatchObject({ version: { version: 1, status: 'PUBLISHED', source: 'MANUAL', immutable: true }, head: { publishedVersion: 1 } })
    await expect(createRpsVersion(advisor(), { ...base, expectedCurrentVersion: 1, assessmentWeights: [{ label: 'Tidak lengkap', weight: 90 }] }, 'academic-rps-key-00002', undefined, clock)).rejects.toMatchObject({ statusCode: 400 } satisfies Partial<CampusError>)
  })

  it('tracks thesis proposal, supervisor approval, and immutable guidance', async () => {
    const proposed = await createThesisProposal(learner(), { title: 'Strategi transformasi digital pada usaha mikro dan kecil', abstract: { format: 'PLAIN_TEXT', text: 'Penelitian ini menguji proses transformasi digital secara deskriptif dan empiris.' } }, 'academic-thesis-key-01', undefined, clock)
    const approved = await transitionThesis(advisor(), proposed.thesis.id, { status: 'APPROVED', expectedVersion: 1 }, undefined, clock)
    const guidance = await addThesisGuidance(advisor(), proposed.thesis.id, { occurredAt: '2026-07-21T03:00:00.000Z', summary: 'Pembahasan perbaikan rumusan masalah dan kerangka teori.', nextAction: 'Mahasiswa memperbaiki bab satu dan dua.', expectedVersion: approved.thesis.version }, 'academic-guidance-001', undefined, clock)
    expect(guidance).toMatchObject({ thesis: { status: 'IN_PROGRESS', version: 3 }, entry: { immutable: true, recordedBy: 'advisor-001' } })
  })

  it('runs MBKM through approval, logbook, evaluation, conversion, and completion', async () => {
    const proposed = await createMbkmActivity(learner(), { periodId: '2025-2026-2', scheme: 'INTERNSHIP', partnerName: 'PT Mitra Kampus', title: 'Magang manajemen operasi', startsOn: '2026-07-01', endsOn: '2026-08-31' }, 'academic-mbkm-key-001', undefined, clock)
    const approved = await transitionMbkmActivity(academic(), proposed.activity.id, { status: 'APPROVED', expectedVersion: 1 }, undefined, clock)
    const active = await transitionMbkmActivity(academic(), proposed.activity.id, { status: 'ACTIVE', expectedVersion: approved.activity.version }, undefined, clock)
    const log = await addMbkmLog(learner(), proposed.activity.id, { occurredOn: '2026-07-21', activity: 'Menyusun peta proses operasional dan mendokumentasikan temuan.', hours: 8, expectedVersion: active.activity.version }, 'academic-mbkm-log-01', undefined, clock)
    expect(log.entry).toMatchObject({ hours: 8, immutable: true })
    const evaluated = await evaluateMbkmActivity(advisor(), proposed.activity.id, { score: 88, note: 'Capaian kegiatan memenuhi target dan bukti logbook memadai.', conversions: [{ courseCode: 'MGT401', credits: 3, gradeLetter: 'A' }], expectedVersion: log.activity.version }, undefined, clock)
    const completed = await transitionMbkmActivity(academic(), proposed.activity.id, { status: 'COMPLETED', expectedVersion: evaluated.activity.version }, undefined, clock)
    expect(completed.activity).toMatchObject({ status: 'COMPLETED', conversions: [{ courseCode: 'MGT401', credits: 3, gradeLetter: 'A' }], evaluation: { score: 88 } })
  })

  it('rejects invalid MBKM state transitions and excessive credit conversion', async () => {
    const proposed = await createMbkmActivity(learner(), { periodId: '2025-2026-2', scheme: 'RESEARCH', partnerName: 'Pusat Studi Kampus', title: 'Riset perilaku organisasi', startsOn: '2026-07-01', endsOn: '2026-08-31' }, 'academic-mbkm-key-002', undefined, clock)
    await expect(transitionMbkmActivity(academic(), proposed.activity.id, { status: 'COMPLETED', expectedVersion: 1 }, undefined, clock)).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' } satisfies Partial<CampusError>)
    const approved = await transitionMbkmActivity(academic(), proposed.activity.id, { status: 'APPROVED', expectedVersion: 1 }, undefined, clock)
    await expect(evaluateMbkmActivity(advisor(), proposed.activity.id, { score: 80, note: 'Evaluasi cukup untuk menguji batas konversi maksimum.', conversions: [{ courseCode: 'A01', credits: 12, gradeLetter: 'A' }, { courseCode: 'A02', credits: 12, gradeLetter: 'A' }, { courseCode: 'A03', credits: 1, gradeLetter: 'A' }], expectedVersion: approved.activity.version }, undefined, clock)).rejects.toMatchObject({ statusCode: 400 } satisfies Partial<CampusError>)
  })
})
