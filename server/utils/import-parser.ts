import { createHash } from 'node:crypto'
import type {
  ImportCounts,
  ImportDataset,
  ImportIssue,
  ImportStagedRow,
} from '../types/imports'
import { invalidInput } from './errors'
import { requestHash } from './security'

const MAX_SOURCE_BYTES = 5 * 1024 * 1024
const MAX_ROWS = 5_000
const MAX_COLUMNS = 50
const MAX_CELL_LENGTH = 500

type CanonicalValue = string | number | boolean

interface FieldDefinition {
  aliases: string[]
  required?: boolean
  normalize: (value: string) => CanonicalValue | undefined
}

interface DatasetDefinition {
  stableIdField: string
  fields: Record<string, FieldDefinition>
}

const text = (value: string): string | undefined => {
  const normalized = value.normalize('NFKC').trim().replace(/\s+/g, ' ')
  return normalized || undefined
}

const identifier = (value: string): string | undefined => {
  const normalized = text(value)?.toUpperCase()
  if (!normalized || !/^[A-Z0-9][A-Z0-9._/-]{1,63}$/.test(normalized)) return undefined
  return normalized
}

const programIdentifier = (value: string): string | undefined => {
  const normalized = text(value)?.toLowerCase()
  if (!normalized || !/^[a-z0-9][a-z0-9._-]{1,79}$/.test(normalized)) return undefined
  return normalized
}

const email = (value: string): string | undefined => {
  const normalized = text(value)?.toLowerCase()
  if (!normalized || normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return undefined
  return normalized
}

const integer = (value: string, min: number, max: number): number | undefined => {
  const normalized = text(value)
  if (!normalized || !/^-?\d+$/.test(normalized)) return undefined
  const number = Number(normalized)
  return Number.isSafeInteger(number) && number >= min && number <= max ? number : undefined
}

const decimal = (value: string, min: number, max: number): number | undefined => {
  const normalized = text(value)?.replace(',', '.')
  if (!normalized || !/^-?\d+(?:\.\d{1,2})?$/.test(normalized)) return undefined
  const number = Number(normalized)
  return Number.isFinite(number) && number >= min && number <= max ? number : undefined
}

const activeStatus = (value: string): string | undefined => {
  const normalized = text(value)?.toUpperCase() || 'ACTIVE'
  const aliases: Record<string, string> = {
    ACTIVE: 'ACTIVE', AKTIF: 'ACTIVE',
    LEAVE: 'LEAVE', CUTI: 'LEAVE',
    GRADUATED: 'GRADUATED', LULUS: 'GRADUATED',
    INACTIVE: 'INACTIVE', NONAKTIF: 'INACTIVE',
  }
  return aliases[normalized]
}

const booleanValue = (value: string): boolean | undefined => {
  const normalized = text(value)?.toLowerCase()
  if (!normalized) return true
  if (['true', '1', 'yes', 'ya', 'active', 'aktif'].includes(normalized)) return true
  if (['false', '0', 'no', 'tidak', 'inactive', 'nonaktif'].includes(normalized)) return false
  return undefined
}

const periodIdentifier = (value: string): string | undefined => {
  const normalized = text(value)
  return normalized && /^[A-Za-z0-9][A-Za-z0-9._/-]{2,39}$/.test(normalized) ? normalized : undefined
}

const DATASETS: Record<ImportDataset, DatasetDefinition> = {
  students: {
    stableIdField: 'studentId',
    fields: {
      studentId: { aliases: ['student_id', 'nim', 'id_mahasiswa'], required: true, normalize: identifier },
      fullName: { aliases: ['full_name', 'nama', 'nama_mahasiswa'], required: true, normalize: text },
      email: { aliases: ['email', 'email_mahasiswa'], required: true, normalize: email },
      programStudyId: { aliases: ['program_study_id', 'prodi_id', 'kode_prodi'], required: true, normalize: programIdentifier },
      cohortYear: { aliases: ['cohort_year', 'angkatan'], required: true, normalize: value => integer(value, 2000, 2100) },
      status: { aliases: ['status', 'status_mahasiswa'], normalize: activeStatus },
    },
  },
  courses: {
    stableIdField: 'courseId',
    fields: {
      courseId: { aliases: ['course_id', 'kode_mk', 'kode_matakuliah'], required: true, normalize: identifier },
      title: { aliases: ['title', 'nama_mk', 'nama_matakuliah'], required: true, normalize: text },
      credits: { aliases: ['credits', 'sks'], required: true, normalize: value => integer(value, 1, 12) },
      programStudyId: { aliases: ['program_study_id', 'prodi_id', 'kode_prodi'], required: true, normalize: programIdentifier },
      active: { aliases: ['active', 'aktif', 'status_aktif'], normalize: booleanValue },
    },
  },
  grades: {
    stableIdField: 'gradeId',
    fields: {
      gradeId: { aliases: ['grade_id', 'id_nilai'], required: true, normalize: identifier },
      studentId: { aliases: ['student_id', 'nim', 'id_mahasiswa'], required: true, normalize: identifier },
      courseId: { aliases: ['course_id', 'kode_mk', 'kode_matakuliah'], required: true, normalize: identifier },
      programStudyId: { aliases: ['program_study_id', 'prodi_id', 'kode_prodi'], required: true, normalize: programIdentifier },
      periodId: { aliases: ['period_id', 'periode', 'semester_id'], required: true, normalize: periodIdentifier },
      score: { aliases: ['score', 'nilai', 'nilai_akhir'], required: true, normalize: value => decimal(value, 0, 100) },
    },
  },
}

export interface ParsedImport {
  checksum: string
  rows: ImportStagedRow[]
  issues: ImportIssue[]
  counts: ImportCounts
}

function normalizeHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

export function parseDelimitedSource(content: string, delimiter: ',' | '\t'): string[][] {
  if (typeof content !== 'string' || !content.trim()) invalidInput('Berkas impor tidak boleh kosong.')
  if (Buffer.byteLength(content, 'utf8') > MAX_SOURCE_BYTES) invalidInput('Berkas impor melebihi batas 5 MB.')

  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false

  const pushCell = () => {
    if (cell.length > MAX_CELL_LENGTH) invalidInput(`Nilai sel melebihi ${MAX_CELL_LENGTH} karakter.`)
    row.push(cell)
    cell = ''
    if (row.length > MAX_COLUMNS) invalidInput(`Jumlah kolom melebihi batas ${MAX_COLUMNS}.`)
  }
  const pushRow = () => {
    pushCell()
    if (row.some(value => value.trim() !== '')) rows.push(row)
    row = []
    if (rows.length > MAX_ROWS + 1) invalidInput(`Jumlah baris melebihi batas ${MAX_ROWS}.`)
  }

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index]!
    if (quoted) {
      if (character === '"') {
        if (content[index + 1] === '"') {
          cell += '"'
          index += 1
        } else {
          quoted = false
        }
      } else {
        cell += character
      }
      continue
    }

    if (character === '"' && cell.length === 0) quoted = true
    else if (character === delimiter) pushCell()
    else if (character === '\n' || character === '\r') {
      if (character === '\r' && content[index + 1] === '\n') index += 1
      pushRow()
    } else cell += character
  }

  if (quoted) invalidInput('Berkas CSV memiliki tanda kutip yang tidak ditutup.')
  if (cell.length || row.length) pushRow()
  if (rows.length < 2) invalidInput('Berkas impor harus memiliki header dan minimal satu baris data.')
  return rows
}

