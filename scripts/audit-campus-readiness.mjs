import { readFile } from 'node:fs/promises'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { cert, deleteApp, initializeApp } from 'firebase-admin/app'
import { initializeFirestore } from 'firebase-admin/firestore'

function argument(name, fallback) {
  const prefix = `--${name}=`
  return process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length) || fallback
}

export function parseEnvironment(source) {
  const values = {}
  for (const line of source.split(/\r?\n/u)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/u)
    if (!match || match[2] === '') continue
    const raw = match[2]
    values[match[1]] = raw.startsWith('"') && raw.endsWith('"')
      ? raw.slice(1, -1).replace(/\\n/gu, '\n')
      : raw
  }
  return values
}

const enabled = value => value === 'true'
const configured = value => typeof value === 'string' && value.trim().length > 0
const ROLE_UAT_REQUIREMENTS = [
  'applicant',
  'student',
  'lecturer',
  'advisor',
  'academic_staff',
  'finance_staff',
  'student_affairs_staff',
  'admissions_staff',
  'leader',
  'administrator',
]

export function evaluateCampusReadiness(input) {
  const counts = input.counts
  const capabilities = {
    firebaseCore: input.environment.CAMPUS_DATA_MODE === 'firebase'
      && configured(input.environment.FIREBASE_SERVICE_ACCOUNT_BASE64),
    fileUploads: enabled(input.environment.FILE_UPLOADS_ENABLED)
      && configured(input.environment.NUXT_PUBLIC_FIREBASE_STORAGE_BUCKET)
      && configured(input.environment.CLAMAV_HOST),
    emailDelivery: enabled(input.environment.EMAIL_DELIVERY_ENABLED)
      && configured(input.environment.EMAIL_GATEWAY_URL),
    sentry: enabled(input.environment.SENTRY_ENABLED)
      && configured(input.environment.SENTRY_DSN),
    pddikti: configured(input.environment.NEO_FEEDER_BASE_URL)
      && configured(input.environment.NEO_FEEDER_USERNAME)
      && configured(input.environment.NEO_FEEDER_PASSWORD),
    paymentGateway: configured(input.environment.PAYMENT_GATEWAY_PROVIDER)
      && configured(input.environment.PAYMENT_GATEWAY_WEBHOOK_SECRET),
  }

  const blockers = []
  const warn = (code, message) => blockers.push({ code, message })
  if (!capabilities.firebaseCore) warn('FIREBASE_CORE_UNAVAILABLE', 'Firebase production mode or runtime credential is not configured.')
  if (!counts.activeProgramStudies) warn('PROGRAM_STUDY_REQUIRED', 'No active program study is available.')
  if (!counts.activeAcademicPeriods) warn('ACADEMIC_PERIOD_REQUIRED', 'No active academic period is available.')
  if (!counts.courseVersions) warn('COURSE_MASTER_REQUIRED', 'No course version is available.')
  if (!counts.activeCurricula) warn('CURRICULUM_REQUIRED', 'No active curriculum is available; canonical student onboarding cannot run.')
  if (!counts.activeStudents) warn('STUDENT_ACCOUNT_REQUIRED', 'No active student account is available.')
  if (!counts.activeLecturers) warn('LECTURER_ACCOUNT_REQUIRED', 'No active lecturer account is available.')
  if (!counts.activeRoleAccounts?.advisor) warn('ADVISOR_ACCOUNT_REQUIRED', 'No active lecturer/advisor account is available; canonical student onboarding cannot run.')
  if (!counts.activeRoleAccounts?.academic_staff) warn('ACADEMIC_STAFF_REQUIRED', 'No active academic staff account is available to perform canonical student onboarding.')
  if (counts.activeStudents > counts.academicStudentProfiles) warn('STUDENT_ONBOARDING_INCOMPLETE', 'Some active student accounts do not have an academic profile.')
  if (counts.academicStudentProfiles > counts.studentAcademicStates) warn('ACADEMIC_STATE_INCOMPLETE', 'Some academic profiles do not have a KRS academic state.')
  if (counts.academicStudentProfiles > counts.billingStudentProfiles) warn('BILLING_PROFILE_INCOMPLETE', 'Some academic profiles do not have a billing profile.')
  if (!counts.activeClasses) warn('ACTIVE_CLASS_REQUIRED', 'No active academic class is available.')
  if (!counts.activeEnrollments) warn('ACTIVE_ENROLMENT_REQUIRED', 'No active class enrolment is available; students cannot access class learning spaces.')
  if (counts.activeClasses > counts.learningSpaces) warn('LEARNING_SPACE_INCOMPLETE', 'Some active classes do not have a learning space.')

  const roleUatGaps = ROLE_UAT_REQUIREMENTS
    .filter(role => !counts.activeRoleAccounts?.[role])
    .map(role => ({ role, message: `No active ${role} account is available for isolated production role UAT.` }))

  return {
    capabilities,
    blockers,
    roleUatGaps,
    readyForRoleUat: blockers.length === 0 && roleUatGaps.length === 0,
  }
}

