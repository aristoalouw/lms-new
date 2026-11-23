import type { AdmissionPathPolicy, AdmissionProgram, AdmissionWave } from '../types/admissions'

export const DEMO_ADMISSION_PROGRAMS: readonly AdmissionProgram[] = [
  { id: 'management-s1', code: 'MGT', name: 'S1 Manajemen', unitId: 'faculty-economics', active: true },
  { id: 'accounting-s1', code: 'ACC', name: 'S1 Akuntansi', unitId: 'faculty-economics', active: true },
  { id: 'informatics-s1', code: 'INF', name: 'S1 Informatika', unitId: 'faculty-engineering', active: true },
  { id: 'information-systems-s1', code: 'INS', name: 'S1 Sistem Informasi', unitId: 'faculty-engineering', active: true },
  { id: 'communication-science-s1', code: 'COM', name: 'S1 Ilmu Komunikasi', unitId: 'faculty-social-sciences', active: true },
] as const

export const DEMO_ADMISSION_PATH_POLICIES: readonly AdmissionPathPolicy[] = [
  { id: 'regular', label: 'Reguler', description: 'Jalur penerimaan reguler.', active: true, programStudyIds: DEMO_ADMISSION_PROGRAMS.map(item => item.id), studyModeIds: ['hybrid', 'evening', 'weekend'], requiredDocumentTypes: ['IDENTITY', 'DIPLOMA'], registrationFee: 500_000, currency: 'IDR', effectiveFrom: '2026-01-01T00:00:00.000Z', version: 1 },
  { id: 'kip-college', label: 'KIP Kuliah', description: 'Jalur penerimaan peserta KIP Kuliah.', active: true, programStudyIds: DEMO_ADMISSION_PROGRAMS.map(item => item.id), studyModeIds: ['hybrid'], requiredDocumentTypes: ['IDENTITY', 'DIPLOMA', 'KIP_CARD'], registrationFee: 0, currency: 'IDR', effectiveFrom: '2026-01-01T00:00:00.000Z', version: 1 },
  { id: 'transfer', label: 'Pindahan', description: 'Jalur mahasiswa pindahan.', active: true, programStudyIds: DEMO_ADMISSION_PROGRAMS.map(item => item.id), studyModeIds: ['hybrid', 'evening', 'weekend'], requiredDocumentTypes: ['IDENTITY', 'DIPLOMA', 'TRANSCRIPT'], registrationFee: 500_000, currency: 'IDR', effectiveFrom: '2026-01-01T00:00:00.000Z', version: 1 },
  { id: 'rpl', label: 'RPL', description: 'Jalur Rekognisi Pembelajaran Lampau.', active: true, programStudyIds: DEMO_ADMISSION_PROGRAMS.map(item => item.id), studyModeIds: ['hybrid', 'evening', 'weekend'], requiredDocumentTypes: ['IDENTITY', 'DIPLOMA', 'RPL_PORTFOLIO'], registrationFee: 500_000, currency: 'IDR', effectiveFrom: '2026-01-01T00:00:00.000Z', version: 1 },
] as const

export const DEMO_ADMISSION_WAVES: readonly AdmissionWave[] = [
  {
    id: '2026-wave-3', academicYear: '2026/2027', label: 'Gelombang 3',
    opensAt: '2026-07-01T00:00:00.000Z', closesAt: '2026-08-31T16:59:59.999Z',
    registrationFee: 500_000, currency: 'IDR', active: true,
    programStudyIds: DEMO_ADMISSION_PROGRAMS.map(program => program.id),
    capacity: 400,
    version: 1,
  },
] as const
