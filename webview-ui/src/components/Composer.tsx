type ComposerProps = {
  value: string
  onChange: (next: string) => void
  onSend: () => void
  onStop: () => void
  isRunning: boolean
  disabled: boolean
}

export function Composer({ value, onChange, onSend, onStop, isRunning, disabled }: ComposerProps) {
  return (
    <div className="composer">
      <textarea
        className="composer__input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="输入消息。Enter 发送，Shift+Enter 换行。"
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
          Send
        </button>
        <button type="button" onClick={onStop} disabled={!isRunning}>
          Stop
        </button>
      </div>
    </div>
  )
}
