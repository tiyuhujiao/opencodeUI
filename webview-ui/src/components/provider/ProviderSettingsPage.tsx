import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode
} from 'react'
import {
  ArrowLeft,
  Brain,
  Braces,
  Check,
  ChevronRight,
  CloudDownload,
  Copy,
  FileJson,
  KeyRound,
  Languages,
  ListPlus,
  LoaderCircle,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings2,
  SlidersHorizontal,
  Trash2,
  X
} from 'lucide-react'
import {
  isExtensionResponseMessage,
  type ProviderSettingsCatalogEntry,
  type ProviderSettingsCatalogModel,
  type ProviderSettingsDraft,
  type ProviderSettingsHeader,
  type ProviderSettingsModelDraft,
  type ProviderSettingsScope,
  type ProviderSettingsSnapshot,
  type ProviderUpstreamModel
} from '../../../../src/shared/protocol'
import {
  addEditableJsonEntry,
  cloneProviderDraft,
  createEmptyProviderDraft,
  createEmptyProviderModelDraft,
  defaultUpstreamModelsEndpoint,
  duplicateProviderModelDraft,
  formatEditableJsonObject,
  getModelThinkingAvailability,
  getOrderedThinkingVariantEntries,
  linesToList,
  listToLines,
  nextEditableJsonKey,
  parseEditableJsonObject,
  providerModelDraftFromUpstream,
  providerDraftFromCatalog,
  removeEditableJsonEntry,
  renameEditableJsonEntry,
  renameThinkingLevelEntry,
  setEditableJsonProperty,
  setNestedEditableJsonProperty,
  supportsOpenAiServiceTier
} from '../../providerSettings'
import { createRequestId, getVsCodeApi } from '../../vscodeApi'
import { useI18n } from '../../i18n'
import {
  ProviderConnectDialog,
  type ProviderAuthFlow
} from './ProviderConnectDialog'
import './providerSettings.css'

type ProviderSettingsPageProps = {
  onClose: () => void
  onCatalogChanged: () => void
}

type SettingsView = 'quick' | 'models' | 'advanced'

type PendingRequest =
  | { kind: 'get'; scope: ProviderSettingsScope; preferredId?: string }
  | { kind: 'models'; providerId: string }
  | { kind: 'upstream-models'; providerId: string }
  | { kind: 'save'; providerId: string }
  | { kind: 'delete'; providerId: string }
  | { kind: 'open' }
  | { kind: 'auth-api'; providerId: string }
  | { kind: 'auth-authorize'; providerId: string; method: number }
  | { kind: 'auth-callback'; providerId: string }
  | { kind: 'auth-disconnect'; providerId: string }
  | { kind: 'auth-open-external'; url: string }

type ConfirmState = {
  title: string
  detail: string
  confirmLabel: string
  danger: boolean
}

const ADAPTER_PRESETS = [
  '@ai-sdk/openai-compatible',
  '@ai-sdk/openai',
  '@ai-sdk/anthropic',
  '@ai-sdk/google',
  '@ai-sdk/azure'
]
const MODALITIES = ['text', 'audio', 'image', 'video', 'pdf'] as const
const REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
const TEXT_VERBOSITIES = ['low', 'medium', 'high'] as const
const SERVICE_TIERS = ['auto', 'default', 'flex', 'priority'] as const
const OPENAI_INCLUDE_FIELDS = [
  'reasoning.encrypted_content',
  'file_search_call.results',
  'web_search_call.results',
  'web_search_call.action.sources',
  'message.input_image.image_url',
  'computer_call_output.output.image_url',
  'code_interpreter_call.outputs',
  'message.output_text.logprobs'
] as const

