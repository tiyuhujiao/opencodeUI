import { useI18n } from '../i18n'

type ComposerProps = {
  value: string
  onChange: (next: string) => void
  onSend: () => void
  onStop: () => void
  isRunning: boolean
  disabled: boolean
}

export function Composer({ value, onChange, onSend, onStop, isRunning, disabled }: ComposerProps) {
  const { t } = useI18n()
  return (
    <div className="composer">
      <textarea
        className="composer__input"
        aria-label={t('Message composer')}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={t('Type a message...')}
        rows={4}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.shiftKey) {
            return
          }

          event.preventDefault()

          // OpenCode TUI behavior: when the last char is a backslash, treat Enter as newline.
          // This complements Shift+Enter (web convention) without breaking it.
          if (value.length > 0 && value[value.length - 1] === '\\') {
            onChange(`${value.slice(0, -1)}\n`)
            return
          }

          if (!disabled && value.trim().length > 0 && !isRunning) {
            onSend()
          }
        }}
      />

      <div className="composer__actions">
        <button
          type="button"
          onClick={onSend}
          disabled={disabled || isRunning || value.trim().length === 0}
        >
          {t('Send')}
        </button>
        <button type="button" onClick={onStop} disabled={!isRunning}>
          {t('Stop')}
        </button>
      </div>
    </div>
  )
}
