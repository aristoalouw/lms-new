import type { SafeDeltaOperation, SafeRichContent } from '../types/learning'
import { invalidInput } from '../utils/errors'

const ALLOWED_ATTRIBUTES = new Set(['bold', 'italic', 'underline', 'strike', 'list', 'header', 'link'])

export function cleanLearningText(value: unknown, label: string, maximum: number, options: { allowNewlines?: boolean } = {}): string {
  if (typeof value !== 'string') invalidInput(`${label} harus berupa teks.`)
  const controlPattern = options.allowNewlines ? /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g : /[\u0000-\u001F\u007F]/g
  const text = value.replace(controlPattern, ' ').replace(/<[^>]*>/g, ' ').replace(/[<>]/g, '').trim()
  if (!text || text.length > maximum) invalidInput(`${label} tidak valid.`)
  return text
}

export function cleanLearningId(value: unknown, label: string): string {
  const id = cleanLearningText(value, label, 128)
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id)) invalidInput(`${label} tidak valid.`)
  return id
}

export function cleanLearningIds(value: unknown, label: string, maximum = 100): string[] {
  if (!Array.isArray(value) || value.length > maximum) invalidInput(`${label} tidak valid.`)
  return [...new Set(value.map(item => cleanLearningId(item, label)))]
}

export function cleanLearningInstant(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length > 48 || !/^\d{4}-\d{2}-\d{2}T/.test(value)) invalidInput(`${label} tidak valid.`)
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) invalidInput(`${label} tidak valid.`)
  return date.toISOString()
}

export function cleanLearningInteger(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) invalidInput(`${label} harus berupa bilangan bulat ${minimum}-${maximum}.`)
  return Number(value)
}

function safeLink(value: unknown): string {
  if (typeof value !== 'string' || value.length > 500) invalidInput('Tautan konten tidak valid.')
  let url: URL
  try { url = new URL(value) } catch { invalidInput('Tautan konten tidak valid.') }
  if (url.protocol !== 'https:' || url.username || url.password) invalidInput('Tautan konten wajib memakai HTTPS tanpa credential.')
  return url.toString()
}

function cleanAttributes(value: unknown): SafeDeltaOperation['attributes'] {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidInput('Atribut Delta tidak valid.')
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.some(([key]) => !ALLOWED_ATTRIBUTES.has(key))) invalidInput('Atribut Delta tidak didukung.')
  const result: NonNullable<SafeDeltaOperation['attributes']> = {}
  for (const [key, item] of entries) {
    if (['bold', 'italic', 'underline', 'strike'].includes(key)) {
      if (item !== true) invalidInput('Atribut format Delta harus bernilai true.')
      result[key as 'bold' | 'italic' | 'underline' | 'strike'] = true
    } else if (key === 'list') {
      if (!['ordered', 'bullet'].includes(String(item))) invalidInput('Atribut daftar Delta tidak valid.')
      result.list = item as 'ordered' | 'bullet'
    } else if (key === 'header') {
      if (![1, 2, 3].includes(Number(item))) invalidInput('Atribut heading Delta tidak valid.')
      result.header = item as 1 | 2 | 3
    } else if (key === 'link') result.link = safeLink(item)
  }
  return result
}

export function validateSafeRichContent(value: unknown, label = 'Konten', maximumCharacters = 20_000): SafeRichContent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidInput(`${label} tidak valid.`)
  const input = value as Record<string, unknown>
  if (input.format === 'PLAIN_TEXT') {
    if (Object.keys(input).some(key => !['format', 'text'].includes(key))) invalidInput(`${label} memuat field tidak didukung.`)
    return { format: 'PLAIN_TEXT', text: cleanLearningText(input.text, label, maximumCharacters, { allowNewlines: true }) }
  }
  if (input.format !== 'QUILL_DELTA' || Object.keys(input).some(key => !['format', 'ops'].includes(key))) invalidInput(`${label} tidak valid.`)
  if (!Array.isArray(input.ops) || !input.ops.length || input.ops.length > 300) invalidInput(`${label} Delta harus berisi 1-300 operasi.`)
  let characterCount = 0
  const ops = input.ops.map((operation, index): SafeDeltaOperation => {
    if (!operation || typeof operation !== 'object' || Array.isArray(operation)) invalidInput(`Operasi Delta ${index + 1} tidak valid.`)
    const record = operation as Record<string, unknown>
    if (Object.keys(record).some(key => !['insert', 'attributes'].includes(key)) || typeof record.insert !== 'string') invalidInput(`Operasi Delta ${index + 1} tidak didukung.`)
    const insert = record.insert.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ').replace(/<[^>]*>/g, ' ').replace(/[<>]/g, '')
    if (!insert || insert.length > 5_000) invalidInput(`Teks Delta ${index + 1} tidak valid.`)
    characterCount += insert.length
    if (characterCount > maximumCharacters) invalidInput(`${label} terlalu panjang.`)
    const attributes = cleanAttributes(record.attributes)
    return { insert, ...(attributes && Object.keys(attributes).length ? { attributes } : {}) }
  })
  return { format: 'QUILL_DELTA', ops }
}

export function safeContentPlainText(content: SafeRichContent): string {
  return content.format === 'PLAIN_TEXT' ? content.text : content.ops.map(operation => operation.insert).join('')
}

export function validateExternalLearningUrl(value: unknown): string {
  return safeLink(value)
}
