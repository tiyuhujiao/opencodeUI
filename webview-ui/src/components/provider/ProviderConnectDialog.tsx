import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  ArrowLeft,
  Check,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  LogOut,
  ShieldCheck,
  X
} from 'lucide-react'
import type {
  ProviderAuthAuthorization,
  ProviderSettingsAuthMethod,
  ProviderSettingsAuthPrompt,
  ProviderSettingsCatalogEntry
} from '../../../../src/shared/protocol'
import { useI18n } from '../../i18n'

export type ProviderAuthBusy = 'api' | 'authorize' | 'callback' | 'disconnect' | null

export type ProviderAuthFlow = {
  entry: ProviderSettingsCatalogEntry
  methodIndex: number | null
  authorization: ProviderAuthAuthorization | null
  busy: ProviderAuthBusy
  openingUrl: boolean
  error: string | null
}

type ProviderConnectDialogProps = {
  flow: ProviderAuthFlow
  onClose: () => void
  onSelectMethod: (methodIndex: number | null) => void
  onApiConnect: (methodIndex: number, key: string, metadata: Record<string, string>) => void
  onAuthorize: (methodIndex: number, inputs: Record<string, string>) => void
  onCallback: (code?: string) => void
  onOpenExternal: () => void
  onDisconnect: () => void
  onAdvanced: () => void
}

const FALLBACK_API_METHOD: ProviderSettingsAuthMethod = {
  type: 'api',
  label: 'API key',
  prompts: []
}

