import { applicationDefault, cert, getApps, initializeApp, type App, type ServiceAccount } from 'firebase-admin/app'
import { getAuth, type Auth } from 'firebase-admin/auth'
import { getFirestore, initializeFirestore, type Firestore } from 'firebase-admin/firestore'

export type FirebaseAdminState =
  | { available: true; app: App; mode: 'emulator' | 'service-account' | 'application-default' }
  | { available: false; reason: string }

let cachedState: FirebaseAdminState | undefined

export function serviceAccountJsonFromEnvironment(): string | undefined {
  const inlineJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim()
  if (inlineJson) return inlineJson
  const encodedJson = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64?.trim()
  return encodedJson ? Buffer.from(encodedJson, 'base64').toString('utf8') : undefined
}

function serviceAccountFromEnvironment(): Record<string, unknown> | undefined {
  const raw = serviceAccountJsonFromEnvironment()
  if (!raw) {
    if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
      return {
        project_id: process.env.FIREBASE_PROJECT_ID,
        client_email: process.env.FIREBASE_CLIENT_EMAIL,
        private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }
    }
    return undefined
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) return undefined
    return parsed
  } catch {
    return undefined
  }
}

export function firebaseAdminState(): FirebaseAdminState {
  if (cachedState) return cachedState

  try {
    const existing = getApps()[0]
    if (existing) {
      cachedState = { available: true, app: existing, mode: 'application-default' }
      return cachedState
    }

    const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT
    if (process.env.FIRESTORE_EMULATOR_HOST) {
      if (!projectId) {
        cachedState = { available: false, reason: 'FIREBASE_PROJECT_ID is required for the emulator.' }
        return cachedState
      }
      cachedState = { available: true, app: initializeApp({ projectId }), mode: 'emulator' }
      return cachedState
    }

    const serviceAccount = serviceAccountFromEnvironment()
    if (serviceAccount) {
      cachedState = {
        available: true,
        app: initializeApp({ credential: cert(serviceAccount as ServiceAccount), projectId: String(serviceAccount.project_id) }),
        mode: 'service-account',
      }
      return cachedState
    }

    const useApplicationDefault = process.env.FIREBASE_USE_APPLICATION_DEFAULT === 'true'
      || Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS)
    if (useApplicationDefault && projectId) {
      cachedState = {
        available: true,
        app: initializeApp({ credential: applicationDefault(), projectId }),
        mode: 'application-default',
      }
      return cachedState
    }

    cachedState = { available: false, reason: 'Firebase Admin credentials are not configured.' }
    return cachedState
  } catch {
    cachedState = { available: false, reason: 'Firebase Admin initialization failed.' }
    return cachedState
  }
}

export function firestoreAdmin(): Firestore | null {
  const state = firebaseAdminState()
  if (!state.available) return null

  // Hostinger's managed Node runtime can stall on Firestore's default gRPC
  // streaming transport. The REST transport supports the reads, writes, and
  // transactions used by this application without relying on HTTP/2.
  return prefersFirestoreRestTransport()
    ? initializeFirestore(state.app, { preferRest: true })
    : getFirestore(state.app)
}

export function prefersFirestoreRestTransport(): boolean {
  return process.env.DEPLOYMENT_TARGET === 'hostinger'
}

export function authAdmin(): Auth | null {
  const state = firebaseAdminState()
  return state.available ? getAuth(state.app) : null
}

export function dataMode(): 'firebase' | 'mock' | 'unavailable' {
  if (process.env.CAMPUS_DATA_MODE === 'mock') {
    if (process.env.NODE_ENV === 'production' && process.env.ALLOW_PRODUCTION_MOCK !== 'true') return 'unavailable'
    return 'mock'
  }
  if (firebaseAdminState().available) return 'firebase'
  return process.env.NODE_ENV === 'production' ? 'unavailable' : 'mock'
}

/** Test-only cache reset. It does not delete an initialized Firebase app. */
export function resetFirebaseAdminStateForTests(): void {
  cachedState = undefined
}
