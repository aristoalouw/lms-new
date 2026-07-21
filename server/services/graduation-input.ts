import type { ApplicationTransition, CreateGraduationPeriodInput, UpdateGraduationPeriodInput } from './graduation'
import type {
  GraduationTemplateLayoutInput,
  IssueGraduationDocumentInput,
  PublishGraduationTemplateInput,
  ReissueGraduationDocumentInput,
  RevokeGraduationDocumentInput,
} from './graduation-documents'
import type { GraduationDocumentType, GraduationParticipantStatus, GraduationPeriodStatus, GraduationTemplateSource } from '../types/graduation'
import { GRADUATION_DOCUMENT_TYPES } from '../types/graduation'
import { invalidInput } from '../utils/errors'
import { optionalString, requireInteger, requireRecord, requireString, requireStringArray } from '../utils/validation'

const PERIOD_STATUSES = new Set<GraduationPeriodStatus>(['DRAFT', 'OPEN', 'REVIEW', 'FINALIZED', 'CLOSED'])
const TRANSITIONS = new Set<ApplicationTransition>(['START_REVIEW', 'FIRST_APPROVE', 'FINAL_APPROVE', 'REJECT', 'CANCEL'])
const PARTICIPANT_STATUSES = new Set<GraduationParticipantStatus>(['YUDISIUM_APPROVED', 'GRADUATED', 'WITHDRAWN'])
const TEMPLATE_SOURCES = new Set<GraduationTemplateSource>([
  'studentName', 'studentNumber', 'programStudyName', 'periodName', 'yudisiumDate', 'graduationDate',
  'gpa', 'earnedCredits', 'documentNumber', 'verificationCode', 'issuedAt',
])

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') invalidInput(`${label} harus berupa boolean.`)
  return value
}

function requireNumber(value: unknown, label: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) invalidInput(`${label} harus berupa angka antara ${min} dan ${max}.`)
  return value
}

function parseRequirements(value: unknown): CreateGraduationPeriodInput['requirements'] {
  const requirements = requireRecord(value, 'requirements')
  const academic = requireRecord(requirements.academic, 'requirements.academic')
  const finance = requireRecord(requirements.finance, 'requirements.finance')
  const library = requireRecord(requirements.library, 'requirements.library')
  const studentAffairs = requireRecord(requirements.studentAffairs, 'requirements.studentAffairs')
  return {
    academic: {
      minimumCredits: requireInteger(academic.minimumCredits, 'minimumCredits', 0, 500),
      minimumGpa: requireNumber(academic.minimumGpa, 'minimumGpa', 0, 4),
      maximumGradeD: requireInteger(academic.maximumGradeD, 'maximumGradeD', 0, 100),
      requireNoGradeE: requireBoolean(academic.requireNoGradeE, 'requireNoGradeE'),
      requireThesisPassed: requireBoolean(academic.requireThesisPassed, 'requireThesisPassed'),
    },
    finance: { maximumOutstandingAmount: requireNumber(finance.maximumOutstandingAmount, 'maximumOutstandingAmount', 0) },
    library: {
      requireClearance: requireBoolean(library.requireClearance, 'requireClearance'),
      maximumUnreturnedItems: requireInteger(library.maximumUnreturnedItems, 'maximumUnreturnedItems', 0, 1_000),
    },
    studentAffairs: {
      minimumPoints: requireInteger(studentAffairs.minimumPoints, 'minimumPoints', 0, 1_000_000),
      maximumActiveSanctions: requireInteger(studentAffairs.maximumActiveSanctions, 'maximumActiveSanctions', 0, 1_000),
    },
  }
}

export function parseCreateGraduationPeriod(value: unknown): CreateGraduationPeriodInput {
  const body = requireRecord(value)
  return {
    code: requireString(body.code, 'code', { max: 40 }),
    name: requireString(body.name, 'name', { max: 160 }),
    programStudyIds: requireStringArray(body.programStudyIds, 'programStudyIds', 100),
    registrationOpensAt: requireString(body.registrationOpensAt, 'registrationOpensAt', { max: 48 }),
    registrationClosesAt: requireString(body.registrationClosesAt, 'registrationClosesAt', { max: 48 }),
    yudisiumDate: requireString(body.yudisiumDate, 'yudisiumDate', { max: 48 }),
    ...(optionalString(body.graduationDate, 'graduationDate', 48) ? { graduationDate: optionalString(body.graduationDate, 'graduationDate', 48) } : {}),
    requirements: parseRequirements(body.requirements),
  }
}

