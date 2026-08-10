import type { TranscriptMessage } from '../../src/shared/protocol'

export type IndexedTranscriptMessage = {
  message: TranscriptMessage
  messageIndex: number
}

export type AssistantTurn = {
  key: string
  user: IndexedTranscriptMessage
  responses: IndexedTranscriptMessage[]
  startedAt?: number
}

export type TranscriptDisplayBlock =
  | { kind: 'message'; entry: IndexedTranscriptMessage }
  | { kind: 'assistant-turn'; turn: AssistantTurn }

export type AssistantTurnTiming = {
  startedAt: number | null
  completedAt: number | null
  elapsedMs: number | null
}

export function buildTranscriptDisplayBlocks(messages: TranscriptMessage[]): TranscriptDisplayBlock[] {
  const blocks: TranscriptDisplayBlock[] = []
  let index = 0
  let previousRunStartedAt: number | undefined
  let previousAssistantCompletedAt: number | undefined
  let previousAssistantIncomplete = false
  let previousAssistantContinuesRun = false

  while (index < messages.length) {
    const message = messages[index]
    const entry = { message, messageIndex: index }
    if (message.role !== 'user') {
      blocks.push({ kind: 'message', entry })
      index += 1
      continue
    }

    blocks.push({ kind: 'message', entry })
    const responses: IndexedTranscriptMessage[] = []
    let responseIndex = index + 1
    while (responseIndex < messages.length && messages[responseIndex]?.role !== 'user') {
      responses.push({ message: messages[responseIndex], messageIndex: responseIndex })
      responseIndex += 1
    }

    const assistantMessages = responses
      .map((response) => response.message)
      .filter((response) => response.role === 'assistant')
    if (assistantMessages.length > 0) {
      const continuesPreviousRun = previousRunStartedAt !== undefined && (
        previousAssistantIncomplete
        || previousAssistantContinuesRun
        || (
          message.created !== undefined
          && previousAssistantCompletedAt !== undefined
          && message.created <= previousAssistantCompletedAt
        )
      )
      const startedAt = continuesPreviousRun ? previousRunStartedAt : message.created
      blocks.push({
        kind: 'assistant-turn',
        turn: {
          key: `turn-${String(index)}`,
          user: entry,
          responses,
          ...(startedAt !== undefined ? { startedAt } : {})
        }
      })
      const completedTimes = assistantMessages
        .map((response) => response.completed)
        .filter((value): value is number => value !== undefined)
      previousRunStartedAt = startedAt
      previousAssistantCompletedAt = completedTimes.length > 0 ? Math.max(...completedTimes) : undefined
      const lastAssistant = assistantMessages[assistantMessages.length - 1]
      previousAssistantIncomplete = lastAssistant?.completed === undefined
      previousAssistantContinuesRun = Boolean(
        lastAssistant
        && (
          lastAssistant.finish === 'tool-calls'
          || lastAssistant.finish === 'unknown'
          || lastAssistant.parts.some((part) => part.type === 'tool')
        )
      )
    } else {
      blocks.push(...responses.map((response) => ({ kind: 'message' as const, entry: response })))
    }

    index = responseIndex
  }

  return blocks
}

export function resolveAssistantTurnTiming(
  turn: AssistantTurn,
  options: { isActive: boolean; now: number; fallbackStartedAt?: number }
): AssistantTurnTiming {
  const assistantMessages = turn.responses
    .map((entry) => entry.message)
    .filter((message) => message.role === 'assistant')
  const startedAt = turn.startedAt
    ?? turn.user.message.created
    ?? assistantMessages.find((message) => message.created !== undefined)?.created
    ?? options.fallbackStartedAt
    ?? null
  const completedTimes = assistantMessages
    .map((message) => message.completed)
    .filter((value): value is number => value !== undefined)
  const completedAt = completedTimes.length > 0 ? Math.max(...completedTimes) : null

  if (startedAt === null) {
    return { startedAt: null, completedAt, elapsedMs: null }
  }

  const endedAt = options.isActive ? options.now : completedAt
  return {
    startedAt,
    completedAt,
    elapsedMs: endedAt === null ? null : Math.max(0, endedAt - startedAt)
  }
}

export function formatTurnDuration(ms: number): string {
  if (ms < 1000) {
    return '<1s'
  }

  const totalSeconds = Math.max(1, Math.floor(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) {
    return `${String(hours)}h${minutes > 0 ? ` ${String(minutes)}m` : ''}${seconds > 0 ? ` ${String(seconds)}s` : ''}`
  }
  if (minutes > 0) {
    return `${String(minutes)}m${seconds > 0 ? ` ${String(seconds)}s` : ''}`
  }
  return `${String(seconds)}s`
}
