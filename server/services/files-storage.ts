import { createHash, randomUUID } from 'node:crypto'
import { getStorage } from 'firebase-admin/storage'
import type { AllowedFileMimeType, UploadTarget } from '../types/files'
import { CampusError, notFound, serviceUnavailable } from '../utils/errors'
import { dataMode, firebaseAdminState } from '../utils/firebase-admin'

export interface StoredObjectInspection {
  sizeBytes: number
  contentType: string
  firstBytes: Uint8Array
}

export interface FileStorage {
  createUploadTarget(input: {
    sessionId: string
    storagePath: string
    contentType: AllowedFileMimeType
    ownerUid: string
    expiresAt: string
  }): Promise<UploadTarget>
  inspectObject(storagePath: string): Promise<StoredObjectInspection>
  openReadStream(storagePath: string): Promise<AsyncIterable<Uint8Array>>
  createDownloadUrl(input: {
    storagePath: string
    fileName: string
    contentType: AllowedFileMimeType
    expiresAt: string
  }): Promise<string>
  deleteObject(storagePath: string): Promise<void>
}

interface MockObject {
  bytes: Uint8Array
  contentType: string
}

interface MockDownloadGrant {
  storagePath: string
  fileName: string
  contentType: AllowedFileMimeType
  expiresAt: string
}

const mockObjects = new Map<string, MockObject>()
const mockDownloadGrants = new Map<string, MockDownloadGrant>()

function cloneBytes(bytes: Uint8Array): Uint8Array {
  return Uint8Array.from(bytes)
}

export class MockFileStorage implements FileStorage {
  async createUploadTarget(input: {
    sessionId: string
    contentType: AllowedFileMimeType
    expiresAt: string
  }): Promise<UploadTarget> {
    return {
      url: `/api/files/upload-sessions/${encodeURIComponent(input.sessionId)}/content`,
      method: 'PUT',
      headers: { 'content-type': input.contentType },
      expiresAt: input.expiresAt,
    }
  }

  async inspectObject(storagePath: string): Promise<StoredObjectInspection> {
    const object = mockObjects.get(storagePath)
    if (!object) notFound('Objek unggahan')
    return {
      sizeBytes: object.bytes.byteLength,
      contentType: object.contentType,
      firstBytes: cloneBytes(object.bytes.subarray(0, 512)),
    }
  }

  async openReadStream(storagePath: string): Promise<AsyncIterable<Uint8Array>> {
    const object = mockObjects.get(storagePath)
    if (!object) notFound('Objek unggahan')
    const bytes = cloneBytes(object.bytes)
    return (async function* () {
      const chunkSize = 64 * 1024
      for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
        yield bytes.subarray(offset, Math.min(offset + chunkSize, bytes.byteLength))
      }
    })()
  }

  async createDownloadUrl(input: {
    storagePath: string
    fileName: string
    contentType: AllowedFileMimeType
    expiresAt: string
  }): Promise<string> {
    if (!mockObjects.has(input.storagePath)) notFound('Objek file')
    const token = createHash('sha256').update(`${randomUUID()}:${input.storagePath}`).digest('base64url')
    mockDownloadGrants.set(token, { ...input })
    return `/api/files/downloads/${token}`
  }

  async deleteObject(storagePath: string): Promise<void> {
    mockObjects.delete(storagePath)
  }
}

class FirebaseFileStorage implements FileStorage {
  private bucket() {
    const state = firebaseAdminState()
    const bucketName = process.env.FIREBASE_STORAGE_BUCKET
    if (!state.available || !bucketName) serviceUnavailable('Penyimpanan file privat belum dikonfigurasi.')
    return getStorage(state.app).bucket(bucketName)
  }

