import type { SessionTimelineItem } from '../../../../src/shared/protocol'

type TimelineDialogProps = {
  open: boolean
  items: SessionTimelineItem[]
  revertMessageId: string | null
  loading: boolean
  error: string | null
  onClose: () => void
}

function formatWhen(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return 'Unknown time'
  }
  return new Date(value).toLocaleString()
}

function clip(text: string, empty: string): string {
  const normalized = text.trim().replace(/\s+/g, ' ')
  if (!normalized) {
    return empty
  }
  return normalized.length > 140 ? `${normalized.slice(0, 140)}…` : normalized
}

export function TimelineDialog({ open, items, revertMessageId, loading, error, onClose }: TimelineDialogProps) {
  if (!open) {
    return null
  }

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="timeline dialog">
      <button type="button" className="overlay__backdrop" onClick={onClose} aria-label="close" />
      <div className="dialog dialog--wide">
        <header className="dialog__header">
          <div className="dialog__title">Session Timeline</div>
        </header>

        {loading ? <div className="dialog__empty">Loading timeline…</div> : null}
        {error ? <div className="dialog__error">{error}</div> : null}
        {!loading && !error && items.length === 0 ? <div className="dialog__empty">No timeline yet</div> : null}

        {!loading && !error ? (
          <ul className="timeline-list">
            {items.map((item, index) => {
              const isReverted = revertMessageId === item.messageId
              return (
                <li
                  key={item.messageId}
                  className={`timeline-item${isReverted ? ' is-reverted' : ''}`}
                >
                  <div className="timeline-item__head">
                    <div className="timeline-item__index">#{index + 1}</div>
                    <div className="timeline-item__time">{formatWhen(item.created)}</div>
                    {isReverted ? <div className="timeline-item__badge">Undo here</div> : null}
                  </div>
                  <div className="timeline-item__user">{clip(item.text, 'Empty user turn')}</div>
                  <div className="timeline-item__assistant">{clip(item.assistantText, 'No assistant text')}</div>
                  <div className="timeline-item__meta">
                    tools {item.toolCount} · thinking {item.reasoningCount} · steps {item.stepCount}
                  </div>
                </li>
              )
            })}
          </ul>
        ) : null}
      </div>
    </div>
  )
}
