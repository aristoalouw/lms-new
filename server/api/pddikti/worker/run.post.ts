import { readBody } from 'h3'
import { requirePddiktiWorkerSecret, runPddiktiWorker } from '../../../services/pddikti-worker'
import { defineCampusHandler, markPrivateResponse } from '../../../utils/security'
import { requireInteger, requireRecord, requireString } from '../../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  requirePddiktiWorkerSecret(event)
  const body = requireRecord(await readBody(event))
  return runPddiktiWorker({
    workerId: requireString(body.workerId, 'workerId', { max: 100, pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]+$/ }),
    ...(body.maxJobs === undefined ? {} : { maxJobs: requireInteger(body.maxJobs, 'maxJobs', 1, 10) }),
  })
})