export function ProviderSettingsPage({ onClose, onCatalogChanged }: ProviderSettingsPageProps) {
  const { language, setLanguage, t } = useI18n()
  const [scope, setScope] = useState<ProviderSettingsScope>('global')
  const [snapshot, setSnapshot] = useState<ProviderSettingsSnapshot | null>(null)
  const [selectedProviderId, setSelectedProviderId] = useState('')
  const [draft, setDraft] = useState<ProviderSettingsDraft | null>(null)
  const [view, setView] = useState<SettingsView>('quick')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [openingConfig, setOpeningConfig] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  const [mobileListOnly, setMobileListOnly] = useState(true)
  const [catalogModels, setCatalogModels] = useState<Map<string, ProviderSettingsCatalogModel[]>>(new Map())
  const [loadingCatalogProvider, setLoadingCatalogProvider] = useState<string | null>(null)
  const [upstreamModels, setUpstreamModels] = useState<null | {
    providerId: string
    endpoint: string
    models: ProviderUpstreamModel[]
  }>(null)
  const [loadingUpstreamProvider, setLoadingUpstreamProvider] = useState<string | null>(null)
  const [upstreamError, setUpstreamError] = useState<string | null>(null)
  const [authFlow, setAuthFlow] = useState<ProviderAuthFlow | null>(null)

  const pendingRequestsRef = useRef<Map<string, PendingRequest>>(new Map())
  const pendingActionRef = useRef<(() => void) | null>(null)
  const baselineRef = useRef('')
  const draftRef = useRef<ProviderSettingsDraft | null>(null)
  const selectedProviderIdRef = useRef('')
  const originalModelIdsRef = useRef<Set<string>>(new Set())

  const isDirty = useMemo(
    () => Boolean(draft) && JSON.stringify(draft) !== baselineRef.current,
    [draft]
  )

  const setLoadedDraft = useCallback((next: ProviderSettingsDraft | null, selectedId: string) => {
    const cloned = next ? cloneProviderDraft(next) : null
    draftRef.current = cloned
    selectedProviderIdRef.current = selectedId
    baselineRef.current = cloned ? JSON.stringify(cloned) : ''
    originalModelIdsRef.current = new Set(cloned?.models.map((model) => model.id) ?? [])
    setUpstreamModels(null)
    setLoadingUpstreamProvider(null)
    setUpstreamError(null)
    setDraft(cloned)
    setSelectedProviderId(selectedId)
  }, [])

  const updateDraft = useCallback((next: ProviderSettingsDraft) => {
    draftRef.current = next
    setDraft(next)
  }, [])

  const applySnapshot = useCallback(
    (next: ProviderSettingsSnapshot, preferredId?: string, keepMobileDetail = false) => {
      setSnapshot(next)
      setScope(next.scope)
      const availableIds = new Set(next.catalog.map((entry) => entry.id))
      const candidate = preferredId && availableIds.has(preferredId) ? preferredId : ''
      const configured = next.configured.find((provider) => provider.id === candidate)
      const catalog = next.catalog.find((provider) => provider.id === candidate)
      setLoadedDraft(configured ?? (catalog ? providerDraftFromCatalog(catalog) : null), candidate)
      if (!keepMobileDetail) {
        setMobileListOnly(true)
      }
    },
    [setLoadedDraft]
  )

  const postRequest = useCallback((message: Record<string, unknown>, pending: PendingRequest) => {
    const vscode = getVsCodeApi()
    if (!vscode) {
      setError('Not running in VS Code')
      setLoading(false)
      return
    }
    const requestId = createRequestId()
    pendingRequestsRef.current.set(requestId, pending)
    vscode.postMessage({ ...message, requestId })
  }, [])

  const requestSnapshot = useCallback(
    (targetScope: ProviderSettingsScope, forceRefresh = false, preferredId?: string) => {
      setError(null)
      setNotice(null)
      if (forceRefresh) {
        setRefreshing(true)
      } else {
        setLoading(true)
      }
      postRequest(
        {
          type: 'provider.settings.get',
          payload: { scope: targetScope, forceRefresh }
        },
        { kind: 'get', scope: targetScope, preferredId }
      )
    },
    [postRequest]
  )

  useEffect(() => {
    requestSnapshot('global')
  }, [requestSnapshot])

  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>) => {
      const message = event.data
      if (!isExtensionResponseMessage(message)) {
        return
      }
      const pending = pendingRequestsRef.current.get(message.requestId)
      if (!pending) {
        return
      }
      pendingRequestsRef.current.delete(message.requestId)

      if (message.type === 'webview.error' && !message.ok) {
        if (
          pending.kind === 'auth-api'
          || pending.kind === 'auth-authorize'
          || pending.kind === 'auth-callback'
          || pending.kind === 'auth-disconnect'
          || pending.kind === 'auth-open-external'
        ) {
          setAuthFlow((current) => current ? {
            ...current,
            busy: pending.kind === 'auth-open-external' ? current.busy : null,
            openingUrl: false,
            error: message.error
          } : current)
          return
        }
        setError(message.error)
        if (pending.kind === 'get') {
          setLoading(false)
          setRefreshing(false)
        } else if (pending.kind === 'models') {
          setLoadingCatalogProvider(null)
        } else if (pending.kind === 'upstream-models') {
          setLoadingUpstreamProvider(null)
          setUpstreamError(message.error)
        } else if (pending.kind === 'save') {
          setSaving(false)
        } else if (pending.kind === 'delete') {
          setDeleting(false)
        } else if (pending.kind === 'open') {
          setOpeningConfig(false)
        }
        return
      }

      if (pending.kind === 'get' && message.type === 'provider.settings.get.response' && message.ok) {
        applySnapshot(message.payload, pending.preferredId)
        setLoading(false)
        setRefreshing(false)
        return
      }
      if (pending.kind === 'models' && message.type === 'provider.settings.models.response' && message.ok) {
        setCatalogModels((current) => new Map(current).set(message.payload.providerId, message.payload.models))
        setLoadingCatalogProvider(null)
        return
      }
      if (
        pending.kind === 'upstream-models'
        && message.type === 'provider.settings.upstreamModels.response'
        && message.ok
      ) {
        setUpstreamModels(message.payload)
        setLoadingUpstreamProvider(null)
        setUpstreamError(null)
        return
      }
      if (pending.kind === 'save' && message.type === 'provider.settings.save.response' && message.ok) {
        applySnapshot(message.payload, pending.providerId, true)
        setSaving(false)
        setNotice('Provider saved')
        onCatalogChanged()
        return
      }
      if (pending.kind === 'delete' && message.type === 'provider.settings.delete.response' && message.ok) {
        applySnapshot(message.payload)
        setDeleting(false)
        setNotice('Provider removed from this scope')
        onCatalogChanged()
        return
      }
      if (pending.kind === 'open' && message.type === 'provider.settings.openConfig.response' && message.ok) {
        setOpeningConfig(false)
        setNotice(`Opened ${message.payload.path}`)
        return
      }
      if (pending.kind === 'auth-authorize' && message.type === 'provider.auth.oauth.authorize.response' && message.ok) {
        const authorization = message.payload.authorization
        setAuthFlow((current) => current && current.entry.id === pending.providerId ? {
          ...current,
          methodIndex: pending.method,
          authorization,
          busy: authorization.method === 'auto' ? 'callback' : null,
          error: null
        } : current)
        if (authorization.method === 'auto') {
          postRequest(
            {
              type: 'provider.auth.oauth.callback',
              payload: { providerId: pending.providerId, method: pending.method }
            },
            { kind: 'auth-callback', providerId: pending.providerId }
          )
        }
        return
      }
      if (pending.kind === 'auth-open-external' && message.type === 'provider.auth.openExternal.response' && message.ok) {
        setAuthFlow((current) => current ? { ...current, openingUrl: false, error: null } : current)
        return
      }
      if (pending.kind === 'auth-api' && message.type === 'provider.auth.api.response' && message.ok) {
        setAuthFlow(null)
        requestSnapshot(scope, true)
        setNotice(`${message.payload.providerId} connected`)
        onCatalogChanged()
        return
      }
      if (pending.kind === 'auth-callback' && message.type === 'provider.auth.oauth.callback.response' && message.ok) {
        setAuthFlow(null)
        requestSnapshot(scope, true)
        setNotice(`${message.payload.providerId} signed in`)
        onCatalogChanged()
        return
      }
      if (pending.kind === 'auth-disconnect' && message.type === 'provider.auth.disconnect.response' && message.ok) {
        setAuthFlow(null)
        requestSnapshot(scope, true)
        setNotice(`${message.payload.providerId} credential removed`)
        onCatalogChanged()
      }
    }

    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [applySnapshot, onCatalogChanged, postRequest, requestSnapshot, scope])

  const runAfterDiscard = useCallback((action: () => void) => {
    const current = draftRef.current
    if (current && JSON.stringify(current) !== baselineRef.current) {
      pendingActionRef.current = action
      setConfirm({
        title: t('Discard unsaved changes?'),
        detail: t('Changes in the current provider have not been saved.'),
        confirmLabel: t('Discard'),
        danger: true
      })
      return
    }
    action()
  }, [t])

  const selectProvider = useCallback(
    (providerId: string) => {
      const catalog = snapshot?.catalog.find((provider) => provider.id === providerId)
      if (catalog?.builtIn) {
        const methods = catalog.authMethods.length > 0 ? catalog.authMethods : [{ type: 'api' as const }]
        setAuthFlow({
          entry: catalog,
          methodIndex: methods.length === 1 ? 0 : null,
          authorization: null,
          busy: null,
          openingUrl: false,
          error: null
        })
        return
      }
      runAfterDiscard(() => {
        const configured = snapshot?.configured.find((provider) => provider.id === providerId)
        setLoadedDraft(configured ?? (catalog ? providerDraftFromCatalog(catalog) : null), providerId)
        setView('quick')
        setError(null)
        setNotice(null)
        setMobileListOnly(false)
      })
    },
    [runAfterDiscard, setLoadedDraft, snapshot]
  )

  const createCustomProvider = useCallback(() => {
    runAfterDiscard(() => {
      const next = createEmptyProviderDraft()
      next.models = [createEmptyProviderModelDraft()]
      setLoadedDraft(next, '__new__')
      originalModelIdsRef.current = new Set()
      setView('quick')
      setMobileListOnly(false)
      setError(null)
      setNotice(null)
    })
  }, [runAfterDiscard, setLoadedDraft])

  const requestSave = useCallback(() => {
    if (!snapshot || !draftRef.current || saving) {
      return
    }
    setSaving(true)
    setError(null)
    setNotice(null)
    postRequest(
      {
        type: 'provider.settings.save',
        payload: {
          scope,
          revision: snapshot.revision,
          draft: draftRef.current
        }
      },
      { kind: 'save', providerId: draftRef.current.id }
    )
  }, [postRequest, saving, scope, snapshot])

  const confirmDeleteProvider = useCallback(() => {
    const current = draftRef.current
    if (!snapshot || !current?.originalId || deleting) {
      return
    }
    const providerId = current.originalId
    pendingActionRef.current = () => {
      setDeleting(true)
      setError(null)
      postRequest(
        {
          type: 'provider.settings.delete',
          payload: {
            scope,
            revision: snapshot.revision,
            providerId
          }
        },
        { kind: 'delete', providerId }
      )
    }
    setConfirm({
      title: `Remove ${current.name || current.id}?`,
      detail: `The provider block will be removed from ${scope} opencode.json. Stored credentials are kept.`,
      confirmLabel: 'Remove provider',
      danger: true
    })
  }, [deleting, postRequest, scope, snapshot])

  const requestCatalogModels = useCallback(
    (providerId: string, forceRefresh = false) => {
      if (!providerId || loadingCatalogProvider) {
        return
      }
      setLoadingCatalogProvider(providerId)
      setError(null)
      postRequest(
        {
          type: 'provider.settings.models',
          payload: { providerId, forceRefresh }
        },
        { kind: 'models', providerId }
      )
    },
    [loadingCatalogProvider, postRequest]
  )

  const requestUpstreamModels = useCallback(
    (endpoint: string) => {
      const current = draftRef.current
      if (!current?.id || loadingUpstreamProvider) {
        return
      }
      setLoadingUpstreamProvider(current.id)
      setUpstreamModels(null)
      setUpstreamError(null)
      setError(null)
      postRequest(
        {
          type: 'provider.settings.upstreamModels',
          payload: { scope, draft: current, endpoint }
        },
        { kind: 'upstream-models', providerId: current.id }
      )
    },
    [loadingUpstreamProvider, postRequest, scope]
  )

  const selectAuthMethod = useCallback((methodIndex: number | null) => {
    setAuthFlow((current) => current ? {
      ...current,
      methodIndex,
      authorization: null,
      busy: null,
      error: null
    } : current)
  }, [])

  const requestApiConnect = useCallback((method: number, key: string, metadata: Record<string, string>) => {
    const providerId = authFlow?.entry.id
    if (!providerId || authFlow.busy) {
      return
    }
    setAuthFlow((current) => current ? { ...current, methodIndex: method, busy: 'api', error: null } : current)
    postRequest(
      { type: 'provider.auth.api', payload: { providerId, key, metadata } },
      { kind: 'auth-api', providerId }
    )
  }, [authFlow, postRequest])

  const requestOAuthAuthorize = useCallback((method: number, inputs: Record<string, string>) => {
    const providerId = authFlow?.entry.id
    if (!providerId || authFlow.busy) {
      return
    }
    setAuthFlow((current) => current ? {
      ...current,
      methodIndex: method,
      authorization: null,
      busy: 'authorize',
      error: null
    } : current)
    postRequest(
      { type: 'provider.auth.oauth.authorize', payload: { providerId, method, inputs } },
      { kind: 'auth-authorize', providerId, method }
    )
  }, [authFlow, postRequest])

  const requestOAuthCallback = useCallback((code?: string) => {
    const providerId = authFlow?.entry.id
    const method = authFlow?.methodIndex
    if (!providerId || method === null || method === undefined || authFlow.busy) {
      return
    }
    setAuthFlow((current) => current ? { ...current, busy: 'callback', error: null } : current)
    postRequest(
      {
        type: 'provider.auth.oauth.callback',
        payload: { providerId, method, ...(code ? { code } : {}) }
      },
      { kind: 'auth-callback', providerId }
    )
  }, [authFlow, postRequest])

  const reopenAuthUrl = useCallback(() => {
    const url = authFlow?.authorization?.url
    if (!url || authFlow.openingUrl) {
      return
    }
    setAuthFlow((current) => current ? { ...current, openingUrl: true, error: null } : current)
    postRequest(
      { type: 'provider.auth.openExternal', payload: { url } },
      { kind: 'auth-open-external', url }
    )
  }, [authFlow, postRequest])

  const disconnectProvider = useCallback(() => {
    const providerId = authFlow?.entry.id
    if (!providerId || authFlow.busy) {
      return
    }
    setAuthFlow((current) => current ? { ...current, busy: 'disconnect', error: null } : current)
    postRequest(
      { type: 'provider.auth.disconnect', payload: { providerId } },
      { kind: 'auth-disconnect', providerId }
    )
  }, [authFlow, postRequest])

  const editProviderOverrides = useCallback(() => {
    const entry = authFlow?.entry
    if (!entry) {
      return
    }
    setAuthFlow(null)
    runAfterDiscard(() => {
      const configured = snapshot?.configured.find((provider) => provider.id === entry.id)
      setLoadedDraft(configured ?? providerDraftFromCatalog(entry), entry.id)
      setView('quick')
      setMobileListOnly(false)
      setError(null)
      setNotice(null)
    })
  }, [authFlow, runAfterDiscard, setLoadedDraft, snapshot])

  const visibleProviders = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) {
      return snapshot?.catalog ?? []
    }
    return (snapshot?.catalog ?? []).filter((provider) =>
      `${provider.label} ${provider.id} ${provider.source}`.toLowerCase().includes(normalizedQuery)
    )
  }, [query, snapshot])

  const selectedCatalogEntry = snapshot?.catalog.find((entry) => entry.id === draft?.id)
  const customModelsValid = !draft?.custom || (draft.models.length > 0 && draft.models.every((model) => model.id.trim().length > 0))
  const canSave = Boolean(draft?.id.trim()) && customModelsValid && !saving && !deleting && (isDirty || draft?.originalId === null)

  return (
    <main className="provider-settings" aria-label={t('Provider settings')}>
      <header className="provider-settings__header">
        <button
          type="button"
          className="provider-settings__icon-button"
          onClick={() => runAfterDiscard(onClose)}
          aria-label={t('Back to chat')}
          title={t('Back to chat')}
        >
          <ArrowLeft size={17} aria-hidden="true" />
        </button>
        <div className="provider-settings__heading">
          <Settings2 size={16} aria-hidden="true" />
          <strong>{t('Provider settings')}</strong>
        </div>
        <div className="provider-settings__header-actions">
          <button
            type="button"
            className={`provider-settings__icon-button${openingConfig ? ' is-loading' : ''}`}
            onClick={() => {
              setOpeningConfig(true)
              setError(null)
              postRequest({ type: 'provider.settings.openConfig', payload: { scope } }, { kind: 'open' })
            }}
            disabled={openingConfig || (scope === 'workspace' && snapshot?.workspaceAvailable === false)}
            aria-label={t('Open opencode config')}
            title={t('Open opencode config')}
          >
            <FileJson size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`provider-settings__icon-button${refreshing ? ' is-loading' : ''}`}
            onClick={() => runAfterDiscard(() => requestSnapshot(scope, true, selectedProviderIdRef.current))}
            disabled={refreshing}
            aria-label={t('Refresh providers')}
            title={t('Refresh providers')}
          >
            <RefreshCw size={16} aria-hidden="true" />
          </button>
          <label className="provider-settings__language" title={t('Interface language')}>
            <Languages size={14} aria-hidden="true" />
            <select
              value={language}
              onChange={(event) => setLanguage(event.target.value === 'zh-CN' ? 'zh-CN' : 'en')}
              aria-label={t('Interface language')}
            >
              <option value="zh-CN">简体中文</option>
              <option value="en">English</option>
            </select>
          </label>
        </div>
      </header>

      <div className="provider-settings__scope-row">
        <fieldset className="provider-settings__segmented">
          <legend className="provider-settings__sr-only">{t('Configuration scope')}</legend>
          {(['global', 'workspace'] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={scope === value ? 'is-selected' : ''}
              disabled={value === 'workspace' && snapshot?.workspaceAvailable === false}
              onClick={() => {
                if (value !== scope) {
                  runAfterDiscard(() => requestSnapshot(value))
                }
              }}
            >
              {value === 'global' ? t('Global') : t('Workspace')}
            </button>
          ))}
        </fieldset>
        <span className="provider-settings__path" title={snapshot?.path}>{snapshot?.path || t('No workspace config')}</span>
      </div>

      {error ? <div className="provider-settings__banner is-error">{t(error)}</div> : null}
      {notice ? (
        <div className="provider-settings__banner is-success">
          <Check size={14} aria-hidden="true" />
          <span>{t(notice)}</span>
        </div>
      ) : null}

      <div className={`provider-settings__body${mobileListOnly ? ' is-mobile-list' : ''}`}>
        <aside className="provider-settings__sidebar">
          <div className="provider-settings__search-row">
            <label className="provider-settings__search">
              <Search size={14} aria-hidden="true" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('Search providers')}
                aria-label={t('Search providers')}
              />
            </label>
            <button
              type="button"
              className="provider-settings__icon-button"
              onClick={createCustomProvider}
              aria-label={t('Add custom provider')}
              title={t('Add custom provider')}
            >
              <Plus size={16} aria-hidden="true" />
            </button>
          </div>
          <div className="provider-settings__provider-list" role="listbox" aria-label={t('Providers')}>
            {loading ? (
              <div className="provider-settings__empty"><LoaderCircle className="is-spinning" size={18} /></div>
            ) : visibleProviders.length === 0 ? (
              <div className="provider-settings__empty">{t('No providers')}</div>
            ) : (
              visibleProviders.map((provider) => (
                <ProviderListItem
                  key={provider.id}
                  provider={provider}
                  selected={provider.id === selectedProviderId}
                  onSelect={() => selectProvider(provider.id)}
                />
              ))
            )}
          </div>
        </aside>

        <section className="provider-settings__detail" aria-label={t('Provider editor')}>
          {draft ? (
            <>
              <div className="provider-settings__detail-header">
                <button
                  type="button"
                  className="provider-settings__mobile-back"
                  onClick={() => setMobileListOnly(true)}
                  aria-label={t('Back to provider list')}
                  title={t('Back to provider list')}
                >
                  <ArrowLeft size={15} aria-hidden="true" />
                </button>
                <div className="provider-settings__provider-title">
                  <div>
                    <strong>{draft.name || draft.id || t('New provider')}</strong>
                    <span>{draft.id || t('Custom provider')}</span>
                  </div>
                  <ConnectionBadge entry={selectedCatalogEntry} configured={Boolean(draft.originalId)} />
                </div>
                <div className="provider-settings__detail-actions">
                  {draft.originalId ? (
                    <button
                      type="button"
                      className="provider-settings__icon-button is-danger"
                      onClick={confirmDeleteProvider}
                      disabled={deleting || saving}
                      aria-label={t('Remove provider')}
                      title={t('Remove provider')}
                    >
                      {deleting ? <LoaderCircle className="is-spinning" size={15} /> : <Trash2 size={15} />}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="provider-settings__save"
                    onClick={requestSave}
                    disabled={!canSave}
                  >
                    {saving ? <LoaderCircle className="is-spinning" size={15} /> : <Save size={15} />}
                    <span>{saving ? t('Saving') : t('Save')}</span>
                  </button>
                </div>
              </div>

              {view !== 'quick' ? (
                <div className="provider-settings__subview-header">
                  <button type="button" onClick={() => setView('quick')}>
                    <ArrowLeft size={14} aria-hidden="true" />
                    {t('Quick setup')}
                  </button>
                  <strong>{view === 'models' ? `${t('Models')} (${String(draft.models.length)})` : t('Advanced configuration')}</strong>
                </div>
              ) : null}

              <div className="provider-settings__editor-scroll">
                {view === 'quick' ? (
                  <QuickSetupEditor
                    draft={draft}
                    catalog={selectedCatalogEntry}
                    originalModelIds={originalModelIdsRef.current}
                    upstreamModels={upstreamModels?.providerId === draft.id ? upstreamModels : null}
                    loadingUpstream={loadingUpstreamProvider === draft.id}
                    upstreamError={upstreamError}
                    onRequestUpstream={requestUpstreamModels}
                    onChange={updateDraft}
                    onManageModels={() => setView('models')}
                    onAdvanced={() => setView('advanced')}
                    onConfirm={(state, action) => {
                      pendingActionRef.current = action
                      setConfirm(state)
                    }}
                  />
                ) : null}
                {view === 'advanced' ? <AdvancedEditor draft={draft} catalog={selectedCatalogEntry} onChange={updateDraft} /> : null}
                {view === 'models' ? (
                  <ModelsEditor
                    key={`${scope}:${selectedProviderId}`}
                    draft={draft}
                    originalModelIds={originalModelIdsRef.current}
                    catalogModels={catalogModels.get(draft.id)}
                    loadingCatalog={loadingCatalogProvider === draft.id}
                    onRequestCatalog={() => requestCatalogModels(draft.id)}
                    onChange={updateDraft}
                    onConfirm={(state, action) => {
                      pendingActionRef.current = action
                      setConfirm(state)
                    }}
                  />
                ) : null}
              </div>
            </>
          ) : (
            <div className="provider-settings__empty">{t('Select a provider')}</div>
          )}
        </section>
      </div>

      {confirm ? (
        <ConfirmDialog
          state={confirm}
          onCancel={() => {
            pendingActionRef.current = null
            setConfirm(null)
          }}
          onConfirm={() => {
            const action = pendingActionRef.current
            pendingActionRef.current = null
            setConfirm(null)
            action?.()
          }}
        />
      ) : null}
      {authFlow ? (
        <ProviderConnectDialog
          flow={authFlow}
          onClose={() => setAuthFlow(null)}
          onSelectMethod={selectAuthMethod}
          onApiConnect={requestApiConnect}
          onAuthorize={requestOAuthAuthorize}
          onCallback={requestOAuthCallback}
          onOpenExternal={reopenAuthUrl}
          onDisconnect={disconnectProvider}
          onAdvanced={editProviderOverrides}
        />
      ) : null}
    </main>
  )
}

