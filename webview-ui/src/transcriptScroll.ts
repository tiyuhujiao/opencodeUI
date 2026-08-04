export type AnchoredScrollInput = {
  anchorTop: number
  contentBottom: number
  clientHeight: number
  maxScrollTop: number
  bottomPadding?: number
}

export function computeAnchoredScrollTop(input: AnchoredScrollInput): number {
  const bottomPadding = input.bottomPadding ?? 20
  const followOutputTop = input.contentBottom - input.clientHeight + bottomPadding
  const desired = Math.max(input.anchorTop, followOutputTop)
  return Math.max(0, Math.min(input.maxScrollTop, desired))
}
