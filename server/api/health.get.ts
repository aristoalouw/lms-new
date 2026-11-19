import { publicHealthPayload } from '../utils/health'
import { defineCampusHandler } from '../utils/security'

export default defineCampusHandler(() => {
  const config = useRuntimeConfig()
  return publicHealthPayload(new Date(), String(config.appVersion || 'development'))
})
