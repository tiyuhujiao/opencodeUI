import { useEffect, useRef, useState } from 'react'
import type { SessionSummary } from '../../../../src/shared/protocol'

type SessionDialogProps = {
  open: boolean
  sessions: SessionSummary[]
  selectedSessionId: string | null
  onSelectSessionId: (id: string) => void
  onDeleteSessionId?: (id: string) => void
  onClose: () => void
}

function formatSessionUpdated(updated: string) {
  const date = new Date(updated)

  if (!Number.isNaN(date.getTime())) {
    const pad = (value: number) => String(value).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  }

  const readable = updated.replace('T', ' ').replace(/\.\d{1,3}Z?$/, '').replace(/Z$/, '').trim()
  return readable || 'Unknown time'
}

export function SessionDialog({ open, sessions, selectedSessionId, onSelectSessionId, onDeleteSessionId, onClose }: SessionDialogProps) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [deleteArmedId, setDeleteArmedId] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<null | { x: number; y: number; id: string }>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const deleteTimerRef = useRef<number | null>(null)
  const deleteArmedIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!open) {
      return
    }
    const index = selectedSessionId ? sessions.findIndex((s) => s.id === selectedSessionId) : -1
    setSelectedIndex(index >= 0 ? index : 0)
  }, [open, selectedSessionId, sessions])

  useEffect(() => {
    if (!open) {
      return
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setContextMenu(null)
        onClose()
        return
      }

      // TUI-like delete: Ctrl+D twice to delete selected session.
      if (onDeleteSessionId && event.key.toLowerCase() === 'd' && event.ctrlKey) {
        event.preventDefault()
        const session = sessions[selectedIndex]
        if (!session) {
          return
        }

        // Use a ref for the actual state machine so rapid key presses don't race React state.
        if (deleteArmedIdRef.current === session.id) {
          // second press
          if (deleteTimerRef.current) {
            window.clearTimeout(deleteTimerRef.current)
            deleteTimerRef.current = null
          }
          deleteArmedIdRef.current = null
          setDeleteArmedId(null)
          onDeleteSessionId(session.id)
          return
        }

        // first press
        deleteArmedIdRef.current = session.id
        setDeleteArmedId(session.id)
        if (deleteTimerRef.current) {
          window.clearTimeout(deleteTimerRef.current)
        }
        deleteTimerRef.current = window.setTimeout(() => {
          deleteArmedIdRef.current = null
          setDeleteArmedId(null)
          deleteTimerRef.current = null
        }, 1500)
        return
      }

      if (sessions.length > 0 && (event.key === 'ArrowUp' || event.key === 'k')) {
        event.preventDefault()
        setSelectedIndex((current) => (current <= 0 ? sessions.length - 1 : current - 1))
        return
      }

      if (sessions.length > 0 && (event.key === 'ArrowDown' || event.key === 'j')) {
        event.preventDefault()
        setSelectedIndex((current) => (current >= sessions.length - 1 ? 0 : current + 1))
        return
      }

      if (event.key === 'Enter') {
        const session = sessions[selectedIndex]
        if (!session) {
          return
        }
        event.preventDefault()
        onSelectSessionId(session.id)
        onClose()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, onDeleteSessionId, onSelectSessionId, open, selectedIndex, sessions])

  useEffect(() => {
    if (!open) {
      return
    }

    const el = listRef.current
    if (!el) {
      return
    }
    const row = el.querySelector<HTMLElement>(`[data-index="${String(selectedIndex)}"]`)
    row?.scrollIntoView({ block: 'nearest' })
  }, [open, selectedIndex])

  if (!open) {
    return null
  }

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="session dialog">
      <button type="button" className="overlay__backdrop" onClick={onClose} aria-label="close" />
      <div className="dialog" ref={dialogRef}>
        <header className="dialog__header">
          <div className="dialog__title">Switch Session</div>
        </header>

        {sessions.length === 0 ? <div className="dialog__empty">No sessions</div> : null}

        <div className="dialog__list" ref={listRef} role="listbox" aria-label="sessions">
          {sessions.map((session, index) => {
            const selected = index === selectedIndex
            return (
              <div
                key={session.id}
                className={`dialog__item dialog__item--session${selected ? ' is-selected' : ''}${deleteArmedId === session.id ? ' is-delete-armed' : ''}`}
                data-index={index}
                onMouseEnter={() => setSelectedIndex(index)}
                onContextMenu={(e) => {
                  if (!onDeleteSessionId) {
                    return
                  }
                  e.preventDefault()
                  setDeleteArmedId(session.id)

                  const dialogRect = dialogRef.current?.getBoundingClientRect()
                  const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
                  // Anchor to the row so it always "follows" the clicked session.
                  const x = Math.round(rect.right - (dialogRect?.left ?? 0) - 12)
                  const y = Math.round(rect.top - (dialogRect?.top ?? 0) + 10)
                  setContextMenu({ x, y, id: session.id })
                }}
                role="option"
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
              >
                <button
                  type="button"
                  className="dialog__itemMain"
                  onClick={() => {
                    onSelectSessionId(session.id)
                    onClose()
                  }}
                >
                  <span className="dialog__itemTitle">{session.title}</span>
                  <span className="dialog__itemMeta">{formatSessionUpdated(session.updated)}</span>
                </button>
                {onDeleteSessionId ? (
                  <button
                    type="button"
                    className="dialog__itemDelete"
                    aria-label={`Delete ${session.title}`}
                    title="Delete session"
                    onClick={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      setContextMenu(null)
                      onDeleteSessionId(session.id)
                    }}
                  >
                    <span className="dialog__itemDeleteIcon" aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            )
          })}
        </div>

        {contextMenu ? (
          <div className="context-menu context-menu--session" style={{ left: contextMenu.x, top: contextMenu.y }}>
            <button
              type="button"
              className="context-menu__item context-menu__item--danger"
              onClick={() => {
                const id = contextMenu.id
                setContextMenu(null)
                onDeleteSessionId?.(id)
              }}
            >
              Delete
            </button>
            <button type="button" className="context-menu__item" onClick={() => setContextMenu(null)}>
              Cancel
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