function issue(
  rowNumber: number,
  code: string,
  message: string,
  field?: string,
  severity: ImportIssue['severity'] = 'ERROR',
): ImportIssue {
  return { rowNumber, code, message, ...(field ? { field } : {}), severity }
}

function headerMapping(dataset: ImportDataset, headers: string[]): {
  mapping: Map<number, string>
  issues: ImportIssue[]
} {
  const definition = DATASETS[dataset]
  const aliases = new Map<string, string>()
  for (const [field, config] of Object.entries(definition.fields)) {
    for (const alias of config.aliases) aliases.set(alias, field)
  }

  const mapping = new Map<number, string>()
  const mappedFields = new Set<string>()
  const issues: ImportIssue[] = []
  headers.forEach((rawHeader, column) => {
    const normalized = normalizeHeader(rawHeader)
    const field = aliases.get(normalized)
    if (!field) {
      issues.push(issue(1, 'UNKNOWN_COLUMN', `Kolom “${normalized || column + 1}” akan diabaikan.`, undefined, 'WARNING'))
      return
    }
    if (mappedFields.has(field)) {
      issues.push(issue(1, 'DUPLICATE_COLUMN', `Kolom untuk ${field} muncul lebih dari sekali.`, field))
      return
    }
    mapping.set(column, field)
    mappedFields.add(field)
  })

  for (const [field, config] of Object.entries(definition.fields)) {
    if (config.required && !mappedFields.has(field)) {
      issues.push(issue(1, 'MISSING_COLUMN', `Kolom wajib ${field} tidak ditemukan.`, field))
    }
  }
  return { mapping, issues }
}

