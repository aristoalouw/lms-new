import { availableDemoProfiles } from '../../utils/auth'
import { defineCampusHandler, markPrivateResponse } from '../../utils/security'

export default defineCampusHandler((event) => {
  markPrivateResponse(event)
  return { enabled: availableDemoProfiles().length > 0, profiles: availableDemoProfiles() }
})
