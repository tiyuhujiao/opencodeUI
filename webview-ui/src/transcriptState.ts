import type {
  SessionSummary,
  TranscriptMessage,
  TranscriptPartText
} from '../../src/shared/protocol'
import {
  applyRunEventToTranscript,
  preserveContextUsage
} from '../../src/shared/runTranscript'

export { applyRunEventToTranscript, preserveContextUsage }

const RUN_ERROR_PREFIX = '运行错误：'

export function clearSettledRunStatus(status: string | null): string | null {
  return status === 'Completed' || status === 'Stopped' || status === 'Failed' ? null : status
}

export function compactTranscript(messages: TranscriptMessage[]): TranscriptMessage[] {
  const next: TranscriptMessage[] = []
  for (const message of messages) {
    const last = next[next.length - 1]
    if (last && canCompactMessages(last, message)) {
      const merged = [...last.parts, ...message.parts]
      last.parts = merged
      if (last.created === undefined && message.created !== undefined) {
        last.created = message.created
      }
      if (message.completed !== undefined) {
        last.completed = last.completed === undefined
          ? message.completed
          : Math.max(last.completed, message.completed)
      }
      if (message.contextUsage) {
        last.contextUsage = preserveContextUsage(last.contextUsage, message.contextUsage)
      }
      if (message.finish) {
        last.finish = message.finish
      }
    } else {
      next.push(cloneTranscriptMessage(message))
    }
  }
  return next
}

function canCompactMessages(previous: TranscriptMessage, next: TranscriptMessage): boolean {
  if (previous.role !== next.role) {
    return false
  }
  if (!previous.id && !next.id) {
    return true
  }
  return Boolean(previous.id && previous.id === next.id)
}

function cloneTranscriptMessage(message: TranscriptMessage): TranscriptMessage {
  return {
    ...(message.id ? { id: message.id } : {}),
    ...(message.created !== undefined ? { created: message.created } : {}),
    ...(message.completed !== undefined ? { completed: message.completed } : {}),
    ...(message.finish ? { finish: message.finish } : {}),
    role: message.role,
    parts: [...message.parts],
    ...(message.contextUsage ? { contextUsage: message.contextUsage } : {})
  }
}

export function isFinalAssistantResponse(message: TranscriptMessage): boolean {
  if (message.role !== 'assistant') {
    return false
  }

  const finish = message.finish?.trim().toLowerCase()
  if (!finish || finish === 'tool-calls' || finish === 'unknown') {
    return false
  }

  return message.parts.some((part) => part.type === 'text' && part.text.trim().length > 0)
}

export function hasAnyAssistantText(messages: TranscriptMessage[]): boolean {
  for (const message of messages) {
    if (message.role !== 'assistant') {
      continue
    }
    for (const part of message.parts) {
      if (part.type === 'text' && part.text.trim().length > 0) {
        return true
      }
    }
  }
  return false
}

export function isExportAtLeastAsComplete(exported: TranscriptMessage[], local: TranscriptMessage[]): boolean {
  const exportedCompleteness = transcriptCompleteness(exported)
  const localCompleteness = transcriptCompleteness(local)

  return (
    exportedCompleteness.userMessages >= localCompleteness.userMessages &&
    exportedCompleteness.assistantTextMessages >= localCompleteness.assistantTextMessages
  )
}

export function summarizePendingSessionTitle(message: string): string {
  const normalized = message.replace(/\s+/g, ' ').trim()
  if (!normalized) {
    return 'New Session'
  }
  return normalized.length > 48 ? `${normalized.slice(0, 47)}…` : normalized
}

export function upsertSessionSummary(current: SessionSummary[], next: SessionSummary): SessionSummary[] {
  return [next, ...current.filter((session) => session.id !== next.id)]
}

export function upsertPendingSessionSummary(
  current: SessionSummary[],
  next: SessionSummary,
  options: { startedNewSession: boolean }
): SessionSummary[] {
  if (!options.startedNewSession) {
    return current
  }
  return upsertSessionSummary(current, next)
}

export function preserveProtectedSessionSummary(
  listed: SessionSummary[],
  protectedSessionId: string | null,
  fallback: SessionSummary | undefined
): SessionSummary[] {
  if (!protectedSessionId || listed.some((session) => session.id === protectedSessionId) || !fallback) {
    return listed
  }
  return [fallback, ...listed]
}