function defaultValue(dataset: ImportDataset, field: string): CanonicalValue | undefined {
  if (dataset === 'students' && field === 'status') return 'ACTIVE'
  if (dataset === 'courses' && field === 'active') return true
  return undefined
}

export function parseImportSource(input: {
  dataset: ImportDataset
  format: 'csv' | 'tsv'
  content: string
  programStudyId: string
  existingFingerprints?: Map<string, string>
}): ParsedImport {
  const delimiter = input.format === 'csv' ? ',' : '\t'
  const sourceRows = parseDelimitedSource(input.content, delimiter)
  const checksum = createHash('sha256').update(input.content, 'utf8').digest('hex')
  const headers = sourceRows[0]!
  const { mapping, issues: headerIssues } = headerMapping(input.dataset, headers)
  const definition = DATASETS[input.dataset]
  const rows: ImportStagedRow[] = []
  const issues = [...headerIssues]
  const seenIds = new Set<string>()
  const hasHeaderErrors = headerIssues.some(item => item.severity === 'ERROR')

  sourceRows.slice(1).forEach((sourceRow, sourceIndex) => {
    const rowNumber = sourceIndex + 2
    const data: Record<string, CanonicalValue> = {}
    const rowIssues: ImportIssue[] = []

    for (const [field, config] of Object.entries(definition.fields)) {
      const column = [...mapping.entries()].find(([, mappedField]) => mappedField === field)?.[0]
      const rawValue = column === undefined ? '' : (sourceRow[column] ?? '')
      if (/^[=+@]/.test(rawValue.trim())) {
        rowIssues.push(issue(rowNumber, 'POTENTIAL_FORMULA', 'Nilai yang menyerupai formula spreadsheet ditolak.', field))
        continue
      }
      const normalized = config.normalize(rawValue)
      const fallback = defaultValue(input.dataset, field)
      if (normalized === undefined && fallback !== undefined && !rawValue.trim()) data[field] = fallback
      else if (normalized === undefined) {
        if (config.required || rawValue.trim()) rowIssues.push(issue(rowNumber, 'INVALID_VALUE', `Nilai ${field} tidak valid.`, field))
      } else data[field] = normalized
    }

    if (hasHeaderErrors) rowIssues.push(issue(rowNumber, 'INVALID_HEADER', 'Baris tidak dapat diproses sebelum header diperbaiki.'))
    if (data.programStudyId && data.programStudyId !== input.programStudyId) {
      rowIssues.push(issue(rowNumber, 'PROGRAM_SCOPE_MISMATCH', 'Program studi pada baris tidak sesuai dengan ruang lingkup impor.', 'programStudyId'))
    }

    const stableId = typeof data[definition.stableIdField] === 'string'
      ? String(data[definition.stableIdField])
      : undefined
    if (stableId && seenIds.has(stableId)) {
      rowIssues.push(issue(rowNumber, 'DUPLICATE_SOURCE_ID', 'Identifier stabil muncul lebih dari sekali pada berkas sumber.', definition.stableIdField))
    }
    if (stableId) seenIds.add(stableId)

    const fingerprint = rowIssues.length === 0 ? requestHash(data) : undefined
    const existingFingerprint = stableId ? input.existingFingerprints?.get(stableId) : undefined
    const action = rowIssues.length > 0 || !stableId || !fingerprint
      ? 'INVALID'
      : !existingFingerprint
        ? 'CREATE'
        : existingFingerprint === fingerprint
          ? 'SKIP'
          : 'UPDATE'
    const staged: ImportStagedRow = {
      rowNumber,
      ...(stableId ? { stableId } : {}),
      action,
      data,
      ...(fingerprint ? { fingerprint } : {}),
      ...(existingFingerprint ? { existingFingerprint } : {}),
      issues: rowIssues,
    }
    rows.push(staged)
    issues.push(...rowIssues)
  })

  if (rows[0] && headerIssues.length) rows[0].issues.unshift(...headerIssues.map(item => ({ ...item })))

  const counts: ImportCounts = {
    total: rows.length,
    valid: rows.filter(row => row.action !== 'INVALID').length,
    errors: issues.filter(item => item.severity === 'ERROR').length,
    warnings: issues.filter(item => item.severity === 'WARNING').length,
    creates: rows.filter(row => row.action === 'CREATE').length,
    updates: rows.filter(row => row.action === 'UPDATE').length,
    skips: rows.filter(row => row.action === 'SKIP').length,
    committed: 0,
    compensated: 0,
    compensationConflicts: 0,
  }
  return { checksum, rows, issues, counts }
}
