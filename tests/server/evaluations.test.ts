import { beforeEach, describe, expect, it } from 'vitest'
import {
  createEvaluationForm,
  createEvaluationPeriod,
  listStudentEvaluationAssignments,
  submitStudentEvaluation,
  updateEvaluationForm,
  updateEvaluationPeriod,
} from '../../server/services/evaluations'
import {
  evaluationReportToCsv,
  exportEvaluationReportCsv,
  generateEvaluationReport,
  safeCsvCell,
} from '../../server/services/evaluations-reporting'
import {
  evaluationMockState,
  resetEvaluationMockState,
  seedEvaluationEnrollmentForTests,
} from '../../server/services/evaluations-mock'
import type {
  EvaluationAnswer,
  EvaluationEnrollment,
  EvaluationQuestionDefinition,
} from '../../server/types/evaluations'
import { CampusError } from '../../server/utils/errors'
import { mockState, resetMockState } from '../../server/utils/mock-store'
import { authContext } from './fixtures'

const questions: EvaluationQuestionDefinition[] = [
  { id: 'clarity', label: 'Materi disampaikan dengan jelas.', type: 'LIKERT_1_5', required: true },
  { id: 'fairness', label: 'Penilaian dilakukan secara adil.', type: 'LIKERT_1_5', required: true },
  { id: 'recommend', label: 'Saya merekomendasikan kelas ini.', type: 'BOOLEAN', required: true },
  { id: 'comment', label: 'Saran perbaikan.', type: 'TEXT', required: false },
]

const baseAnswers: EvaluationAnswer[] = [
  { questionId: 'clarity', value: 5 },
  { questionId: 'fairness', value: 4 },
  { questionId: 'recommend', value: true },
  { questionId: 'comment', value: 'Komentar rahasia mahasiswa.' },
]

const academic = authContext('academic-001', ['academic_staff'], ['management-s1'])
const admin = authContext('admin-001', ['administrator'], [])
const reportOpen = '2026-07-01T00:00:00.000Z'
const reportClose = '2026-07-10T00:00:00.000Z'
const submissionNow = Date.parse('2026-07-05T12:00:00.000Z')

function enrollment(
  studentUid: string,
  options: Partial<EvaluationEnrollment> = {},
): EvaluationEnrollment {
  return {
    id: `enrollment-${studentUid}`,
    studentUid,
    studentId: studentUid,
    lecturerId: 'lecturer-001',
    lecturerName: 'Dr. Rina Wulandari',
    courseId: 'course-mgt401',
    courseCode: 'MGT401',
    courseName: 'Manajemen Strategik',
    classId: 'class-mgt401-a',
    className: 'MGT401-A',
    programStudyId: 'management-s1',
    academicPeriodId: '2025-2026-2',
    status: 'ENROLLED',
    ...options,
  }
}

async function setup(options: {
  minimumResponses?: number
  opensAt?: string
  closesAt?: string
  formQuestions?: EvaluationQuestionDefinition[]
  formName?: string
} = {}) {
  const form = await createEvaluationForm(academic, {
    name: options.formName || 'Evaluasi Mutu Pembelajaran',
    description: 'Form terstruktur dan anonim.',
    programStudyId: 'management-s1',
    questions: options.formQuestions || questions,
  }, 'evaluation-form-key-0001')
  const period = await createEvaluationPeriod(academic, {
    name: 'Evaluasi Genap 2025/2026',
    academicPeriodId: '2025-2026-2',
    programStudyId: 'management-s1',
    formId: form.form.id,
    formVersion: form.form.currentVersion,
    opensAt: options.opensAt || reportOpen,
    closesAt: options.closesAt || reportClose,
    minimumResponses: options.minimumResponses || 3,
  }, 'evaluation-period-key-0001')
  return { form, period }
}

async function submitFor(
  studentUid: string,
  periodId: string,
  key: string,
  answers = baseAnswers,
  now = submissionNow,
) {
  const record = enrollment(studentUid)
  seedEvaluationEnrollmentForTests(record)
  return submitStudentEvaluation(
    authContext(studentUid, ['student']),
    { evaluationPeriodId: periodId, enrollmentId: record.id, answers },
    key,
    undefined,
    now,
  )
}

