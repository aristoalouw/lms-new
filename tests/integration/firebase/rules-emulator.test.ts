// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'

const emulatorAvailable = Boolean(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_STORAGE_EMULATOR_HOST)
const suite = emulatorAvailable ? describe : describe.skip
let environment: RulesTestEnvironment

const claims = (role: 'student' | 'lecturer' | 'administrator', programStudyIds = ['management-s1']) => ({
  roles: [role],
  scope: { unitIds: ['faculty-economics'], programStudyIds, studentIds: role === 'student' ? ['student-001'] : [] },
})

const asPromise = <T>(thenable: PromiseLike<T>): Promise<T> => new Promise((resolve, reject) => thenable.then(resolve, reject))

suite('Firebase Rules Emulator — profil LMS MVP', () => {
  beforeAll(async () => {
    environment = await initializeTestEnvironment({
      projectId: 'demo-lms-mvp',
      firestore: { rules: readFileSync(resolve(process.cwd(), 'firebase/firestore.rules'), 'utf8') },
      storage: { rules: readFileSync(resolve(process.cwd(), 'firebase/storage.rules'), 'utf8') },
    })
  })

  beforeEach(async () => {
    await environment.clearFirestore()
    await environment.clearStorage()
    await environment.withSecurityRulesDisabled(async context => {
      await context.firestore().doc('users/student-001').set({ displayName: 'Nabila Putri', phone: '', role: 'student', updatedAt: '2026-07-22T00:00:00.000Z' })
      await context.firestore().doc('learningSpaces/class-a').set({ programStudyId: 'management-s1', status: 'ACTIVE' })
      await context.firestore().doc('learningMaterials/material-a').set({ spaceId: 'class-a', status: 'PUBLISHED' })
      await context.firestore().doc('classEnrollments/class-a_student-001').set({ classId: 'class-a', studentId: 'student-001', studentUid: 'student-001', status: 'ACTIVE' })
      await context.firestore().doc('learningSpaces/class-b').set({ programStudyId: 'engineering-s1', status: 'ACTIVE' })
      await context.firestore().doc('learningMaterials/material-b').set({ spaceId: 'class-b', status: 'PUBLISHED' })
      await context.firestore().doc('classEnrollments/class-b_student-002').set({ classId: 'class-b', studentId: 'student-002', studentUid: 'student-002', status: 'ACTIVE' })
    })
  })

  afterAll(async () => { await environment.cleanup() })

  it('menolak akses anonymous ke profil dan seluruh data LMS', async () => {
    const db = environment.unauthenticatedContext().firestore()
    await assertFails(db.doc('users/student-001').get())
    await assertFails(db.doc('learningSpaces/class-a').get())
  })

  it.each(['student', 'lecturer', 'administrator'] as const)('menolak akses LMS langsung untuk role %s', async role => {
    const db = environment.authenticatedContext(`${role}-001`, claims(role)).firestore()
    await assertFails(db.doc('learningSpaces/class-a').get())
    await assertFails(db.doc('learningMaterials/material-a').get())
    await assertFails(db.doc('classEnrollments/class-a_student-001').get())
    await assertFails(db.doc('learningSubmissions/submission-a').set({ studentUid: `${role}-001` }))
  })

  it('hanya mengizinkan pemilik membaca dan mengubah field profil minimum', async () => {
    const owner = environment.authenticatedContext('student-001', claims('student')).firestore()
    const other = environment.authenticatedContext('student-002', claims('student', ['engineering-s1'])).firestore()
    await assertSucceeds(owner.doc('users/student-001').get())
    await assertSucceeds(owner.doc('users/student-001').update({ displayName: 'Nabila P.', updatedAt: '2026-07-22T01:00:00.000Z' }))
    await assertFails(owner.doc('users/student-001').update({ role: 'administrator' }))
    await assertFails(other.doc('users/student-001').get())
  })

  it('menolak pembacaan LMS lintas kelas dan lintas program pada boundary client', async () => {
    const managementStudent = environment.authenticatedContext('student-001', claims('student')).firestore()
    const engineeringLecturer = environment.authenticatedContext('lecturer-002', claims('lecturer', ['engineering-s1'])).firestore()
    await assertFails(managementStudent.doc('learningSpaces/class-b').get())
    await assertFails(managementStudent.doc('classEnrollments/class-b_student-002').get())
    await assertFails(engineeringLecturer.doc('learningMaterials/material-a').get())
  })

  it('menolak objek Storage privat untuk anonymous dan ketiga role', async () => {
    await assertFails(asPromise(environment.unauthenticatedContext().storage().ref('private/class-a/file.pdf').putString('private')))
    for (const role of ['student', 'lecturer', 'administrator'] as const) {
      const storage = environment.authenticatedContext(`${role}-001`, claims(role)).storage()
      await assertFails(asPromise(storage.ref('private/class-a/file.pdf').putString('private')))
      await assertFails(storage.ref('private/class-a/file.pdf').getDownloadURL())
    }
  })
})
