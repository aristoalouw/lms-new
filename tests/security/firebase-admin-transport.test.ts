import { afterEach, describe, expect, it } from 'vitest'
import {
  prefersFirestoreRestTransport,
  serviceAccountJsonFromEnvironment,
} from '../../server/utils/firebase-admin'

describe('Firebase Admin transport', () => {
  const previousTarget = process.env.DEPLOYMENT_TARGET
  const previousJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  const previousBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64

  afterEach(() => {
    if (previousTarget === undefined) delete process.env.DEPLOYMENT_TARGET
    else process.env.DEPLOYMENT_TARGET = previousTarget
    if (previousJson === undefined) delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON
    else process.env.FIREBASE_SERVICE_ACCOUNT_JSON = previousJson
    if (previousBase64 === undefined) delete process.env.FIREBASE_SERVICE_ACCOUNT_BASE64
    else process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 = previousBase64
  })

  it('uses the REST transport on Hostinger to avoid managed-hosting gRPC stalls', () => {
    process.env.DEPLOYMENT_TARGET = 'hostinger'
    expect(prefersFirestoreRestTransport()).toBe(true)
  })

  it('keeps the default transport on other deployment targets', () => {
    process.env.DEPLOYMENT_TARGET = 'docker'
    expect(prefersFirestoreRestTransport()).toBe(false)
  })

  it('falls back to the base64 credential when the inline JSON variable is blank', () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = ''
    process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 = Buffer.from('{"project_id":"test-project"}').toString('base64')

    expect(serviceAccountJsonFromEnvironment()).toBe('{"project_id":"test-project"}')
  })
})
