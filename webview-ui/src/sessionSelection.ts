export type SessionSelectionAfterListInput = {
  currentSessionId: string | null
  listedSessionIds: readonly string[]
  allowAutoSelect: boolean
  protectedSessionId?: string | null
}

export type SessionSelectionAfterListResult = {
  selectedSessionId: string | null
  suppressAutoExport: boolean
}

export function resolveSessionSelectionAfterList(input: SessionSelectionAfterListInput): SessionSelectionAfterListResult {
  const listedIds = new Set(input.listedSessionIds)
  const protectedSessionId = input.protectedSessionId?.trim() || null

  if (protectedSessionId) {
    const currentMissing = input.currentSessionId ? !listedIds.has(input.currentSessionId) : true
    if (!input.currentSessionId || input.currentSessionId === protectedSessionId || currentMissing) {
      return {
        selectedSessionId: protectedSessionId,
        suppressAutoExport: false
      }
    }
  }

  if (!input.currentSessionId) {
    return {
      selectedSessionId: input.allowAutoSelect ? (input.listedSessionIds[0] ?? null) : null,
      suppressAutoExport: true
    }
  }

  if (listedIds.has(input.currentSessionId)) {
    return {
      selectedSessionId: input.currentSessionId,
      suppressAutoExport: false
    }
  }

  return {
    selectedSessionId: null,
    suppressAutoExport: true
  }
}