export const CANONICAL_SCOPE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/

export function parseCanonicalScopeInput(value: string, label: string): string[] {
  const items = [...new Set(value.split(',').map(item => item.trim()).filter(Boolean))]
  const invalid = items.find(item => !CANONICAL_SCOPE_ID_PATTERN.test(item))
  if (invalid) {
    throw new Error(`${label} harus berupa ID kanonik tanpa spasi (contoh: manajemen-s1).`)
  }
  return items
}
