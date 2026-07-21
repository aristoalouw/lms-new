import { setResponseStatus } from 'h3'
import { dataMode, firestoreAdmin } from '../utils/firebase-admin'
import { publicReadinessPayload } from '../utils/health'
import { defineCampusHandler } from '../utils/security'

export default defineCampusHandler(async (event) => {
  const mode = dataMode()
  let ready = mode !== 'unavailable'
  if (mode === 'firebase') {
    const db = firestoreAdmin()
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      if (!db) throw new Error('Firebase unavailable')
      await Promise.race([
        db.collection('_system').doc('readiness').get(),
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error('Readiness timeout')), 2_000)
        }),
      ])
    } catch {
      ready = false
    } finally {
      if (timeout) clearTimeout(timeout)
    }
  }
  setResponseStatus(event, ready ? 200 : 503)
  return publicReadinessPayload(ready)
})
