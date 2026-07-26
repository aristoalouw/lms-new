import { createHash } from 'node:crypto'
import { parseArgs } from 'node:util'
import { applicationDefault, deleteApp, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

const SEED_ID = 'lms-mvp-synthetic-v1'
const SEED_VERSION = 1
const SEED_TIMESTAMP = '2026-07-27T00:00:00.000Z'
const SEED_ACTOR_UID = 'seed-admin-001'
const EMULATOR_PROJECT_ID = 'demo-lms-mvp'
const STAGING_PROJECT_ID = 'sttsp-lms-staging'
const DEFAULT_FIRESTORE_HOST = '127.0.0.1:8080'
const DEFAULT_AUTH_HOST = '127.0.0.1:9099'
const MAX_STUDENTS = 100
const MAX_BATCH_WRITES = 500

const UNIT_ID = 'seed-unit-campus'
const PROGRAM_ID = 'seed-program-lms-s1'
const PERIOD_ID = 'seed-2026-2027-1'
const COURSE_ID = 'seed-course-lms101'
const COURSE_VERSION_ID = `${COURSE_ID}_v1`
const COURSE_CODE = 'SEEDLMS101'
const SECTION = 'A'
const LECTURER_UID = 'seed-lecturer-001'

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function opaqueId(prefix, value) {
  return `${prefix}_${sha256(value).slice(0, 24)}`
}

function parseStudentCount(value) {
  if (!/^[1-9][0-9]*$/.test(value)) throw new Error('--students harus berupa bilangan bulat positif.')
  const count = Number(value)
  if (!Number.isSafeInteger(count) || count > MAX_STUDENTS) {
    throw new Error(`--students harus berada pada rentang 1-${MAX_STUDENTS}.`)
  }
  return count
}

function assertLoopbackHost(value, label) {
  const match = /^(localhost|127\.0\.0\.1|\[::1\]):([1-9][0-9]{0,4})$/.exec(value)
  const port = match ? Number(match[2]) : 0
  if (!match || port > 65_535) {
    throw new Error(`${label} wajib berupa host emulator loopback dengan port, misalnya 127.0.0.1:8080.`)
  }
}

function usage() {
  return [
    'Seed sintetis LMS MVP (maksimal 100 mahasiswa).',
    '',
    'Emulator, default dan aman:',
    '  node scripts/seed-lms-mvp.mjs --students=100',
    '  node scripts/seed-lms-mvp.mjs --dry-run --students=100',
    '',
    'Staging, wajib eksplisit:',
    `  node scripts/seed-lms-mvp.mjs --target=staging --project=${STAGING_PROJECT_ID} --confirm-staging=${STAGING_PROJECT_ID} --students=100`,
    '',
    'Opsi:',
    '  --target=emulator|staging',
    '  --project=<firebase-project-id>',
    '  --students=1..100',
    '  --firestore-host=127.0.0.1:8080',
    '  --auth-host=127.0.0.1:9099',
    '  --dry-run',
    '  --help',
  ].join('\n')
}

function readOptions() {
  const { values } = parseArgs({
    options: {
      target: { type: 'string', default: 'emulator' },
      project: { type: 'string' },
      students: { type: 'string', default: String(MAX_STUDENTS) },
      'confirm-staging': { type: 'string' },
      'firestore-host': { type: 'string' },
      'auth-host': { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    allowPositionals: false,
    strict: true,
  })

  if (values.help) return { help: true }
  if (!['emulator', 'staging'].includes(values.target)) {
    throw new Error('--target hanya menerima emulator atau staging.')
  }

  const studentCount = parseStudentCount(values.students)
  if (values.target === 'emulator') {
    const projectId = values.project ?? EMULATOR_PROJECT_ID
    if (projectId !== EMULATOR_PROJECT_ID) {
      throw new Error(`Target emulator hanya mengizinkan project ID ${EMULATOR_PROJECT_ID}.`)
    }
    if (values['confirm-staging']) throw new Error('--confirm-staging tidak berlaku untuk target emulator.')

    const firestoreHost = values['firestore-host']
      ?? process.env.FIRESTORE_EMULATOR_HOST
      ?? DEFAULT_FIRESTORE_HOST
    const authHost = values['auth-host']
      ?? process.env.FIREBASE_AUTH_EMULATOR_HOST
      ?? DEFAULT_AUTH_HOST
    assertLoopbackHost(firestoreHost, '--firestore-host')
    assertLoopbackHost(authHost, '--auth-host')
    return {
      help: false,
      target: 'emulator',
      projectId,
      studentCount,
      firestoreHost,
      authHost,
      dryRun: values['dry-run'],
    }
  }

  if (values['firestore-host'] || values['auth-host']) {
    throw new Error('Opsi host emulator tidak boleh digunakan untuk target staging.')
  }
  if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error('Hapus environment variable emulator sebelum memilih target staging.')
  }
  if (values.project !== STAGING_PROJECT_ID) {
    throw new Error(`Target staging hanya mengizinkan project ID ${STAGING_PROJECT_ID}.`)
  }
  if (values['confirm-staging'] !== STAGING_PROJECT_ID) {
    throw new Error(`Staging memerlukan --confirm-staging=${STAGING_PROJECT_ID}.`)
  }
  return {
    help: false,
    target: 'staging',
    projectId: STAGING_PROJECT_ID,
    studentCount,
    dryRun: values['dry-run'],
  }
}

function scope({ studentId } = {}) {
  return {
    unitIds: [UNIT_ID],
    programStudyIds: [PROGRAM_ID],
    cohortYears: studentId ? [2026] : [],
    studentIds: studentId ? [studentId] : [],
  }
}

function people(studentCount) {
  const fixed = [
    {
      uid: SEED_ACTOR_UID,
      email: 'admin.seed@example.test',
      displayName: 'Administrator Sintetis',
      roles: ['administrator'],
      scope: { unitIds: [], programStudyIds: [], cohortYears: [], studentIds: [] },
    },
    {
      uid: LECTURER_UID,
      email: 'lecturer.seed@example.test',
      displayName: 'Dosen Sintetis',
      roles: ['lecturer'],
      scope: scope(),
    },
  ]
  const students = Array.from({ length: studentCount }, (_, index) => {
    const number = index + 1
    const suffix = String(number).padStart(3, '0')
    const uid = `seed-student-${suffix}`
    return {
      uid,
      studentId: uid,
      studentNumber: String(26_000_000 + number),
      email: `student${suffix}.seed@example.test`,
      displayName: `Mahasiswa Sintetis ${suffix}`,
      roles: ['student'],
      scope: scope({ studentId: uid }),
    }
  })
  return [...fixed, ...students]
}

function auditFields() {
  return {
    version: 1,
    createdAt: SEED_TIMESTAMP,
    createdBy: SEED_ACTOR_UID,
    updatedAt: SEED_TIMESTAMP,
    updatedBy: SEED_ACTOR_UID,
    seedManaged: true,
    seedId: SEED_ID,
  }
}

function weeklySchedule(startIso, count = 16, durationMinutes = 100) {
  const start = Date.parse(startIso)
  return Array.from({ length: count }, (_, index) => {
    const scheduledStart = start + index * 7 * 24 * 60 * 60 * 1000
    const scheduledEnd = scheduledStart + durationMinutes * 60 * 1000
    return {
      meetingNumber: index + 1,
      scheduledStartAt: new Date(scheduledStart).toISOString(),
      scheduledEndAt: new Date(scheduledEnd).toISOString(),
      attendanceOpensAt: new Date(scheduledStart - 15 * 60 * 1000).toISOString(),
      attendanceClosesAt: new Date(scheduledEnd + 15 * 60 * 1000).toISOString(),
    }
  })
}

function addEntry(entries, path, data) {
  if (entries.some(entry => entry.path === path)) throw new Error(`Path seed duplikat: ${path}`)
  entries.push({ path, data })
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    )
  }
  return value
}

