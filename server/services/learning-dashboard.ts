import type { H3Event } from 'h3'
import type { AuthContext } from '../types/auth'
import type {
  LearningActivityEvent,
  LearningAssignment,
  LearningForumPost,
  LearningForumThread,
  LearningGamificationPreference,
  LearningGamificationRule,
  LearningMaterial,
  LearningModule,
  LearningProgressDashboard,
  LearningSubmission,
  LearningSubmissionAttempt,
} from '../types/learning'
import { appendAudit } from '../utils/audit'
import { conflict, invalidInput, serviceUnavailable } from '../utils/errors'
import { dataMode, firestoreAdmin } from '../utils/firebase-admin'
import { opaqueId, requestHash } from '../utils/security'
import { loadLearningSpace, requireLearningSpaceRead } from './learning'
import { learningMockState } from './learning-mock'
import { cleanLearningId, cleanLearningInteger } from './learning-validation'

export const LEARNING_GAMIFICATION_RULES: LearningGamificationRule[] = [
  { id: 'ON_TIME_SUBMISSION', label: 'Mengirim tugas sebelum atau saat tenggat', points: 10, maximumPerSpace: 100 },
  { id: 'FORUM_CONTRIBUTION', label: 'Membuat topik atau balasan forum yang tetap terlihat', points: 2, maximumPerSpace: 50 },
]

function clone<T>(value: T): T { return structuredClone(value) }

async function bySpace<T>(spaceId: string, collection: string, mockValues: () => T[], limit = 1_000): Promise<T[]> {
  if (dataMode() === 'mock') return mockValues().map(clone)
  const db = firestoreAdmin(); if (!db) serviceUnavailable('Penyimpanan pembelajaran tidak tersedia.')
  const snapshot = await db.collection(collection).where('spaceId', '==', spaceId).limit(limit).get()
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as T)
}

async function preferenceFor(spaceId: string, userUid: string): Promise<LearningGamificationPreference | undefined> {
  const id = opaqueId('learning_game_pref', `${spaceId}:${userUid}`)
  if (dataMode() === 'mock') return clone(learningMockState().gamificationPreferences.get(id))
  const db = firestoreAdmin(); if (!db) serviceUnavailable('Penyimpanan preferensi pembelajaran tidak tersedia.')
  const snapshot = await db.collection('learningGamificationPreferences').doc(id).get()
  return snapshot.exists ? { id: snapshot.id, ...snapshot.data() } as LearningGamificationPreference : undefined
}

