export const THINKING_PREFERENCES_STORAGE_KEY = 'opencode-ui.thinking-by-model'

type StorageReader = Pick<Storage, 'getItem'>
type StorageWriter = Pick<Storage, 'setItem'>

export function readThinkingPreferences(storage: StorageReader): Record<string, string> {
  try {
    const raw = storage.getItem(THINKING_PREFERENCES_STORAGE_KEY)
    if (!raw) {
      return {}
    }
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) {
      return {}
    }

    const result: Record<string, string> = {}
    for (const [model, selection] of Object.entries(parsed)) {
      if (model.trim() && typeof selection === 'string' && selection.trim()) {
        result[model] = selection
      }
    }
    return result
  } catch {
    return {}
  }
}

export function writeThinkingPreferences(storage: StorageWriter, preferences: Record<string, string>): void {
  try {
    storage.setItem(THINKING_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences))
  } catch {
    // Constrained webviews may not expose persistent storage; in-memory selection still works.
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