function ProviderListItem({
  provider,
  selected,
  onSelect
}: {
  provider: ProviderSettingsCatalogEntry
  selected: boolean
  onSelect: () => void
}) {
  const { t } = useI18n()
  const stateClass = provider.connected ? 'is-connected' : provider.configuredInScope ? 'is-disconnected' : 'is-available'
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      className={`provider-settings__provider-item${selected ? ' is-selected' : ''}`}
      onClick={onSelect}
    >
      <span className={`provider-settings__status-dot ${stateClass}`} aria-hidden="true" />
      <span className="provider-settings__provider-copy">
        <strong>{provider.label}</strong>
        <span>{provider.id}</span>
      </span>
      <span className="provider-settings__provider-meta">
        {provider.connected ? t('Connected') : provider.builtIn ? t('Built-in') : t('Custom')}
      </span>
      <ChevronRight size={14} aria-hidden="true" />
    </button>
  )
}

function ConnectionBadge({ entry, configured }: { entry?: ProviderSettingsCatalogEntry; configured: boolean }) {
  const { t } = useI18n()
  const connected = entry?.connected === true
  return (
    <span className={`provider-settings__connection${connected ? ' is-connected' : configured ? ' is-disconnected' : ''}`}>
      <span aria-hidden="true" />
      {connected ? t('Connected') : configured ? t('Not connected') : t('Available')}
    </span>
  )
}

