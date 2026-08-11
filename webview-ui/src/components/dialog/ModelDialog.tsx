import { useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import type { ModelSummary, ProviderSummary } from '../../../../src/shared/protocol'
import { useI18n } from '../../i18n'

type ModelDialogProps = {
  open: boolean
  providers: ProviderSummary[]
  selectedProviderId: string
  setSelectedProviderId: (id: string) => void
  models: ModelSummary[]
  loadingModels: boolean
  loadingProviders: boolean
  modelsError: string | null
  onRefresh: () => void
  onSelectModel: (modelName: string) => void
  onClose: () => void
}

export function ModelDialog({
  open,
  providers,
  selectedProviderId,
  setSelectedProviderId,
  models,
  loadingModels,
  loadingProviders,
  modelsError,
  onRefresh,
  onSelectModel,
  onClose
}: ModelDialogProps) {
  const { t } = useI18n()
  const [selectedIndex, setSelectedIndex] = useState(0)
  const listRef = useRef<HTMLDivElement | null>(null)

  const providerIndex = useMemo(() => {
    return Math.max(
      0,
      providers.findIndex((provider) => provider.id === selectedProviderId)
    )
  }, [providers, selectedProviderId])

  useEffect(() => {
    if (!open) {
      return
    }
    setSelectedIndex(0)
  }, [open])

  useEffect(() => {
    if (!open) {
      return
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }

      if (providers.length > 0 && (event.key === 'ArrowLeft' || event.key === 'h')) {
        event.preventDefault()
        const nextIndex = providerIndex <= 0 ? providers.length - 1 : providerIndex - 1
        setSelectedProviderId(providers[nextIndex]?.id ?? '')
        return
      }

      if (providers.length > 0 && (event.key === 'ArrowRight' || event.key === 'l')) {
        event.preventDefault()
        const nextIndex = providerIndex >= providers.length - 1 ? 0 : providerIndex + 1
        setSelectedProviderId(providers[nextIndex]?.id ?? '')
        return
      }

      if (models.length > 0 && (event.key === 'ArrowUp' || event.key === 'k')) {
        event.preventDefault()
        setSelectedIndex((current) => (current <= 0 ? models.length - 1 : current - 1))
        return
      }

      if (models.length > 0 && (event.key === 'ArrowDown' || event.key === 'j')) {
        event.preventDefault()
        setSelectedIndex((current) => (current >= models.length - 1 ? 0 : current + 1))
        return
      }

      if (event.key === 'Enter') {
        const model = models[selectedIndex]
        if (!model) {
          return
        }
        event.preventDefault()
        onSelectModel(model.name)
        onClose()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [models, onClose, onSelectModel, providerIndex, providers, selectedIndex, setSelectedProviderId, open])

  useEffect(() => {
    if (!open) {
      return
    }

    const el = listRef.current
    if (!el) {
      return
    }
    const row = el.querySelector<HTMLButtonElement>(`button[data-index="${String(selectedIndex)}"]`)
    row?.scrollIntoView({ block: 'nearest' })
  }, [open, selectedIndex])

  if (!open) {
    return null
  }

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={t('Select Model')}>
      <button type="button" className="overlay__backdrop" onClick={onClose} aria-label={t('Close')} />
      <div className="dialog">
        <header className="dialog__header">
          <div className="dialog__title">{t('Select Model')}</div>
          <button
            type="button"
            className="dialog__secondary"
            onClick={onRefresh}
            disabled={loadingModels || loadingProviders}
          >
            <RefreshCw size={13} aria-hidden="true" />
            {loadingModels || loadingProviders ? t('Refreshing') : t('Refresh')}
          </button>
        </header>

        <div className="dialog__row">
          <div className="dialog__label">{t('Provider')}</div>
          <div className="dialog__value">
            <select
              className="dialog__select"
              value={selectedProviderId}
              onChange={(event) => setSelectedProviderId(event.target.value)}
              aria-label={t('Provider')}
            >
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {modelsError ? <div className="dialog__error">{t(modelsError)}</div> : null}
        {loadingModels ? <div className="dialog__empty">{t('Loading models...')}</div> : null}

        {!loadingModels && models.length === 0 && !modelsError ? (
          <div className="dialog__empty">{t('No models')}</div>
        ) : null}

        <div className="dialog__list" ref={listRef} role="listbox" aria-label={t('Models')}>
          {models.map((model, index) => {
            const selected = index === selectedIndex
            return (
              <button
                type="button"
                key={model.name}
                className={`dialog__item ${selected ? 'is-selected' : ''}`}
                data-index={index}
                onMouseEnter={() => setSelectedIndex(index)}
                onClick={() => {
                  onSelectModel(model.name)
                  onClose()
                }}
                role="option"
                aria-selected={selected}
              >
                {model.name}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
