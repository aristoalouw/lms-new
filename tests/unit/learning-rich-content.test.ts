import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { SafeRichContent } from '../../server/types/learning'
import { learningRichBlocks } from '../../utils/learning-rich-content'

describe('safe LMS rich-content rendering model', () => {
  it('preserves headings, inline formatting, safe links, and grouped lists', () => {
    const content: SafeRichContent = {
      format: 'QUILL_DELTA',
      ops: [
        { insert: 'Tujuan belajar\n', attributes: { header: 2 } },
        { insert: 'Baca ', attributes: { bold: true } },
        { insert: 'panduan', attributes: { link: 'https://example.edu/panduan' } },
        { insert: '\n', attributes: { list: 'bullet' } },
        { insert: 'Bandingkan strategi\n', attributes: { list: 'bullet' } },
      ],
    }

    const blocks = learningRichBlocks(content)

    expect(blocks[0]).toMatchObject({
      type: 'heading',
      level: 2,
      segments: [{ text: 'Tujuan belajar' }],
    })
    expect(blocks[1]).toMatchObject({
      type: 'list',
      style: 'bullet',
      items: [
        [
          { text: 'Baca ', bold: true },
          { text: 'panduan', link: 'https://example.edu/panduan' },
        ],
        [{ text: 'Bandingkan strategi' }],
      ],
    })
  })

  it('keeps text as data and drops a non-HTTPS link defensively', () => {
    const content = {
      format: 'QUILL_DELTA',
      ops: [{ insert: '<img src=x onerror=alert(1)>', attributes: { link: 'javascript:alert(1)' } }],
    } as SafeRichContent

    const blocks = learningRichBlocks(content)
    expect(blocks).toMatchObject([
      {
        type: 'paragraph',
        segments: [{ text: '<img src=x onerror=alert(1)>' }],
      },
    ])
    const firstBlock = blocks[0]
    expect(firstBlock?.type === 'paragraph' ? firstBlock.segments[0]?.link : 'unexpected block').toBeUndefined()

    const componentPath = join(process.cwd(), 'components/lms/SafeRichContent.vue')
    expect(readFileSync(componentPath, 'utf8')).not.toContain('v-html')
  })

  it('retains every plain-text line instead of collapsing content into a preview', () => {
    const blocks = learningRichBlocks({
      format: 'PLAIN_TEXT',
      text: 'Baris pertama\nBaris kedua\nBaris ketiga',
    })

    expect(blocks).toHaveLength(3)
    expect(blocks.map(block => block.type === 'paragraph' ? block.segments[0]?.text : '')).toEqual([
      'Baris pertama',
      'Baris kedua',
      'Baris ketiga',
    ])
  })
})