function buildPlan(options) {
  const identities = people(options.studentCount)
  const students = identities.filter(person => person.roles.includes('student'))
  const classKey = `${PERIOD_ID.toLowerCase()}|${COURSE_CODE.toLowerCase()}|${SECTION.toLowerCase()}`
  const classId = opaqueId('class', classKey)
  const classKeyId = sha256(classKey)
  const fields = auditFields()
  const entries = []

  for (const person of identities) {
    addEntry(entries, `accounts/${person.uid}`, {
      id: person.uid,
      email: person.email,
      displayName: person.displayName,
      roles: person.roles,
      scope: person.scope,
      status: 'active',
      guardianStudentIds: [],
      ...fields,
    })
    addEntry(entries, `users/${person.uid}`, {
      displayName: person.displayName,
      phone: '',
      photoURL: '',
      ...fields,
    })
    addEntry(entries, `accountEmailIndex/${opaqueId('email', person.email)}`, {
      accountId: person.uid,
      email: person.email,
      ...fields,
    })
  }

  addEntry(entries, `academicProgramStudies/${PROGRAM_ID}`, {
    id: PROGRAM_ID,
    facultyId: UNIT_ID,
    code: 'SYN-LMS',
    name: 'S1 Program Studi Sintetis LMS',
    level: 'S1',
    active: true,
    accreditationStatus: 'DATA_SYNTHETIC',
    accreditationExpiresAt: '2030-12-31',
    ...fields,
  })
  addEntry(entries, `academicPeriodDefinitions/${PERIOD_ID}`, {
    id: PERIOD_ID,
    academicYear: '2026/2027',
    term: 'ODD',
    startsAt: '2026-09-01T00:00:00.000Z',
    endsAt: '2027-01-31T16:59:59.000Z',
    krsOpensAt: '2026-08-10T00:00:00.000Z',
    krsClosesAt: '2026-08-28T16:59:59.000Z',
    active: true,
    ...fields,
  })
  addEntry(entries, `academicCourseVersions/${COURSE_VERSION_ID}`, {
    id: COURSE_VERSION_ID,
    courseId: COURSE_ID,
    code: COURSE_CODE,
    name: 'Pengantar Pembelajaran Digital Sintetis',
    programStudyId: PROGRAM_ID,
    credits: 3,
    semesterRecommendation: 1,
    prerequisiteCourseCodes: [],
    equivalentCourseCodes: [],
    status: 'ACTIVE',
    immutable: true,
    ...fields,
  })
  addEntry(entries, `academicCourseHeads/${COURSE_ID}`, {
    courseId: COURSE_ID,
    programStudyId: PROGRAM_ID,
    currentVersion: 1,
    currentVersionId: COURSE_VERSION_ID,
    ...fields,
  })

  const schedule = weeklySchedule('2026-09-07T01:00:00.000Z')
  addEntry(entries, `academicClasses/${classId}`, {
    id: classId,
    courseCode: COURSE_CODE,
    courseName: 'Pengantar Pembelajaran Digital Sintetis',
    credits: 3,
    section: SECTION,
    periodId: PERIOD_ID,
    programStudyId: PROGRAM_ID,
    unitId: UNIT_ID,
    lecturerIds: [LECTURER_UID],
    lecturerNames: ['Dosen Sintetis'],
    timezone: 'Asia/Jakarta',
    status: 'ACTIVE',
    totalScheduledMeetings: schedule.length,
    realizedMeetingCount: 0,
    schedule,
    enrollmentCount: students.length,
    capacity: MAX_STUDENTS,
    reservedSeatCount: 0,
    gradeConfigVersion: 1,
    gradebookVersion: 0,
    publicationVersion: 0,
    ...fields,
  })
  addEntry(entries, `academicClassKeys/${classKeyId}`, {
    classId,
    key: classKey,
    ...fields,
  })
  addEntry(entries, `academicClasses/${classId}/gradeConfiguration/current`, {
    classId,
    components: [
      { id: 'assignments', label: 'Tugas terstruktur', weight: 30, maxScore: 100, order: 1 },
      { id: 'midterm', label: 'Ujian tengah semester', weight: 30, maxScore: 100, order: 2 },
      { id: 'final', label: 'Ujian akhir semester', weight: 40, maxScore: 100, order: 3 },
    ],
    ...fields,
  })
  addEntry(entries, `learningSpaces/${classId}`, {
    id: classId,
    kind: 'ACADEMIC_CLASS',
    title: 'Pengantar Pembelajaran Digital Sintetis · Kelas A',
    description: `Ruang pembelajaran ${COURSE_CODE} untuk periode ${PERIOD_ID}.`,
    academicClassId: classId,
    courseCode: COURSE_CODE,
    section: SECTION,
    periodId: PERIOD_ID,
    programStudyId: PROGRAM_ID,
    unitId: UNIT_ID,
    lecturerIds: [LECTURER_UID],
    participantUserIds: [],
    status: 'ACTIVE',
    gamificationAvailable: false,
    ...fields,
  })

  for (const student of students) {
    const enrollmentId = `${classId}_${student.studentId}`
    addEntry(entries, `classEnrollments/${enrollmentId}`, {
      id: enrollmentId,
      classId,
      studentId: student.studentId,
      studentUid: student.uid,
      studentNumber: student.studentNumber,
      studentName: student.displayName,
      programStudyId: PROGRAM_ID,
      periodId: PERIOD_ID,
      status: 'ACTIVE',
      source: 'ADMIN',
      sourceRef: `synthetic-seed:${SEED_ID}`,
      overrideReason: 'Enrolment sintetis untuk verifikasi LMS MVP.',
      ...fields,
    })
  }

  const planHash = sha256(JSON.stringify(stableValue({
    seedId: SEED_ID,
    seedVersion: SEED_VERSION,
    projectId: options.projectId,
    target: options.target,
    studentCount: options.studentCount,
    entries,
  })))
  const auditId = opaqueId('audit', `${SEED_ID}:${options.projectId}`)
  addEntry(entries, `auditLogs/${auditId}`, {
    id: auditId,
    occurredAt: SEED_TIMESTAMP,
    actor: { uid: SEED_ACTOR_UID, roles: ['administrator'] },
    action: 'LMS_MVP_SYNTHETIC_SEED_APPLIED',
    resource: { type: 'system_seed', id: SEED_ID },
    outcome: 'SUCCESS',
    metadata: {
      projectId: options.projectId,
      target: options.target,
      studentCount: options.studentCount,
      seedVersion: SEED_VERSION,
      planHash,
    },
    seedManaged: true,
    seedId: SEED_ID,
  })
  addEntry(entries, `systemSeedRuns/${SEED_ID}`, {
    id: SEED_ID,
    seedVersion: SEED_VERSION,
    projectId: options.projectId,
    target: options.target,
    studentCount: options.studentCount,
    authUserCount: identities.length,
    firestoreDocumentCount: entries.length + 1,
    planHash,
    ...fields,
  })

  if (entries.length > MAX_BATCH_WRITES) {
    throw new Error(`Seed menghasilkan ${entries.length} write; batas batch adalah ${MAX_BATCH_WRITES}.`)
  }
  for (const identity of identities) {
    const claims = {
      roles: identity.roles,
      scope: identity.scope,
      accountStatus: 'active',
      seedManaged: true,
      seedId: SEED_ID,
    }
    if (Buffer.byteLength(JSON.stringify(claims), 'utf8') > 900) {
      throw new Error(`Custom claims melampaui batas aman untuk UID ${identity.uid}.`)
    }
  }
  return { identities, entries, classId, planHash }
}