function QuickSetupEditor({
  draft,
  catalog,
  originalModelIds,
  upstreamModels,
  loadingUpstream,
  upstreamError,
  onRequestUpstream,
  onChange,
  onManageModels,
  onAdvanced,
  onConfirm
}: {
  draft: ProviderSettingsDraft
  catalog?: ProviderSettingsCatalogEntry
  originalModelIds: ReadonlySet<string>
  upstreamModels: { endpoint: string; models: ProviderUpstreamModel[] } | null
  loadingUpstream: boolean
  upstreamError: string | null
  onRequestUpstream: (endpoint: string) => void
  onChange: (draft: ProviderSettingsDraft) => void
  onManageModels: () => void
  onAdvanced: () => void
  onConfirm: (state: ConfirmState, action: () => void) => void
}) {
  const { t } = useI18n()
  const [upstreamOpen, setUpstreamOpen] = useState(false)
  const adapterPreset = ADAPTER_PRESETS.includes(draft.npm) ? draft.npm : '__custom'
  const update = <K extends keyof ProviderSettingsDraft>(key: K, value: ProviderSettingsDraft[K]) =>
    onChange({ ...draft, [key]: value })
  const updateModel = (index: number, next: ProviderSettingsModelDraft) => {
    const models = [...draft.models]
    models[index] = next
    onChange({ ...draft, models })
  }
  const addModel = () => {
    const models = [...draft.models, createEmptyProviderModelDraft(nextQuickModelId(draft.models))]
    onChange({ ...draft, models })
  }
  const fetchUpstreamModels = () => {
    if (!draft.baseURL.trim() || loadingUpstream) {
      return
    }
    setUpstreamOpen(true)
    onRequestUpstream(defaultUpstreamModelsEndpoint(draft.baseURL))
  }
  const duplicateModel = (index: number) => {
    const source = draft.models[index]
    if (!source) {
      return
    }
    const copy = duplicateProviderModelDraft(source, draft.models)
    const models = [...draft.models]
    models.splice(index + 1, 0, copy)
    onChange({ ...draft, models })
  }
  const removeModel = (index: number) => {
    const model = draft.models[index]
    const remove = () => onChange({
      ...draft,
      models: draft.models.filter((_, modelIndex) => modelIndex !== index)
    })
    if (!model || !originalModelIds.has(model.id)) {
      remove()
      return
    }
    onConfirm(
      {
        title: `Remove ${model.name || model.id || 'model'}?`,
        detail: t('The model will be removed when the provider is saved.'),
        confirmLabel: t('Remove model'),
        danger: true
      },
      remove
    )
  }

  return (
    <div className="provider-settings__form provider-settings__quick-form">
      <FormSection title="Connection">
        <FormGrid>
          <FormField label="Provider ID">
            <input
              value={draft.id}
              disabled={Boolean(draft.originalId) || !draft.custom}
              onChange={(event) => update('id', event.target.value)}
              spellCheck={false}
            />
          </FormField>
          <FormField label="Display name">
            <input value={draft.name} onChange={(event) => update('name', event.target.value)} />
          </FormField>
          <FormField label="Adapter">
            <select
              value={adapterPreset}
              onChange={(event) => update('npm', event.target.value === '__custom' ? '' : event.target.value)}
            >
              {ADAPTER_PRESETS.map((adapter) => <option key={adapter} value={adapter}>{adapter}</option>)}
              <option value="__custom">{t('Custom package')}</option>
            </select>
          </FormField>
          {adapterPreset === '__custom' ? (
            <FormField label="npm package">
              <input value={draft.npm} onChange={(event) => update('npm', event.target.value)} spellCheck={false} />
            </FormField>
          ) : null}
          <FormField label="Base URL" wide>
            <input
              value={draft.baseURL}
              onChange={(event) => update('baseURL', event.target.value)}
              placeholder="https://api.example.com/v1"
              spellCheck={false}
            />
          </FormField>
          {!catalog?.builtIn ? (
            <FormField label="API key" wide>
              <input
                type="password"
                value={draft.credential.value}
                onChange={(event) => onChange({
                  ...draft,
                  credential: {
                    ...draft.credential,
                    mode: event.target.value ? 'store' : draft.credential.mode,
                    value: event.target.value
                  }
                })}
                placeholder={
                  draft.credential.hasStoreValue || draft.credential.hasConfigValue || draft.credential.mode === 'env'
                    ? t('Saved value unchanged')
                    : t('Enter API key')
                }
                autoComplete="new-password"
              />
            </FormField>
          ) : null}
        </FormGrid>
      </FormSection>

      <FormSection title="Models" icon={<Brain size={14} />}>
        <div className="provider-settings__quick-models">
          <div className="provider-settings__quick-models-toolbar">
            <span>{String(draft.models.length)} {t('configured')}</span>
            <div className="provider-settings__quick-model-actions">
              <button
                type="button"
                className="provider-settings__add-row"
                onClick={fetchUpstreamModels}
                disabled={!draft.baseURL.trim() || loadingUpstream}
                title={draft.baseURL.trim() ? t('Fetch models from the provider endpoint') : t('Enter Base URL first')}
              >
                {loadingUpstream ? <LoaderCircle className="is-spinning" size={14} /> : <CloudDownload size={14} aria-hidden="true" />}
                {loadingUpstream ? t('Fetching') : t('Fetch models')}
              </button>
              <button type="button" className="provider-settings__add-row" onClick={addModel}>
                <Plus size={14} aria-hidden="true" />
                {t('Add model')}
              </button>
            </div>
          </div>
          {draft.models.length === 0 ? (
            <button type="button" className="provider-settings__add-model-empty" onClick={addModel}>
              <Plus size={14} aria-hidden="true" />
              {t('Add your first model')}
            </button>
          ) : null}
          {draft.models.map((model, index) => (
            <QuickModelEditor
              key={String(index)}
              model={model}
              providerNpm={draft.npm}
              idLocked={originalModelIds.has(model.id)}
              initiallyOpen={index === 0 || !originalModelIds.has(model.id)}
              onChange={(next) => updateModel(index, next)}
              onDuplicate={() => duplicateModel(index)}
              onRemove={() => removeModel(index)}
            />
          ))}
        </div>
      </FormSection>

      <FormSection title="Provider headers">
        <HeaderEditor headers={draft.headers} onChange={(headers) => update('headers', headers)} />
      </FormSection>

      <div className="provider-settings__configuration-links">
        <button type="button" onClick={onManageModels}>
          <span className="provider-settings__configuration-icon"><ListPlus size={15} /></span>
          <span><strong>{t('Manage models')}</strong><small>{String(draft.models.length)} {t('configured')}</small></span>
          <ChevronRight size={14} aria-hidden="true" />
        </button>
        <button type="button" onClick={onAdvanced}>
          <span className="provider-settings__configuration-icon"><SlidersHorizontal size={15} /></span>
          <span><strong>{t('Advanced configuration')}</strong><small>{t('Credentials, runtime and raw adapter options')}</small></span>
          <ChevronRight size={14} aria-hidden="true" />
        </button>
      </div>

      {upstreamOpen ? (
        <UpstreamModelPicker
          draft={draft}
          result={upstreamModels}
          loading={loadingUpstream}
          error={upstreamError}
          onClose={() => setUpstreamOpen(false)}
          onChange={onChange}
        />
      ) : null}
    </div>
  )
}

function QuickModelEditor({
  model,
  providerNpm,
  idLocked,
  initiallyOpen,
  onChange,
  onDuplicate,
  onRemove
}: {
  model: ProviderSettingsModelDraft
  providerNpm: string
  idLocked: boolean
  initiallyOpen: boolean
  onChange: (model: ProviderSettingsModelDraft) => void
  onDuplicate: () => void
  onRemove: () => void
}) {
  const { t } = useI18n()
  const [expanded, setExpanded] = useState(initiallyOpen)
  const supportsImages = model.modalities.input?.includes('image') ?? false
  const update = <K extends keyof ProviderSettingsModelDraft>(key: K, value: ProviderSettingsModelDraft[K]) =>
    onChange({ ...model, [key]: value })
  const updateLimit = (key: 'context' | 'output', value: number | null) =>
    update('limit', { ...model.limit, [key]: value })
  const updateCost = (key: 'input' | 'output', value: number | null) =>
    update('cost', { ...model.cost, [key]: value })
  const setSupportsImages = (enabled: boolean) => {
    const current = model.modalities.input ?? ['text']
    const input = enabled
      ? [...new Set([...current, 'image' as const])]
      : current.filter((item) => item !== 'image')
    update('modalities', { ...model.modalities, input })
  }

  return (
    <section className={`provider-settings__quick-model${expanded ? ' is-expanded' : ''}`}>
      <header>
        <button
          type="button"
          className="provider-settings__quick-model-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          <ChevronRight size={14} aria-hidden="true" />
          <span>
            <strong>{model.name || model.id || t('New model')}</strong>
            <small>{model.id || t('Model ID required')}</small>
          </span>
        </button>
        <ThinkingAvailabilityBadge model={model} />
        <button
          type="button"
          className="provider-settings__icon-button"
          onClick={onDuplicate}
          aria-label={`${t('Duplicate model')}: ${model.name || model.id || t('Model')}`}
          title={t('Duplicate model')}
        >
          <Copy size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="provider-settings__icon-button is-danger"
          onClick={onRemove}
          aria-label={`Remove ${model.name || model.id || 'model'}`}
          title={t('Remove model')}
        >
          <Trash2 size={14} aria-hidden="true" />
        </button>
      </header>
      {expanded ? (
        <div className="provider-settings__quick-model-body">
          <FormGrid>
            <FormField label="Model ID">
              <input
                value={model.id}
                disabled={idLocked}
                onChange={(event) => {
                  const id = event.target.value
                  if (!model.name || model.name === model.id) {
                    onChange({ ...model, id, name: id })
                  } else {
                    update('id', id)
                  }
                }}
                placeholder="model-id"
                spellCheck={false}
                aria-invalid={!model.id.trim()}
              />
            </FormField>
            <FormField label="Display name">
              <input
                value={model.name}
                onChange={(event) => update('name', event.target.value)}
                placeholder={model.id || t('Model name')}
              />
            </FormField>
            <NumberField label="Context window" value={model.limit.context} onChange={(value) => updateLimit('context', value)} />
            <NumberField label="Max output tokens" value={model.limit.output} onChange={(value) => updateLimit('output', value)} />
            <NumberField label="Input price / 1M" value={model.cost.input} onChange={(value) => updateCost('input', value)} step="any" />
            <NumberField label="Output price / 1M" value={model.cost.output} onChange={(value) => updateCost('output', value)} step="any" />
          </FormGrid>
          {!model.id.trim() ? <output className="provider-settings__field-error">{t('Model ID is required')}</output> : null}
          <div className="provider-settings__quick-capabilities">
            <label>
              <input type="checkbox" checked={supportsImages} onChange={(event) => setSupportsImages(event.target.checked)} />
              <span>{t('Supports images')}</span>
            </label>
          </div>
          <QuickThinkingLevelsEditor
            model={model}
            showServiceTier={supportsOpenAiServiceTier(model, providerNpm)}
            onChange={(variantsJson) => update('variantsJson', variantsJson)}
          />
        </div>
      ) : null}
    </section>
  )
}

function ThinkingAvailabilityBadge({ model }: { model: Pick<ProviderSettingsModelDraft, 'reasoning' | 'variantsJson'> }) {
  const { t } = useI18n()
  const availability = getModelThinkingAvailability(model)
  const metadataLabel = availability.metadata === true
    ? t('enabled')
    : availability.metadata === false
      ? t('disabled')
      : t('unspecified')
  const label = availability.activeLevelCount > 0
    ? `${String(availability.activeLevelCount)} ${t(availability.activeLevelCount === 1 ? 'level' : 'levels')}`
    : availability.source === 'metadata'
      ? 'Metadata'
      : t('Not configured')
  const title = availability.activeLevelCount > 0
    ? t('Thinking is available through {count} enabled request variants. Reasoning capability metadata is {metadata}.', {
        count: availability.activeLevelCount,
        metadata: metadataLabel
      }) + (availability.metadataConflict ? ` ${t('The variants still apply to requests.')}` : '')
    : availability.source === 'metadata'
      ? t('Reasoning capability metadata is enabled, but no selectable thinking levels are configured.')
      : t('No enabled reasoning variants are configured. Reasoning capability metadata is {metadata}.', { metadata: metadataLabel })

  return (
    <span
      className={`provider-settings__thinking-badge${availability.available ? ' is-available' : ''}`}
      title={title}
    >
      <span aria-hidden="true" />
      {label}
    </span>
  )
}

