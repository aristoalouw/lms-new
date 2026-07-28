import { describe, expect, it } from 'vitest'
import { parseCanonicalScopeInput } from '../../shared/auth/scope-identifiers'

describe('account scope identifier input', () => {
  it('trims, deduplicates, and preserves canonical identifiers', () => {
    expect(parseCanonicalScopeInput(' manajemen-s1, 2026001, manajemen-s1 ', 'Scope'))
      .toEqual(['manajemen-s1', '2026001'])
  })

  it('explains that human-readable labels are not canonical identifiers', () => {
    expect(() => parseCanonicalScopeInput('STT Saint Paul', 'Unit'))
      .toThrow('Unit harus berupa ID kanonik tanpa spasi (contoh: manajemen-s1).')
  })
})
