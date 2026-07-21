import { publicHealthPayload } from '../utils/health'
import { defineCampusHandler } from '../utils/security'

export default defineCampusHandler(() => publicHealthPayload())
