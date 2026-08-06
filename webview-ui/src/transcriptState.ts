import type {
  ContextUsage,
  RunStreamEvent,
  SessionSummary,
  TranscriptMessage,
  TranscriptPartText,
  TranscriptPartTool
} from '../../src/shared/protocol'

const RUN_ERROR_PREFIX = '运行错误：'

export function clearSettledRunStatus(status: string | null): string | null {
  return status === 'Completed' || status === 'Stopped' || status === 'Failed' ? null : status
}

export function preserveContextUsage(previous: ContextUsage | undefined, incoming: ContextUsage): ContextUsage {
  if (incoming.usedTokens === 0 && previous && previous.usedTokens > 0) {
    return {
      ...previous,
      ...(incoming.model ? { model: incoming.model } : {})
    }
  }
  return incoming
}

export function compactTranscript(messages: TranscriptMessage[]): TranscriptMessage[] {
  const next: TranscriptMessage[] = []
  for (const message of messages) {
    const last = next[next.length - 1]
    if (last && last.role === message.role) {
      const merged = [...last.parts, ...message.parts]
      last.parts = merged
      if (message.contextUsage) {
        last.contextUsage = preserveContextUsage(last.contextUsage, message.contextUsage)
      }
    } else {
      next.push({
        role: message.role,
        parts: [...message.parts],
        ...(message.contextUsage ? { contextUsage: message.contextUsage } : {})
      })
    }
  }
  return next
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

  const merged = exported.map((message) => ({
    role: message.role,
    parts: [...message.parts],
    ...(message.contextUsage ? { contextUsage: message.contextUsage } : {})
  }))

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

  const merged = exported.map((message) => ({
    role: message.role,
    parts: [...message.parts],
    ...(message.contextUsage ? { contextUsage: message.contextUsage } : {})
  }))

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

export function applyRunEventToTranscript(messages: TranscriptMessage[], event: RunStreamEvent, assistantIndex: number): TranscriptMessage[] {
  const target = messages[assistantIndex]
  if (!target) {
    return messages
  }

  const next = [...messages]
  const nextTarget: TranscriptMessage = {
    ...target,
    parts: [...target.parts]
  }
  next[assistantIndex] = nextTarget

  if (event.type === 'context.usage') {
    const previousUsage = findLatestContextUsage(messages, assistantIndex)
    nextTarget.contextUsage = preserveContextUsage(previousUsage, event.usage)
    return next
  }

  if (event.type === 'part') {
    if (event.part.type === 'tool') {
      const raw = event.part.raw as { type?: unknown; part?: unknown } | null
      const rawType = typeof raw?.type === 'string' ? raw.type : null
      const part = (raw && typeof raw === 'object' ? (raw as { part?: unknown }).part : undefined) as
        | { type?: unknown }
        | undefined
      const partType = typeof part?.type === 'string' ? part.type : null
      if (rawType === 'step_start' || rawType === 'step_finish' || partType === 'step-start' || partType === 'step-finish') {
        return messages
      }
    }

    if (event.part.type === 'text') {
      const previous = nextTarget.parts[nextTarget.parts.length - 1]
      if (previous?.type === 'text') {
        nextTarget.parts[nextTarget.parts.length - 1] = {
          type: 'text',
          text: `${previous.text}${event.part.text}`
        }
      } else {
        nextTarget.parts.push(event.part)
      }
      return next
    }

    if (event.part.type === 'reasoning') {
      const previous = nextTarget.parts[nextTarget.parts.length - 1]
      if (previous?.type === 'reasoning') {
        nextTarget.parts[nextTarget.parts.length - 1] = {
          type: 'reasoning',
          text: `${previous.text}${event.part.text}`,
          raw: event.part.raw ?? previous.raw
        }
      } else {
        nextTarget.parts.push(event.part)
      }
      return next
    }

    if (event.part.type === 'tool') {
      const incomingKey = getToolPartUpdateKey(event.part)
      if (incomingKey) {
        const existingIndex = nextTarget.parts.findIndex((part) => part.type === 'tool' && getToolPartUpdateKey(part) === incomingKey)
        if (existingIndex >= 0) {
          nextTarget.parts[existingIndex] = mergeToolPart(nextTarget.parts[existingIndex] as TranscriptPartTool, event.part)
          return next
        }
      }
    }

    nextTarget.parts.push(event.part)
    return next
  }

  if (event.type === 'error') {
    const errorPart: TranscriptPartText = {
      type: 'text',
      text: `\n\n${RUN_ERROR_PREFIX}${event.error}`
    }
    if (!nextTarget.parts.some((part) => isRunErrorPart(part) && part.text === errorPart.text)) {
      nextTarget.parts.push(errorPart)
    }
  }

  return next
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

function findLatestContextUsage(messages: TranscriptMessage[], beforeIndex: number): ContextUsage | undefined {
  for (let index = beforeIndex; index >= 0; index -= 1) {
    const usage = messages[index]?.contextUsage
    if (usage) {
      return usage
    }
  }
  return undefined
}

function mergeToolPart(previous: TranscriptPartTool, next: TranscriptPartTool): TranscriptPartTool {
  return {
    type: 'tool',
    toolName: next.toolName || previous.toolName,
    status: next.status || previous.status,
    raw: next.raw ?? previous.raw
  }
}

function getToolPartUpdateKey(part: TranscriptPartTool): string | null {
  const toolName = part.toolName.trim().toLowerCase()
  const raw = toRecord(part.raw)
  const nestedPart = toRecord(raw?.part)
  const state = toRecord(nestedPart?.state) ?? toRecord(raw?.state)
  const input = toRecord(state?.input)
  const id = pickFirstString([
    nestedPart?.id,
    nestedPart?.partID,
    nestedPart?.partId,
    nestedPart?.toolCallID,
    nestedPart?.toolCallId,
    raw?.id,
    raw?.partID,
    raw?.partId,
    raw?.toolCallID,
    raw?.toolCallId,
    state?.id,
    state?.partID,
    state?.partId,
    state?.toolCallID,
    state?.toolCallId
  ])
  if (id) {
    return `${toolName}:id:${id}`
  }

  if (toolName !== 'task') {
    return null
  }

  const semantic = pickFirstString([input?.description, input?.prompt])
  return semantic ? `${toolName}:semantic:${semantic.toLowerCase().replace(/\s+/g, ' ')}` : null
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

function pickFirstString(values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== 'string') {
      continue
    }
    const trimmed = value.trim()
    if (trimmed.length > 0) {
      return trimmed
    }
  }
  return null
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
