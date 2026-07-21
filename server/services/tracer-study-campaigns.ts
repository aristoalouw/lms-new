import type { H3Event } from 'h3'
import type { AuthContext } from '../types/auth'
import type {
  TracerAlumniProfile,
  TracerCampaign,
  TracerCampaignKind,
  TracerDeliveryRecord,
  TracerOpaqueTokenRecord,
  TracerRecipient,
} from '../types/tracer-study'
import { appendAudit } from '../utils/audit'
import { conflict, invalidInput, notFound, serviceUnavailable } from '../utils/errors'
import { dataMode, firestoreAdmin } from '../utils/firebase-admin'
import { opaqueId, requestHash } from '../utils/security'
import { emailDeliveryAdapterFromEnvironment } from './email-delivery'
import {
  generateTracerOpaqueToken,
  hashTracerAccessToken,
  isTracerPeriodOpen,
  loadTracerPeriod,
  requireTracerManager,
  tracerTokenRecordId,
} from './tracer-study'
import { tracerStudyMockState } from './tracer-study-mock'

export interface SendTracerCampaignInput {
  periodId: string
  kind: TracerCampaignKind
  reminderSequence?: number
}

export interface TracerEmailDeliveryRequest {
  deliveryId: string
  recipientEmail: string
  subject: string
  textBody: string
}

export type TracerEmailDeliveryHook = (request: TracerEmailDeliveryRequest) => Promise<{ providerMessageId: string }>

function cleanId(value: string, label: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{1,127}$/.test(value)) invalidInput(`${label} tidak valid.`)
  return value
}

function normalizeInput(input: SendTracerCampaignInput): Required<SendTracerCampaignInput> {
  if (!['INITIAL', 'REMINDER'].includes(input.kind)) invalidInput('Jenis kampanye tidak valid.')
  const reminderSequence = input.kind === 'REMINDER' ? input.reminderSequence : 0
  if (!Number.isInteger(reminderSequence) || (reminderSequence as number) < 0 || (reminderSequence as number) > 20) invalidInput('Urutan reminder tidak valid.')
  if (input.kind === 'REMINDER' && reminderSequence === 0) invalidInput('Urutan reminder wajib dimulai dari 1.')
  return { periodId: cleanId(input.periodId, 'Periode'), kind: input.kind, reminderSequence: reminderSequence as number }
}

function eligible(profile: TracerAlumniProfile, period: Awaited<ReturnType<typeof loadTracerPeriod>>): boolean {
  return profile.contactable
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email)
    && period.programStudyIds.includes(profile.programStudyId)
    && profile.graduationYear >= period.graduationYearFrom
    && profile.graduationYear <= period.graduationYearTo
    && Date.parse(profile.graduatedAt) <= Date.parse(period.opensAt)
}

async function eligibleProfiles(period: Awaited<ReturnType<typeof loadTracerPeriod>>): Promise<TracerAlumniProfile[]> {
  let profiles: TracerAlumniProfile[]
  if (dataMode() === 'mock') profiles = [...tracerStudyMockState().alumniProfiles.values()].map(item => structuredClone(item))
  else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan profil alumni tidak tersedia.')
    const chunks = Array.from({ length: Math.ceil(period.programStudyIds.length / 30) }, (_, index) => period.programStudyIds.slice(index * 30, index * 30 + 30))
    const snapshots = await Promise.all(chunks.map(chunk => db.collection('tracerAlumniProfiles').where('programStudyId', 'in', chunk).limit(2_500).get()))
    profiles = snapshots.flatMap(snapshot => snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as TracerAlumniProfile))
  }
  return profiles.filter(profile => eligible(profile, period))
}

async function recipientsForReminder(periodId: string): Promise<TracerRecipient[]> {
  if (dataMode() === 'mock') return [...tracerStudyMockState().recipients.values()].filter(item => item.periodId === periodId).map(item => structuredClone(item))
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan penerima tracer study tidak tersedia.')
  const snapshot = await db.collection('tracerRecipients').where('periodId', '==', periodId).limit(2_500).get()
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as TracerRecipient)
}

