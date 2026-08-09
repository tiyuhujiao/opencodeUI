type TerminalSnapshotIdentity = {
  requestId: string
  sessionId?: string
}

type TerminalRecoveryState = {
  activeRequestId: string | null
  consumedRequestId: string | null
  selectedSessionId: string | null
}

type ActiveSnapshotIdentity = {
  requestId: string
  revision: number
}

type ActiveRecoveryState = {
  activeRequestId: string | null
  currentRevision: number
}

export function shouldRestoreActiveSnapshot(
  snapshot: ActiveSnapshotIdentity,
  state: ActiveRecoveryState
): boolean {
  if (state.activeRequestId === null) {
    return true
  }
  return state.activeRequestId === snapshot.requestId && snapshot.revision > state.currentRevision
}

export function shouldApplyRunEvent(
  requestId: string,
  revision: number,
  state: ActiveRecoveryState
): boolean {
  return state.activeRequestId === requestId && revision > state.currentRevision
}

export function shouldRestoreTerminalSnapshot(
  snapshot: TerminalSnapshotIdentity,
  state: TerminalRecoveryState
): boolean {
  if (state.consumedRequestId === snapshot.requestId) {
    return false
  }
  if (state.activeRequestId !== null) {
    return state.activeRequestId === snapshot.requestId
  }
  return state.selectedSessionId === (snapshot.sessionId ?? null)
}
