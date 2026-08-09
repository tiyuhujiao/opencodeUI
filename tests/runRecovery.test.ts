import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  shouldApplyRunEvent,
  shouldRestoreActiveSnapshot,
  shouldRestoreTerminalSnapshot
} from '../webview-ui/src/runRecovery'

describe('active run revision recovery', () => {
  it('keeps the retained UI when a snapshot is not newer', () => {
    const snapshot = { requestId: 'run-1', revision: 4 }
    expect(shouldRestoreActiveSnapshot(snapshot, {
      activeRequestId: 'run-1',
      currentRevision: 4
    })).toBe(false)
  })

  it('restores only a newer snapshot for the same active request', () => {
    expect(shouldRestoreActiveSnapshot({ requestId: 'run-1', revision: 5 }, {
      activeRequestId: 'run-1',
      currentRevision: 4
    })).toBe(true)
    expect(shouldRestoreActiveSnapshot({ requestId: 'run-old', revision: 99 }, {
      activeRequestId: 'run-new',
      currentRevision: 1
    })).toBe(false)
  })

  it('deduplicates an event already represented by a snapshot', () => {
    expect(shouldApplyRunEvent('run-1', 5, {
      activeRequestId: 'run-1',
      currentRevision: 5
    })).toBe(false)
    expect(shouldApplyRunEvent('run-1', 6, {
      activeRequestId: 'run-1',
      currentRevision: 5
    })).toBe(true)
  })
})

describe('terminal run recovery', () => {
  const snapshot = {
    requestId: 'run-1',
    sessionId: 'session-1'
  }

  it('does not restore a terminal snapshot already consumed from the live event stream', () => {
    expect(shouldRestoreTerminalSnapshot(snapshot, {
      activeRequestId: null,
      consumedRequestId: 'run-1',
      selectedSessionId: 'session-1'
    })).toBe(false)
  })

  it('does not let a terminal snapshot replace a newer active run', () => {
    expect(shouldRestoreTerminalSnapshot(snapshot, {
      activeRequestId: 'run-2',
      consumedRequestId: null,
      selectedSessionId: 'session-1'
    })).toBe(false)
  })

  it('restores the matching active run even before its session selection is persisted', () => {
    expect(shouldRestoreTerminalSnapshot(snapshot, {
      activeRequestId: 'run-1',
      consumedRequestId: null,
      selectedSessionId: null
    })).toBe(true)
  })

  it('requires an exact session match when no run is active', () => {
    expect(shouldRestoreTerminalSnapshot(snapshot, {
      activeRequestId: null,
      consumedRequestId: null,
      selectedSessionId: 'session-1'
    })).toBe(true)
    expect(shouldRestoreTerminalSnapshot(snapshot, {
      activeRequestId: null,
      consumedRequestId: null,
      selectedSessionId: 'session-2'
    })).toBe(false)
    expect(shouldRestoreTerminalSnapshot(snapshot, {
      activeRequestId: null,
      consumedRequestId: null,
      selectedSessionId: null
    })).toBe(false)
  })

  it('marks a live terminal event as consumed before clearing the active run', () => {
    const source = readFileSync(join(process.cwd(), 'webview-ui/src/App.tsx'), 'utf8')
    const blockStart = source.indexOf('const completeRun = useCallback')
    const blockEnd = source.indexOf('const restoreActiveRun = useCallback', blockStart)
    const block = source.slice(blockStart, blockEnd)
    const consumedAt = block.indexOf('lastRecoveredTerminalRequestIdRef.current = active.requestId')
    const clearedAt = block.indexOf('activeRunRef.current = null')

    expect(blockStart).toBeGreaterThan(0)
    expect(consumedAt).toBeGreaterThan(0)
    expect(clearedAt).toBeGreaterThan(consumedAt)
  })
})