async function loadProfile(id: string): Promise<TracerAlumniProfile> {
  if (dataMode() === 'mock') {
    const profile = tracerStudyMockState().alumniProfiles.get(id)
    if (!profile) notFound('Profil alumni')
    return structuredClone(profile)
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan profil alumni tidak tersedia.')
  const snapshot = await db.collection('tracerAlumniProfiles').doc(id).get()
  if (!snapshot.exists) notFound('Profil alumni')
  return { id: snapshot.id, ...snapshot.data() } as TracerAlumniProfile
}

function defaultDeliveryHook(): TracerEmailDeliveryHook {
  if (dataMode() === 'mock') return async request => ({ providerMessageId: opaqueId('mock_email', request.deliveryId) })
  const adapter = emailDeliveryAdapterFromEnvironment()
  return request => adapter.send({
    outboxId: request.deliveryId,
    to: request.recipientEmail,
    deliveryKind: 'RENDERED_TEMPLATE',
    subject: request.subject,
    textBody: request.textBody,
  })
}

function baseUrl(): URL {
  const configured = process.env.TRACER_STUDY_PUBLIC_URL?.trim()
    || (dataMode() === 'mock' ? 'https://campus.example.test/tracer-study' : '')
  let url: URL
  try {
    url = new URL(configured)
  } catch {
    serviceUnavailable('TRACER_STUDY_PUBLIC_URL belum valid.')
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) serviceUnavailable('TRACER_STUDY_PUBLIC_URL wajib memakai HTTPS tanpa credential atau fragment.')
  return url
}

function invitationBody(profile: TracerAlumniProfile, periodName: string, url: URL, kind: TracerCampaignKind): string {
  return [
    `Yth. ${profile.displayName},`,
    '',
    kind === 'REMINDER' ? `Pengingat: periode ${periodName} masih menunggu respons Anda.` : `Anda diundang berpartisipasi dalam ${periodName}.`,
    'Partisipasi bersifat sukarela. Persetujuan ditampilkan sebelum kuesioner dan dapat ditarik kembali.',
    '',
    `Buka tautan aman berikut: ${url.toString()}`,
    '',
    'Tautan memiliki masa berlaku dan hanya dapat menghasilkan satu respons.',
  ].join('\n')
}

async function existingDelivery(id: string): Promise<TracerDeliveryRecord | undefined> {
  if (dataMode() === 'mock') return structuredClone(tracerStudyMockState().deliveries.get(id))
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan kampanye tracer study tidak tersedia.')
  const snapshot = await db.collection('tracerDeliveries').doc(id).get()
  return snapshot.exists ? { id: snapshot.id, ...snapshot.data() } as TracerDeliveryRecord : undefined
}

async function revokeActiveAccessTokens(recipientId: string, revokedAt: string): Promise<void> {
  if (dataMode() === 'mock') {
    for (const [id, token] of tracerStudyMockState().tokens.entries()) {
      if (token.recipientId === recipientId && token.purpose === 'ACCESS' && token.status === 'ACTIVE') {
        tracerStudyMockState().tokens.set(id, { ...token, status: 'REVOKED', revokedAt })
      }
    }
    return
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan token tracer study tidak tersedia.')
  const snapshot = await db.collection('tracerOpaqueTokens').where('recipientId', '==', recipientId).limit(50).get()
  const batch = db.batch()
  for (const document of snapshot.docs) {
    const token = document.data() as TracerOpaqueTokenRecord
    if (token.purpose === 'ACCESS' && token.status === 'ACTIVE') batch.update(document.ref, { status: 'REVOKED', revokedAt })
  }
  await batch.commit()
}

async function persistPending(
  recipient: TracerRecipient,
  token: TracerOpaqueTokenRecord,
  delivery: TracerDeliveryRecord,
): Promise<void> {
  if (dataMode() === 'mock') {
    tracerStudyMockState().recipients.set(recipient.id, structuredClone(recipient))
    tracerStudyMockState().tokens.set(token.id, structuredClone(token))
    tracerStudyMockState().deliveries.set(delivery.id, structuredClone(delivery))
    return
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan kampanye tracer study tidak tersedia.')
  const batch = db.batch()
  batch.set(db.collection('tracerRecipients').doc(recipient.id), recipient)
  batch.create(db.collection('tracerOpaqueTokens').doc(token.id), token)
  batch.create(db.collection('tracerDeliveries').doc(delivery.id), delivery)
  await batch.commit()
}

async function persistDeliveryResult(delivery: TracerDeliveryRecord, recipient: TracerRecipient): Promise<void> {
  if (dataMode() === 'mock') {
    tracerStudyMockState().deliveries.set(delivery.id, structuredClone(delivery))
    tracerStudyMockState().recipients.set(recipient.id, structuredClone(recipient))
    return
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan kampanye tracer study tidak tersedia.')
  const batch = db.batch()
  batch.set(db.collection('tracerDeliveries').doc(delivery.id), delivery)
  batch.set(db.collection('tracerRecipients').doc(recipient.id), recipient)
  await batch.commit()
}

async function campaignById(id: string): Promise<TracerCampaign> {
  if (dataMode() === 'mock') {
    const campaign = tracerStudyMockState().campaigns.get(id)
    if (!campaign) notFound('Kampanye tracer study')
    return structuredClone(campaign)
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan kampanye tracer study tidak tersedia.')
  const snapshot = await db.collection('tracerCampaigns').doc(id).get()
  if (!snapshot.exists) notFound('Kampanye tracer study')
  return { id: snapshot.id, ...snapshot.data() } as TracerCampaign
}

export async function sendTracerCampaign(
  context: AuthContext,
  input: SendTracerCampaignInput,
  idempotencyKey: string,
  event?: H3Event,
  now = Date.now(),
  deliveryHook: TracerEmailDeliveryHook = defaultDeliveryHook(),
): Promise<{ campaign: TracerCampaign; replayed: boolean; auditId?: string }> {
  const normalized = normalizeInput(input)
  const period = await loadTracerPeriod(normalized.periodId)
  requireTracerManager(context, period.programStudyIds)
  if (!isTracerPeriodOpen(period, now)) conflict('TRACER_PERIOD_NOT_OPEN', 'Kampanye hanya dapat dikirim saat periode aktif.')
  const hash = requestHash(normalized)
  const namespace = `campaign:send:${idempotencyKey}`
  const campaignId = opaqueId('tracer_campaign', `${context.uid}:${idempotencyKey}`)
  const createdAt = new Date(now).toISOString()
  if (dataMode() === 'mock') {
    const previous = tracerStudyMockState().idempotency.get(namespace)
    if (previous) {
      if (previous.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.')
      return { campaign: structuredClone(previous.response) as TracerCampaign, replayed: true }
    }
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan kampanye tracer study tidak tersedia.')
    const idemSnapshot = await db.collection('tracerStudyIdempotency').doc(opaqueId('idem', namespace)).get()
    if (idemSnapshot.exists) {
      const stored = idemSnapshot.data() as { requestHash: string; campaignId: string }
      if (stored.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.')
      return { campaign: await campaignById(stored.campaignId), replayed: true }
    }
  }
  const profiles = normalized.kind === 'INITIAL'
    ? await eligibleProfiles(period)
    : await Promise.all((await recipientsForReminder(period.id))
      .filter(recipient => ['DELIVERED', 'DELIVERY_FAILED', 'OPENED', 'ELIGIBLE'].includes(recipient.status))
      .map(recipient => loadProfile(recipient.alumniProfileId)))
  const uniqueProfiles = [...new Map(profiles.filter(profile => eligible(profile, period)).map(profile => [profile.id, profile])).values()]
  let campaign: TracerCampaign = {
    id: campaignId, periodId: period.id, kind: normalized.kind,
    ...(normalized.kind === 'REMINDER' ? { reminderSequence: normalized.reminderSequence } : {}),
    status: 'PROCESSING', eligibleCount: uniqueProfiles.length, sentCount: 0, failedCount: 0, skippedCount: 0,
    createdAt, createdBy: context.uid,
  }
  if (dataMode() === 'mock') tracerStudyMockState().campaigns.set(campaign.id, structuredClone(campaign))
  else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan kampanye tracer study tidak tersedia.')
    const idem = db.collection('tracerStudyIdempotency').doc(opaqueId('idem', namespace))
    const replayed = await db.runTransaction(async (transaction) => {
      const prior = await transaction.get(idem)
      if (prior.exists) {
        const stored = prior.data() as { requestHash: string }
        if (stored.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.')
        return true
      }
      transaction.create(db.collection('tracerCampaigns').doc(campaign.id), campaign)
      transaction.create(idem, { requestHash: hash, campaignId: campaign.id, createdAt })
      return false
    })
    if (replayed) return { campaign: await campaignById(campaign.id), replayed: true }
  }
  const targetBaseUrl = baseUrl()
  for (const profile of uniqueProfiles) {
    const recipientId = opaqueId('tracer_recipient', `${period.id}:${profile.id}`)
    const existingRecipient = dataMode() === 'mock'
      ? structuredClone(tracerStudyMockState().recipients.get(recipientId))
      : await (async () => {
          const db = firestoreAdmin()
          if (!db) serviceUnavailable('Penyimpanan penerima tracer study tidak tersedia.')
          const snapshot = await db.collection('tracerRecipients').doc(recipientId).get()
          return snapshot.exists ? { id: snapshot.id, ...snapshot.data() } as TracerRecipient : undefined
        })()
    if (existingRecipient && ['RESPONDED', 'WITHDRAWN'].includes(existingRecipient.status)) {
      campaign.skippedCount++
      continue
    }
    const deliveryId = opaqueId('tracer_delivery', `${period.id}:${recipientId}:${normalized.kind}:${normalized.reminderSequence}`)
    if (await existingDelivery(deliveryId)) {
      campaign.skippedCount++
      continue
    }
    await revokeActiveAccessTokens(recipientId, createdAt)
    const rawToken = generateTracerOpaqueToken()
    const tokenHash = hashTracerAccessToken(rawToken)
    const tokenExpiresAt = new Date(Math.min(Date.parse(period.closesAt), now + period.accessTokenTtlHours * 3_600_000)).toISOString()
    const token: TracerOpaqueTokenRecord = {
      id: tracerTokenRecordId(tokenHash), tokenHash, purpose: 'ACCESS', periodId: period.id, recipientId,
      status: 'ACTIVE', expiresAt: tokenExpiresAt, createdAt,
    }
    const recipient: TracerRecipient = existingRecipient
      ? { ...existingRecipient, version: existingRecipient.version + 1, updatedAt: createdAt }
      : { id: recipientId, periodId: period.id, alumniProfileId: profile.id, programStudyId: profile.programStudyId, graduationYear: profile.graduationYear, status: 'ELIGIBLE', version: 1, createdAt, updatedAt: createdAt }
    const delivery: TracerDeliveryRecord = {
      id: deliveryId, campaignId: campaign.id, periodId: period.id, recipientId, tokenRecordId: token.id,
      kind: normalized.kind, ...(normalized.kind === 'REMINDER' ? { reminderSequence: normalized.reminderSequence } : {}), status: 'PENDING', createdAt,
    }
    await persistPending(recipient, token, delivery)
    const accessUrl = new URL(targetBaseUrl)
    // Keep the bearer in the URL fragment so it is not sent in HTTP request logs,
    // referrers, or server-side analytics. The page exchanges it from memory.
    accessUrl.hash = new URLSearchParams({ access_token: rawToken }).toString()
    try {
      const delivered = await deliveryHook({
        deliveryId, recipientEmail: profile.email,
        subject: normalized.kind === 'REMINDER' ? `Pengingat ${period.name}` : `Undangan ${period.name}`,
        textBody: invitationBody(profile, period.name, accessUrl, normalized.kind),
      })
      const sentAt = new Date().toISOString()
      const sentDelivery: TracerDeliveryRecord = { ...delivery, status: 'SENT', sentAt, providerMessageId: delivered.providerMessageId.slice(0, 180) }
      const sentRecipient: TracerRecipient = { ...recipient, status: 'DELIVERED', firstInvitedAt: recipient.firstInvitedAt ?? sentAt, lastContactAt: sentAt, version: recipient.version + 1, updatedAt: sentAt }
      await persistDeliveryResult(sentDelivery, sentRecipient)
      campaign.sentCount++
    } catch (error) {
      const failureCode = error instanceof Error ? error.message.replace(/[^A-Z0-9_-]/gi, '_').slice(0, 100) : 'DELIVERY_FAILED'
      const failedAt = new Date().toISOString()
      await persistDeliveryResult({ ...delivery, status: 'FAILED', failureCode }, { ...recipient, status: 'DELIVERY_FAILED', lastContactAt: failedAt, version: recipient.version + 1, updatedAt: failedAt })
      campaign.failedCount++
    }
  }
  campaign = { ...campaign, status: campaign.failedCount ? 'PARTIAL' : 'COMPLETED', completedAt: new Date().toISOString() }
  if (dataMode() === 'mock') {
    tracerStudyMockState().campaigns.set(campaign.id, structuredClone(campaign))
    tracerStudyMockState().idempotency.set(namespace, { requestHash: hash, response: structuredClone(campaign) })
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan kampanye tracer study tidak tersedia.')
    await db.collection('tracerCampaigns').doc(campaign.id).set(campaign)
  }
  const audit = await appendAudit({ actor: context, action: normalized.kind === 'REMINDER' ? 'TRACER_REMINDER_SENT' : 'TRACER_CAMPAIGN_SENT', resourceType: 'tracer_campaign', resourceId: campaign.id, after: { periodId: period.id, kind: normalized.kind, eligibleCount: campaign.eligibleCount, sentCount: campaign.sentCount, failedCount: campaign.failedCount, skippedCount: campaign.skippedCount }, event })
  return { campaign, replayed: false, auditId: audit.id }
}

export async function listTracerCampaigns(context: AuthContext, periodId: string): Promise<TracerCampaign[]> {
  const period = await loadTracerPeriod(cleanId(periodId, 'Periode'))
  requireTracerManager(context, period.programStudyIds)
  let campaigns: TracerCampaign[]
  if (dataMode() === 'mock') campaigns = [...tracerStudyMockState().campaigns.values()].filter(item => item.periodId === period.id).map(item => structuredClone(item))
  else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan kampanye tracer study tidak tersedia.')
    const snapshot = await db.collection('tracerCampaigns').where('periodId', '==', period.id).limit(100).get()
    campaigns = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as TracerCampaign)
  }
  return campaigns.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}