function firebaseErrorCode(error) {
  return error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined
}

async function synchronizeIdentity(auth, identity) {
  let existing
  try {
    existing = await auth.getUser(identity.uid)
  } catch (error) {
    if (firebaseErrorCode(error) !== 'auth/user-not-found') throw error
  }

  if (existing) {
    if (existing.email?.toLowerCase() !== identity.email) {
      throw new Error(`UID sintetis ${identity.uid} sudah digunakan oleh email berbeda.`)
    }
    const claims = existing.customClaims ?? {}
    if (claims.seedManaged !== true || claims.seedId !== SEED_ID) {
      throw new Error(`UID sintetis ${identity.uid} tidak memiliki marker kepemilikan seed yang sama.`)
    }
    await auth.updateUser(identity.uid, {
      email: identity.email,
      displayName: identity.displayName,
      disabled: false,
      emailVerified: existing.emailVerified,
    })
  } else {
    await auth.createUser({
      uid: identity.uid,
      email: identity.email,
      displayName: identity.displayName,
      disabled: false,
      emailVerified: true,
    })
  }

  await auth.setCustomUserClaims(identity.uid, {
    roles: identity.roles,
    scope: identity.scope,
    accountStatus: 'active',
    seedManaged: true,
    seedId: SEED_ID,
  })
  await auth.revokeRefreshTokens(identity.uid)
}

