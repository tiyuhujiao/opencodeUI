import type { TranscriptMessage } from '../../src/shared/protocol'

export type IndexedTranscriptMessage = {
  message: TranscriptMessage
  messageIndex: number
}

export type TranscriptRun = {
  key: string
  initialUser: IndexedTranscriptMessage
  events: IndexedTranscriptMessage[]
  startedAt?: number
  completedAt?: number
}

export type TranscriptDisplayBlock =
  | { kind: 'message'; entry: IndexedTranscriptMessage }
  | { kind: 'run'; run: TranscriptRun }

export type TranscriptRunTiming = {
  startedAt: number | null
  completedAt: number | null
  elapsedMs: number | null
}

type TranscriptSequence =
  | { kind: 'message'; entry: IndexedTranscriptMessage }
  | { kind: 'run'; run: TranscriptRun }

export function buildTranscriptDisplayBlocks(messages: TranscriptMessage[]): TranscriptDisplayBlock[] {
  const sequence: TranscriptSequence[] = []
  let currentRun: TranscriptRun | null = null

  for (let messageIndex = 0; messageIndex < messages.length; messageIndex += 1) {
    const message = messages[messageIndex]
    if (!message) {
      continue
    }
    const entry = { message, messageIndex }

    if (message.role !== 'user') {
      if (!currentRun) {
        sequence.push({ kind: 'message', entry })
        continue
      }
      currentRun.events.push(entry)
      if (message.role === 'assistant' && message.completed !== undefined) {
        currentRun.completedAt = currentRun.completedAt === undefined
          ? message.completed
          : Math.max(currentRun.completedAt, message.completed)
      }
      continue
    }

    if (currentRun && userContinuesRun(currentRun, message)) {
      currentRun.events.push(entry)
      continue
    }

    currentRun = {
      key: `run-${String(messageIndex)}`,
      initialUser: entry,
      events: [],
      ...(message.created !== undefined ? { startedAt: message.created } : {})
    }
    sequence.push({ kind: 'run', run: currentRun })
  }

  const blocks: TranscriptDisplayBlock[] = []
  for (const item of sequence) {
    if (item.kind === 'message') {
      blocks.push(item)
      continue
    }

    blocks.push({ kind: 'message', entry: item.run.initialUser })
    if (item.run.events.some((entry) => entry.message.role === 'assistant')) {
      blocks.push(item)
      continue
    }
    blocks.push(...item.run.events.map((entry) => ({ kind: 'message' as const, entry })))
  }
  return blocks
}

function userContinuesRun(run: TranscriptRun, user: TranscriptMessage): boolean {
  const previousEvent = run.events[run.events.length - 1]
  if (!previousEvent || previousEvent.message.role === 'user') {
    return true
  }

  let previousAssistant: TranscriptMessage | undefined
  for (let index = run.events.length - 1; index >= 0; index -= 1) {
    const candidate = run.events[index]?.message
    if (candidate?.role === 'assistant') {
      previousAssistant = candidate
      break
    }
  }
  if (!previousAssistant) {
    return true
  }

  return previousAssistant.completed === undefined
    || previousAssistant.finish === 'tool-calls'
    || previousAssistant.finish === 'unknown'
    || previousAssistant.parts.some((part) => part.type === 'tool')
    || (
      user.created !== undefined
      && previousAssistant.completed !== undefined
      && user.created <= previousAssistant.completed
    )
}

export function resolveTranscriptRunTiming(
  run: TranscriptRun,
  options: { isActive: boolean; now: number; fallbackStartedAt?: number }
): TranscriptRunTiming {
  const assistantMessages = run.events
    .map((entry) => entry.message)
    .filter((message) => message.role === 'assistant')
  const startedAt = run.startedAt
    ?? run.initialUser.message.created
    ?? assistantMessages.find((message) => message.created !== undefined)?.created
    ?? options.fallbackStartedAt
    ?? null
  const completedTimes = assistantMessages
    .map((message) => message.completed)
    .filter((value): value is number => value !== undefined)
  const completedAt = run.completedAt
    ?? (completedTimes.length > 0 ? Math.max(...completedTimes) : null)

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