function QuickThinkingLevelsEditor({
  model,
  showServiceTier,
  onChange
}: {
  model: Pick<ProviderSettingsModelDraft, 'reasoning' | 'variantsJson'>
  showServiceTier: boolean
  onChange: (value: string) => void
}) {
  const { t } = useI18n()
  const entries = getOrderedThinkingVariantEntries(model.variantsJson)
  const tierListId = useId()
  const addLevel = () => {
    const id = nextEditableJsonKey(model.variantsJson, 'medium')
    const updated = addEditableJsonEntry(model.variantsJson, id, { reasoningEffort: 'medium' })
    if (updated !== null) {
      onChange(updated)
    }
  }

  return (
    <div className="provider-settings__quick-thinking">
      <div className="provider-settings__quick-thinking-header">
        <span><Brain size={14} aria-hidden="true" /><strong>{t('Thinking levels')}</strong></span>
        <ThinkingAvailabilityBadge model={model} />
        <button type="button" className="provider-settings__add-row" onClick={addLevel} disabled={!entries}>
          <Plus size={13} aria-hidden="true" />
          {t('Add level')}
        </button>
      </div>
      {entries ? (
        <>
          {entries.length > 0 ? (
            <div className={`provider-settings__quick-level-headings${showServiceTier ? ' has-service-tier' : ''}`} aria-hidden="true">
              <span>{t('On')}</span>
              <span>{t('Thinking level')}</span>
              {showServiceTier ? <span>Service tier</span> : null}
              <span />
              <span />
            </div>
          ) : <div className="provider-settings__quick-level-empty">{t('No thinking levels')}</div>}
          {entries.map(([id, rawOptions]) => (
            <QuickThinkingLevelRow
              key={id}
              source={model.variantsJson}
              id={id}
              options={isJsonObject(rawOptions) ? rawOptions : null}
              tierListId={tierListId}
              showServiceTier={showServiceTier}
              onChange={onChange}
            />
          ))}
          {showServiceTier ? (
            <datalist id={tierListId}>
              {SERVICE_TIERS.map((tier) => <option key={tier} value={tier} />)}
            </datalist>
          ) : null}
        </>
      ) : <output className="provider-settings__banner is-error">{t('Invalid variants JSON. Open Manage models to repair it.')}</output>}
    </div>
  )
}

function QuickThinkingLevelRow({
  source,
  id,
  options,
  tierListId,
  showServiceTier,
  onChange
}: {
  source: string
  id: string
  options: Record<string, unknown> | null
  tierListId: string
  showServiceTier: boolean
  onChange: (value: string) => void
}) {
  const { t } = useI18n()
  const [idDraft, setIdDraft] = useState(id)
  const [idError, setIdError] = useState(false)
  const enabled = options?.disabled !== true
  const updateOption = (key: string, value: unknown | undefined) => {
    const updated = setNestedEditableJsonProperty(source, id, key, value)
    if (updated !== null) {
      onChange(updated)
    }
  }
  const commitId = () => {
    const updated = renameThinkingLevelEntry(source, id, idDraft)
    if (updated === null) {
      setIdError(true)
      return
    }
    setIdError(false)
    onChange(updated)
  }
  const duplicate = () => {
    if (!options) {
      return
    }
    const nextId = nextEditableJsonKey(source, `${id}-copy`)
    const updated = addEditableJsonEntry(source, nextId, options)
    if (updated !== null) {
      onChange(updated)
    }
  }
  const remove = () => {
    const updated = removeEditableJsonEntry(source, id)
    if (updated !== null) {
      onChange(updated)
    }
  }

  useEffect(() => {
    setIdDraft(id)
    setIdError(false)
  }, [id])

  return (
    <div className={`provider-settings__quick-level-row${showServiceTier ? ' has-service-tier' : ''}`}>
      <label className="provider-settings__quick-level-enabled" title={enabled ? t('Disable level') : t('Enable level')}>
        <input
          type="checkbox"
          checked={enabled}
          disabled={!options}
          onChange={(event) => updateOption('disabled', event.target.checked ? undefined : true)}
          aria-label={`${enabled ? 'Disable' : 'Enable'} ${id} level`}
        />
      </label>
      <input
        className="provider-settings__quick-level-id"
        value={idDraft}
        onChange={(event) => {
          setIdDraft(event.target.value)
          setIdError(false)
        }}
        onBlur={commitId}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.currentTarget.blur()
          }
          if (event.key === 'Escape') {
            setIdDraft(id)
            setIdError(false)
            event.currentTarget.blur()
          }
        }}
        aria-label={`${id} level ID`}
        aria-invalid={idError}
        title={idError ? t('Level ID must be unique and non-empty') : 'Level ID'}
        spellCheck={false}
      />
      {showServiceTier ? (
        <input
          className="provider-settings__quick-level-tier"
          value={typeof options?.serviceTier === 'string' ? options.serviceTier : ''}
          list={tierListId}
          disabled={!options}
          onChange={(event) => updateOption('serviceTier', event.target.value || undefined)}
          aria-label={`${id} service tier`}
          aria-invalid={options !== null && options.serviceTier !== undefined && typeof options.serviceTier !== 'string'}
          placeholder="Service tier"
          spellCheck={false}
        />
      ) : null}
      <button
        type="button"
        className="provider-settings__icon-button provider-settings__quick-level-copy"
        onClick={duplicate}
        disabled={!options}
        aria-label={`Duplicate ${id} level`}
        title={t('Duplicate level')}
      >
        <Copy size={13} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="provider-settings__icon-button is-danger provider-settings__quick-level-remove"
        onClick={remove}
        aria-label={`Remove ${id} level`}
        title={t('Remove level')}
      >
        <Trash2 size={13} aria-hidden="true" />
      </button>
    </div>
  )
}

function nextQuickModelId(models: ProviderSettingsModelDraft[]): string {
  const ids = new Set(models.map((model) => model.id))
  if (!ids.has('model')) {
    return 'model'
  }
  let index = 2
  while (ids.has(`model-${String(index)}`)) {
    index += 1
  }
  return `model-${String(index)}`
}

function AdvancedEditor({
  draft,
  catalog,
  onChange
}: {
  draft: ProviderSettingsDraft
  catalog?: ProviderSettingsCatalogEntry
  onChange: (draft: ProviderSettingsDraft) => void
}) {
  const { t } = useI18n()
  const update = <K extends keyof ProviderSettingsDraft>(key: K, value: ProviderSettingsDraft[K]) =>
    onChange({ ...draft, [key]: value })
  return (
    <div className="provider-settings__form">
      <FormSection title="Provider details">
        <FormGrid>
          <FormField label="Provider object ID">
            <input value={draft.configId} onChange={(event) => update('configId', event.target.value)} spellCheck={false} />
          </FormField>
          <FormField label="Provider API">
            <input value={draft.api} onChange={(event) => update('api', event.target.value)} spellCheck={false} />
          </FormField>
          <FormField label="npm package">
            <input value={draft.npm} onChange={(event) => update('npm', event.target.value)} spellCheck={false} />
          </FormField>
          <FormField label="Enterprise URL">
            <input value={draft.enterpriseUrl} onChange={(event) => update('enterpriseUrl', event.target.value)} spellCheck={false} />
          </FormField>
        </FormGrid>
      </FormSection>
      <FormSection title="Credential source" icon={<KeyRound size={14} />}>
        <FormGrid>
          <FormField label="Source">
            <select
              value={draft.credential.mode}
              onChange={(event) => onChange({
                ...draft,
                credential: {
                  ...draft.credential,
                  mode: event.target.value as ProviderSettingsDraft['credential']['mode'],
                  value: ''
                }
              })}
            >
              <option value="store">{t('OpenCode credential store')}</option>
              <option value="env">{t('Environment reference')}</option>
              <option value="config">{t('Plaintext opencode.json')}</option>
              <option value="none">{t('None')}</option>
            </select>
          </FormField>
          {draft.credential.mode === 'store' || draft.credential.mode === 'config' ? (
            <FormField label="API key" wide>
              <input
                type="password"
                value={draft.credential.value}
                onChange={(event) => onChange({ ...draft, credential: { ...draft.credential, value: event.target.value } })}
                placeholder={draft.credential.hasStoreValue || draft.credential.hasConfigValue ? t('Saved value unchanged') : t('Enter API key')}
                autoComplete="new-password"
              />
            </FormField>
          ) : null}
          {draft.credential.mode === 'env' ? (
            <FormField label="Environment variable" wide>
              <input
                value={draft.credential.env}
                onChange={(event) => onChange({ ...draft, credential: { ...draft.credential, env: event.target.value } })}
                placeholder={catalog?.env[0] ?? 'OPENAI_API_KEY'}
                spellCheck={false}
              />
            </FormField>
          ) : null}
        </FormGrid>
      </FormSection>
      <FormSection title="Runtime options">
        <div className="provider-settings__timeout-grid">
          <TimeoutField label="Timeout" value={draft.timeout} onChange={(value) => update('timeout', value)} allowFalse />
          <TimeoutField label="Header timeout" value={draft.headerTimeout} onChange={(value) => update('headerTimeout', value)} allowFalse />
          <TimeoutField label="Chunk timeout" value={draft.chunkTimeout} onChange={(value) => update('chunkTimeout', value as number | null)} />
          <TriStateField label="Set cache key" value={draft.setCacheKey} onChange={(value) => update('setCacheKey', value)} />
        </div>
      </FormSection>
      <FormSection title="Model filters">
        <FormGrid>
          <FormField label="Environment variables">
            <textarea value={listToLines(draft.env)} onChange={(event) => update('env', linesToList(event.target.value))} rows={4} spellCheck={false} />
          </FormField>
          <FormField label="Whitelist">
            <textarea value={listToLines(draft.whitelist)} onChange={(event) => update('whitelist', linesToList(event.target.value))} rows={4} spellCheck={false} />
          </FormField>
          <FormField label="Blacklist">
            <textarea value={listToLines(draft.blacklist)} onChange={(event) => update('blacklist', linesToList(event.target.value))} rows={4} spellCheck={false} />
          </FormField>
        </FormGrid>
      </FormSection>
      <FormSection title="Raw configuration">
        <JsonField label="Additional provider options" value={draft.optionExtrasJson} onChange={(value) => update('optionExtrasJson', value)} />
        <JsonField label="Additional provider fields" value={draft.providerExtrasJson} onChange={(value) => update('providerExtrasJson', value)} />
      </FormSection>
    </div>
  )
}