export async function updateLearningGamificationPreference(
  context: AuthContext,
  spaceId: string,
  input: { optedIn: boolean; expectedVersion: number },
  idempotencyKey: string,
  event?: H3Event,
): Promise<{ preference: LearningGamificationPreference; replayed: boolean; auditId?: string }> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/.test(idempotencyKey)) invalidInput('Idempotency key tidak valid.')
  const space = await loadLearningSpace(cleanLearningId(spaceId, 'spaceId')); await requireLearningSpaceRead(context, space)
  if (!space.gamificationAvailable && input.optedIn) conflict('GAMIFICATION_NOT_AVAILABLE', 'Gamifikasi tidak diaktifkan pada ruang ini.')
  const expectedVersion = cleanLearningInteger(input.expectedVersion, 'expectedVersion', 0, 100_000)
  const hash = requestHash({ spaceId: space.id, userUid: context.uid, optedIn: Boolean(input.optedIn), expectedVersion }), namespace = `gamification:preference:${idempotencyKey}`
  if (dataMode() === 'mock') { const prior = learningMockState().idempotency.get(namespace); if (prior) { if (prior.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.'); return { ...(clone(prior.response) as { preference: LearningGamificationPreference; replayed: boolean }), replayed: true } } }
  const id = opaqueId('learning_game_pref', `${space.id}:${context.uid}`), now = new Date().toISOString()
  const current = await preferenceFor(space.id, context.uid)
  if ((current?.version ?? 0) !== expectedVersion) conflict('VERSION_CONFLICT', 'Preferensi gamifikasi telah berubah.', { currentVersion: current?.version ?? 0 })
  const preference: LearningGamificationPreference = { id, spaceId: space.id, userUid: context.uid, optedIn: Boolean(input.optedIn), version: (current?.version ?? 0) + 1, updatedAt: now }
  const response = { preference, replayed: false }
  if (dataMode() === 'mock') { learningMockState().gamificationPreferences.set(id, clone(preference)); learningMockState().idempotency.set(namespace, { requestHash: hash, response: clone(response) }) }
  else {
    const db = firestoreAdmin(); if (!db) serviceUnavailable('Penyimpanan preferensi pembelajaran tidak tersedia.'); const preferenceRef = db.collection('learningGamificationPreferences').doc(id), idemRef = db.collection('learningIdempotency').doc(opaqueId('idem', namespace))
    const result = await db.runTransaction(async transaction => { const [idem, snapshot] = await Promise.all([transaction.get(idemRef), transaction.get(preferenceRef)]); if (idem.exists) { const stored = idem.data() as { requestHash: string; response: typeof response }; if (stored.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.'); return { ...stored.response, replayed: true } } const fresh = snapshot.exists ? snapshot.data() as LearningGamificationPreference : undefined; if ((fresh?.version ?? 0) !== expectedVersion) conflict('VERSION_CONFLICT', 'Preferensi gamifikasi telah berubah.', { currentVersion: fresh?.version ?? 0 }); transaction.set(preferenceRef, preference); transaction.create(idemRef, { requestHash: hash, response, createdAt: now }); return response }); if (result.replayed) return result
  }
  const audit = await appendAudit({ actor: context, action: 'LEARNING_GAMIFICATION_PREFERENCE_UPDATED', resourceType: 'learning_gamification_preference', resourceId: id, before: { optedIn: current?.optedIn, version: expectedVersion }, after: { optedIn: preference.optedIn, version: preference.version }, event })
  return { ...response, auditId: audit.id }
}

export async function getLearningProgressDashboard(context: AuthContext, spaceId: string): Promise<LearningProgressDashboard> {
  const space = await loadLearningSpace(cleanLearningId(spaceId, 'spaceId'))
  const access = await requireLearningSpaceRead(context, space)
  const [modules, materials, assignments, submissions, attempts, events, threads, posts, preference] = await Promise.all([
    bySpace<LearningModule>(space.id, 'learningModules', () => [...learningMockState().modules.values()].filter(item => item.spaceId === space.id), 500),
    bySpace<LearningMaterial>(space.id, 'learningMaterials', () => [...learningMockState().materials.values()].filter(item => item.spaceId === space.id), 1_000),
    bySpace<LearningAssignment>(space.id, 'learningAssignments', () => [...learningMockState().assignments.values()].filter(item => item.spaceId === space.id), 500),
    bySpace<LearningSubmission>(space.id, 'learningSubmissions', () => [...learningMockState().submissions.values()].filter(item => item.spaceId === space.id), 2_000),
    bySpace<LearningSubmissionAttempt>(space.id, 'learningSubmissionAttempts', () => [...learningMockState().submissionAttempts.values()].filter(item => item.spaceId === space.id), 5_000),
    bySpace<LearningActivityEvent>(space.id, 'learningActivityEvents', () => [...learningMockState().activityEvents.values()].filter(item => item.spaceId === space.id), 250),
    bySpace<LearningForumThread>(space.id, 'learningForumThreads', () => [...learningMockState().forumThreads.values()].filter(item => item.spaceId === space.id), 250),
    bySpace<LearningForumPost>(space.id, 'learningForumPosts', () => [...learningMockState().forumPosts.values()].filter(item => item.spaceId === space.id), 1_000),
    preferenceFor(space.id, context.uid),
  ])
  const publishedAssignments = assignments.filter(item => item.status === 'PUBLISHED')
  const relevantSubmissions = access.canManage ? submissions : submissions.filter(item => item.studentId === access.studentId)
  const latestAttempts = relevantSubmissions.flatMap(submission => {
    const attempt = attempts.filter(item => item.submissionId === submission.id).sort((a, b) => b.attemptNumber - a.attemptNumber)[0]
    return attempt ? [attempt] : []
  })
  const denominator = access.canManage
    ? publishedAssignments.length * Math.max(access.academicClass?.rosterStudentIds.length ?? space.participantUserIds.length, 1)
    : publishedAssignments.length
  const submittedAssignments = latestAttempts.length
  const completionPercent = denominator ? Math.min(100, Math.round(submittedAssignments * 10000 / denominator) / 100) : 0
  const ownOnTime = attempts.filter(item => item.studentUid === context.uid && item.timeliness === 'ON_TIME').length
  const ownForumContributions = threads.filter(item => item.authorUid === context.uid && item.status !== 'HIDDEN').length
    + posts.filter(item => item.authorUid === context.uid && item.status === 'VISIBLE').length
  const optedIn = Boolean(space.gamificationAvailable && preference?.optedIn)
  const points = optedIn
    ? Math.min(ownOnTime * 10, LEARNING_GAMIFICATION_RULES[0]!.maximumPerSpace)
      + Math.min(ownForumContributions * 2, LEARNING_GAMIFICATION_RULES[1]!.maximumPerSpace)
    : 0
  return {
    spaceId: space.id, generatedAt: new Date().toISOString(), roleView: access.canManage ? 'TEACHER' : 'LEARNER',
    modulesPublished: modules.filter(item => item.status === 'PUBLISHED').length,
    materialsPublished: materials.filter(item => item.status === 'PUBLISHED').length,
    assignmentsPublished: publishedAssignments.length, submittedAssignments,
    onTimeSubmissions: latestAttempts.filter(item => item.timeliness === 'ON_TIME').length,
    lateSubmissions: latestAttempts.filter(item => item.timeliness === 'LATE').length,
    completionPercent,
    recentActivity: events.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, 20),
    gamification: {
      available: space.gamificationAvailable, optedIn, preferenceVersion: preference?.version ?? 0, points,
      rules: clone(LEARNING_GAMIFICATION_RULES),
      explanation: 'Poin bersifat sukarela dan informatif. Poin tidak memengaruhi nilai, akses kelas, atau sanksi akademik.',
    },
    method: 'DESCRIPTIVE_ONLY',
  }
}