export function ProviderConnectDialog({
  flow,
  onClose,
  onSelectMethod,
  onApiConnect,
  onAuthorize,
  onCallback,
  onOpenExternal,
  onDisconnect,
  onAdvanced
}: ProviderConnectDialogProps) {
  const { t } = useI18n()
  const dialogRef = useRef<HTMLElement>(null)
  const methods = flow.entry.authMethods.length > 0 ? flow.entry.authMethods : [FALLBACK_API_METHOD]
  const method = flow.methodIndex === null ? null : methods[flow.methodIndex]
  const busy = flow.busy !== null

  useEffect(() => {
    dialogRef.current?.focus({ preventScroll: true })
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="provider-settings__overlay provider-connect-overlay" role="presentation">
      <section
        ref={dialogRef}
        className="provider-connect"
        role="dialog"
        aria-modal="true"
        aria-labelledby="provider-connect-title"
        tabIndex={-1}
      >
        <header className="provider-connect__header">
          <div className="provider-connect__title">
            {flow.methodIndex !== null && methods.length > 1 && !flow.authorization ? (
              <button
                type="button"
                className="provider-settings__icon-button"
                onClick={() => onSelectMethod(null)}
                disabled={busy}
                aria-label={t('Back to sign-in methods')}
                title={t('Back to sign-in methods')}
              >
                <ArrowLeft size={15} aria-hidden="true" />
              </button>
            ) : (
              <span className="provider-connect__mark" aria-hidden="true">
                <ShieldCheck size={17} />
              </span>
            )}
            <div>
              <h2 id="provider-connect-title">{flow.entry.label}</h2>
              <span>{flow.entry.id}</span>
            </div>
          </div>
          <button
            type="button"
            className="provider-settings__icon-button"
            onClick={onClose}
            aria-label={t('Close provider connection')}
            title={t('Close')}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </header>

        <div className="provider-connect__body">
          <ConnectionSummary entry={flow.entry} />
          {flow.error ? <div className="provider-settings__banner is-error" role="alert">{t(flow.error)}</div> : null}

          {flow.authorization ? (
            <OAuthAuthorizationView
              authorization={flow.authorization}
              method={method}
              busy={flow.busy === 'callback'}
              openingUrl={flow.openingUrl}
              onOpenExternal={onOpenExternal}
              onCallback={onCallback}
            />
          ) : method?.type === 'api' && flow.methodIndex !== null ? (
            <ApiKeyView
              key={`${flow.entry.id}:${String(flow.methodIndex)}`}
              method={method}
              busy={flow.busy === 'api'}
              onSubmit={(key, metadata) => onApiConnect(flow.methodIndex!, key, metadata)}
            />
          ) : method?.type === 'oauth' && flow.methodIndex !== null ? (
            <OAuthStartView
              key={`${flow.entry.id}:${String(flow.methodIndex)}`}
              method={method}
              busy={flow.busy === 'authorize'}
              onSubmit={(inputs) => onAuthorize(flow.methodIndex!, inputs)}
            />
          ) : (
            <MethodPicker
              methods={methods}
              providerName={flow.entry.label}
              disabled={busy}
              onSelect={onSelectMethod}
            />
          )}
        </div>

        <footer className="provider-connect__footer">
          <button type="button" className="provider-connect__text-action" onClick={onAdvanced} disabled={busy}>
            {t('Advanced configuration')}
          </button>
          {flow.entry.credentialType ? (
            <button
              type="button"
              className="provider-connect__disconnect"
              onClick={onDisconnect}
              disabled={busy}
            >
              {flow.busy === 'disconnect' ? <LoaderCircle className="is-spinning" size={14} /> : <LogOut size={14} />}
              {t('Disconnect')}
            </button>
          ) : null}
        </footer>
      </section>
    </div>
  )
}

function ConnectionSummary({ entry }: { entry: ProviderSettingsCatalogEntry }) {
  const { t } = useI18n()
  if (!entry.connected) {
    return <p className="provider-connect__intro">{t('Connect this built-in provider without adding a provider block to opencode.json.')}</p>
  }
  const source = entry.credentialType === 'oauth'
    ? t('Signed in with a subscription account')
    : entry.credentialType === 'api'
      ? t('Connected with an OpenCode-stored API key')
      : t('Connected through your environment or configuration')
  return (
    <div className="provider-connect__connected">
      <span aria-hidden="true"><Check size={13} /></span>
      <div><strong>{t('Connected')}</strong><small>{source}</small></div>
    </div>
  )
}

function MethodPicker({
  methods,
  providerName,
  disabled,
  onSelect
}: {
  methods: ProviderSettingsAuthMethod[]
  providerName: string
  disabled: boolean
  onSelect: (methodIndex: number) => void
}) {
  const { t } = useI18n()
  return (
    <div className="provider-connect__methods">
      <div>
        <strong>{t('Connect {provider}', { provider: providerName })}</strong>
        <span>{t('Choose the sign-in method provided by OpenCode.')}</span>
      </div>
      <div className="provider-connect__method-list">
        {methods.map((method, index) => (
          <button
            key={`${method.type}:${method.label}:${String(index)}`}
            type="button"
            onClick={() => onSelect(index)}
            disabled={disabled}
          >
            <span className={`provider-connect__method-icon is-${method.type}`} aria-hidden="true">
              {method.type === 'oauth' ? <ExternalLink size={15} /> : <KeyRound size={15} />}
            </span>
            <span><strong>{method.label}</strong><small>{method.type === 'oauth' ? t('Browser sign-in') : t('Secure API key')}</small></span>
            <span className={`provider-connect__method-tag is-${method.type}`}>{method.type === 'oauth' ? 'OAuth' : 'Key'}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function ApiKeyView({
  method,
  busy,
  onSubmit
}: {
  method: ProviderSettingsAuthMethod
  busy: boolean
  onSubmit: (key: string, metadata: Record<string, string>) => void
}) {
  const { t } = useI18n()
  const [key, setKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [inputs, setInputs] = useState<Record<string, string>>({})
  const keyInputRef = useRef<HTMLInputElement>(null)
  const visiblePrompts = useVisiblePrompts(method.prompts, inputs)
  const ready = key.trim().length > 0 && promptsComplete(visiblePrompts, inputs)

  useEffect(() => {
    keyInputRef.current?.focus({ preventScroll: true })
  }, [])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (ready && !busy) {
      onSubmit(key.trim(), visibleInputValues(visiblePrompts, inputs))
    }
  }

  return (
    <form className="provider-connect__form" onSubmit={submit}>
      <div className="provider-connect__form-copy">
        <strong>{method.label}</strong>
        <span>{t('The key is stored by OpenCode and is not written to opencode.json.')}</span>
      </div>
      <AuthPromptFields prompts={visiblePrompts} values={inputs} onChange={setInputs} />
      <label className="provider-connect__field">
        <span>API key</span>
        <span className="provider-connect__secret-input">
          <input
            ref={keyInputRef}
            type={showKey ? 'text' : 'password'}
            value={key}
            onChange={(event) => setKey(event.target.value)}
            placeholder={t('Enter API key')}
            autoComplete="new-password"
            spellCheck={false}
          />
          <button
            type="button"
            onClick={() => setShowKey((current) => !current)}
            aria-label={showKey ? t('Hide API key') : t('Show API key')}
            title={showKey ? t('Hide API key') : t('Show API key')}
          >
            {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </span>
      </label>
      <button type="submit" className="provider-connect__primary" disabled={!ready || busy}>
        {busy ? <LoaderCircle className="is-spinning" size={15} /> : <KeyRound size={15} />}
        {busy ? t('Connecting') : t('Connect')}
      </button>
    </form>
  )
}

function OAuthStartView({
  method,
  busy,
  onSubmit
}: {
  method: ProviderSettingsAuthMethod
  busy: boolean
  onSubmit: (inputs: Record<string, string>) => void
}) {
  const { t } = useI18n()
  const [inputs, setInputs] = useState<Record<string, string>>({})
  const visiblePrompts = useVisiblePrompts(method.prompts, inputs)
  const ready = promptsComplete(visiblePrompts, inputs)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (ready && !busy) {
      onSubmit(visibleInputValues(visiblePrompts, inputs))
    }
  }

  return (
    <form className="provider-connect__form" onSubmit={submit}>
      <div className="provider-connect__form-copy">
        <strong>{method.label}</strong>
        <span>{t('OpenCode will open your browser and securely store the resulting login.')}</span>
      </div>
      <AuthPromptFields prompts={visiblePrompts} values={inputs} onChange={setInputs} />
      <button type="submit" className="provider-connect__primary" disabled={!ready || busy}>
        {busy ? <LoaderCircle className="is-spinning" size={15} /> : <ExternalLink size={15} />}
        {busy ? t('Opening browser') : t('Continue in browser')}
      </button>
    </form>
  )
}

function OAuthAuthorizationView({
  authorization,
  method,
  busy,
  openingUrl,
  onOpenExternal,
  onCallback
}: {
  authorization: ProviderAuthAuthorization
  method: ProviderSettingsAuthMethod | null
  busy: boolean
  openingUrl: boolean
  onOpenExternal: () => void
  onCallback: (code?: string) => void
}) {
  const { t } = useI18n()
  const [code, setCode] = useState('')
  const [copied, setCopied] = useState(false)
  const codeInputRef = useRef<HTMLInputElement>(null)
  const confirmationCode = useMemo(() => extractConfirmationCode(authorization.instructions), [authorization.instructions])

  useEffect(() => {
    if (authorization.method === 'code') {
      codeInputRef.current?.focus({ preventScroll: true })
    }
  }, [authorization.method])

  const copyCode = async () => {
    if (!confirmationCode) {
      return
    }
    await navigator.clipboard.writeText(confirmationCode)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1400)
  }

  if (authorization.method === 'code') {
    return (
      <form
        className="provider-connect__form"
        onSubmit={(event) => {
          event.preventDefault()
          if (code.trim() && !busy) {
            onCallback(code.trim())
          }
        }}
      >
        <div className="provider-connect__form-copy">
          <strong>{t('Finish {method}', { method: method?.label ?? t('browser sign-in') })}</strong>
          <span>{authorization.instructions || t('Complete the browser flow, then paste the authorization code below.')}</span>
        </div>
        <button type="button" className="provider-connect__link-button" onClick={onOpenExternal} disabled={openingUrl}>
          {openingUrl ? <LoaderCircle className="is-spinning" size={14} /> : <ExternalLink size={14} />}
          {t('Open authorization page')}
        </button>
        <label className="provider-connect__field">
          <span>{t('Authorization code')}</span>
          <input
            ref={codeInputRef}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder={t('Paste authorization code')}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <button type="submit" className="provider-connect__primary" disabled={!code.trim() || busy}>
          {busy ? <LoaderCircle className="is-spinning" size={15} /> : <Check size={15} />}
          {busy ? t('Verifying') : t('Complete sign-in')}
        </button>
      </form>
    )
  }

  return (
    <div className="provider-connect__waiting">
      <div className="provider-connect__form-copy">
        <strong>{t('Waiting for browser authorization')}</strong>
        <span>{authorization.instructions || t('Complete the sign-in flow in your browser.')}</span>
      </div>
      {confirmationCode ? (
        <div className="provider-connect__device-code">
          <span>{t('Confirmation code')}</span>
          <strong>{confirmationCode}</strong>
          <button type="button" onClick={() => void copyCode()} aria-label={t('Copy confirmation code')} title={t('Copy confirmation code')}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
        </div>
      ) : null}
      <button type="button" className="provider-connect__link-button" onClick={onOpenExternal} disabled={openingUrl}>
        {openingUrl ? <LoaderCircle className="is-spinning" size={14} /> : <ExternalLink size={14} />}
        {t('Open browser again')}
      </button>
      {busy ? (
        <output className="provider-connect__pending" aria-live="polite">
          <LoaderCircle className="is-spinning" size={16} />
          <span>{t('Waiting for authorization')}</span>
        </output>
      ) : (
        <button type="button" className="provider-connect__primary" onClick={() => onCallback()}>
          <Check size={15} />
          {t('Check authorization')}
        </button>
      )}
    </div>
  )
}

function AuthPromptFields({
  prompts,
  values,
  onChange
}: {
  prompts: ProviderSettingsAuthPrompt[]
  values: Record<string, string>
  onChange: (values: Record<string, string>) => void
}) {
  return (
    <>
      {prompts.map((prompt) => (
        <AuthPromptField key={prompt.key} prompt={prompt} values={values} onChange={onChange} />
      ))}
    </>
  )
}

function AuthPromptField({
  prompt,
  values,
  onChange
}: {
  prompt: ProviderSettingsAuthPrompt
  values: Record<string, string>
  onChange: (values: Record<string, string>) => void
}) {
  const { t } = useI18n()
  const inputId = useId()
  return (
    <label htmlFor={inputId} className="provider-connect__field">
      <span>{prompt.message}</span>
      {prompt.type === 'select' ? (
        <select
          id={inputId}
          value={values[prompt.key] ?? ''}
          onChange={(event) => onChange({ ...values, [prompt.key]: event.target.value })}
        >
          <option value="">{t('Select an option')}</option>
          {prompt.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}{option.hint ? ` - ${option.hint}` : ''}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={inputId}
          value={values[prompt.key] ?? ''}
          onChange={(event) => onChange({ ...values, [prompt.key]: event.target.value })}
          placeholder={prompt.placeholder}
          spellCheck={false}
        />
      )}
    </label>
  )
}

function useVisiblePrompts(prompts: ProviderSettingsAuthPrompt[], values: Record<string, string>) {
  return useMemo(
    () => prompts.filter((prompt) => {
      if (!prompt.when) {
        return true
      }
      const actual = values[prompt.when.key]
      if (actual === undefined) {
        return false
      }
      return prompt.when.op === 'eq' ? actual === prompt.when.value : actual !== prompt.when.value
    }),
    [prompts, values]
  )
}

function promptsComplete(prompts: ProviderSettingsAuthPrompt[], values: Record<string, string>) {
  return prompts.every((prompt) => (values[prompt.key] ?? '').trim().length > 0)
}

function visibleInputValues(prompts: ProviderSettingsAuthPrompt[], values: Record<string, string>) {
  return Object.fromEntries(prompts.map((prompt) => [prompt.key, (values[prompt.key] ?? '').trim()]))
}

function extractConfirmationCode(instructions: string): string {
  const match = instructions.match(/(?:code\s*:\s*|enter\s+)([A-Z0-9][A-Z0-9-]{3,})/i)
  return match?.[1] ?? ''
}