function UpstreamModelPicker({
  draft,
  result,
  loading,
  error,
  onClose,
  onChange
}: {
  draft: ProviderSettingsDraft
  result: { endpoint: string; models: ProviderUpstreamModel[] } | null
  loading: boolean
  error: string | null
  onClose: () => void
  onChange: (draft: ProviderSettingsDraft) => void
}) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const searchRef = useRef<HTMLInputElement>(null)
  const configuredIds = new Set(draft.models.map((model) => model.id))
  const filteredModels = (result?.models ?? []).filter((model) =>
    `${model.name} ${model.id} ${model.ownedBy}`.toLowerCase().includes(query.trim().toLowerCase())
  )
  const selectableIds = (result?.models ?? [])
    .filter((model) => !configuredIds.has(model.id))
    .map((model) => model.id)

  useEffect(() => {
    if (!result || loading) {
      return
    }
    const frame = window.requestAnimationFrame(() => searchRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [loading, result])

  const addSelected = () => {
    const additions = (result?.models ?? [])
      .filter((model) => selectedIds.has(model.id) && !configuredIds.has(model.id))
      .map(providerModelDraftFromUpstream)
    if (additions.length === 0) {
      return
    }
    onChange({ ...draft, models: [...draft.models, ...additions] })
    onClose()
  }

  return (
    <div className="provider-settings__overlay" role="presentation">
      <section
        className="provider-settings__picker provider-settings__upstream-picker"
        role="dialog"
        aria-modal="true"
        aria-busy={loading}
        aria-label={t('Fetch upstream models')}
      >
        <header>
          <div>
            <strong>{t('Fetch upstream models')}</strong>
            <small>
              {loading
                ? t('Fetching upstream models...')
                : result
                  ? t('Select the models to add. Configured models cannot be selected.')
                  : t('Unable to fetch upstream models.')}
            </small>
          </div>
          <button
            type="button"
            className="provider-settings__icon-button"
            onClick={onClose}
            aria-label={t('Close upstream model preview')}
            title={t('Close')}
          >
            <X size={15} />
          </button>
        </header>

        {loading ? (
          <output className="provider-settings__upstream-empty" aria-live="polite">
            <LoaderCircle className="is-spinning" size={22} aria-hidden="true" />
            <span>{t('Fetching upstream models...')}</span>
          </output>
        ) : error ? (
          <div className="provider-settings__upstream-empty is-error" role="alert">
            <CloudDownload size={22} aria-hidden="true" />
            <span>{t('Unable to fetch upstream models.')}</span>
            <small>{t(error)}</small>
          </div>
        ) : result ? (
          <>
            <div className="provider-settings__upstream-toolbar">
              <label className="provider-settings__search">
                <Search size={14} />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t('Search fetched models')}
                  aria-label={t('Search fetched models')}
                />
              </label>
              <span>{String(result.models.length)} {t('fetched')}</span>
              <button type="button" onClick={() => setSelectedIds(new Set(selectableIds))}>{t('Select all')}</button>
              <button type="button" onClick={() => setSelectedIds(new Set())}>{t('Clear')}</button>
            </div>
            <div className="provider-settings__picker-list provider-settings__upstream-list">
              {filteredModels.length === 0 ? <div className="provider-settings__empty">{t('No matching models')}</div> : null}
              {filteredModels.map((model) => {
                const configured = configuredIds.has(model.id)
                return (
                  <label key={model.id} className={configured ? 'is-configured' : ''}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(model.id)}
                      disabled={configured}
                      onChange={(event) => {
                        setSelectedIds((current) => {
                          const next = new Set(current)
                          if (event.target.checked) {
                            next.add(model.id)
                          } else {
                            next.delete(model.id)
                          }
                          return next
                        })
                      }}
                    />
                    <span>
                      <strong>{model.name || model.id}</strong>
                      <small>{model.id}</small>
                    </span>
                    <span className="provider-settings__upstream-meta">
                      {configured ? t('Configured') : model.ownedBy}
                      {model.contextWindow ? `${model.ownedBy ? ' · ' : ''}${model.contextWindow.toLocaleString()} ctx` : ''}
                    </span>
                  </label>
                )
              })}
            </div>
            <footer className="provider-settings__upstream-footer">
              <span>{String(selectedIds.size)} {t('selected')}</span>
              <button type="button" onClick={onClose}>{t('Cancel')}</button>
              <button
                type="button"
                className="provider-settings__primary-action"
                onClick={addSelected}
                disabled={selectedIds.size === 0}
              >
                <Plus size={14} />
                {t('Add selected')}
              </button>
            </footer>
          </>
        ) : null}
      </section>
    </div>
  )
}


