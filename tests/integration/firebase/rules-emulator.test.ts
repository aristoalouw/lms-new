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
  scope: {
    unitIds: [],
    programStudyIds,
    cohortYears: role === 'student' ? [2026] : [],
    studentIds: role === 'student' ? ['student-001'] : [],
  },
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
      await context.firestore().doc('users/student-001').set({
        displayName: 'Nabila Putri',
        phone: '',
        photoURL: '',
        role: 'student',
        updatedAt: '2026-07-22T00:00:00.000Z',
      })
      await context.firestore().doc('users/admin-001').set({
        displayName: 'Administrator LMS',
        phone: '',
        photoURL: '',
        role: 'administrator',
        updatedAt: '2026-07-22T00:00:00.000Z',
      })
      await context.firestore().doc('auditLogs/audit-existing').set({
        occurredAt: '2026-07-22T00:00:00.000Z',
        actor: { uid: 'lecturer-001', roles: ['lecturer'] },
        action: 'LEARNING_SUBMISSION_GRADED',
        resource: { type: 'learning_grade', id: 'grade-001' },
        outcome: 'SUCCESS',
        after: { score: 90 },
      })
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

  it('mengizinkan pemilik non-admin memperbarui empat field profil yang valid', async () => {
    const owner = environment.authenticatedContext('student-001', claims('student')).firestore()
    const other = environment.authenticatedContext('student-002', claims('student', ['engineering-s1'])).firestore()
    await assertSucceeds(owner.doc('users/student-001').get())
    await assertSucceeds(owner.doc('users/student-001').update({
      displayName: 'Nabila P.',
      phone: '+62 812-3456-7890',
      photoURL: 'https://cdn.example.ac.id/profiles/student-001.png',
      updatedAt: '2026-07-22T01:00:00.000Z',
    }))
    await assertSucceeds(owner.doc('users/student-001').update({
      photoURL: '',
      updatedAt: '2026-07-22T01:01:00.000Z',
    }))
    await assertFails(owner.doc('users/student-new').set({
      displayName: 'Student Baru',
      phone: '',
      photoURL: '',
      updatedAt: '2026-07-22T01:02:00.000Z',
    }))
    await assertFails(owner.doc('users/student-001').delete())
    await assertFails(owner.doc('users/student-001').update({ role: 'administrator' }))
    await assertFails(other.doc('users/student-001').get())
    await assertFails(other.doc('users/student-001').update({
      displayName: 'Pengguna Lain',
      updatedAt: '2026-07-22T01:03:00.000Z',
    }))
  })

  it('menolak tipe, panjang, URL, dan timestamp profil yang tidak aman', async () => {
    const profile = environment.authenticatedContext('student-001', claims('student')).firestore().doc('users/student-001')
    await assertFails(profile.update({ displayName: 'N', updatedAt: '2026-07-22T02:00:00.000Z' }))
    await assertFails(profile.update({ displayName: 'N'.repeat(151), updatedAt: '2026-07-22T02:01:00.000Z' }))
    await assertFails(profile.update({ phone: 628123456789, updatedAt: '2026-07-22T02:02:00.000Z' }))
    await assertFails(profile.update({ phone: '1'.repeat(33), updatedAt: '2026-07-22T02:03:00.000Z' }))
    await assertFails(profile.update({ photoURL: 'http://cdn.example.ac.id/profile.png', updatedAt: '2026-07-22T02:04:00.000Z' }))
    await assertFails(profile.update({ photoURL: 'https://cdn.example.ac.id/profile\nunsafe.png', updatedAt: '2026-07-22T02:04:30.000Z' }))
    await assertFails(profile.update({ photoURL: `https://example.ac.id/${'a'.repeat(2048)}`, updatedAt: '2026-07-22T02:05:00.000Z' }))
    await assertFails(profile.update({ updatedAt: '2026-7-22T02:06:00Z' }))
    await assertFails(profile.update({ updatedAt: 1_753_150_760_000 }))
    await assertFails(profile.update({ phone: '+62 811 0000 0000' }))
    await assertFails(profile.set({
      displayName: 'Nabila Putri',
      phone: '',
      role: 'student',
      updatedAt: '2026-07-22T02:07:00.000Z',
    }))
  })

  it('menolak create, update, dan delete profil langsung oleh administrator', async () => {
    const admin = environment.authenticatedContext('admin-001', claims('administrator')).firestore()
    await assertSucceeds(admin.doc('users/student-001').get())
    await assertFails(admin.doc('users/admin-created').set({
      displayName: 'Admin Created',
      phone: '',
      photoURL: '',
      updatedAt: '2026-07-22T03:00:00.000Z',
    }))
    await assertFails(admin.doc('users/admin-001').update({
      displayName: 'Admin Browser Update',
      updatedAt: '2026-07-22T03:01:00.000Z',
    }))
    await assertFails(admin.doc('users/student-001').delete())
  })

  it('menolak seluruh akses browser ke audit, termasuk administrator', async () => {
    const student = environment.authenticatedContext('student-001', claims('student')).firestore()
    const admin = environment.authenticatedContext('admin-001', claims('administrator')).firestore()
    await assertFails(student.doc('auditLogs/audit-existing').get())
    await assertFails(admin.doc('auditLogs/audit-existing').get())
    await assertFails(admin.doc('auditLogs/audit-created').set({ action: 'ADMIN_BROWSER_CREATE' }))
    await assertFails(admin.doc('auditLogs/audit-existing').update({ outcome: 'FAILURE' }))
    await assertFails(admin.doc('auditLogs/audit-existing').delete())
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
