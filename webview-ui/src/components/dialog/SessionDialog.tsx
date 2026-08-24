import { useEffect, useMemo, useRef, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { LoaderCircle, Search } from 'lucide-react'
import type { SessionSearchHit, SessionSummary } from '../../../../src/shared/protocol'
import { createSearchRegExp } from '../../../../src/shared/search'
import { useI18n } from '../../i18n'

type SessionDialogProps = {
  open: boolean
  sessions: SessionSummary[]
  selectedSessionId: string | null
  onSelectSessionId: (id: string) => void
  onDeleteSessionId?: (id: string) => void
  searchQuery: string
  onSearchQueryChange: (query: string) => void
  searchHits: SessionSearchHit[]
  searchLoading: boolean
  onOpenSearchHit: (hit: SessionSearchHit) => void
  onClose: () => void
}

function formatSessionUpdated(updated: string, unknownLabel: string) {
  const date = new Date(updated)

  if (!Number.isNaN(date.getTime())) {
    const pad = (value: number) => String(value).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  }

  const readable = updated.replace('T', ' ').replace(/\.\d{1,3}Z?$/, '').replace(/Z$/, '').trim()
  return readable || unknownLabel
}

function renderSearchSnippet(hit: SessionSearchHit, query: string) {
  const matcher = createSearchRegExp(query)
  if (matcher) {
    const parts: Array<string | JSX.Element> = []
    let cursor = 0
    let match = matcher.exec(hit.snippet)
    while (match) {
      if (match.index > cursor) {
        parts.push(hit.snippet.slice(cursor, match.index))
      }
      parts.push(<mark className="search-hit" key={`${String(match.index)}:${match[0]}`}>{match[0]}</mark>)
      cursor = match.index + match[0].length
      match = matcher.exec(hit.snippet)
    }
    if (parts.length > 0) {
      if (cursor < hit.snippet.length) {
        parts.push(hit.snippet.slice(cursor))
      }
      return parts
    }
  }

  const range = hit.snippetMatch
  if (!range || range.start < 0 || range.end <= range.start || range.end > hit.snippet.length) {
    return hit.snippet
  }
  return (
    <>
      {hit.snippet.slice(0, range.start)}
      <mark className="search-hit">{hit.snippet.slice(range.start, range.end)}</mark>
      {hit.snippet.slice(range.end)}
    </>
  )
}

export function SessionDialog({
  open,
  sessions,
  selectedSessionId,
  onSelectSessionId,
  onDeleteSessionId,
  searchQuery,
  onSearchQueryChange,
  searchHits,
  searchLoading,
  onOpenSearchHit,
  onClose
}: SessionDialogProps) {
  const { t } = useI18n()
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [deleteCandidate, setDeleteCandidate] = useState<SessionSummary | null>(null)
  const [contextMenu, setContextMenu] = useState<null | { x: number; y: number; id: string }>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const cancelDeleteButtonRef = useRef<HTMLButtonElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase()
  const filteredSessions = useMemo(() => normalizedSearchQuery
    ? sessions.filter((session) => `${session.title} ${session.id}`.toLocaleLowerCase().includes(normalizedSearchQuery))
    : sessions, [normalizedSearchQuery, sessions])

  useEffect(() => {
    if (!open) {
      setContextMenu(null)
      setDeleteCandidate(null)
      return
    }
    const index = selectedSessionId ? filteredSessions.findIndex((s) => s.id === selectedSessionId) : -1
    setSelectedIndex(index >= 0 ? index : 0)
  }, [filteredSessions, open, selectedSessionId])

  useEffect(() => {
    if (!open) {
      return
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (deleteCandidate) {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopImmediatePropagation()
          setDeleteCandidate(null)
        }
        return
      }

      const target = event.target
      const isTextInput = target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || (target instanceof HTMLElement && target.isContentEditable)
      if (isTextInput && event.key !== 'Escape') {
        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        setContextMenu(null)
        onClose()
        return
      }

      // Keep the keyboard shortcut, but route it through the same confirmation as pointer actions.
      if (onDeleteSessionId && event.key.toLowerCase() === 'd' && event.ctrlKey) {
        event.preventDefault()
        const session = filteredSessions[selectedIndex]
        if (!session) {
          return
        }

        setContextMenu(null)
        setDeleteCandidate(session)
        return
      }

      if (filteredSessions.length > 0 && (event.key === 'ArrowUp' || event.key === 'k')) {
        event.preventDefault()
        setSelectedIndex((current) => (current <= 0 ? filteredSessions.length - 1 : current - 1))
        return
      }

      if (filteredSessions.length > 0 && (event.key === 'ArrowDown' || event.key === 'j')) {
        event.preventDefault()
        setSelectedIndex((current) => (current >= filteredSessions.length - 1 ? 0 : current + 1))
        return
      }

      if (event.key === 'Enter') {
        const session = filteredSessions[selectedIndex]
        if (!session) {
          return
        }
        event.preventDefault()
        onSelectSessionId(session.id)
        onClose()
      }
    }

    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [deleteCandidate, filteredSessions, onClose, onDeleteSessionId, onSelectSessionId, open, selectedIndex])

  useEffect(() => {
    if (!open) {
      return
    }
    const frame = window.requestAnimationFrame(() => searchInputRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [open])

  useEffect(() => {
    if (deleteCandidate) {
      cancelDeleteButtonRef.current?.focus()
    }
  }, [deleteCandidate])

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
    <div className="overlay" role="dialog" aria-modal="true" aria-label={t('Switch Session')}>
      <button type="button" className="overlay__backdrop" onClick={onClose} aria-label={t('Close')} />
      <div className="dialog" ref={dialogRef} aria-hidden={deleteCandidate ? true : undefined}>
        <header className="dialog__header">
          <div className="dialog__title">{t('Switch Session')}</div>
        </header>

        <div className="session-search">
          <Search size={14} aria-hidden="true" />
          <input
            ref={searchInputRef}
            className="session-search__input"
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
            placeholder={t('Search sessions and messages')}
            aria-label={t('Search sessions and messages')}
          />
          {searchLoading ? <LoaderCircle className="session-search__loading" size={14} aria-hidden="true" /> : null}
        </div>

        {searchQuery.trim() && searchHits.length > 0 ? (
          <div className="session-search__results" role="listbox" aria-label={t('Message matches')}>
            {searchHits.slice(0, 80).map((hit, index) => (
              <button
                type="button"
                className="session-search__result"
                key={`${hit.sessionId}:${String(hit.messageIndex)}:${String(hit.occurrence)}:${String(index)}`}
                onClick={() => onOpenSearchHit(hit)}
              >
                <span className="session-search__result-title">{hit.title}</span>
                <span className="session-search__result-snippet">{renderSearchSnippet(hit, searchQuery)}</span>
              </button>
            ))}
          </div>
        ) : null}

        {filteredSessions.length === 0 && searchHits.length === 0 ? <div className="dialog__empty">{t('No sessions')}</div> : null}

        <div className="dialog__list" ref={listRef} role="listbox" aria-label="sessions">
          {filteredSessions.map((session, index) => {
            const selected = index === selectedIndex
            return (
              <div
                key={session.id}
                className={`dialog__item dialog__item--session${selected ? ' is-selected' : ''}`}
                data-index={index}
                onMouseEnter={() => setSelectedIndex(index)}
                onContextMenu={(e) => {
                  if (!onDeleteSessionId) {
                    return
                  }
                  e.preventDefault()

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
                  <span className="dialog__itemMeta">{formatSessionUpdated(session.updated, t('Unknown time'))}</span>
                </button>
                {onDeleteSessionId ? (
                  <button
                    type="button"
                    className="dialog__itemDelete"
                    aria-label={`${t('Delete session')}: ${session.title}`}
                    title={t('Delete session')}
                    onClick={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      setContextMenu(null)
                      setDeleteCandidate(session)
                    }}
                  >
                    <Trash2 className="dialog__itemDeleteIcon" size={14} aria-hidden="true" />
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
                const session = sessions.find((candidate) => candidate.id === contextMenu.id)
                setContextMenu(null)
                if (session) {
                  setDeleteCandidate(session)
                }
              }}
            >
              {t('Delete')}
            </button>
            <button type="button" className="context-menu__item" onClick={() => setContextMenu(null)}>
              {t('Cancel')}
            </button>
          </div>
        ) : null}
      </div>

      {deleteCandidate ? (
        <div className="delete-confirm">
          <button
            type="button"
            className="delete-confirm__backdrop"
            tabIndex={-1}
            aria-label={t('Cancel session deletion')}
            onClick={() => setDeleteCandidate(null)}
          />
          <div
            className="delete-confirm__dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-session-title"
            aria-describedby="delete-session-description"
            onKeyDown={(event) => {
              if (event.key !== 'Tab') {
                return
              }
              const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not([disabled])'))
              const focusedIndex = buttons.indexOf(document.activeElement as HTMLButtonElement)
              const nextIndex = event.shiftKey
                ? (focusedIndex <= 0 ? buttons.length - 1 : focusedIndex - 1)
                : (focusedIndex >= buttons.length - 1 ? 0 : focusedIndex + 1)
              event.preventDefault()
              buttons[nextIndex]?.focus()
            }}
          >
            <div className="delete-confirm__body">
              <h2 id="delete-session-title" className="delete-confirm__title">{t('Delete session?')}</h2>
              <p id="delete-session-description" className="delete-confirm__message">
                {t('This session will be permanently deleted. This action cannot be undone.')}
                <span className="delete-confirm__session">{deleteCandidate.title}</span>
              </p>
            </div>
            <div className="delete-confirm__actions">
              <button
                ref={cancelDeleteButtonRef}
                type="button"
                className="delete-confirm__button"
                onClick={() => setDeleteCandidate(null)}
              >
                {t('Cancel')}
              </button>
              <button
                type="button"
                className="delete-confirm__button delete-confirm__button--danger"
                onClick={() => {
                  const id = deleteCandidate.id
                  setDeleteCandidate(null)
                  onDeleteSessionId?.(id)
                }}
              >
                {t('Delete')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