function ModelsEditor({
  draft,
  originalModelIds,
  catalogModels,
  loadingCatalog,
  onRequestCatalog,
  onChange,
  onConfirm
}: {
  draft: ProviderSettingsDraft
  originalModelIds: ReadonlySet<string>
  catalogModels?: ProviderSettingsCatalogModel[]
  loadingCatalog: boolean
  onRequestCatalog: () => void
  onChange: (draft: ProviderSettingsDraft) => void
  onConfirm: (state: ConfirmState, action: () => void) => void
}) {
  const { t } = useI18n()
  const [selectedIndex, setSelectedIndex] = useState(draft.models.length ? 0 : -1)
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [catalogQuery, setCatalogQuery] = useState('')
  const catalogSearchRef = useRef<HTMLInputElement>(null)
  const selectedModel = selectedIndex >= 0 ? draft.models[selectedIndex] : undefined

  const updateModel = (next: ProviderSettingsModelDraft) => {
    const models = [...draft.models]
    models[selectedIndex] = next
    onChange({ ...draft, models })
  }
  const addModel = () => {
    const models = [...draft.models, createEmptyProviderModelDraft()]
    onChange({ ...draft, models })
    setSelectedIndex(models.length - 1)
  }
  const duplicateModel = (index: number) => {
    const source = draft.models[index]
    if (!source) {
      return
    }
    const copy = duplicateProviderModelDraft(source, draft.models)
    const models = [...draft.models]
    models.splice(index + 1, 0, copy)
    onChange({ ...draft, models })
    setSelectedIndex(index + 1)
  }
  const importModel = (model: ProviderSettingsCatalogModel) => {
    const existingIndex = draft.models.findIndex((entry) => entry.id === model.id)
    if (existingIndex >= 0) {
      setSelectedIndex(existingIndex)
      setCatalogOpen(false)
      return
    }
    const models = [...draft.models, JSON.parse(JSON.stringify(model)) as ProviderSettingsModelDraft]
    onChange({ ...draft, models })
    setSelectedIndex(models.length - 1)
    setCatalogOpen(false)
  }
  const filteredCatalog = (catalogModels ?? []).filter((model) =>
    `${model.name} ${model.id}`.toLowerCase().includes(catalogQuery.trim().toLowerCase())
  )

  useEffect(() => {
    if (!catalogOpen) {
      return
    }
    const frame = window.requestAnimationFrame(() => catalogSearchRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [catalogOpen])

  return (
    <div className="provider-settings__models">
      <div className="provider-settings__model-sidebar">
        <div className="provider-settings__model-actions">
          <button type="button" onClick={addModel}><Plus size={14} /> {t('Custom')}</button>
          <button
            type="button"
            onClick={() => {
              setCatalogOpen(true)
              if (!catalogModels) {
                onRequestCatalog()
              }
            }}
            disabled={!draft.id}
          >
            {loadingCatalog ? <LoaderCircle className="is-spinning" size={14} /> : <Search size={14} />}
            {t('Catalog')}
          </button>
        </div>
        <div className="provider-settings__model-list">
          {draft.models.length === 0 ? <div className="provider-settings__empty">{t('No configured models')}</div> : null}
          {draft.models.map((model, index) => (
            <button
              key={`${model.id}:${String(index)}`}
              type="button"
              className={selectedIndex === index ? 'is-selected' : ''}
              onClick={() => setSelectedIndex(index)}
            >
              <span><strong>{model.name || model.id || t('New model')}</strong><small>{model.id || t('Model ID required')}</small></span>
              <ChevronRight size={13} />
            </button>
          ))}
        </div>
      </div>
      <div className="provider-settings__model-editor">
        {selectedModel ? (
          <>
            <div className="provider-settings__model-editor-header">
              <strong>{selectedModel.name || selectedModel.id || t('New model')}</strong>
              <button
                type="button"
                className="provider-settings__icon-button"
                onClick={() => duplicateModel(selectedIndex)}
                aria-label={t('Duplicate model')}
                title={t('Duplicate model')}
              >
                <Copy size={14} />
              </button>
              <button
                type="button"
                className="provider-settings__icon-button is-danger"
                onClick={() => onConfirm(
                  {
                    title: `Remove ${selectedModel.name || selectedModel.id || 'model'}?`,
                    detail: t('The model will be removed when the provider is saved.'),
                    confirmLabel: t('Remove model'),
                    danger: true
                  },
                  () => {
                    const models = draft.models.filter((_, index) => index !== selectedIndex)
                    onChange({ ...draft, models })
                    setSelectedIndex(Math.min(selectedIndex, models.length - 1))
                  }
                )}
                aria-label={t('Remove model')}
                title={t('Remove model')}
              >
                <Trash2 size={14} />
              </button>
            </div>
            <ModelEditor
              model={selectedModel}
              providerNpm={draft.npm}
              idLocked={originalModelIds.has(selectedModel.id)}
              onChange={updateModel}
            />
          </>
        ) : (
          <div className="provider-settings__empty">{t('Add or import a model')}</div>
        )}
      </div>

      {catalogOpen ? (
        <div className="provider-settings__overlay" role="presentation">
          <section className="provider-settings__picker" role="dialog" aria-modal="true" aria-label={t('Model catalog')}>
            <header>
              <strong>{t('Model catalog')}</strong>
              <button type="button" className="provider-settings__icon-button" onClick={() => setCatalogOpen(false)} aria-label={t('Close model catalog')} title={t('Close')}>
                <X size={15} />
              </button>
            </header>
            <label className="provider-settings__search">
              <Search size={14} />
              <input ref={catalogSearchRef} value={catalogQuery} onChange={(event) => setCatalogQuery(event.target.value)} placeholder={t('Search models')} aria-label={t('Search models')} />
            </label>
            <div className="provider-settings__picker-list">
              {loadingCatalog ? <div className="provider-settings__empty"><LoaderCircle className="is-spinning" size={18} /></div> : null}
              {!loadingCatalog && filteredCatalog.length === 0 ? <div className="provider-settings__empty">{t('No catalog models')}</div> : null}
              {filteredCatalog.map((model) => (
                <button key={model.id} type="button" onClick={() => importModel(model)}>
                  <span><strong>{model.name}</strong><small>{model.id}</small></span>
                  <Plus size={14} />
                </button>
              ))}
            </div>
          </section>
        </div>
      ) : null}

    </div>
  )
}

function ModelEditor({
  model,
  providerNpm,
  idLocked,
  onChange
}: {
  model: ProviderSettingsModelDraft
  providerNpm: string
  idLocked: boolean
  onChange: (model: ProviderSettingsModelDraft) => void
}) {
  const { t } = useI18n()
  const update = <K extends keyof ProviderSettingsModelDraft>(key: K, value: ProviderSettingsModelDraft[K]) =>
    onChange({ ...model, [key]: value })
  const updateLimit = (key: keyof ProviderSettingsModelDraft['limit'], value: number | null) =>
    update('limit', { ...model.limit, [key]: value })
  const updateCost = (key: 'input' | 'output' | 'cacheRead' | 'cacheWrite', value: number | null, over200k = false) => {
    if (over200k) {
      update('cost', { ...model.cost, contextOver200k: { ...model.cost.contextOver200k, [key]: value } })
    } else {
      update('cost', { ...model.cost, [key]: value })
    }
  }
  const showServiceTier = supportsOpenAiServiceTier(model, providerNpm)

  return (
    <div className="provider-settings__model-form">
      <FormSection title="Identity">
        <FormGrid>
          <FormField label="OpenCode model ID"><input value={model.id} disabled={idLocked} onChange={(event) => update('id', event.target.value)} spellCheck={false} /></FormField>
          <FormField label="Upstream API model ID"><input value={model.apiModelId} onChange={(event) => update('apiModelId', event.target.value)} spellCheck={false} /></FormField>
          <FormField label="Display name"><input value={model.name} onChange={(event) => update('name', event.target.value)} /></FormField>
          <FormField label="Family"><input value={model.family} onChange={(event) => update('family', event.target.value)} /></FormField>
          <FormField label="Release date"><input value={model.releaseDate} onChange={(event) => update('releaseDate', event.target.value)} placeholder="YYYY-MM-DD" /></FormField>
          <FormField label="Status">
            <select value={model.status} onChange={(event) => update('status', event.target.value as ProviderSettingsModelDraft['status'])}>
              <option value="">{t('Unspecified')}</option>
              <option value="active">{t('Active')}</option>
              <option value="alpha">{t('Alpha')}</option>
              <option value="beta">{t('Beta')}</option>
              <option value="deprecated">{t('Deprecated')}</option>
            </select>
          </FormField>
          <FormField label="Description" wide><textarea value={model.description} onChange={(event) => update('description', event.target.value)} rows={3} /></FormField>
        </FormGrid>
      </FormSection>

      <FormSection title="Capabilities">
        <div className="provider-settings__capability-grid">
          <TriStateField label="Reasoning capability metadata" value={model.reasoning} onChange={(value) => update('reasoning', value)} />
          <TriStateField label="Attachments" value={model.attachment} onChange={(value) => update('attachment', value)} />
          <TriStateField label="Temperature" value={model.temperature} onChange={(value) => update('temperature', value)} />
          <TriStateField label="Tool calls" value={model.toolCall} onChange={(value) => update('toolCall', value)} />
          <TriStateField label="Experimental" value={model.experimental} onChange={(value) => update('experimental', value)} />
          <InterleavedField value={model.interleaved} onChange={(value) => update('interleaved', value)} />
        </div>
        <div className="provider-settings__modalities">
          {(['input', 'output'] as const).map((direction) => (
            <fieldset key={direction}>
              <legend>{t(direction === 'input' ? 'Input modalities' : 'Output modalities')}</legend>
              <select
                aria-label={t('{direction} modalities mode', { direction: t(direction) })}
                value={model.modalities[direction] === null ? 'inherit' : 'configured'}
                onChange={(event) => update('modalities', {
                  ...model.modalities,
                  [direction]: event.target.value === 'inherit' ? null : []
                })}
              >
                <option value="inherit">{t('Unspecified')}</option>
                <option value="configured">{t('Configured')}</option>
              </select>
              {model.modalities[direction] !== null ? (
                <div>
                  {MODALITIES.map((modality) => (
                    <label key={modality}>
                      <input
                        type="checkbox"
                        checked={model.modalities[direction]?.includes(modality) ?? false}
                        onChange={(event) => {
                          const current = model.modalities[direction] ?? []
                          const next = event.target.checked ? [...current, modality] : current.filter((item) => item !== modality)
                          update('modalities', { ...model.modalities, [direction]: next })
                        }}
                      />
                      <span>{modality}</span>
                    </label>
                  ))}
                </div>
              ) : null}
            </fieldset>
          ))}
        </div>
      </FormSection>

      <FormSection title="Limits and pricing">
        <div className="provider-settings__number-grid">
          {(['context', 'input', 'output'] as const).map((key) => (
            <NumberField key={key} label={`${key} tokens`} value={model.limit[key]} onChange={(value) => updateLimit(key, value)} />
          ))}
        </div>
        <div className="provider-settings__price-block">
          <span>{t('Standard context')}</span>
          <div className="provider-settings__number-grid">
            {(['input', 'output', 'cacheRead', 'cacheWrite'] as const).map((key) => (
              <NumberField key={key} label={priceLabel(key)} value={model.cost[key]} onChange={(value) => updateCost(key, value)} step="any" />
            ))}
          </div>
        </div>
        <div className="provider-settings__price-block">
          <span>{t('Context over 200k')}</span>
          <div className="provider-settings__number-grid">
            {(['input', 'output', 'cacheRead', 'cacheWrite'] as const).map((key) => (
              <NumberField key={key} label={priceLabel(key)} value={model.cost.contextOver200k[key]} onChange={(value) => updateCost(key, value, true)} step="any" />
            ))}
          </div>
        </div>
      </FormSection>

      <FormSection title="Model adapter override">
        <FormGrid>
          <FormField label="API"><input value={model.api} onChange={(event) => update('api', event.target.value)} spellCheck={false} /></FormField>
          <FormField label="npm"><input value={model.npm} onChange={(event) => update('npm', event.target.value)} spellCheck={false} /></FormField>
        </FormGrid>
      </FormSection>
      <FormSection title="Headers"><HeaderEditor headers={model.headers} onChange={(headers) => update('headers', headers)} /></FormSection>
      <FormSection title="Request options">
        <ModelRequestOptionsEditor
          value={model.optionsJson}
          showServiceTier={showServiceTier}
          onChange={(value) => update('optionsJson', value)}
        />
      </FormSection>
      <FormSection title="Variants">
        <VariantsEditor
          value={model.variantsJson}
          showServiceTier={showServiceTier}
          onChange={(value) => update('variantsJson', value)}
        />
      </FormSection>
      <FormSection title="Additional model fields">
        <JsonField label="Additional model fields" value={model.extrasJson} onChange={(value) => update('extrasJson', value)} />
      </FormSection>
    </div>
  )
}

function ModelRequestOptionsEditor({
  value,
  showServiceTier,
  onChange,
  variant = false
}: {
  value: string
  showServiceTier: boolean
  onChange: (value: string) => void
  variant?: boolean
}) {
  const { t } = useI18n()
  const options = parseEditableJsonObject(value)
  const updateOption = (key: string, next: unknown | undefined) => {
    const updated = setEditableJsonProperty(value, key, next)
    if (updated !== null) {
      onChange(updated)
    }
  }

  return (
    <div className="provider-settings__request-options">
      {options ? (
        <>
          <div className="provider-settings__option-grid">
            {variant ? (
              <JsonBooleanOptionField
                label="Variant availability"
                value={options.disabled}
                trueLabel="Disabled"
                falseLabel="Enabled"
                onChange={(next) => updateOption('disabled', next)}
              />
            ) : null}
            <JsonStringOptionField
              label="Reasoning effort"
              value={options.reasoningEffort}
              suggestions={REASONING_EFFORTS}
              onChange={(next) => updateOption('reasoningEffort', next)}
            />
            <JsonStringOptionField
              label="Reasoning summary"
              value={options.reasoningSummary}
              suggestions={['auto']}
              onChange={(next) => updateOption('reasoningSummary', next)}
            />
            <JsonStringOptionField
              label="Text verbosity"
              value={options.textVerbosity}
              suggestions={TEXT_VERBOSITIES}
              onChange={(next) => updateOption('textVerbosity', next)}
            />
            {showServiceTier ? (
              <JsonStringOptionField
                label="Service tier"
                value={options.serviceTier}
                suggestions={SERVICE_TIERS}
                onChange={(next) => updateOption('serviceTier', next)}
              />
            ) : null}
            <JsonBooleanOptionField
              label="Store responses"
              value={options.store}
              trueLabel="Enabled"
              falseLabel="Disabled"
              onChange={(next) => updateOption('store', next)}
            />
            <JsonStringOptionField
              label="Prompt cache key"
              value={options.promptCacheKey}
              onChange={(next) => updateOption('promptCacheKey', next)}
            />
          </div>
          <JsonStringListOptionField
            label="Include response fields"
            value={options.include}
            suggestions={OPENAI_INCLUDE_FIELDS}
            onChange={(next) => updateOption('include', next)}
          />
        </>
      ) : (
        <output className="provider-settings__banner is-error">{t('Invalid options JSON')}</output>
      )}
      {!variant ? (
        <details className="provider-settings__raw-json" open={!options}>
          <summary><Braces size={13} /> {t('Raw options JSON')}</summary>
          <JsonField label="Options" value={value} onChange={onChange} />
        </details>
      ) : null}
    </div>
  )
}

function VariantsEditor({
  value,
  showServiceTier,
  onChange
}: {
  value: string
  showServiceTier: boolean
  onChange: (value: string) => void
}) {
  const { t } = useI18n()
  const variants = parseEditableJsonObject(value)
  const entries = variants ? Object.entries(variants) : []
  const addVariant = () => {
    const id = nextEditableJsonKey(value, 'custom')
    const updated = addEditableJsonEntry(value, id)
    if (updated !== null) {
      onChange(updated)
    }
  }

  return (
    <div className="provider-settings__variants">
      <div className="provider-settings__variant-actions">
        <button type="button" className="provider-settings__add-row" onClick={addVariant} disabled={!variants}>
          <Plus size={14} /> {t('Add variant')}
        </button>
      </div>
      {variants && entries.length === 0 ? <div className="provider-settings__empty">{t('No custom variants')}</div> : null}
      {variants ? entries.map(([id, rawOptions], index) => (
        <VariantEditorRow
          key={id}
          source={value}
          id={id}
          options={isJsonObject(rawOptions) ? rawOptions : null}
          showServiceTier={showServiceTier}
          initiallyOpen={index === 0}
          onChange={onChange}
        />
      )) : <output className="provider-settings__banner is-error">{t('Invalid variants JSON')}</output>}
      <details className="provider-settings__raw-json" open={!variants}>
        <summary><Braces size={13} /> {t('Raw variants JSON')}</summary>
        <JsonField label="Variants" value={value} onChange={onChange} />
      </details>
    </div>
  )
}

function VariantEditorRow({
  source,
  id,
  options,
  showServiceTier,
  initiallyOpen,
  onChange
}: {
  source: string
  id: string
  options: Record<string, unknown> | null
  showServiceTier: boolean
  initiallyOpen: boolean
  onChange: (value: string) => void
}) {
  const { t } = useI18n()
  const [expanded, setExpanded] = useState(initiallyOpen)
  const [idDraft, setIdDraft] = useState(id)
  const [idError, setIdError] = useState(false)

  useEffect(() => {
    setIdDraft(id)
    setIdError(false)
  }, [id])

  const commitId = () => {
    const updated = renameEditableJsonEntry(source, id, idDraft)
    if (updated === null) {
      setIdError(true)
      return
    }
    setIdError(false)
    onChange(updated)
  }
  const duplicate = () => {
    if (!options) {
      return
    }
    const nextId = nextEditableJsonKey(source, `${id}-copy`)
    const updated = addEditableJsonEntry(source, nextId, options)
    if (updated !== null) {
      onChange(updated)
    }
  }
  const remove = () => {
    const updated = removeEditableJsonEntry(source, id)
    if (updated !== null) {
      onChange(updated)
    }
  }
  const updateOptions = (next: string) => {
    const parsed = parseEditableJsonObject(next)
    if (!parsed) {
      return
    }
    const updated = setEditableJsonProperty(source, id, parsed)
    if (updated !== null) {
      onChange(updated)
    }
  }

  return (
    <section className={`provider-settings__variant${expanded ? ' is-expanded' : ''}`}>
      <header>
        <button
          type="button"
          className="provider-settings__variant-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          <ChevronRight size={13} />
          <strong>{id}</strong>
        </button>
        <button type="button" className="provider-settings__icon-button" onClick={duplicate} disabled={!options} aria-label={`${t('Duplicate variant')}: ${id}`} title={t('Duplicate variant')}>
          <Copy size={13} />
        </button>
        <button type="button" className="provider-settings__icon-button is-danger" onClick={remove} aria-label={`${t('Remove variant')}: ${id}`} title={t('Remove variant')}>
          <Trash2 size={13} />
        </button>
      </header>
      {expanded ? (
        <div className="provider-settings__variant-body">
          <FormField label="Variant ID">
            <input
              value={idDraft}
              aria-invalid={idError}
              onChange={(event) => {
                setIdDraft(event.target.value)
                setIdError(false)
              }}
              onBlur={commitId}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.currentTarget.blur()
                }
                if (event.key === 'Escape') {
                  setIdDraft(id)
                  setIdError(false)
                  event.currentTarget.blur()
                }
              }}
              spellCheck={false}
            />
          </FormField>
          {idError ? <output className="provider-settings__field-error">{t('Variant ID must be unique and non-empty')}</output> : null}
          {options ? (
            <ModelRequestOptionsEditor
              value={formatEditableJsonObject(options)}
              showServiceTier={showServiceTier}
              onChange={updateOptions}
              variant
            />
          ) : (
            <output className="provider-settings__banner is-error">{t('Variant value must be a JSON object')}</output>
          )}
        </div>
      ) : null}
    </section>
  )
}