async function count(query) {
  const snapshot = await query.count().get()
  return snapshot.data().count
}

async function main() {
  const environmentFile = argument('env', '.env.hostinger.production')
  const fileValues = parseEnvironment(await readFile(environmentFile, 'utf8'))
  const environment = { ...fileValues, ...process.env }
  const projectId = environment.FIREBASE_PROJECT_ID
  const encodedCredentials = environment.FIREBASE_SERVICE_ACCOUNT_BASE64
  if (!projectId || !encodedCredentials) {
    throw new Error('FIREBASE_PROJECT_ID and FIREBASE_SERVICE_ACCOUNT_BASE64 are required.')
  }

  const credentials = JSON.parse(Buffer.from(encodedCredentials, 'base64').toString('utf8'))
  if (credentials.project_id !== projectId) throw new Error('Firebase credential project does not match FIREBASE_PROJECT_ID.')
  const app = initializeApp({ credential: cert(credentials), projectId }, `campus-readiness-${Date.now()}`)

  try {
    const db = initializeFirestore(app, { preferRest: true })
    const roleCountTasks = Object.fromEntries(ROLE_UAT_REQUIREMENTS.map(role => [
      role,
      count(db.collection('accounts').where('status', '==', 'active').where('roles', 'array-contains', role)),
    ]))
    const countTasks = {
      accounts: count(db.collection('accounts')),
      activeStudents: count(db.collection('accounts').where('status', '==', 'active').where('roles', 'array-contains', 'student')),
      activeLecturers: count(db.collection('accounts').where('status', '==', 'active').where('roles', 'array-contains', 'lecturer')),
      activeProgramStudies: count(db.collection('academicProgramStudies').where('active', '==', true)),
      activeAcademicPeriods: count(db.collection('academicPeriodDefinitions').where('active', '==', true)),
      courseVersions: count(db.collection('academicCourseVersions')),
      activeCurricula: count(db.collection('academicCurriculumVersions').where('status', '==', 'ACTIVE')),
      academicStudentProfiles: count(db.collection('academicStudentProfiles')),
      studentAcademicStates: count(db.collection('studentAcademicStates')),
      billingStudentProfiles: count(db.collection('billingStudentProfiles')),
      activeClasses: count(db.collection('academicClasses').where('status', '==', 'ACTIVE')),
      activeEnrollments: count(db.collection('classEnrollments').where('status', '==', 'ACTIVE')),
      learningSpaces: count(db.collection('learningSpaces')),
      publishedMaterials: count(db.collection('learningMaterials').where('status', '==', 'PUBLISHED')),
      publishedAssignments: count(db.collection('learningAssignments').where('status', '==', 'PUBLISHED')),
      admissionApplications: count(db.collection('admissionApplications')),
      invoices: count(db.collection('invoices')),
      pddiktiJobs: count(db.collection('pddiktiSyncJobs')),
      auditLogs: count(db.collection('auditLogs')),
    }
    const [entries, roleEntries] = await Promise.all([
      Promise.all(Object.entries(countTasks).map(async ([key, task]) => [key, await task])),
      Promise.all(Object.entries(roleCountTasks).map(async ([key, task]) => [key, await task])),
    ])
    const counts = { ...Object.fromEntries(entries), activeRoleAccounts: Object.fromEntries(roleEntries) }
    const assessment = evaluateCampusReadiness({ counts, environment })
    process.stdout.write(`${JSON.stringify({
      projectId,
      featureProfile: environment.APP_FEATURE_PROFILE || 'full-campus',
      counts,
      ...assessment,
      note: 'Aggregate-only audit; no names, emails, student IDs, grades, or document contents are read or printed.',
    }, null, 2)}\n`)
    if (!assessment.readyForRoleUat) process.exitCode = 2
  } finally {
    await deleteApp(app)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
