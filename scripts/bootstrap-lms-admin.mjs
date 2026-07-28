import { createHash } from 'node:crypto'
import { parseArgs } from 'node:util'
import { applicationDefault, deleteApp, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

const ALLOWED_PROJECT_ID = 'sttsp-lms-staging'
const BOOTSTRAP_ACTOR = 'system-bootstrap'
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function opaqueId(prefix, value) {
  return `${prefix}_${createHash('sha256').update(value).digest('hex').slice(0, 24)}`
}

function options() {
  const { values } = parseArgs({
    options: {
      project: { type: 'string' },
      'confirm-project': { type: 'string' },
      email: { type: 'string' },
      'display-name': { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
    },
    strict: true,
  })
  const projectId = String(values.project || '')
  const email = String(values.email || '').trim().toLowerCase()
  const displayName = String(values['display-name'] || '').trim()

  if (projectId !== ALLOWED_PROJECT_ID || values['confirm-project'] !== ALLOWED_PROJECT_ID) {
    throw new Error(`Bootstrap hanya mengizinkan project ${ALLOWED_PROJECT_ID} dengan --confirm-project yang sama.`)
  }
  if (!EMAIL_PATTERN.test(email) || email.length > 254) throw new Error('--email harus berupa alamat email yang valid.')
  if (displayName.length < 2 || displayName.length > 150) throw new Error('--display-name harus berisi 2-150 karakter.')
  return { projectId, email, displayName, dryRun: values['dry-run'] }
}

function authCode(error) {
  return error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
}

async function findIdentity(auth, uid, email) {
  try {
    return await auth.getUser(uid)
  } catch (error) {
    if (authCode(error) !== 'auth/user-not-found') throw error
  }
  try {
    const byEmail = await auth.getUserByEmail(email)
    if (byEmail.uid !== uid) throw new Error('Email bootstrap telah digunakan oleh UID lain.')
    return byEmail
  } catch (error) {
    if (authCode(error) !== 'auth/user-not-found') throw error
  }
  return undefined
}

async function bootstrap() {
  const input = options()
  const uid = opaqueId('usr', `bootstrap-admin:${input.email}`)
  if (input.dryRun) {
    console.log(`Bootstrap admin valid: project=${input.projectId}, uid=${uid}. Tidak ada perubahan Firebase.`)
    return
  }

  const app = initializeApp({ projectId: input.projectId, credential: applicationDefault() })
  let createdIdentity = false
  try {
    const auth = getAuth(app)
    const db = getFirestore(app)
    const existingIdentity = await findIdentity(auth, uid, input.email)
    if (existingIdentity?.customClaims && Object.keys(existingIdentity.customClaims).length > 0
      && existingIdentity.customClaims.bootstrapManaged !== true) {
      throw new Error('Identitas yang ada memiliki custom claims non-bootstrap; pemeriksaan manual diperlukan.')
    }

    if (existingIdentity) {
      await auth.updateUser(uid, { email: input.email, displayName: input.displayName, disabled: true })
    } else {
      await auth.createUser({
        uid,
        email: input.email,
        displayName: input.displayName,
        disabled: true,
        emailVerified: false,
      })
      createdIdentity = true
    }

    const scope = { unitIds: [], programStudyIds: [], cohortYears: [], studentIds: [] }
    await auth.setCustomUserClaims(uid, {
      roles: ['administrator'],
      scope,
      accountStatus: 'active',
      bootstrapManaged: true,
    })
    await auth.revokeRefreshTokens(uid)

    const now = new Date().toISOString()
    const account = {
      id: uid,
      email: input.email,
      displayName: input.displayName,
      roles: ['administrator'],
      scope,
      status: 'active',
      guardianStudentIds: [],
      version: 1,
      createdAt: now,
      createdBy: BOOTSTRAP_ACTOR,
      updatedAt: now,
      updatedBy: BOOTSTRAP_ACTOR,
      bootstrapManaged: true,
    }
    const accountRef = db.collection('accounts').doc(uid)
    const profileRef = db.collection('users').doc(uid)
    const emailRef = db.collection('accountEmailIndex').doc(opaqueId('email', input.email))
    const auditId = opaqueId('audit', `${now}:${BOOTSTRAP_ACTOR}:${uid}`)
    await db.runTransaction(async transaction => {
      const [storedAccount, storedEmail] = await Promise.all([
        transaction.get(accountRef),
        transaction.get(emailRef),
      ])
      if (storedAccount.exists) {
        const data = storedAccount.data()
        if (data?.email !== input.email || data?.bootstrapManaged !== true) {
          throw new Error('Dokumen akun yang ada bukan milik bootstrap ini.')
        }
      } else {
        transaction.create(accountRef, account)
        transaction.create(profileRef, {
          displayName: input.displayName,
          phone: '',
          photoURL: '',
          version: 1,
          createdAt: now,
          createdBy: BOOTSTRAP_ACTOR,
          updatedAt: now,
          updatedBy: BOOTSTRAP_ACTOR,
          bootstrapManaged: true,
        })
      }
      if (storedEmail.exists && storedEmail.data()?.accountId !== uid) {
        throw new Error('Indeks email telah dimiliki akun lain.')
      }
      transaction.set(emailRef, { accountId: uid, email: input.email, createdAt: now, bootstrapManaged: true })
      transaction.create(db.collection('auditLogs').doc(auditId), {
        id: auditId,
        occurredAt: now,
        actor: { uid: BOOTSTRAP_ACTOR, roles: ['administrator'] },
        action: 'INITIAL_ADMIN_BOOTSTRAPPED',
        resource: { type: 'account', id: uid },
        outcome: 'SUCCESS',
        metadata: { projectId: input.projectId, createdIdentity },
      })
    })
    await auth.updateUser(uid, { disabled: false })
    console.log(`Bootstrap admin selesai: project=${input.projectId}, uid=${uid}. Gunakan pemulihan kata sandi Firebase untuk aktivasi.`)
  } finally {
    await deleteApp(app)
  }
}

bootstrap().catch((error) => {
  const message = error instanceof Error ? error.message : 'Kesalahan tidak dikenal.'
  console.error(`Bootstrap admin dibatalkan: ${message.slice(0, 500)}`)
  process.exitCode = 1
})
