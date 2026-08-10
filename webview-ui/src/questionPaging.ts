export type QuestionPage = {
  index: number
  current: number
  total: number
  label: string
  hasPrevious: boolean
  hasNext: boolean
}

export function getQuestionPage(index: number, total: number): QuestionPage {
  const safeTotal = Math.max(0, Math.trunc(total))
  const maxIndex = Math.max(0, safeTotal - 1)
  const safeIndex = Math.min(maxIndex, Math.max(0, Math.trunc(index)))
  const current = safeTotal === 0 ? 0 : safeIndex + 1

  return {
    index: safeIndex,
    current,
    total: safeTotal,
    label: `${String(current)}/${String(safeTotal)}`,
    hasPrevious: safeTotal > 0 && safeIndex > 0,
    hasNext: safeIndex < maxIndex
  }
}

export function getQuestionIndexAfterOption(
  index: number,
  total: number,
  multiple: boolean | undefined
): number {
  const page = getQuestionPage(index, total)
  return multiple || !page.hasNext ? page.index : page.index + 1
}
