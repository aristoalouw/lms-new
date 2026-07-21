import { getQuery } from 'h3'
import { listGraduationDocuments } from '../../../services/graduation-documents'
import type { GraduationDocumentType } from '../../../types/graduation'
import { requireAuth } from '../../../utils/auth'
import { defineCampusHandler, markPrivateResponse } from '../../../utils/security'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  const query = getQuery(event)
  return {
    documents: await listGraduationDocuments(await requireAuth(event), {
      ...(typeof query.applicationId === 'string' ? { applicationId: query.applicationId.slice(0, 128) } : {}),
      ...(typeof query.type === 'string' ? { type: query.type as GraduationDocumentType } : {}),
    }),
  }
})
