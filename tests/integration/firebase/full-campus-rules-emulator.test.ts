// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { assertFails, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { afterAll, beforeAll, describe, it } from 'vitest'

const emulatorAvailable = Boolean(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_STORAGE_EMULATOR_HOST)
const suite = emulatorAvailable ? describe : describe.skip
let environment: RulesTestEnvironment

const claims = (role: string) => ({
  roles: [role],
  accountStatus: 'active',
  scope: { unitIds: ['campus'], programStudyIds: ['management-s1'], cohortYears: [2026], studentIds: ['student-001'] },
})

const asPromise = <T>(thenable: PromiseLike<T>): Promise<T> => new Promise((resolvePromise, reject) => thenable.then(resolvePromise, reject))

suite('Firebase Rules Emulator — profil full-campus produksi', () => {
  beforeAll(async () => {
    environment = await initializeTestEnvironment({
      projectId: 'demo-lms-mvp',
      firestore: { rules: readFileSync(resolve(process.cwd(), 'firebase/firestore.rules'), 'utf8') },
      storage: { rules: readFileSync(resolve(process.cwd(), 'firebase/storage.rules'), 'utf8') },
    })
  })

  afterAll(async () => { await environment.cleanup() })

  it.each(['student', 'lecturer', 'finance_staff', 'admissions_staff', 'administrator'])(
    'menolak seluruh data bisnis dan upload langsung untuk %s',
    async role => {
      const context = environment.authenticatedContext(`${role}-001`, claims(role))
      const db = context.firestore()
      const storage = context.storage()
      for (const path of [
        'users/student-001', 'students/student-001', 'krs/krs-001', 'invoices/invoice-001',
        'payments/payment-001', 'academicClasses/class-001', 'learningSpaces/class-001',
        'admissionApplications/application-001', 'pddiktiSyncJobs/job-001', 'auditLogs/audit-001',
      ]) await assertFails(db.doc(path).get())
      await assertFails(asPromise(storage.ref('profile-images/student-001/profile.png').putString('private')))
      await assertFails(asPromise(storage.ref('student-documents/student-001/document.pdf').putString('private')))
      await assertFails(asPromise(storage.ref('admissions/public/brochure.pdf').putString('private')))
    },
  )

  it('menolak anonymous pada Firestore dan Storage', async () => {
    const context = environment.unauthenticatedContext()
    await assertFails(context.firestore().doc('publicContent/news-001').get())
    await assertFails(asPromise(context.storage().ref('admissions/public/brochure.pdf').putString('private')))
  })
})