async function runWithConcurrency(items, concurrency, task) {
  let cursor = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      await task(items[index])
    }
  })
  await Promise.all(workers)
}

async function getSnapshots(db, references, chunkSize = 100) {
  const snapshots = []
  for (let index = 0; index < references.length; index += chunkSize) {
    snapshots.push(...await db.getAll(...references.slice(index, index + chunkSize)))
  }
  return snapshots
}

async function assertFirestoreOwnership(db, plan, options) {
  const references = plan.entries.map(entry => db.doc(entry.path))
  const snapshots = await getSnapshots(db, references)
  const markerPath = `systemSeedRuns/${SEED_ID}`
  let markerFound = false
  let existingCount = 0
  for (const snapshot of snapshots) {
    if (!snapshot.exists) continue
    existingCount += 1
    const path = snapshot.ref.path
    const data = snapshot.data()
    if (data?.seedManaged !== true || data?.seedId !== SEED_ID) {
      throw new Error(`Seed menolak menimpa dokumen yang tidak dimiliki: ${path}`)
    }
    if (path === markerPath) {
      markerFound = true
      if (data.projectId !== options.projectId || data.target !== options.target) {
        throw new Error('Marker seed berasal dari project atau target berbeda.')
      }
      if (data.studentCount !== options.studentCount) {
        throw new Error('Jumlah mahasiswa berbeda dari seed sebelumnya; cleanup/migrasi eksplisit diperlukan.')
      }
      if (data.seedVersion !== SEED_VERSION || data.planHash !== plan.planHash) {
        throw new Error('Versi atau fingerprint seed berbeda; gunakan prosedur migrasi eksplisit.')
      }
    }
  }
  if (!markerFound && existingCount > 0) {
    throw new Error('Dokumen seed tanpa marker run ditemukan; cleanup atau pemulihan eksplisit diperlukan.')
  }
}

