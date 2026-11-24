import type { AuthContext } from '../types/auth'
import {
  EVALUATION_QUESTION_TYPES,
  type EvaluationAnswer,
  type EvaluationPeriodRecord,
  type EvaluationQuestionDefinition,
  type EvaluationQuestionType,
} from '../types/evaluations'
import { CampusError, forbidden, invalidInput } from '../utils/errors'
import { can, hasProgramAccess } from '../utils/rbac'

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/

export function normalizeEvaluationId(value: unknown, label: string, pattern = ID_PATTERN): string {
  if (typeof value !== 'string' || !pattern.test(value)) invalidInput(`${label} tidak valid.`)
  return value
}

export function normalizeEvaluationText(value: unknown, label: string, min = 1, max = 300): string {
  if (typeof value !== 'string') invalidInput(`${label} harus berupa teks.`)
  const normalized = value.normalize('NFKC').trim()
  if (normalized.length < min || normalized.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(normalized)) {
    invalidInput(`${label} harus memiliki panjang ${min}-${max} karakter tanpa karakter kontrol.`)
  }
  return normalized
}

export function normalizeOptionalEvaluationText(value: unknown, label: string, max = 1000): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return normalizeEvaluationText(value, label, 1, max)
}

export function normalizeEvaluationInstant(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    invalidInput(`${label} harus berupa waktu ISO yang valid.`)
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) invalidInput(`${label} harus berupa waktu ISO yang valid.`)
  return date.toISOString()
}

export function normalizeMinimumResponses(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 3 || (value as number) > 50) {
    invalidInput('minimumResponses harus berupa bilangan bulat antara 3 dan 50.')
  }
  return value as number
}

export function normalizeEvaluationQuestions(value: unknown): EvaluationQuestionDefinition[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 50) invalidInput('Formulir wajib memiliki 1-50 pertanyaan.')
  const seen = new Set<string>()
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) invalidInput(`questions[${index}] tidak valid.`)
    const raw = item as Record<string, unknown>
    const id = normalizeEvaluationId(raw.id, `questions[${index}].id`, /^[A-Za-z][A-Za-z0-9_-]{0,59}$/)
    if (seen.has(id)) invalidInput(`ID pertanyaan ${id} digunakan lebih dari sekali.`)
    seen.add(id)
    const type = normalizeEvaluationId(raw.type, `questions[${index}].type`) as EvaluationQuestionType
    if (!EVALUATION_QUESTION_TYPES.includes(type)) invalidInput(`Tipe pertanyaan ${id} tidak didukung.`)
    if (typeof raw.required !== 'boolean') invalidInput(`questions[${index}].required harus berupa boolean.`)
    return {
      id,
      label: normalizeEvaluationText(raw.label, `questions[${index}].label`, 3, 300),
      type,
      required: raw.required,
      ...(normalizeOptionalEvaluationText(raw.helpText, `questions[${index}].helpText`, 300)
        ? { helpText: normalizeOptionalEvaluationText(raw.helpText, `questions[${index}].helpText`, 300) }
        : {}),
    }
  })
}

export function normalizeEvaluationAnswers(
  value: unknown,
  questions: EvaluationQuestionDefinition[],
): EvaluationAnswer[] {
  if (!Array.isArray(value) || value.length > questions.length) invalidInput('answers tidak valid.')
  const definitions = new Map(questions.map(question => [question.id, question]))
  const answers = new Map<string, EvaluationAnswer>()
  for (const [index, item] of value.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) invalidInput(`answers[${index}] tidak valid.`)
    const raw = item as Record<string, unknown>
    const questionId = normalizeEvaluationId(raw.questionId, `answers[${index}].questionId`, /^[A-Za-z][A-Za-z0-9_-]{0,59}$/)
    const question = definitions.get(questionId)
    if (!question) invalidInput(`Pertanyaan ${questionId} tidak ada pada versi formulir ini.`)
    if (answers.has(questionId)) invalidInput(`Pertanyaan ${questionId} dijawab lebih dari sekali.`)
    let answer: EvaluationAnswer
    if (question.type === 'LIKERT_1_5') {
      if (!Number.isInteger(raw.value) || (raw.value as number) < 1 || (raw.value as number) > 5) {
        invalidInput(`Jawaban ${questionId} harus berupa skala 1-5.`)
      }
      answer = { questionId, value: raw.value as number }
    } else if (question.type === 'BOOLEAN') {
      if (typeof raw.value !== 'boolean') invalidInput(`Jawaban ${questionId} harus berupa boolean.`)
      answer = { questionId, value: raw.value }
    } else {
      answer = { questionId, value: normalizeEvaluationText(raw.value, `Jawaban ${questionId}`, 1, 1000) }
    }
    answers.set(questionId, answer)
  }
  const missing = questions.filter(question => question.required && !answers.has(question.id))
  if (missing.length) invalidInput(`Pertanyaan wajib belum dijawab: ${missing.map(question => question.id).join(', ')}.`)
  return questions.flatMap(question => answers.has(question.id) ? [answers.get(question.id)!] : [])
}

export function requireEvaluationConfigurationAccess(context: AuthContext, programStudyId: string): void {
  if (!can(context, 'evaluation.configure')) forbidden('Anda tidak memiliki akses konfigurasi evaluasi.')
  if (!context.roles.includes('administrator') && !context.scope.programStudyIds.includes(programStudyId)) {
    forbidden('Program studi berada di luar lingkup akses Anda.')
  }
}

export function requireEvaluationReportAccess(
  context: AuthContext,
  programStudyId: string,
  lecturerId?: string,
): void {
  if (context.roles.includes('leader')) return
  if (context.roles.includes('academic_staff') && hasProgramAccess(context, programStudyId)) return
  if (context.roles.includes('lecturer') && lecturerId === context.uid) return
  if (context.roles.includes('advisor') && context.scope.programStudyIds.includes(programStudyId)) return
  forbidden('Laporan evaluasi berada di luar lingkup akses Anda.')
}

export function requireStudentEvaluationAccess(context: AuthContext): void {
  if (!context.roles.includes('student')) forbidden('Hanya mahasiswa aktif yang dapat mengisi evaluasi.')
}

export function assertEvaluationPeriodOpen(period: EvaluationPeriodRecord, now = Date.now()): void {
  if (now < Date.parse(period.opensAt)) {
    throw new CampusError(409, 'EVALUATION_NOT_OPEN', 'Periode evaluasi belum dibuka.')
  }
  if (now >= Date.parse(period.closesAt)) {
    throw new CampusError(409, 'EVALUATION_CLOSED', 'Periode evaluasi telah ditutup.')
  }
}

export function normalizePeriodWindow(opensAt: unknown, closesAt: unknown): { opensAt: string; closesAt: string } {
  const normalizedOpen = normalizeEvaluationInstant(opensAt, 'opensAt')
  const normalizedClose = normalizeEvaluationInstant(closesAt, 'closesAt')
  const duration = Date.parse(normalizedClose) - Date.parse(normalizedOpen)
  if (duration < 60 * 60 * 1000 || duration > 366 * 24 * 60 * 60 * 1000) {
    invalidInput('Periode evaluasi harus berlangsung antara 1 jam dan 366 hari.')
  }
  return { opensAt: normalizedOpen, closesAt: normalizedClose }
}
