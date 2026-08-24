import type { TranscriptMessage, TranscriptPartText, TranscriptRole } from './protocol'

export type TranscriptSearchOptions = {
  caseSensitive?: boolean
  wholeWord?: boolean
  regex?: boolean
}

export type TranscriptSearchMatch = {
  messageIndex: number
  partIndex: number
  partOccurrence: number
  messageOccurrence: number
  messageId?: string
  role: Extract<TranscriptRole, 'user' | 'assistant'>
  start: number
  end: number
  text: string
}

export type SearchSnippet = {
  text: string
  matchStart: number
  matchEnd: number
}

export function getSearchableMessageText(message: TranscriptMessage): string {
  return message.parts
    .filter((part): part is Extract<typeof part, { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .filter((text) => text.length > 0)
    .join('')
}

export function createSearchRegExp(
  query: string,
  options: TranscriptSearchOptions = {},
): RegExp | null {
  const normalized = query.trim()
  if (!normalized) {
    return null
  }

  const source = options.regex ? normalized : escapeRegExp(normalized)
  const wrapped = options.wholeWord ? `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])` : source
  try {
    return new RegExp(wrapped, `g${options.caseSensitive ? '' : 'i'}u`)
  } catch {
    return null
  }
}

export function findTranscriptMatches(
  messages: TranscriptMessage[],
  query: string,
  options: TranscriptSearchOptions = {},
  maxMatches = 5000,
): TranscriptSearchMatch[] {
  const matches: TranscriptSearchMatch[] = []
  const normalized = query.trim()
  if (!normalized) {
    return matches
  }

  const matcher = createSearchRegExp(normalized, options)
  if (!matcher) {
    return matches
  }

  for (let messageIndex = 0; messageIndex < messages.length; messageIndex += 1) {
    const message = messages[messageIndex]
    if (!message || (message.role !== 'user' && message.role !== 'assistant')) {
      continue
    }
    const textParts = message.parts
      .map((part, partIndex) => ({ part, partIndex }))
      .filter((entry): entry is { part: TranscriptPartText; partIndex: number } => entry.part.type === 'text' && entry.part.text.length > 0)
    if (textParts.length === 0) {
      continue
    }

    const searchableText = textParts.map(({ part }) => part.text).join('')
    const segments = [] as Array<{ partIndex: number; start: number; end: number }>
    let offset = 0
    for (const { part, partIndex } of textParts) {
      segments.push({ partIndex, start: offset, end: offset + part.text.length })
      offset += part.text.length
    }

    const partOccurrences = new Map<number, number>()
    let messageOccurrence = 0
    matcher.lastIndex = 0
    let match = matcher.exec(searchableText)
    while (match !== null) {
      const value = match[0]
      const start = match.index
      const end = start + value.length
      const segment = segments.find((candidate) => (
        start < candidate.end && (end > candidate.start || value.length === 0)
      )) ?? segments[segments.length - 1]
      if (segment) {
        const partOccurrence = partOccurrences.get(segment.partIndex) ?? 0
        partOccurrences.set(segment.partIndex, partOccurrence + 1)
        matches.push({
          messageIndex,
          partIndex: segment.partIndex,
          partOccurrence,
          messageOccurrence,
          ...(message.id ? { messageId: message.id } : {}),
          role: message.role,
          start,
          end,
          text: value
        })
        messageOccurrence += 1
        if (matches.length >= maxMatches) {
          return matches
        }
      }
      if (value.length === 0) {
        matcher.lastIndex += 1
      }
      match = matcher.exec(searchableText)
    }
  }

  return matches
}

export function createSearchSnippet(text: string, start: number, end: number, maxLength = 180): string {
  return createSearchSnippetParts(text, start, end, maxLength).text
}

export function createSearchSnippetParts(text: string, start: number, end: number, maxLength = 180): SearchSnippet {
  const safeStart = Math.max(0, Math.min(start, text.length))
  const safeEnd = Math.max(safeStart, Math.min(end, text.length))
  const sourceMatch = text.slice(safeStart, safeEnd)
  if (text.length <= maxLength) {
    const prefix = text.slice(0, safeStart).replace(/\s+/g, ' ')
    const match = sourceMatch.replace(/\s+/g, ' ')
    const suffix = text.slice(safeEnd).replace(/\s+/g, ' ')
    const leadingWhitespace = prefix.length - prefix.trimStart().length
    const matchStart = prefix.length - leadingWhitespace
    return {
      text: `${prefix}${match}${suffix}`.trim(),
      matchStart,
      matchEnd: matchStart + match.length
    }
  }

  const matchLength = Math.max(1, safeEnd - safeStart)
  const availableContext = Math.max(0, maxLength - matchLength)
  const beforeContext = Math.min(safeStart, Math.min(32, availableContext))
  const afterContext = Math.max(0, availableContext - beforeContext)
  const from = Math.max(0, safeStart - beforeContext)
  const to = Math.min(text.length, safeEnd + afterContext)
  const rawPrefix = text.slice(from, safeStart).replace(/\s+/g, ' ')
  const match = sourceMatch.replace(/\s+/g, ' ')
  const rawSuffix = text.slice(safeEnd, to).replace(/\s+/g, ' ')
  const ellipsis = from > 0 ? '…' : ''
  const left = `${ellipsis}${rawPrefix}`.trimStart()
  const right = rawSuffix.trimEnd()
  const matchStart = left.length
  return {
    text: `${left}${match}${right}${to < text.length ? '…' : ''}`.trim(),
    matchStart,
    matchEnd: matchStart + match.length
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
