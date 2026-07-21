export const TRACER_QUESTION_TYPES = ['SINGLE_CHOICE', 'MULTI_CHOICE', 'TEXT', 'NUMBER', 'BOOLEAN'] as const
export type TracerQuestionType = (typeof TRACER_QUESTION_TYPES)[number]

export interface TracerQuestionOption {
  value: string
  label: string
}

export interface TracerQuestionDefinition {
  id: string
  label: string
  helpText?: string
  type: TracerQuestionType
  required: boolean
  options?: TracerQuestionOption[]
  minimum?: number
  maximum?: number
}

export interface TracerQuestionnaire {
  id: string
  name: string
  description?: string
  programStudyId: string
  currentVersion: number
  version: number
  status: 'ACTIVE' | 'ARCHIVED'
  createdAt: string
  createdBy: string
  updatedAt: string
  updatedBy: string
}

export interface TracerQuestionnaireVersion {
  id: string
  questionnaireId: string
  version: number
  name: string
  description?: string
  questions: TracerQuestionDefinition[]
  createdAt: string
  createdBy: string
}

export type TracerPeriodStatus = 'DRAFT' | 'ACTIVE' | 'CLOSED'

export interface TracerDistributionPeriod {
  id: string
  name: string
  questionnaireId: string
  questionnaireVersion: number
  programStudyIds: string[]
  graduationYearFrom: number
  graduationYearTo: number
  opensAt: string
  closesAt: string
  status: TracerPeriodStatus
  accessTokenTtlHours: number
  minimumCellSize: number
  consentVersion: string
  consentNotice: string
  version: number
  createdAt: string
  createdBy: string
  updatedAt: string
  updatedBy: string
}

export interface TracerAlumniProfile {
  id: string
  userUid?: string
  studentId: string
  studentNumber: string
  displayName: string
  email: string
  programStudyId: string
  programStudyName: string
  graduationYear: number
  graduatedAt: string
  contactable: boolean
}

export interface IssuedSkpiReference {
  documentId: string
  documentNumber: string
  issuedAt: string
  href?: string
}

export type TracerRecipientStatus =
  | 'ELIGIBLE'
  | 'DELIVERED'
  | 'DELIVERY_FAILED'
  | 'OPENED'
  | 'RESPONDED'
  | 'WITHDRAWN'
  | 'EXPIRED'

export interface TracerRecipient {
  id: string
  periodId: string
  alumniProfileId: string
  programStudyId: string
  graduationYear: number
  status: TracerRecipientStatus
  version: number
  firstInvitedAt?: string
  lastContactAt?: string
  openedAt?: string
  respondedAt?: string
  withdrawnAt?: string
  responseId?: string
  createdAt: string
  updatedAt: string
}

export type TracerTokenPurpose = 'ACCESS' | 'WITHDRAWAL'
export type TracerTokenStatus = 'ACTIVE' | 'CONSUMED' | 'REVOKED'

export interface TracerOpaqueTokenRecord {
  id: string
  tokenHash: string
  purpose: TracerTokenPurpose
  periodId: string
  recipientId: string
  responseId?: string
  status: TracerTokenStatus
  expiresAt: string
  createdAt: string
  consumedAt?: string
  revokedAt?: string
}

export const TRACER_EMPLOYMENT_STATUSES = [
  'EMPLOYED',
  'ENTREPRENEUR',
  'FURTHER_STUDY',
  'SEEKING_WORK',
  'NOT_WORKING',
] as const
export type TracerEmploymentStatus = (typeof TRACER_EMPLOYMENT_STATUSES)[number]

export const TRACER_INCOME_RANGES = ['BELOW_3M', '3M_TO_6M', '6M_TO_10M', 'ABOVE_10M', 'UNDISCLOSED'] as const
export type TracerIncomeRange = (typeof TRACER_INCOME_RANGES)[number]

