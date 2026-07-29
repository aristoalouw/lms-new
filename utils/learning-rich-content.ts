import type { SafeDeltaOperation, SafeRichContent } from '~/shared/contracts/lms'

export interface LearningRichSegment {
  text: string
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
  link?: string
}

export type LearningRichBlock =
  | { type: 'paragraph'; segments: LearningRichSegment[] }
  | { type: 'heading'; level: 1 | 2 | 3; segments: LearningRichSegment[] }
  | { type: 'list'; style: 'ordered' | 'bullet'; items: LearningRichSegment[][] }

function safeHttpsLink(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : undefined
  } catch {
    return undefined
  }
}

function segment(text: string, attributes?: SafeDeltaOperation['attributes']): LearningRichSegment {
  return {
    text,
    bold: attributes?.bold === true,
    italic: attributes?.italic === true,
    underline: attributes?.underline === true,
    strike: attributes?.strike === true,
    ...(safeHttpsLink(attributes?.link) ? { link: safeHttpsLink(attributes?.link) } : {}),
  }
}

function plainTextBlocks(text: string): LearningRichBlock[] {
  return text.split('\n').map(line => ({
    type: 'paragraph',
    segments: line ? [segment(line)] : [],
  }))
}

export function learningRichBlocks(content?: SafeRichContent): LearningRichBlock[] {
  if (!content) return []
  if (content.format === 'PLAIN_TEXT') return plainTextBlocks(content.text)

  const blocks: LearningRichBlock[] = []
  let current: LearningRichSegment[] = []

  const pushLine = (attributes?: SafeDeltaOperation['attributes']) => {
    if (attributes?.list) {
      const previous = blocks.at(-1)
      if (previous?.type === 'list' && previous.style === attributes.list) previous.items.push(current)
      else blocks.push({ type: 'list', style: attributes.list, items: [current] })
    } else if (attributes?.header) {
      blocks.push({ type: 'heading', level: attributes.header, segments: current })
    } else {
      blocks.push({ type: 'paragraph', segments: current })
    }
    current = []
  }

  for (const operation of content.ops) {
    const parts = operation.insert.split('\n')
    for (const [index, part] of parts.entries()) {
      if (part) current.push(segment(part, operation.attributes))
      if (index < parts.length - 1) pushLine(operation.attributes)
    }
  }
  if (current.length) pushLine()
  return blocks
}
