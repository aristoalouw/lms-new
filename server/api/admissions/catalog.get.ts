import { admissionCatalog } from '../../services/admissions'
import { defineCampusHandler, markPrivateResponse } from '../../utils/security'

export default defineCampusHandler((event) => {
  markPrivateResponse(event)
  return admissionCatalog()
})
