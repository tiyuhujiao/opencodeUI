import type { SessionTimelineItem } from '../../../../src/shared/protocol'
import { useI18n } from '../../i18n'

type TimelineDialogProps = {
  open: boolean
  items: SessionTimelineItem[]
  revertMessageId: string | null
  loading: boolean
  error: string | null
  onClose: () => void
}

function formatWhen(value: number, locale: string, unknownLabel: string): string {
  if (!Number.isFinite(value) || value <= 0) {
    return unknownLabel
  }
  return new Date(value).toLocaleString(locale)
}

function clip(text: string, empty: string): string {
  const normalized = text.trim().replace(/\s+/g, ' ')
  if (!normalized) {
    return empty
  }
  return normalized.length > 140 ? `${normalized.slice(0, 140)}…` : normalized
}

export function TimelineDialog({ open, items, revertMessageId, loading, error, onClose }: TimelineDialogProps) {
  const { language, t } = useI18n()
  if (!open) {
    return null
  }

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={t('Session Timeline')}>
      <button type="button" className="overlay__backdrop" onClick={onClose} aria-label={t('Close')} />
      <div className="dialog dialog--wide">
        <header className="dialog__header">
          <div className="dialog__title">{t('Session Timeline')}</div>
        </header>

        {loading ? <div className="dialog__empty">{t('Loading timeline...')}</div> : null}
        {error ? <div className="dialog__error">{t(error)}</div> : null}
        {!loading && !error && items.length === 0 ? <div className="dialog__empty">{t('No timeline yet')}</div> : null}

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
                    <div className="timeline-item__time">{formatWhen(item.created, language, t('Unknown time'))}</div>
                    {isReverted ? <div className="timeline-item__badge">{t('Undo here')}</div> : null}
                  </div>
                  <div className="timeline-item__user">{clip(item.text, t('Empty user turn'))}</div>
                  <div className="timeline-item__assistant">{clip(item.assistantText, t('No assistant text'))}</div>
                  <div className="timeline-item__meta">
                    {t('tools')} {item.toolCount} · {t('thinking')} {item.reasoningCount} · {t('steps')} {item.stepCount}
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