export function parseUpdateGraduationPeriod(value: unknown): UpdateGraduationPeriodInput {
  const body = requireRecord(value)
  const status = optionalString(body.status, 'status', 20) as GraduationPeriodStatus | undefined
  if (status && !PERIOD_STATUSES.has(status)) invalidInput('Status periode tidak valid.')
  return {
    expectedVersion: requireInteger(body.expectedVersion, 'expectedVersion', 1),
    ...(status ? { status } : {}),
    ...(optionalString(body.registrationClosesAt, 'registrationClosesAt', 48) ? { registrationClosesAt: optionalString(body.registrationClosesAt, 'registrationClosesAt', 48) } : {}),
    ...(optionalString(body.yudisiumDate, 'yudisiumDate', 48) ? { yudisiumDate: optionalString(body.yudisiumDate, 'yudisiumDate', 48) } : {}),
    ...(optionalString(body.graduationDate, 'graduationDate', 48) ? { graduationDate: optionalString(body.graduationDate, 'graduationDate', 48) } : {}),
    ...(body.requirements === undefined ? {} : { requirements: parseRequirements(body.requirements) }),
  }
}

export function parseGraduationApplicationSubmission(value: unknown): { periodId: string; studentId: string } {
  const body = requireRecord(value)
  return {
    periodId: requireString(body.periodId, 'periodId', { max: 128 }),
    studentId: requireString(body.studentId, 'studentId', { max: 128 }),
  }
}

export function parseGraduationTransition(value: unknown): { transition: ApplicationTransition; expectedVersion: number; reason?: string } {
  const body = requireRecord(value)
  const transition = requireString(body.transition, 'transition', { max: 30 }) as ApplicationTransition
  if (!TRANSITIONS.has(transition)) invalidInput('Transisi pengajuan tidak valid.')
  const reason = optionalString(body.reason, 'reason', 500)
  return { transition, expectedVersion: requireInteger(body.expectedVersion, 'expectedVersion', 1), ...(reason ? { reason } : {}) }
}

export function parseGraduationParticipantStatus(value: unknown): { status: GraduationParticipantStatus; expectedVersion: number; reason?: string } {
  const body = requireRecord(value)
  const status = requireString(body.status, 'status', { max: 30 }) as GraduationParticipantStatus
  if (!PARTICIPANT_STATUSES.has(status)) invalidInput('Status peserta tidak valid.')
  const reason = optionalString(body.reason, 'reason', 500)
  return { status, expectedVersion: requireInteger(body.expectedVersion, 'expectedVersion', 1), ...(reason ? { reason } : {}) }
}

function parseTemplateLayout(value: unknown): GraduationTemplateLayoutInput {
  const layout = requireRecord(value, 'layout')
  if (!Array.isArray(layout.fields)) invalidInput('layout.fields harus berupa daftar.')
  const fields = layout.fields.map((item, index) => {
    const field = requireRecord(item, `layout.fields[${index}]`)
    const source = requireString(field.source, `layout.fields[${index}].source`, { max: 40 }) as GraduationTemplateSource
    if (!TEMPLATE_SOURCES.has(source)) invalidInput('Sumber kolom template tidak didukung.')
    return {
      key: requireString(field.key, `layout.fields[${index}].key`, { max: 60 }),
      label: requireString(field.label, `layout.fields[${index}].label`, { max: 120 }),
      source,
    }
  })
  const subtitle = optionalString(layout.subtitle, 'layout.subtitle', 180)
  return {
    title: requireString(layout.title, 'layout.title', { max: 180 }),
    ...(subtitle ? { subtitle } : {}),
    fields,
    footerText: requireString(layout.footerText, 'layout.footerText', { max: 500 }),
  }
}

export function parsePublishGraduationTemplate(value: unknown): PublishGraduationTemplateInput {
  const body = requireRecord(value)
  return {
    expectedVersion: requireInteger(body.expectedVersion, 'expectedVersion', 1),
    name: requireString(body.name, 'name', { max: 160 }),
    layout: parseTemplateLayout(body.layout),
  }
}

export function parseIssueGraduationDocument(value: unknown): IssueGraduationDocumentInput {
  const body = requireRecord(value)
  const type = requireString(body.type, 'type', { max: 20 }) as GraduationDocumentType
  if (!GRADUATION_DOCUMENT_TYPES.includes(type)) invalidInput('Jenis dokumen kelulusan tidak valid.')
  return { applicationId: requireString(body.applicationId, 'applicationId', { max: 128 }), type }
}

export function parseRevokeGraduationDocument(value: unknown): RevokeGraduationDocumentInput {
  const body = requireRecord(value)
  return {
    expectedVersion: requireInteger(body.expectedVersion, 'expectedVersion', 1),
    reason: requireString(body.reason, 'reason', { max: 500 }),
  }
}

export function parseReissueGraduationDocument(value: unknown): ReissueGraduationDocumentInput {
  return parseRevokeGraduationDocument(value)
}