  async createUploadTarget(input: {
    sessionId: string
    storagePath: string
    contentType: AllowedFileMimeType
    ownerUid: string
    expiresAt: string
  }): Promise<UploadTarget> {
    const metadataHeaders = {
      'x-goog-meta-owner-uid': input.ownerUid,
      'x-goog-meta-upload-session': input.sessionId,
    }
    const [url] = await this.bucket().file(input.storagePath).getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: new Date(input.expiresAt),
      contentType: input.contentType,
      extensionHeaders: metadataHeaders,
    })
    return {
      url,
      method: 'PUT',
      headers: { 'content-type': input.contentType, ...metadataHeaders },
      expiresAt: input.expiresAt,
    }
  }

  async inspectObject(storagePath: string): Promise<StoredObjectInspection> {
    const file = this.bucket().file(storagePath)
    let metadata: { size?: string | number; contentType?: string }
    try {
      ;[metadata] = await file.getMetadata()
    } catch (error) {
      const code = (error as { code?: number }).code
      if (code === 404) notFound('Objek unggahan')
      throw error
    }
    const chunks: Buffer[] = []
    let collected = 0
    for await (const chunk of file.createReadStream({ start: 0, end: 511 })) {
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
      const remaining = 512 - collected
      if (remaining <= 0) break
      chunks.push(value.subarray(0, remaining))
      collected += Math.min(value.byteLength, remaining)
    }
    const sizeBytes = Number(metadata.size)
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
      throw new CampusError(502, 'INVALID_STORAGE_METADATA', 'Metadata ukuran objek penyimpanan tidak valid.')
    }
    return {
      sizeBytes,
      contentType: metadata.contentType || '',
      firstBytes: Uint8Array.from(Buffer.concat(chunks)),
    }
  }

  async openReadStream(storagePath: string): Promise<AsyncIterable<Uint8Array>> {
    const stream = this.bucket().file(storagePath).createReadStream()
    return (async function* () {
      for await (const chunk of stream) {
        yield Uint8Array.from(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array))
      }
    })()
  }

  async createDownloadUrl(input: {
    storagePath: string
    fileName: string
    contentType: AllowedFileMimeType
    expiresAt: string
  }): Promise<string> {
    const asciiName = input.fileName.replace(/[^A-Za-z0-9._ -]/g, '_').replace(/["\\]/g, '_') || 'download'
    const encodedName = encodeURIComponent(input.fileName)
    const [url] = await this.bucket().file(input.storagePath).getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: new Date(input.expiresAt),
      responseDisposition: `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`,
      responseType: input.contentType,
    })
    return url
  }

  async deleteObject(storagePath: string): Promise<void> {
    await this.bucket().file(storagePath).delete({ ignoreNotFound: true })
  }
}

let configuredStorage: FileStorage | undefined
const mockStorage = new MockFileStorage()

export function fileStorage(): FileStorage {
  if (configuredStorage) return configuredStorage
  return dataMode() === 'mock' ? mockStorage : new FirebaseFileStorage()
}

export function configureFileStorage(storage?: FileStorage): void {
  configuredStorage = storage
}

export function putMockUploadObject(storagePath: string, bytes: Uint8Array, contentType: string): void {
  if (dataMode() !== 'mock') throw new CampusError(404, 'NOT_FOUND', 'Endpoint unggahan lokal tidak tersedia.')
  mockObjects.set(storagePath, { bytes: cloneBytes(bytes), contentType })
}

export function resolveMockDownload(token: string): MockDownloadGrant & { bytes: Uint8Array } {
  const grant = mockDownloadGrants.get(token)
  if (!grant || Date.parse(grant.expiresAt) <= Date.now()) {
    mockDownloadGrants.delete(token)
    throw new CampusError(404, 'DOWNLOAD_EXPIRED', 'Tautan unduhan tidak valid atau telah kedaluwarsa.')
  }
  const object = mockObjects.get(grant.storagePath)
  if (!object) notFound('Objek file')
  return { ...grant, bytes: cloneBytes(object.bytes) }
}

export function resetFileStorageForTests(): void {
  configuredStorage = undefined
  mockObjects.clear()
  mockDownloadGrants.clear()
}
