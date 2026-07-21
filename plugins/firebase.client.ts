import { getApps, initializeApp, type FirebaseApp } from 'firebase/app'
import { getAuth, type Auth } from 'firebase/auth'
import { getFirestore, type Firestore } from 'firebase/firestore'
import { getStorage, type FirebaseStorage } from 'firebase/storage'

export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig()
  const firebaseConfig = {
    apiKey: config.public.firebaseApiKey,
    authDomain: config.public.firebaseAuthDomain,
    projectId: config.public.firebaseProjectId,
    storageBucket: config.public.firebaseStorageBucket,
    messagingSenderId: config.public.firebaseMessagingSenderId,
    appId: config.public.firebaseAppId,
  }

  let app: FirebaseApp | null = null
  let firebaseAuth: Auth | null = null
  let firestore: Firestore | null = null
  let firebaseStorage: FirebaseStorage | null = null
  if (firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId) {
    app = getApps()[0] || initializeApp(firebaseConfig)
    firebaseAuth = getAuth(app)
    firestore = getFirestore(app)
    firebaseStorage = getStorage(app)
  }

  return {
    provide: {
      firebase: app,
      firebaseAuth,
      firestore,
      firebaseStorage,
    },
  }
})
