import type { ModelSummary } from '../../src/shared/protocol'

export const THINKING_OFF_VALUE = 'off'
export const THINKING_DEFAULT_VALUE = 'default'

type ThinkingModel = Pick<ModelSummary, 'variants' | 'supportsThinking'>

export function getThinkingOptionsForModel(model: ThinkingModel | null | undefined): string[] {
  const options = [THINKING_OFF_VALUE]
  const variants = uniqueOptions(model?.variants ?? [])
  if (variants.length > 0) {
    return [...options, ...variants]
  }
  if (model?.supportsThinking) {
    return [...options, THINKING_DEFAULT_VALUE]
  }
  return options
}

export function getThinkingSelectionValue(enabled: boolean, variant: string): string {
  if (!enabled) {
    return THINKING_OFF_VALUE
  }
  return variant.trim() || THINKING_DEFAULT_VALUE
}

export function findThinkingOption(options: string[], input: string): string | undefined {
  const normalized = normalizeOption(input)
  return options.find((option) => normalizeOption(option) === normalized)
}

export function toThinkingSelection(value: string): { enabled: boolean; variant: string } {
  if (normalizeOption(value) === THINKING_OFF_VALUE) {
    return { enabled: false, variant: '' }
  }
  if (normalizeOption(value) === THINKING_DEFAULT_VALUE) {
    return { enabled: true, variant: '' }
  }
  return { enabled: true, variant: value.trim() }
}

function uniqueOptions(options: string[]) {
  const seen = new Set<string>()
  const result: string[] = []
  for (const option of options) {
    const trimmed = option.trim()
    const normalized = normalizeOption(trimmed)
    if (!trimmed || seen.has(normalized) || normalized === THINKING_OFF_VALUE) {
      continue
    }
    seen.add(normalized)
    result.push(trimmed)
  }
  return result
}

function normalizeOption(option: string) {
  return option.trim().toLowerCase()
}
