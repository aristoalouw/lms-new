// Browser and Nitro share these DTOs. The source declarations remain in the
// existing server type files during the MVP migration so older campus modules
// keep their stable imports while LMS screens use this public contract boundary.
export type * from '../../../server/types/academic-classes'
export type * from '../../../server/types/files'
export type * from '../../../server/types/learning'
export type { AuditEntry } from '../../../server/types/domain'
