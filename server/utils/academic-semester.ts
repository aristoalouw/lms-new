export type AcademicTerm = 'ODD' | 'EVEN' | 'SHORT'
export type SemesterParity = 'ODD' | 'EVEN'
export type KrsSemesterTrack = 'CURRENT' | 'LOWER' | 'UPPER' | 'UNSPECIFIED'

export interface KrsSemesterEligibility {
  eligible: boolean
  track: KrsSemesterTrack
  courseParity?: SemesterParity
  code?: 'SEMESTER_PARITY_MISMATCH' | 'SEMESTER_SHORT_UPPER_NOT_ALLOWED'
  reason?: string
}

export function semesterParity(semester: number): SemesterParity {
  return semester % 2 === 1 ? 'ODD' : 'EVEN'
}

export function semesterParityLabel(parity: SemesterParity): 'Ganjil' | 'Genap' {
  return parity === 'ODD' ? 'Ganjil' : 'Genap'
}

export function deriveStudentSemester(
  cohortYear?: number,
  academicYear?: string,
  term?: AcademicTerm,
): number {
  if (!cohortYear || !Number.isInteger(cohortYear) || !academicYear) return 1
  const match = /^(\d{4})[/-](\d{4})$/.exec(academicYear.trim())
  if (!match) return 1
  const startYear = Number(match[1])
  const yearDiff = startYear - cohortYear
  if (yearDiff < 0) return 1
  const offset = term === 'EVEN' ? 2 : 1
  return Math.min(14, Math.max(1, yearDiff * 2 + offset))
}

export function evaluateKrsSemesterEligibility(input: {
  studentSemester?: number
  courseSemester?: number
  periodTerm?: AcademicTerm
}): KrsSemesterEligibility {
  const { studentSemester, courseSemester, periodTerm } = input
  if (!courseSemester || !Number.isInteger(courseSemester) || courseSemester < 1) {
    return { eligible: true, track: 'UNSPECIFIED' }
  }
  const courseParity = semesterParity(courseSemester)
  const track: KrsSemesterTrack = !studentSemester
    ? 'UNSPECIFIED'
    : courseSemester === studentSemester
      ? 'CURRENT'
      : courseSemester < studentSemester
        ? 'LOWER'
        : 'UPPER'

  if (periodTerm === 'ODD' && courseParity !== 'ODD') {
    return {
      eligible: false,
      track,
      courseParity,
      code: 'SEMESTER_PARITY_MISMATCH',
      reason: `Mata kuliah Semester ${courseSemester} (Genap) tidak dapat diambil pada periode Ganjil.`,
    }
  }
  if (periodTerm === 'EVEN' && courseParity !== 'EVEN') {
    return {
      eligible: false,
      track,
      courseParity,
      code: 'SEMESTER_PARITY_MISMATCH',
      reason: `Mata kuliah Semester ${courseSemester} (Ganjil) tidak dapat diambil pada periode Genap.`,
    }
  }
  if (periodTerm === 'SHORT' && studentSemester && courseSemester > studentSemester) {
    return {
      eligible: false,
      track,
      courseParity,
      code: 'SEMESTER_SHORT_UPPER_NOT_ALLOWED',
      reason: `Pada semester pendek hanya mata kuliah semester Anda atau tingkat bawah (Semester 1–${studentSemester}) yang dapat diambil.`,
    }
  }
  return { eligible: true, track, courseParity }
}
