import type { RunStreamEvent, SessionSummary, TranscriptMessage, TranscriptPartTool } from '../../src/shared/protocol'

export function compactTranscript(messages: TranscriptMessage[]): TranscriptMessage[] {
  const next: TranscriptMessage[] = []
  for (const message of messages) {
    const last = next[next.length - 1]
    if (last && last.role === message.role) {
      const merged = [...last.parts, ...message.parts]
      last.parts = merged
    } else {
      next.push({ role: message.role, parts: [...message.parts] })
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
    parts: [...message.parts]
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
    nextTarget.parts.push({
      type: 'text',
      text: `\n\n运行错误：${event.error}`
    })
  }

  return next
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
