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
