import { readFile } from 'node:fs/promises'
import process from 'node:process'
import { cert, deleteApp, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { initializeFirestore } from 'firebase-admin/firestore'

function argument(name, fallback) {
  const prefix = `--${name}=`
  return process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length) || fallback
}

function parseEnvironment(source) {
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

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
}

function same(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))
}

async function listAllUsers(auth) {
  const users = []
  let pageToken
  do {
    const page = await auth.listUsers(1_000, pageToken)
    users.push(...page.users)
    pageToken = page.pageToken
  } while (pageToken)
  return users
}

const environmentFile = argument('env', '.env.hostinger.production')
const fileValues = parseEnvironment(await readFile(environmentFile, 'utf8'))
const projectId = process.env.FIREBASE_PROJECT_ID || fileValues.FIREBASE_PROJECT_ID
const encodedCredentials = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 || fileValues.FIREBASE_SERVICE_ACCOUNT_BASE64

if (!projectId || !encodedCredentials) {
  throw new Error('FIREBASE_PROJECT_ID and FIREBASE_SERVICE_ACCOUNT_BASE64 are required.')
}

const credentials = JSON.parse(Buffer.from(encodedCredentials, 'base64').toString('utf8'))
if (credentials.project_id !== projectId) throw new Error('Firebase credential project does not match FIREBASE_PROJECT_ID.')

const app = initializeApp({ credential: cert(credentials), projectId }, `identity-audit-${Date.now()}`)

try {
  const auth = getAuth(app)
  const db = initializeFirestore(app, { preferRest: true })
  const [users, accountSnapshot] = await Promise.all([
    listAllUsers(auth),
    db.collection('accounts').get(),
  ])
  const identities = new Map(users.map(user => [user.uid, user]))
  const accounts = new Map(accountSnapshot.docs.map(document => [document.id, document.data()]))
  const roleCounts = {}
  const issues = {
    accountWithoutIdentity: 0,
    identityWithoutAccount: 0,
    inactiveAccountIdentityEnabled: 0,
    activeAccountIdentityDisabled: 0,
    invalidActiveAccount: 0,
    claimsMismatch: 0,
  }

  for (const [uid, account] of accounts) {
    const roles = Array.isArray(account.roles) ? account.roles.map(String) : []
    for (const role of roles) roleCounts[role] = (roleCounts[role] || 0) + 1
    const identity = identities.get(uid)
    if (!identity) {
      issues.accountWithoutIdentity += 1
      continue
    }
    if (account.status === 'active' && identity.disabled) issues.activeAccountIdentityDisabled += 1
    if (account.status !== 'active' && !identity.disabled) issues.inactiveAccountIdentityEnabled += 1
    if (account.status === 'active' && (!roles.length || !Number.isInteger(Number(account.version)) || Number(account.version) < 1)) {
      issues.invalidActiveAccount += 1
    }
    const expectedClaims = { roles, scope: account.scope || {}, accountStatus: account.status }
    const actualClaims = {
      roles: identity.customClaims?.roles || [],
      scope: identity.customClaims?.scope || {},
      accountStatus: identity.customClaims?.accountStatus,
    }
    if (!same(expectedClaims, actualClaims)) issues.claimsMismatch += 1
  }

  for (const uid of identities.keys()) {
    if (!accounts.has(uid)) issues.identityWithoutAccount += 1
  }

  const activeStudents = [...accounts.values()].filter(account => account.status === 'active' && Array.isArray(account.roles) && account.roles.includes('student')).length
  const hasIssues = Object.values(issues).some(count => count > 0)
  process.stdout.write(`${JSON.stringify({
    projectId,
    authUsers: users.length,
    accountDocuments: accounts.size,
    activeStudents,
    roleCounts,
    issues,
    healthy: !hasIssues,
  }, null, 2)}\n`)
  if (hasIssues) process.exitCode = 2
} finally {
  await deleteApp(app)
}
