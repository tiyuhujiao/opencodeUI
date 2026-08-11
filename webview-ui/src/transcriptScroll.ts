import type { TranscriptMessage } from '../../src/shared/protocol'

export type AnchoredScrollInput = {
  anchorTop: number
  contentBottom: number
  clientHeight: number
  maxScrollTop: number
  bottomPadding?: number
  topGap?: number
}

export type RunSpacerInput = {
  clientHeight: number
  anchorHeight: number
  rowGap: number
  paddingBottom: number
}

export const TURN_ANCHOR_TOP_GAP = 20
export const TURN_ANCHOR_SCROLL_DURATION_MS = 180

export type AssistantTextOutput = {
  key: string
  text: string
}

export function findLatestAssistantTextOutput(messages: TranscriptMessage[]): AssistantTextOutput | null {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex]
    if (message?.role !== 'assistant') {
      continue
    }

    for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = message.parts[partIndex]
      if (part?.type !== 'text' || part.text.trim().length === 0) {
        continue
      }
      return {
        key: `${message.id ?? String(messageIndex)}:${part.streamKey ?? String(partIndex)}`,
        text: part.text
      }
    }
    return null
  }
  return null
}

export function computeAnchoredScrollTop(input: AnchoredScrollInput): number {
  const bottomPadding = input.bottomPadding ?? 20
  const topGap = input.topGap ?? TURN_ANCHOR_TOP_GAP
  const followOutputTop = input.contentBottom - input.clientHeight + bottomPadding
  const anchorTarget = input.anchorTop - topGap
  const desired = Math.max(anchorTarget, followOutputTop)
  return Math.max(0, Math.min(input.maxScrollTop, desired))
}

export function interpolateFastScrollTop(
  start: number,
  target: number,
  elapsedMs: number,
  durationMs = TURN_ANCHOR_SCROLL_DURATION_MS
): number {
  if (durationMs <= 0 || elapsedMs >= durationMs) {
    return target
  }
  if (elapsedMs <= 0) {
    return start
  }
  const progress = Math.min(1, elapsedMs / durationMs)
  const eased = 1 - (1 - progress) ** 3
  return start + (target - start) * eased
}

export function computeRunSpacerHeight(input: RunSpacerInput): number {
  const available = input.clientHeight - input.anchorHeight - input.rowGap - input.paddingBottom
  return Math.max(0, Math.ceil(available))
}