export interface TracerCareerData {
  employmentStatus: TracerEmploymentStatus
  waitMonths?: number
  fieldAlignment?: number
  incomeRange?: TracerIncomeRange
  employerSector?: string
  jobLevel?: string
  workLocation?: string
  organizationName?: string
  furtherStudyInstitution?: string
}

export type TracerAnswerValue = string | number | boolean | string[]

export interface TracerAnswer {
  questionId: string
  value: TracerAnswerValue
}

export type TracerResponseStatus = 'SUBMITTED' | 'WITHDRAWN'

export interface TracerResponse {
  id: string
  periodId: string
  questionnaireId: string
  questionnaireVersion: number
  recipientId: string
  programStudyId: string
  graduationYear: number
  status: TracerResponseStatus
  career?: TracerCareerData
  answers: TracerAnswer[]
  submittedAt: string
  withdrawnAt?: string
  version: number
}

export interface TracerConsentRecord {
  id: string
  periodId: string
  recipientId: string
  responseId: string
  consentVersion: string
  noticeSnapshot: string
  status: 'GRANTED' | 'WITHDRAWN'
  grantedAt: string
  withdrawnAt?: string
  version: number
}

export type TracerCampaignKind = 'INITIAL' | 'REMINDER'
export type TracerCampaignStatus = 'PROCESSING' | 'COMPLETED' | 'PARTIAL'

export interface TracerCampaign {
  id: string
  periodId: string
  kind: TracerCampaignKind
  reminderSequence?: number
  status: TracerCampaignStatus
  eligibleCount: number
  sentCount: number
  failedCount: number
  skippedCount: number
  createdAt: string
  createdBy: string
  completedAt?: string
}

export interface TracerDeliveryRecord {
  id: string
  campaignId: string
  periodId: string
  recipientId: string
  tokenRecordId: string
  kind: TracerCampaignKind
  reminderSequence?: number
  status: 'PENDING' | 'SENT' | 'FAILED'
  createdAt: string
  sentAt?: string
  providerMessageId?: string
  failureCode?: string
}

export interface TracerAccessView {
  period: Pick<TracerDistributionPeriod, 'id' | 'name' | 'opensAt' | 'closesAt' | 'consentVersion' | 'consentNotice'>
  questionnaire: TracerQuestionnaireVersion
  recipientStatus: TracerRecipientStatus
  skpiReferences: IssuedSkpiReference[]
}

export interface TracerOwnAssignment extends TracerAccessView {
  recipientId: string
  submitted: boolean
  responseId?: string
}

export interface TracerSubmissionReceipt {
  receiptId: string
  submittedAt: string
  replayed: boolean
  withdrawalToken?: string
}

export interface TracerRespondentMonitorItem {
  recipientId: string
  studentNumber: string
  displayName: string
  maskedEmail: string
  programStudyId: string
  programStudyName: string
  graduationYear: number
  status: TracerRecipientStatus
  firstInvitedAt?: string
  lastContactAt?: string
  respondedAt?: string
  consentStatus: 'NOT_GRANTED' | 'GRANTED' | 'WITHDRAWN'
  skpiReferences: IssuedSkpiReference[]
}

export type TracerReportGroupBy = 'program' | 'graduation_year'

export interface TracerOutcomeGroup {
  key: string
  label: string
  suppressed: boolean
  responseCount: number | null
  employmentStatus: Partial<Record<TracerEmploymentStatus, { count: number; percent: number }>>
  incomeRange: Partial<Record<TracerIncomeRange, { count: number; percent: number }>>
  averageWaitMonths: number | null
  averageFieldAlignment: number | null
}

export interface TracerOutcomeReport {
  periodId: string
  periodName: string
  groupBy: TracerReportGroupBy
  generatedAt: string
  groups: TracerOutcomeGroup[]
  confidentiality: {
    respondentIdentityIncluded: false
    freeTextIncluded: false
    smallCellsSuppressed: true
    minimumCellSize: number
  }
  method: 'DESCRIPTIVE_ONLY'
}
