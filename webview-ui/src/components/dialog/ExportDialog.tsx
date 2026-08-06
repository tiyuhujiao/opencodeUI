import { useEffect, useRef, useState } from 'react'
import { FileText, X } from 'lucide-react'
import { useI18n } from '../../i18n'

export type SessionExportOptions = {
  filename: string
  includeThinking: boolean
  includeToolDetails: boolean
  includeAssistantMetadata: boolean
  openWithoutSaving: boolean
}

type ExportDialogProps = {
  open: boolean
  defaultFilename: string
  busy: boolean
  error: string | null
  onClose: () => void
  onConfirm: (options: SessionExportOptions) => void
}

export function ExportDialog({ open, defaultFilename, busy, error, onClose, onConfirm }: ExportDialogProps) {
  const { t } = useI18n()
  const filenameRef = useRef<HTMLInputElement | null>(null)
  const [filename, setFilename] = useState(defaultFilename)
  const [includeThinking, setIncludeThinking] = useState(true)
  const [includeToolDetails, setIncludeToolDetails] = useState(true)
  const [includeAssistantMetadata, setIncludeAssistantMetadata] = useState(true)
  const [openWithoutSaving, setOpenWithoutSaving] = useState(false)

  useEffect(() => {
    if (!open) {
      return
    }
    setFilename(defaultFilename)
    setIncludeThinking(true)
    setIncludeToolDetails(true)
    setIncludeAssistantMetadata(true)
    setOpenWithoutSaving(false)
    window.requestAnimationFrame(() => filenameRef.current?.focus())
  }, [defaultFilename, open])

  useEffect(() => {
    if (!open) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [busy, onClose, open])

  if (!open) {
    return null
  }

  const canSubmit = openWithoutSaving || filename.trim().length > 0

  return (
    <div className="modal-backdrop export-dialog__backdrop" role="presentation">
      <section
        className="export-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-dialog-title"
      >
        <header className="export-dialog__header">
          <div className="export-dialog__heading">
            <span className="export-dialog__icon" aria-hidden="true"><FileText size={16} /></span>
            <div>
              <h2 id="export-dialog-title">{t('Export session')}</h2>
              <p>{t('Markdown transcript')}</p>
            </div>
          </div>
          <button type="button" className="export-dialog__close" onClick={onClose} disabled={busy} aria-label={t('Close export dialog')} title={t('Close')}>
            <X size={16} aria-hidden="true" />
          </button>
        </header>

        <form className="export-dialog__form" onSubmit={(event) => {
          event.preventDefault()
          if (!canSubmit || busy) {
            return
          }
          onConfirm({ filename: filename.trim(), includeThinking, includeToolDetails, includeAssistantMetadata, openWithoutSaving })
        }}>
          <label className="settings-field" htmlFor="export-filename">
            <span className="settings-field__label">{t('Filename')}</span>
            <input
              ref={filenameRef}
              id="export-filename"
              value={filename}
              onChange={(event) => setFilename(event.target.value)}
              disabled={busy || openWithoutSaving}
              placeholder="session.md"
              autoComplete="off"
            />
          </label>

          <fieldset className="export-dialog__options">
            <legend className="export-dialog__options-title">{t('Export options')}</legend>
            <ExportOption checked={includeThinking} onChange={setIncludeThinking} label="Include thinking" disabled={busy} />
            <ExportOption checked={includeToolDetails} onChange={setIncludeToolDetails} label="Include tool details" disabled={busy} />
            <ExportOption checked={includeAssistantMetadata} onChange={setIncludeAssistantMetadata} label="Include assistant metadata" disabled={busy} />
            <ExportOption checked={openWithoutSaving} onChange={setOpenWithoutSaving} label="Open without saving" disabled={busy} />
          </fieldset>

          {error ? <p className="export-dialog__error" role="alert">{t(error)}</p> : null}

          <footer className="export-dialog__actions">
            <button type="button" className="button-secondary" onClick={onClose} disabled={busy}>{t('Cancel')}</button>
            <button type="submit" className="button-primary" disabled={!canSubmit || busy}>
              {busy ? t('Exporting') : openWithoutSaving ? t('Open') : t('Export')}
            </button>
          </footer>
        </form>
      </section>
    </div>
  )
}

function ExportOption({ checked, onChange, label, disabled }: { checked: boolean; onChange: (value: boolean) => void; label: string; disabled: boolean }) {
  const { t } = useI18n()
  return (
    <label className="export-option">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} disabled={disabled} />
      <span>{t(label)}</span>
    </label>
  )
}