export function mergeLocalImageParts(local: TranscriptMessage[], exported: TranscriptMessage[]): TranscriptMessage[] {
  if (local.length === 0 || exported.length === 0) {
    return exported
  }

  const merged = exported.map(cloneTranscriptMessage)

  for (let i = 0; i < Math.min(local.length, merged.length); i += 1) {
    const localMessage = local[i]
    const exportedMessage = merged[i]
    if (localMessage.role !== 'user' || exportedMessage.role !== 'user') {
      continue
    }
    const localImages = localMessage.parts.filter((part) => part.type === 'image')
    if (localImages.length === 0) {
      continue
    }
    const alreadyHasImage = exportedMessage.parts.some((part) => part.type === 'image')
    if (alreadyHasImage) {
      continue
    }
    exportedMessage.parts = [...localMessage.parts]
  }

  return merged
}

export function mergeLocalRunErrors(local: TranscriptMessage[], exported: TranscriptMessage[]): TranscriptMessage[] {
  const errors = collectLocalRunErrors(local)
  if (errors.length === 0) {
    return exported
  }

  const merged = exported.map(cloneTranscriptMessage)

  for (const entry of errors) {
    const target = findTurnTarget(merged, entry.userTurn)
    if (!target) {
      continue
    }

    if (target.assistantIndex !== null) {
      const assistant = merged[target.assistantIndex]
      const existing = new Set(
        assistant.parts
          .filter((part): part is TranscriptPartText => isRunErrorPart(part))
          .map((part) => part.text)
      )
      const missing = entry.parts.filter((part) => !existing.has(part.text))
      if (missing.length > 0) {
        assistant.parts = [...assistant.parts, ...missing]
      }
      continue
    }

    merged.splice(target.insertIndex, 0, {
      role: 'assistant',
      parts: entry.parts.map((part) => ({ ...part }))
    })
  }

  return merged
}

function collectLocalRunErrors(messages: TranscriptMessage[]): Array<{ userTurn: number; parts: TranscriptPartText[] }> {
  const errors: Array<{ userTurn: number; parts: TranscriptPartText[] }> = []
  let userTurn = -1

  for (const message of messages) {
    if (message.role === 'user') {
      userTurn += 1
      continue
    }
    if (message.role !== 'assistant' || userTurn < 0) {
      continue
    }
    const parts = message.parts.filter((part): part is TranscriptPartText => isRunErrorPart(part))
    if (parts.length > 0) {
      errors.push({ userTurn, parts: parts.map((part) => ({ ...part })) })
    }
  }

  return errors
}

function findTurnTarget(
  messages: TranscriptMessage[],
  userTurn: number
): { assistantIndex: number | null; insertIndex: number } | null {
  let currentUserTurn = -1
  let userIndex = -1

  for (let index = 0; index < messages.length; index += 1) {
    if (messages[index]?.role !== 'user') {
      continue
    }
    currentUserTurn += 1
    if (currentUserTurn === userTurn) {
      userIndex = index
      break
    }
  }

  if (userIndex < 0) {
    return null
  }

  for (let index = userIndex + 1; index < messages.length; index += 1) {
    const role = messages[index]?.role
    if (role === 'user') {
      return { assistantIndex: null, insertIndex: index }
    }
    if (role === 'assistant') {
      return { assistantIndex: index, insertIndex: index }
    }
  }

  return { assistantIndex: null, insertIndex: messages.length }
}

function isRunErrorPart(part: TranscriptMessage['parts'][number]): part is TranscriptPartText {
  return part.type === 'text' && part.text.trimStart().startsWith(RUN_ERROR_PREFIX)
}

function transcriptCompleteness(messages: TranscriptMessage[]): { userMessages: number; assistantTextMessages: number } {
  let userMessages = 0
  let assistantTextMessages = 0

  for (const message of messages) {
    if (message.role === 'user') {
      userMessages += 1
      continue
    }

    if (message.role !== 'assistant') {
      continue
    }

    const hasText = message.parts.some((part) => {
      if (part.type !== 'text' && part.type !== 'reasoning') {
        return false
      }
      return part.text.trim().length > 0
    })

    if (hasText) {
      assistantTextMessages += 1
    }
  }

  return { userMessages, assistantTextMessages }
}