async function applyFirestorePlan(db, plan) {
  const batch = db.batch()
  for (const entry of plan.entries) batch.set(db.doc(entry.path), entry.data)
  await batch.commit()
}

function initializeFirebase(options) {
  if (options.target === 'emulator') {
    process.env.FIRESTORE_EMULATOR_HOST = options.firestoreHost
    process.env.FIREBASE_AUTH_EMULATOR_HOST = options.authHost
    return initializeApp({ projectId: options.projectId })
  }
  return initializeApp({
    projectId: options.projectId,
    credential: applicationDefault(),
  })
}

async function main() {
  const options = readOptions()
  if (options.help) {
    console.log(usage())
    return
  }
  const plan = buildPlan(options)
  const summary = `target=${options.target}, project=${options.projectId}, mahasiswa=${options.studentCount}, auth=${plan.identities.length}, firestore=${plan.entries.length}`
  if (options.dryRun) {
    console.log(`Dry-run seed valid: ${summary}. Tidak ada koneksi Firebase.`)
    return
  }

  const app = initializeFirebase(options)
  try {
    const db = getFirestore(app)
    const auth = getAuth(app)
    await assertFirestoreOwnership(db, plan, options)
    await runWithConcurrency(plan.identities, 5, identity => synchronizeIdentity(auth, identity))
    await applyFirestorePlan(db, plan)
    console.log(`Seed selesai: ${summary}.`)
  } finally {
    await deleteApp(app)
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : 'Kesalahan tidak dikenal.'
  console.error(`Seed dibatalkan: ${message.slice(0, 500)}`)
  process.exitCode = 1
})