describe('lecturer evaluations', () => {
  beforeEach(() => {
    process.env.CAMPUS_DATA_MODE = 'mock'
    resetMockState()
    resetEvaluationMockState({ seedDemo: false })
  })

  it('creates idempotent forms, preserves immutable definitions, and rejects stale revisions', async () => {
    const first = await createEvaluationForm(academic, {
      name: 'Form Evaluasi', programStudyId: 'management-s1', questions,
    }, 'form-idempotency-0001')
    const replay = await createEvaluationForm(academic, {
      name: 'Form Evaluasi', programStudyId: 'management-s1', questions,
    }, 'form-idempotency-0001')
    expect(first.replayed).toBe(false)
    expect(replay).toMatchObject({ replayed: true, form: { id: first.form.id } })
    expect(evaluationMockState().forms).toHaveLength(1)
    expect(evaluationMockState().formVersions).toHaveLength(1)
    expect(mockState().auditEntries.filter(entry => entry.action === 'EVALUATION_FORM_CREATED')).toHaveLength(1)

    await expect(createEvaluationForm(academic, {
      name: 'Payload lain', programStudyId: 'management-s1', questions,
    }, 'form-idempotency-0001')).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' } satisfies Partial<CampusError>)

    const updated = await updateEvaluationForm(academic, first.form.id, {
      expectedVersion: 1,
      name: 'Form Evaluasi Revisi',
      questions: [...questions, { id: 'prepared', label: 'Dosen hadir dengan persiapan yang baik.', type: 'LIKERT_1_5', required: true }],
    })
    expect(updated.form).toMatchObject({ version: 2, currentVersion: 2, nextVersion: 3 })
    expect(updated.definition.version).toBe(2)
    expect(evaluationMockState().formVersions.get(`${first.form.id}_v1`)?.questions).toHaveLength(4)
    expect(evaluationMockState().formVersions.get(`${first.form.id}_v2`)?.questions).toHaveLength(5)
    await expect(updateEvaluationForm(academic, first.form.id, {
      expectedVersion: 1, name: 'Stale', questions,
    })).rejects.toMatchObject({ code: 'VERSION_CONFLICT' } satisfies Partial<CampusError>)
  })

  it('enforces program scope for configuration and optimistic period updates', async () => {
    const outsider = authContext('academic-other', ['academic_staff'], ['informatics-s1'])
    await expect(createEvaluationForm(outsider, {
      name: 'Form lintas prodi', programStudyId: 'management-s1', questions,
    }, 'scope-form-key-0001')).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' } satisfies Partial<CampusError>)

    const futureOpen = '2030-01-01T00:00:00.000Z'
    const futureClose = '2030-02-01T00:00:00.000Z'
    const { period } = await setup({ opensAt: futureOpen, closesAt: futureClose })
    const replay = await createEvaluationPeriod(academic, {
      name: 'Evaluasi Genap 2025/2026',
      academicPeriodId: '2025-2026-2',
      programStudyId: 'management-s1',
      formId: period.period.formId,
      formVersion: period.period.formVersion,
      opensAt: futureOpen,
      closesAt: futureClose,
      minimumResponses: 3,
    }, 'evaluation-period-key-0001')
    expect(replay).toMatchObject({ replayed: true, period: { id: period.period.id } })
    expect(evaluationMockState().periods).toHaveLength(1)
    const updated = await updateEvaluationPeriod(academic, period.period.id, {
      expectedVersion: 1,
      name: 'Evaluasi 2030 Revisi',
      opensAt: futureOpen,
      closesAt: '2030-02-15T00:00:00.000Z',
      minimumResponses: 5,
    })
    expect(updated.period).toMatchObject({ version: 2, minimumResponses: 5 })
    await expect(updateEvaluationPeriod(academic, period.period.id, {
      expectedVersion: 1,
      name: 'Stale', opensAt: futureOpen, closesAt: futureClose, minimumResponses: 3,
    })).rejects.toMatchObject({ code: 'VERSION_CONFLICT' } satisfies Partial<CampusError>)
  })

  it('accepts only eligible enrolled students during the half-open period boundary', async () => {
    const { period } = await setup()
    const before = enrollment('student-before')
    seedEvaluationEnrollmentForTests(before)
    await expect(submitStudentEvaluation(authContext(before.studentUid, ['student']), {
      evaluationPeriodId: period.period.id, enrollmentId: before.id, answers: baseAnswers,
    }, 'boundary-before-0001', undefined, Date.parse(reportOpen) - 1))
      .rejects.toMatchObject({ code: 'EVALUATION_NOT_OPEN' } satisfies Partial<CampusError>)

    const atOpen = enrollment('student-at-open')
    seedEvaluationEnrollmentForTests(atOpen)
    await expect(submitStudentEvaluation(authContext(atOpen.studentUid, ['student']), {
      evaluationPeriodId: period.period.id, enrollmentId: atOpen.id, answers: baseAnswers,
    }, 'boundary-open-00001', undefined, Date.parse(reportOpen))).resolves.toMatchObject({ replayed: false })

    const atClose = enrollment('student-at-close')
    seedEvaluationEnrollmentForTests(atClose)
    await expect(submitStudentEvaluation(authContext(atClose.studentUid, ['student']), {
      evaluationPeriodId: period.period.id, enrollmentId: atClose.id, answers: baseAnswers,
    }, 'boundary-close-0001', undefined, Date.parse(reportClose)))
      .rejects.toMatchObject({ code: 'EVALUATION_CLOSED' } satisfies Partial<CampusError>)

    const notOwner = enrollment('student-real')
    seedEvaluationEnrollmentForTests(notOwner)
    await expect(submitStudentEvaluation(authContext('student-attacker', ['student']), {
      evaluationPeriodId: period.period.id, enrollmentId: notOwner.id, answers: baseAnswers,
    }, 'boundary-owner-0001', undefined, submissionNow))
      .rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' } satisfies Partial<CampusError>)
  })

  it('lists only open assignments for the authenticated eligible student', async () => {
    const { period } = await setup()
    const own = enrollment('student-001')
    const other = enrollment('student-002')
    seedEvaluationEnrollmentForTests(own)
    seedEvaluationEnrollmentForTests(other)
    const assignments = await listStudentEvaluationAssignments(authContext('student-001', ['student']), submissionNow)
    expect(assignments).toHaveLength(1)
    expect(assignments[0]).toMatchObject({ evaluationPeriodId: period.period.id, enrollmentId: own.id, completed: false })
    expect(JSON.stringify(assignments)).not.toContain(other.id)
  })

  it('validates required, typed, unique, and known answers', async () => {
    const { period } = await setup()
    const record = enrollment('student-001')
    seedEvaluationEnrollmentForTests(record)
    const submit = (answers: EvaluationAnswer[], key: string) => submitStudentEvaluation(
      authContext(record.studentUid, ['student']),
      { evaluationPeriodId: period.period.id, enrollmentId: record.id, answers },
      key,
      undefined,
      submissionNow,
    )
    await expect(submit(baseAnswers.filter(answer => answer.questionId !== 'clarity'), 'answers-required-0001'))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' } satisfies Partial<CampusError>)
    await expect(submit([{ ...baseAnswers[0]!, value: 6 }, ...baseAnswers.slice(1)], 'answers-scale-000001'))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' } satisfies Partial<CampusError>)
    await expect(submit([...baseAnswers, { questionId: 'unknown', value: 5 }], 'answers-unknown-00001'))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' } satisfies Partial<CampusError>)
    await expect(submit([...baseAnswers, baseAnswers[0]!], 'answers-duplicate-001'))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' } satisfies Partial<CampusError>)
  })

  it('stores identity separately, prevents duplicates, and replays identical submissions idempotently', async () => {
    const { period } = await setup()
    const record = enrollment('student-001')
    seedEvaluationEnrollmentForTests(record)
    const student = authContext(record.studentUid, ['student'])
    const input = { evaluationPeriodId: period.period.id, enrollmentId: record.id, answers: baseAnswers }
    const first = await submitStudentEvaluation(student, input, 'submission-key-0001', undefined, submissionNow)
    const replay = await submitStudentEvaluation(student, input, 'submission-key-0001', undefined, submissionNow)
    expect(replay).toMatchObject({ receiptId: first.receiptId, replayed: true })
    expect(evaluationMockState().responses).toHaveLength(1)
    expect(evaluationMockState().respondentIdentities).toHaveLength(1)
    const anonymous = [...evaluationMockState().responses.values()][0]!
    expect(anonymous).not.toHaveProperty('studentUid')
    expect(anonymous).not.toHaveProperty('studentId')
    expect(anonymous).not.toHaveProperty('enrollmentId')
    const identity = [...evaluationMockState().respondentIdentities.values()][0]!
    expect(identity).toMatchObject({ studentUid: record.studentUid, responseId: anonymous.id })
    expect(mockState().auditEntries.filter(entry => entry.action === 'EVALUATION_SUBMITTED')).toHaveLength(1)
    expect(JSON.stringify(mockState().auditEntries.find(entry => entry.action === 'EVALUATION_SUBMITTED'))).not.toContain(anonymous.id)

    await expect(submitStudentEvaluation(student, input, 'submission-key-0002', undefined, submissionNow))
      .rejects.toMatchObject({ code: 'EVALUATION_ALREADY_SUBMITTED' } satisfies Partial<CampusError>)
    const duplicateEnrollment = { ...record, id: 'enrollment-student-001-duplicate' }
    seedEvaluationEnrollmentForTests(duplicateEnrollment)
    await expect(submitStudentEvaluation(student, {
      ...input,
      enrollmentId: duplicateEnrollment.id,
    }, 'submission-key-0003', undefined, submissionNow))
      .rejects.toMatchObject({ code: 'EVALUATION_ALREADY_SUBMITTED' } satisfies Partial<CampusError>)
    await expect(submitStudentEvaluation(student, {
      ...input, answers: [{ ...baseAnswers[0]!, value: 1 }, ...baseAnswers.slice(1)],
    }, 'submission-key-0001', undefined, submissionNow))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' } satisfies Partial<CampusError>)
  })

  it('suppresses small cohorts without returning counts, answers, comments, or identities', async () => {
    const { period } = await setup({ minimumResponses: 3 })
    await submitFor('student-one', period.period.id, 'threshold-submit-001')
    await submitFor('student-two', period.period.id, 'threshold-submit-002')
    const report = await generateEvaluationReport(academic, {
      evaluationPeriodId: period.period.id, groupBy: 'class',
    })
    expect(report.groups).toHaveLength(1)
    expect(report.groups[0]).toMatchObject({ suppressed: true, responseCount: null, questions: [] })
    const serialized = JSON.stringify(report)
    expect(serialized).not.toContain('student-one')
    expect(serialized).not.toContain('student-two')
    expect(serialized).not.toContain('Komentar rahasia mahasiswa')
    expect(serialized).not.toContain('responseId')
    expect(serialized).not.toContain('studentUid')
  })

  it('returns descriptive aggregates only after the threshold and excludes free-text content', async () => {
    const { period } = await setup({ minimumResponses: 3 })
    await submitFor('student-one', period.period.id, 'aggregate-submit-001', baseAnswers)
    await submitFor('student-two', period.period.id, 'aggregate-submit-002', [
      { questionId: 'clarity', value: 3 }, { questionId: 'fairness', value: 4 },
      { questionId: 'recommend', value: false }, { questionId: 'comment', value: 'Rahasia kedua.' },
    ])
    await submitFor('student-three', period.period.id, 'aggregate-submit-003', [
      { questionId: 'clarity', value: 4 }, { questionId: 'fairness', value: 5 }, { questionId: 'recommend', value: true },
    ])
    const report = await generateEvaluationReport(admin, {
      evaluationPeriodId: period.period.id, groupBy: 'lecturer',
    })
    const group = report.groups[0]!
    expect(group).toMatchObject({ suppressed: false, responseCount: 3, overallMean: 4.17 })
    expect(group.questions.find(item => item.questionId === 'clarity')).toMatchObject({
      answeredCount: 3, mean: 4, median: 4, minimum: 3, maximum: 5, favorablePercent: 66.67,
      distribution: { '1': 0, '2': 0, '3': 1, '4': 1, '5': 1 },
    })
    expect(group.questions.find(item => item.questionId === 'recommend')).toMatchObject({ answeredCount: 3, truePercent: 66.67 })
    expect(group.questions.find(item => item.questionId === 'comment')).toEqual({
      questionId: 'comment', label: 'Saran perbaikan.', type: 'TEXT', answeredCount: 2,
    })
    expect(JSON.stringify(report)).not.toContain('Rahasia kedua')
    expect(report.confidentiality).toEqual({ respondentIdentityIncluded: false, smallCohortsSuppressed: true, freeTextExcluded: true })
  })

  it('scopes reports to program administrators and each lecturer own results', async () => {
    const { period } = await setup({ minimumResponses: 3 })
    for (const uid of ['student-one', 'student-two', 'student-three']) {
      await submitFor(uid, period.period.id, `scope-submit-${uid}`)
    }
    const ownLecturer = authContext('lecturer-001', ['lecturer'], ['management-s1'])
    const otherLecturer = authContext('lecturer-other', ['lecturer'], ['management-s1'])
    const outsideAcademic = authContext('academic-other', ['academic_staff'], ['informatics-s1'])
    await expect(generateEvaluationReport(ownLecturer, {
      evaluationPeriodId: period.period.id, groupBy: 'course',
    })).resolves.toMatchObject({ groups: [{ suppressed: false, responseCount: 3 }] })
    await expect(generateEvaluationReport(otherLecturer, {
      evaluationPeriodId: period.period.id, groupBy: 'course', lecturerId: 'lecturer-001',
    })).resolves.toMatchObject({ groups: [] })
    await expect(generateEvaluationReport(outsideAcademic, {
      evaluationPeriodId: period.period.id, groupBy: 'program',
    })).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' } satisfies Partial<CampusError>)
    await expect(generateEvaluationReport(authContext('student-one', ['student']), {
      evaluationPeriodId: period.period.id, groupBy: 'program',
    })).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' } satisfies Partial<CampusError>)
  })

  it('groups aggregate reports by lecturer, course, class, and program', async () => {
    const { period } = await setup({ minimumResponses: 3 })
    for (const uid of ['student-one', 'student-two', 'student-three']) {
      await submitFor(uid, period.period.id, `group-submit-${uid}`)
    }
    for (const groupBy of ['lecturer', 'course', 'class', 'program'] as const) {
      const report = await generateEvaluationReport(admin, { evaluationPeriodId: period.period.id, groupBy })
      expect(report.groupBy).toBe(groupBy)
      expect(report.groups).toHaveLength(1)
      expect(report.groups[0]?.suppressed).toBe(false)
    }
  })

  it('exports only aggregate CSV and neutralizes spreadsheet formulas in every text cell', async () => {
    const dangerousQuestions: EvaluationQuestionDefinition[] = [
      { id: 'formula', label: '=HYPERLINK("https://example.invalid")', type: 'LIKERT_1_5', required: true },
    ]
    const { period } = await setup({ minimumResponses: 3, formQuestions: dangerousQuestions, formName: '@Form' })
    for (const [index, uid] of ['csv-one', 'csv-two', 'csv-three'].entries()) {
      const record = enrollment(uid, {
        lecturerName: '@SUM(1+1)', courseCode: '+cmd', courseName: 'Course', className: '-danger',
      })
      seedEvaluationEnrollmentForTests(record)
      await submitStudentEvaluation(authContext(uid, ['student']), {
        evaluationPeriodId: period.period.id,
        enrollmentId: record.id,
        answers: [{ questionId: 'formula', value: 4 + (index % 2) }],
      }, `csv-submission-${uid}`, undefined, submissionNow)
    }
    const report = await generateEvaluationReport(admin, { evaluationPeriodId: period.period.id, groupBy: 'class' })
    const csv = evaluationReportToCsv(report)
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toContain('"\'-danger · +cmd"')
    expect(csv).toContain('"\'@SUM(1+1)"')
    expect(csv).toContain('"\'+cmd Course"')
    expect(csv).toContain('"\'=HYPERLINK(""https://example.invalid"")"')
    expect(csv).not.toContain('csv-one')
    expect(csv).not.toContain('Komentar rahasia')
    expect(safeCsvCell('  =2+3')).toBe('"\'  =2+3"')
    expect(safeCsvCell('\t@cmd')).toBe('"\'\t@cmd"')
    expect(safeCsvCell('normal')).toBe('"normal"')
    expect(safeCsvCell(-2)).toBe('-2')

    const exported = await exportEvaluationReportCsv(admin, {
      evaluationPeriodId: period.period.id,
      groupBy: 'class',
    })
    expect(exported.content).toContain('TERSEDIA')
    expect(exported.auditId).toMatch(/^audit_/)
    expect(mockState().auditEntries.some(entry => entry.action === 'EVALUATION_REPORT_EXPORTED')).toBe(true)
  })
})
