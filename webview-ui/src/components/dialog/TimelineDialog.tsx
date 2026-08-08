import type { SessionTimelineItem } from '../../../../src/shared/protocol'
import { LoaderCircle, Undo2 } from 'lucide-react'
import { useI18n } from '../../i18n'

type TimelineDialogProps = {
  open: boolean
  items: SessionTimelineItem[]
  revertMessageId: string | null
  loading: boolean
  error: string | null
  revertingMessageId: string | null
  disabled: boolean
  onRevert: (messageId: string) => void
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

export function TimelineDialog({
  open,
  items,
  revertMessageId,
  loading,
  error,
  revertingMessageId,
  disabled,
  onRevert,
  onClose
}: TimelineDialogProps) {
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
              const isReverting = revertingMessageId === item.messageId
              const itemDisabled = disabled || isReverted || revertingMessageId !== null
              return (
                <li key={item.messageId} className="timeline-list__item">
                  <button
                    type="button"
                    className={`timeline-item${isReverted ? ' is-reverted' : ''}${isReverting ? ' is-reverting' : ''}`}
                    onClick={() => onRevert(item.messageId)}
                    disabled={itemDisabled}
                    aria-current={isReverted ? 'step' : undefined}
                    aria-label={t('Undo to this message: {message}', { message: clip(item.text, t('Empty user turn')) })}
                    title={isReverted ? t('Current undo point') : t('Undo to this message')}
                  >
                    <span className="timeline-item__head">
                      <span className="timeline-item__index">#{index + 1}</span>
                      <span className="timeline-item__time">{formatWhen(item.created, language, t('Unknown time'))}</span>
                      {isReverted ? <span className="timeline-item__badge">{t('Undo here')}</span> : null}
                      <span className="timeline-item__action" aria-hidden="true">
                        {isReverting ? <LoaderCircle size={14} /> : <Undo2 size={14} />}
                      </span>
                    </span>
                    <span className="timeline-item__user">{clip(item.text, t('Empty user turn'))}</span>
                    <span className="timeline-item__assistant">{clip(item.assistantText, t('No assistant text'))}</span>
                    <span className="timeline-item__meta">
                      {t('tools')} {item.toolCount} · {t('thinking')} {item.reasoningCount} · {t('steps')} {item.stepCount}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        ) : null}
      </div>
    </div>
  )
}