function JsonStringOptionField({
  label,
  value,
  suggestions = [],
  onChange
}: {
  label: string
  value: unknown
  suggestions?: readonly string[]
  onChange: (value: string | undefined) => void
}) {
  const listId = useId()
  return (
    <>
      <FormField label={label}>
        <input
          value={typeof value === 'string' ? value : ''}
          list={suggestions.length ? listId : undefined}
          aria-invalid={value !== undefined && typeof value !== 'string'}
          onChange={(event) => onChange(event.target.value || undefined)}
          spellCheck={false}
        />
      </FormField>
      {suggestions.length ? <datalist id={listId}>{suggestions.map((item) => <option key={item} value={item} />)}</datalist> : null}
    </>
  )
}

function JsonBooleanOptionField({
  label,
  value,
  trueLabel,
  falseLabel,
  onChange
}: {
  label: string
  value: unknown
  trueLabel: string
  falseLabel: string
  onChange: (value: boolean | undefined) => void
}) {
  const { t } = useI18n()
  const current = typeof value === 'boolean' ? String(value) : 'inherit'
  return (
    <FormField label={label}>
      <select
        value={current}
        aria-invalid={value !== undefined && typeof value !== 'boolean'}
        onChange={(event) => onChange(event.target.value === 'inherit' ? undefined : event.target.value === 'true')}
      >
        <option value="inherit">{t('Unspecified')}</option>
        <option value="true">{t(trueLabel)}</option>
        <option value="false">{t(falseLabel)}</option>
      </select>
    </FormField>
  )
}

function JsonStringListOptionField({
  label,
  value,
  suggestions,
  onChange
}: {
  label: string
  value: unknown
  suggestions: readonly string[]
  onChange: (value: string[] | undefined) => void
}) {
  const values = Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  return (
    <FormField label={label} wide>
      <textarea
        value={listToLines(values)}
        placeholder={suggestions[0]}
        aria-invalid={value !== undefined && (!Array.isArray(value) || values.length !== value.length)}
        onChange={(event) => {
          const next = linesToList(event.target.value)
          onChange(next.length ? next : undefined)
        }}
        rows={3}
        spellCheck={false}
      />
    </FormField>
  )
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function FormSection({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  const { t } = useI18n()
  return <section className="provider-settings__section"><h3>{icon}{t(title)}</h3>{children}</section>
}

function FormGrid({ children }: { children: ReactNode }) {
  return <div className="provider-settings__form-grid">{children}</div>
}

function FormField({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  const { t } = useI18n()
  const id = useId()
  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<{ id?: string }>, { id })
    : children
  return <div className={`provider-settings__field${wide ? ' is-wide' : ''}`}><label htmlFor={id}>{t(label)}</label>{control}</div>
}

function TriStateField({ label, value, onChange }: { label: string; value: boolean | null; onChange: (value: boolean | null) => void }) {
  const { t } = useI18n()
  return (
    <FormField label={label}>
      <select value={value === null ? 'inherit' : String(value)} onChange={(event) => onChange(event.target.value === 'inherit' ? null : event.target.value === 'true')}>
        <option value="inherit">{t('Unspecified')}</option>
        <option value="true">{t('Enabled')}</option>
        <option value="false">{t('Disabled')}</option>
      </select>
    </FormField>
  )
}

function TimeoutField({
  label,
  value,
  allowFalse,
  onChange
}: {
  label: string
  value: number | false | null
  allowFalse?: boolean
  onChange: (value: number | false | null) => void
}) {
  const { t } = useI18n()
  const mode = value === null ? 'inherit' : value === false ? 'disabled' : 'value'
  return (
    <div className="provider-settings__timeout-field">
      <span>{t(label)}</span>
      <div>
        <select
          value={mode}
          onChange={(event) => onChange(event.target.value === 'inherit' ? null : event.target.value === 'disabled' ? false : 60000)}
        >
          <option value="inherit">{t('Unspecified')}</option>
          {allowFalse ? <option value="disabled">{t('Disabled')}</option> : null}
          <option value="value">{t('Milliseconds')}</option>
        </select>
        {mode === 'value' ? (
          <input type="number" min={1} step={1} value={value === false || value === null ? '' : value} onChange={(event) => onChange(numberFromInput(event.target.value))} />
        ) : null}
      </div>
    </div>
  )
}

function InterleavedField({
  value,
  onChange
}: {
  value: ProviderSettingsModelDraft['interleaved']
  onChange: (value: ProviderSettingsModelDraft['interleaved']) => void
}) {
  const { t } = useI18n()
  const mode = value === null ? 'inherit' : typeof value === 'object' ? 'field' : typeof value === 'string' ? 'string' : String(value)
  return (
    <div className="provider-settings__interleaved">
      <FormField label="Interleaved">
        <select
          value={mode}
          onChange={(event) => {
            const next = event.target.value
            onChange(next === 'inherit' ? null : next === 'true' ? true : next === 'false' ? false : next === 'field' ? { field: '' } : '')
          }}
        >
          <option value="inherit">{t('Unspecified')}</option>
          <option value="true">{t('Enabled')}</option>
          <option value="false">{t('Disabled')}</option>
          <option value="field">{t('Field mapping')}</option>
          <option value="string">{t('String value')}</option>
        </select>
      </FormField>
      {mode === 'field' ? <input value={typeof value === 'object' && value !== null ? value.field : ''} onChange={(event) => onChange({ field: event.target.value })} placeholder="reasoning_content" /> : null}
      {mode === 'string' ? <input value={typeof value === 'string' ? value : ''} onChange={(event) => onChange(event.target.value)} /> : null}
    </div>
  )
}

function NumberField({ label, value, step = '1', onChange }: { label: string; value: number | null; step?: string; onChange: (value: number | null) => void }) {
  return (
    <FormField label={label}>
      <input type="number" min={0} step={step} value={value ?? ''} onChange={(event) => onChange(numberFromInput(event.target.value))} />
    </FormField>
  )
}

function HeaderEditor({ headers, onChange }: { headers: ProviderSettingsHeader[]; onChange: (headers: ProviderSettingsHeader[]) => void }) {
  const { t } = useI18n()
  return (
    <div className="provider-settings__headers">
      {headers.map((header, index) => (
        <div key={`${header.name}:${String(index)}`} className="provider-settings__header-row">
          <input
            value={header.name}
            onChange={(event) => {
              const next = [...headers]
              next[index] = { ...header, name: event.target.value, hasStoredValue: false }
              onChange(next)
            }}
            placeholder={t('Header name')}
            spellCheck={false}
          />
          <input
            type={header.hasStoredValue ? 'password' : 'text'}
            value={header.value}
            onChange={(event) => {
              const next = [...headers]
              next[index] = { ...header, value: event.target.value }
              onChange(next)
            }}
            placeholder={header.hasStoredValue ? t('Saved value unchanged') : t('Value')}
            spellCheck={false}
          />
          <button type="button" className="provider-settings__icon-button is-danger" onClick={() => onChange(headers.filter((_, itemIndex) => itemIndex !== index))} aria-label={`${t('Remove header')}: ${header.name || 'header'}`} title={t('Remove header')}>
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <button type="button" className="provider-settings__add-row" onClick={() => onChange([...headers, { name: '', value: '', hasStoredValue: false }])}>
        <Plus size={14} /> {t('Add header')}
      </button>
    </div>
  )
}

function JsonField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const { t } = useI18n()
  return (
    <label className="provider-settings__json-field">
      <span>{t(label)}</span>
      <textarea value={value} onChange={(event) => onChange(event.target.value)} rows={7} spellCheck={false} />
    </label>
  )
}

function ConfirmDialog({ state, onCancel, onConfirm }: { state: ConfirmState; onCancel: () => void; onConfirm: () => void }) {
  const { t } = useI18n()
  const cancelButtonRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => cancelButtonRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [])
  return (
    <div className="provider-settings__overlay" role="presentation">
      <section className="provider-settings__confirm" role="alertdialog" aria-modal="true" aria-labelledby="provider-confirm-title">
        <h2 id="provider-confirm-title">{state.title}</h2>
        <p>{state.detail}</p>
        <div>
          <button ref={cancelButtonRef} type="button" onClick={onCancel}>{t('Cancel')}</button>
          <button type="button" className={state.danger ? 'is-danger' : 'is-primary'} onClick={onConfirm}>{state.confirmLabel}</button>
        </div>
      </section>
    </div>
  )
}

function numberFromInput(value: string): number | null {
  if (!value.trim()) {
    return null
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function priceLabel(key: 'input' | 'output' | 'cacheRead' | 'cacheWrite'): string {
  if (key === 'cacheRead') return 'cache read'
  if (key === 'cacheWrite') return 'cache write'
  return key
}
