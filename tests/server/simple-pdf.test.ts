import { describe, expect, it } from 'vitest'
import { simpleTextPdf } from '../../server/utils/simple-pdf'

describe('simple operational PDF renderer', () => {
  it('creates a parseable-shaped PDF without active content', () => {
    const buffer = simpleTextPdf('Dashboard', ['academic.activeStudents: 2000', 'status: (ready)'])
    const text = buffer.toString('latin1')
    expect(text.startsWith('%PDF-1.4')).toBe(true)
    expect(text).toContain('xref')
    expect(text).toContain('trailer')
    expect(text).toContain('status: \\(ready\\)')
    expect(text).not.toContain('/JavaScript')
  })
})
