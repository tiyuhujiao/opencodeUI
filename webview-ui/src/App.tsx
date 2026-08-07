import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowUp, History, Languages, Moon, Plus, RefreshCw, Settings2, ShieldCheck, Square, Sun } from 'lucide-react'
import { createRequestId, getVsCodeApi } from './vscodeApi'
import { Transcript } from './components/Transcript'
import { ModelDialog } from './components/dialog/ModelDialog'
import { SessionDialog } from './components/dialog/SessionDialog'
import { TimelineDialog } from './components/dialog/TimelineDialog'
import { ResourceDialog, type ResourceDialogKind } from './components/dialog/ResourceDialog'
import { ExportDialog, type SessionExportOptions } from './components/dialog/ExportDialog'
import { ProviderSettingsPage } from './components/provider/ProviderSettingsPage'
import { resolveSessionSelectionAfterList } from './sessionSelection'
import {
  applyRunEventToTranscript,
  clearSettledRunStatus,
  compactTranscript,
  hasAnyAssistantText,
  isExportAtLeastAsComplete,
  mergeLocalImageParts,
  mergeLocalRunErrors,
  preserveProtectedSessionSummary,
  summarizePendingSessionTitle,
  upsertPendingSessionSummary
} from './transcriptState'
import {
  isExtensionResponseMessage,
  type AgentSummary,
  type ComposerCommandSummary,
  type ComposerMcpServerSummary,
  type ComposerSkillSummary,
  type ContextUsage,
  type HostKind,
  type InlineDiffFileSummary,
  type ModelSummary,
  type ProviderSummary,
  type QuestionInfo,
  type RunStreamEvent,
  type SessionSummary,
  type SessionTimelineItem,
  type TranscriptMessage,
  type WorkspaceResourceSummary
} from '../../src/shared/protocol'
import { summarizeEditedFiles, type EditedFileSummary } from './editedFiles'
import {
  countCompletedTodos,
  extractLatestTodosFromTranscript,
  normalizeTodoStatus,
  todoStatusLabel,
  type TodoItem
} from './todos'
import {
  findThinkingOption,
  getThinkingOptionsForModel,
  THINKING_OFF_VALUE,
  toThinkingSelection
} from './thinkingOptions'
import { readThinkingPreferences, writeThinkingPreferences } from './thinkingPreferences'
import { useI18n } from './i18n'
import { isComposerCommandInvocation, resolveComposerCommandInvocation } from './composerCommands'
import {
  appendWorkspaceMentions,
  getWorkspaceMentionState,
  hasWorkspaceMention,
  insertWorkspaceMention,
  mergeWorkspaceResources
} from './workspaceMentions'

type ThemeMode = 'light' | 'dark'

const THEME_STORAGE_KEY = 'opencode-ui.theme'

function readInitialTheme(): ThemeMode {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    return stored === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

function ContextUsageIndicator({ usage, contextWindow }: { usage: ContextUsage; contextWindow: number }) {
  const { t } = useI18n()
  const percent = Math.max(0, Math.min(100, (usage.usedTokens / contextWindow) * 100))
  const roundedPercent = Math.round(percent)
  const remainingPercent = Math.max(0, 100 - roundedPercent)
  const status = roundedPercent >= 50
    ? t('{percent}% full', { percent: roundedPercent })
    : t('{percent}% used ({remaining}% left)', { percent: roundedPercent, remaining: remainingPercent })
  const label = t('Context usage: {percent}%', { percent: roundedPercent })

  return (
    <button className="context-usage" type="button" aria-label={label}>
      <svg className="context-usage__donut" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        <circle className="context-usage__track" cx="6" cy="6" r="5" pathLength="100" />
        <circle
          className="context-usage__value"
          cx="6"
          cy="6"
          r="5"
          pathLength="100"
          strokeDasharray="100"
          strokeDashoffset={100 - percent}
        />
      </svg>
      <span className="context-usage__tooltip" role="tooltip">
        <span>{t('Context window')}:</span>
        <strong>{status}</strong>
        <span>{t('{used} / {total} tokens used', {
          used: formatTokenCount(usage.usedTokens),
          total: formatTokenCount(contextWindow)
        })}</span>
      </span>
    </button>
  )
}

function formatTokenCount(value: number): string {
  if (value < 1000) {
    return String(Math.round(value))
  }
  const thousands = value / 1000
  return `${Number.isInteger(thousands) ? thousands.toFixed(0) : thousands.toFixed(1)}k`
}

export type UiRunEvent = RunStreamEvent

type DisplayEditedFile = EditedFileSummary & {
  fileId?: string
  hunks?: number
  status?: InlineDiffFileSummary['status']
  reason?: string
}

type DebugEntry = {
  at: string
  kind: 'tx' | 'rx'
  type: string
  requestId?: string
  ok?: boolean
  detail?: string
}

type SelfcheckState = {
  state: 'idle' | 'pending' | 'ok' | 'error' | 'timeout'
  detail?: string
  lastRequestId?: string
}

type SelfcheckSnapshot = {
  health: SelfcheckState
  sessions: SelfcheckState
  models: SelfcheckState
  agents: SelfcheckState
}

type DiagnosticsState = 'idle' | 'pending' | 'ok' | 'error'

type PendingRunCompletion = {
  type: 'done' | 'stopped' | 'error'
  sessionId: string | null
}

type PendingQuestionState = {
  questionId: string
  questions: QuestionInfo[]
}

type SessionListRequestMeta = {
  background: boolean
}

type ExportRequestMeta = {
  sessionId: string
  background: boolean
}

type ActiveSubtask = {
  sessionId: string
  title: string
}

function formatHostLabel(hostKind: HostKind, remoteName?: string): string {
  if (hostKind === 'local-windows') {
    return 'Windows'
  }

  if (hostKind === 'local-linux') {
    return 'Linux'
  }

  if (hostKind === 'local-macos') {
    return 'macOS'
  }

  if (hostKind === 'wsl') {
    return 'WSL'
  }

  if (hostKind === 'remote-ssh-linux') {
    return 'Remote-SSH Linux'
  }

  if (hostKind === 'remote-linux') {
    return remoteName ? `Remote Linux (${remoteName})` : 'Remote Linux'
  }

  if (hostKind === 'remote-ssh-macos') {
    return 'Remote-SSH macOS'
  }

  if (hostKind === 'remote-macos') {
    return remoteName ? `Remote macOS (${remoteName})` : 'Remote macOS'
  }

  return remoteName ?? 'Unsupported'
}

function hasBlockingExportRequests(requests: Map<string, ExportRequestMeta>): boolean {
  for (const request of requests.values()) {
    if (!request.background) {
      return true
    }
  }
  return false
}

function hasBlockingSessionListRequests(requests: Map<string, SessionListRequestMeta>): boolean {
  for (const request of requests.values()) {
    if (!request.background) {
      return true
    }
  }
  return false
}

function getDiagnosticsState(selfcheck: SelfcheckSnapshot): DiagnosticsState {
  if (selfcheck.health.state === 'error') {
    return 'error'
  }
  if (selfcheck.health.state === 'pending' || selfcheck.health.state === 'timeout') {
    return 'pending'
  }
  if (selfcheck.health.state === 'ok') {
    return 'ok'
  }
  return 'idle'
}

function getDiagnosticsLabel(state: DiagnosticsState): string {
  if (state === 'error') {
    return 'Diagnostics: attention needed'
  }
  if (state === 'pending') {
    return 'Diagnostics: checking'
  }
  if (state === 'ok') {
    return 'Diagnostics: all checks passed'
  }
  return 'Diagnostics'
}

function getRunActivity(status: string): { kind: 'running' | 'completed' | 'stopped' | 'failed'; label: string } | null {
  if (status === 'Running…') {
    return { kind: 'running', label: 'Running' }
  }

  if (status === 'Completed') {
    return { kind: 'completed', label: 'Completed' }
  }

  if (status === 'Stopped') {
    return { kind: 'stopped', label: 'Stopped' }
  }

  if (status === 'Failed') {
    return { kind: 'failed', label: 'Failed' }
  }

  return null
}

function RunActivityIndicator({ status }: { status: string | null }) {
  const { t } = useI18n()
  const activity = status ? getRunActivity(status) : null
  return (
    <span className={`run-activity-slot${activity ? '' : ' is-empty'}`} aria-hidden={activity ? undefined : 'true'}>
      {activity ? (
        <output className={`run-indicator run-indicator--${activity.kind}`} aria-label={t(activity.label)}>
          <span className="run-indicator__icon" aria-hidden="true" />
        </output>
      ) : null}
    </span>
  )
}

function RunStatusDetails({
  status,
  files,
  onOpenFile,
  onDismissFile
}: {
  status: string | null
  files: DisplayEditedFile[]
  onOpenFile: (file: DisplayEditedFile) => void
  onDismissFile: (fileId: string) => void
}) {
  const message = status && !getRunActivity(status) ? status : null
  if (!message && files.length === 0) {
    return null
  }

  return (
    <div className="run-status-row">
      {message ? <p className="status-line status-line--message">{message}</p> : null}
      <EditedFilesSummary files={files} onOpenFile={onOpenFile} onDismissFile={onDismissFile} />
    </div>
  )
}

function EditedFilesSummary({
  files,
  onOpenFile,
  onDismissFile
}: {
  files: DisplayEditedFile[]
  onOpenFile: (file: DisplayEditedFile) => void
  onDismissFile: (fileId: string) => void
}) {
  const { t } = useI18n()
  if (files.length === 0) {
    return null
  }

  const additions = files.reduce((sum, file) => sum + file.additions, 0)
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0)
  const label = files.length === 1 ? files[0]?.displayPath : `${String(files.length)} ${t('files')}`

  return (
    <details className="edit-summary">
      <summary className="edit-summary__summary">
        <span className="edit-summary__label">{label}</span>
        <span className="edit-summary__stats">
          <span className="edit-summary__add">+{additions}</span>
          <span className="edit-summary__del">-{deletions}</span>
        </span>
      </summary>
      <div className="edit-summary__list">
        {files.map((file) => {
          const fileId = file.fileId
          const canDismiss = Boolean(fileId && file.status && file.status !== 'pending')
          const actionLabel = fileId ? (file.status === 'pending' ? t('Review') : t('View')) : t('Open')
          return (
            <div key={fileId ?? file.path} className={`edit-summary__item${file.status ? ` edit-summary__item--${file.status}` : ''}`}>
              <button
                type="button"
                className="edit-summary__open"
                onClick={() => onOpenFile(file)}
                title={file.reason}
              >
                <span className="edit-summary__file">
                  <span className="edit-summary__path">{file.displayPath}</span>
                  {file.reason ? <span className="edit-summary__reason">{file.reason}</span> : null}
                </span>
                <span className="edit-summary__meta">
                  <span className="edit-summary__stats">
                    <span className="edit-summary__add">+{file.additions}</span>
                    <span className="edit-summary__del">-{file.deletions}</span>
                  </span>
                  {typeof file.hunks === 'number' && file.hunks > 0 ? <span>{file.hunks} {t(file.hunks === 1 ? 'hunk' : 'hunks')}</span> : null}
                  {file.status && file.status !== 'pending' ? <span className="edit-summary__state">{file.status}</span> : null}
                  <span className="edit-summary__action">{actionLabel}</span>
                </span>
              </button>
              {canDismiss && fileId ? (
                <button
                  type="button"
                  className="edit-summary__dismiss"
                  aria-label={`Dismiss ${file.displayPath}`}
                  onClick={() => onDismissFile(fileId)}
                >
                  {t('Dismiss')}
                </button>
              ) : null}
            </div>
          )
        })}
      </div>
    </details>
  )
}

function mergeEditedFileSummaries(liveFiles: EditedFileSummary[], reviewFiles: InlineDiffFileSummary[]): DisplayEditedFile[] {
  const merged = new Map<string, DisplayEditedFile>()

  for (const file of liveFiles) {
    merged.set(normalizeEditedFilePath(file.path), file)
  }

  for (const file of reviewFiles) {
    merged.set(normalizeEditedFilePath(file.path), file)
  }

  return [...merged.values()]
}

function normalizeEditedFilePath(filePath: string): string {
  const normalized = filePath.replace(/\\/gu, '/')
  return /^[A-Za-z]:\//u.test(normalized) || normalized.startsWith('//') ? normalized.toLowerCase() : normalized
}

function TodoPanel({ todos }: { todos: TodoItem[] }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(true)
  const todoIdentity = todos.map((todo) => todo.content).join('\u001f')
  const previousTodoIdentityRef = useRef('')

  useEffect(() => {
    if (todos.length === 0) {
      previousTodoIdentityRef.current = ''
      return
    }

    if (previousTodoIdentityRef.current !== todoIdentity) {
      previousTodoIdentityRef.current = todoIdentity
      setOpen(true)
    }
  }, [todoIdentity, todos.length])

  if (todos.length === 0) {
    return null
  }

  const completed = countCompletedTodos(todos)
  const activeTodo = todos.find((todo) => normalizeTodoStatus(todo.status) === 'in_progress')
  const summaryText = activeTodo?.content ?? todos.find((todo) => normalizeTodoStatus(todo.status) !== 'completed')?.content ?? t('All done')

  return (
    <details
      className="composer-todo"
      open={open}
      onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="composer-todo__summary">
        <span className="composer-todo__chevron" aria-hidden="true" />
        <span className="composer-todo__title">{t('Todos')}</span>
        <span className="composer-todo__progress">
          {completed}/{todos.length}
        </span>
        <span className="composer-todo__current">{summaryText}</span>
      </summary>
      <div className="composer-todo__list">
        {todos.map((todo, index) => {
          const status = normalizeTodoStatus(todo.status)
          const statusKind = status === 'completed' ? 'completed' : status === 'in_progress' ? 'active' : 'pending'
          return (
            <div key={`${todo.content}-${String(index)}`} className={`composer-todo__item composer-todo__item--${statusKind}`}>
              <span className={`composer-todo__mark composer-todo__mark--${statusKind}`} aria-hidden="true" />
              <span className="composer-todo__content">{todo.content}</span>
              <span className="composer-todo__state">{t(todoStatusLabel(todo.status))}</span>
            </div>
          )
        })}
      </div>
    </details>
  )
}

const VISIBLE_BUILTIN_AGENT_NAMES = new Set(['build', 'plan'])
const HIDDEN_BUILTIN_AGENT_NAMES = new Set(['compaction', 'explore', 'general', 'summary', 'title'])

function normalizeAgentName(name: string) {
  return name.trim().toLowerCase()
}

function isVisibleAgentName(name: string) {
  const normalized = normalizeAgentName(name)
  return normalized.length > 0 && !HIDDEN_BUILTIN_AGENT_NAMES.has(normalized)
}

function getVisibleAgentOptions(agents: AgentSummary[], selectedAgent = '') {
  const seen = new Set<string>()
  const merged: AgentSummary[] = []

  const add = (agent: AgentSummary) => {
    const name = agent.name.trim()
    const normalized = normalizeAgentName(name)
    if (!name || !isVisibleAgentName(name) || seen.has(normalized)) {
      return
    }
    seen.add(normalized)
    merged.push({ ...agent, name })
  }

  if (selectedAgent) {
    add({ name: selectedAgent, isPrimary: false })
  }
  for (const agent of agents) {
    add(agent)
  }

  return merged
}

function isVisibleAgentSelection(agents: AgentSummary[], name: string) {
  const normalized = normalizeAgentName(name)
  if (!normalized || !isVisibleAgentName(name)) {
    return false
  }
  return VISIBLE_BUILTIN_AGENT_NAMES.has(normalized) || agents.some((agent) => normalizeAgentName(agent.name) === normalized)
}

function getDefaultAgentName(agents: AgentSummary[]) {
  const options = getVisibleAgentOptions(agents)
  return (
    options.find((agent) => normalizeAgentName(agent.name) === 'build')?.name ??
    options.find((agent) => normalizeAgentName(agent.name) === 'plan')?.name ??
    options[0]?.name ??
    'build'
  )
}

function AgentMenu({
  agents,
  selectedAgent,
  onSelect,
  loading,
  error
}: {
  agents: AgentSummary[]
  selectedAgent: string
  onSelect: (name: string) => void
  loading: boolean
  error: string | null
}) {
  const { t } = useI18n()
  const detailsRef = useRef<HTMLDetailsElement | null>(null)
  const options = useMemo(() => getVisibleAgentOptions(agents, selectedAgent), [agents, selectedAgent])
  const selected = options.find((agent) => normalizeAgentName(agent.name) === normalizeAgentName(selectedAgent))?.name ?? options[0]?.name ?? ''

  return (
    <details className="agent-menu" ref={detailsRef}>
      <summary className="agent-menu__summary" aria-label={`agent mode ${selected || 'not selected'}`}>
        <span className="agent-menu__value">{selected || (loading ? t('Loading') : t('Agent'))}</span>
        <span className="agent-menu__chevron" aria-hidden="true" />
      </summary>
      <div className="agent-menu__panel" role="listbox" aria-label="agent mode">
        {loading ? <div className="agent-menu__hint">{t('Loading...')}</div> : null}
        {error ? <div className="agent-menu__error">{t(error)}</div> : null}
        {options.length === 0 ? <div className="agent-menu__hint">{t('No agents')}</div> : null}
        {options.map((agent) => {
          const active = agent.name === selected
          return (
            <button
              key={agent.name}
              type="button"
              role="option"
              aria-selected={active}
              className={`agent-menu__option${active ? ' is-active' : ''}`}
              onClick={() => {
                onSelect(agent.name)
                if (detailsRef.current) {
                  detailsRef.current.open = false
                }
              }}
            >
              <span className="agent-menu__optionName">{agent.name}</span>
            </button>
          )
        })}
      </div>
    </details>
  )
}

function QuestionBanner({
  pending,
  onReply,
  onReject
}: {
  pending: PendingQuestionState
  onReply: (questionId: string, answers: string[][]) => void
  onReject: (questionId: string) => void
}) {
  const { t } = useI18n()
  const [selected, setSelected] = useState<string[][]>(() => pending.questions.map(() => []))
  const [customAnswers, setCustomAnswers] = useState<string[]>(() => pending.questions.map(() => ''))

  useEffect(() => {
    setSelected(pending.questions.map(() => []))
    setCustomAnswers(pending.questions.map(() => ''))
  }, [pending.questions])

  const answers = useMemo(
    () =>
      pending.questions.map((question, index) => {
        const chosen = selected[index] ?? []
        const custom = question.custom === false ? '' : (customAnswers[index] ?? '').trim()
        if (!custom) {
          return chosen
        }
        if (question.multiple) {
          return Array.from(new Set([...chosen, custom]))
        }
        return [custom]
      }),
    [customAnswers, pending.questions, selected]
  )

  const canReply = answers.length === pending.questions.length && answers.every((answer) => answer.length > 0)

  const toggleOption = (questionIndex: number, label: string, multiple: boolean | undefined) => {
    setSelected((current) => {
      const next = current.map((answer) => [...answer])
      const answer = next[questionIndex] ?? []
      if (!multiple) {
        next[questionIndex] = [label]
        return next
      }
      next[questionIndex] = answer.includes(label) ? answer.filter((item) => item !== label) : [...answer, label]
      return next
    })
  }

  return (
    <div className="question-banner" role="alert">
      <div className="question-banner__header">{t('Question needs input')}</div>
      <div className="question-banner__body">
        {pending.questions.map((question, questionIndex) => {
          const inputType = question.multiple ? 'checkbox' : 'radio'
          const groupName = `${pending.questionId}-${String(questionIndex)}`
          return (
            <fieldset key={`${pending.questionId}-${String(questionIndex)}`} className="question-banner__question">
              <legend>
                <span className="question-banner__label">{question.header}</span>
                <span className="question-banner__text">{question.question}</span>
              </legend>
              <div className="question-banner__options">
                {question.options.map((option) => (
                  <label key={option.label} className="question-banner__option">
                    <input
                      type={inputType}
                      name={groupName}
                      checked={(selected[questionIndex] ?? []).includes(option.label)}
                      onChange={() => toggleOption(questionIndex, option.label, question.multiple)}
                    />
                    <span>
                      <span className="question-banner__optionLabel">{option.label}</span>
                      <span className="question-banner__optionDescription">{option.description}</span>
                    </span>
                  </label>
                ))}
              </div>
              {question.custom !== false ? (
                <input
                  className="question-banner__custom"
                  value={customAnswers[questionIndex] ?? ''}
                  placeholder={t('Custom answer')}
                  onChange={(event) => {
                    const value = event.currentTarget.value
                    setCustomAnswers((current) => {
                      const next = [...current]
                      next[questionIndex] = value
                      return next
                    })
                  }}
                />
              ) : null}
            </fieldset>
          )
        })}
      </div>
      <div className="question-banner__actions">
        <button type="button" onClick={() => onReply(pending.questionId, answers)} disabled={!canReply}>
          {t('Reply')}
        </button>
        <button type="button" onClick={() => onReject(pending.questionId)}>
          {t('Dismiss')}
        </button>
      </div>
    </div>
  )
}

export default function App() {
  const { language, setLanguage, t } = useI18n()
  const [status, setStatus] = useState('Connecting...')
  const [workspaceFolderPath, setWorkspaceFolderPath] = useState<string | undefined>(undefined)
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => readInitialTheme())
  const [debugEnabled, setDebugEnabled] = useState(false)
  const [debugPopoverOpen, setDebugPopoverOpen] = useState(false)
  const [debugLog, setDebugLog] = useState<DebugEntry[]>([])

  const [selfcheck, setSelfcheck] = useState<SelfcheckSnapshot>({
    health: { state: 'idle' },
    sessions: { state: 'idle' },
    models: { state: 'idle' },
    agents: { state: 'idle' }
  })

  const pushDebug = useCallback((entry: DebugEntry) => {
    setDebugLog((current) => [...current, entry].slice(-200))
  }, [])

  const selfcheckTimersRef = useRef<{ health?: number; sessions?: number; models?: number; agents?: number }>({})

  const startSelfcheckTimer = useCallback(
    (key: keyof SelfcheckSnapshot, requestId: string) => {
      const existing = selfcheckTimersRef.current[key]
      if (existing) {
        window.clearTimeout(existing)
      }

      selfcheckTimersRef.current[key] = window.setTimeout(() => {
        setSelfcheck((current) => {
          const target = current[key]
          if (target.state !== 'pending' || target.lastRequestId !== requestId) {
            return current
          }
          return {
            ...current,
            [key]: {
              state: 'timeout',
              detail: 'No response from extension',
              lastRequestId: requestId
            }
          }
        })
      }, key === 'health' ? 8000 : 4000)
    },
    []
  )
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [sessionsError, setSessionsError] = useState<string | null>(null)
  const [loadingSessions, setLoadingSessions] = useState(false)
  const [transcript, setTranscript] = useState<TranscriptMessage[]>([])
  const [transcriptError, setTranscriptError] = useState<string | null>(null)
  const [loadingTranscript, setLoadingTranscript] = useState(false)
  const [activeSubtask, setActiveSubtask] = useState<ActiveSubtask | null>(null)
  const [subtaskTranscript, setSubtaskTranscript] = useState<TranscriptMessage[]>([])
  const [subtaskTranscriptError, setSubtaskTranscriptError] = useState<string | null>(null)
  const [loadingSubtaskTranscript, setLoadingSubtaskTranscript] = useState(false)
  const [models, setModels] = useState<ModelSummary[]>([])
  const [agents, setAgents] = useState<AgentSummary[]>([])
  const [composerCommands, setComposerCommands] = useState<ComposerCommandSummary[]>([])
  const [composerSkills, setComposerSkills] = useState<ComposerSkillSummary[]>([])
  const [composerMcpServers, setComposerMcpServers] = useState<ComposerMcpServerSummary[]>([])
  const [resourceDialogKind, setResourceDialogKind] = useState<ResourceDialogKind | null>(null)
  const [pendingMcpTargets, setPendingMcpTargets] = useState<Map<string, boolean>>(new Map())
  const [refreshingResources, setRefreshingResources] = useState(false)
  const [mcpError, setMcpError] = useState<string | null>(null)
  const [selectedModel, setSelectedModel] = useState<string>('')
  const [selectedAgent, setSelectedAgent] = useState<string>('')
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [agentsError, setAgentsError] = useState<string | null>(null)
  const [loadingModels, setLoadingModels] = useState(false)
  const [modelsLoaded, setModelsLoaded] = useState(false)
  const [loadingAgents, setLoadingAgents] = useState(false)

  const [providers, setProviders] = useState<ProviderSummary[]>([])
  const [providersError, setProvidersError] = useState<string | null>(null)
  const [loadingProviders, setLoadingProviders] = useState(false)
  const [selectedProviderId, setSelectedProviderId] = useState('')
  const [composerValue, setComposerValue] = useState('')
  const [composerCursor, setComposerCursor] = useState(0)
  const [workspaceResources, setWorkspaceResources] = useState<WorkspaceResourceSummary[]>([])
  const [workspaceAttachments, setWorkspaceAttachments] = useState<WorkspaceResourceSummary[]>([])
  const [workspaceResourceIndex, setWorkspaceResourceIndex] = useState(0)
  const composerRef = useRef<HTMLTextAreaElement | null>(null)
  const commandMenuRef = useRef<HTMLDivElement | null>(null)
  const workspaceMenuRef = useRef<HTMLDivElement | null>(null)
  const permissionAllowButtonRef = useRef<HTMLButtonElement | null>(null)

  const [commandIndex, setCommandIndex] = useState(0)
  const [selectedNativeCommandName, setSelectedNativeCommandName] = useState<string | null>(null)
  const [deleteArmed, setDeleteArmed] = useState<null | { sessionId: string; armedAt: number }>(null)
  const [pastedImage, setPastedImage] = useState<null | { fileName: string; bytesBase64: string; previewUrl: string; mimeType: string }>(
    null
  )
  const [pastedImageFilePath, setPastedImageFilePath] = useState<string | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [runStatus, setRunStatus] = useState<string | null>(null)
  const clearSettledRunIndicator = useCallback(() => setRunStatus(clearSettledRunStatus), [])
  const [editedFiles, setEditedFiles] = useState<EditedFileSummary[]>([])
  const [reviewFiles, setReviewFiles] = useState<InlineDiffFileSummary[]>([])
  const displayedEditedFiles = useMemo(() => mergeEditedFileSummaries(editedFiles, reviewFiles), [editedFiles, reviewFiles])

  const [thinkingPreferences, setThinkingPreferences] = useState<Record<string, string>>(() =>
    readThinkingPreferences(window.localStorage)
  )
  const selectedModelSummary = useMemo(() => models.find((model) => model.name === selectedModel), [models, selectedModel])
  const thinkingOptions = useMemo(() => getThinkingOptionsForModel(selectedModelSummary), [selectedModelSummary])
  const savedThinkingOption = thinkingPreferences[selectedModel] ?? THINKING_OFF_VALUE
  const selectedThinkingOption = findThinkingOption(thinkingOptions, savedThinkingOption) ?? THINKING_OFF_VALUE
  const thinkingSelection = toThinkingSelection(selectedThinkingOption)
  const thinkingEnabled = thinkingSelection.enabled
  const thinkingVariant = thinkingSelection.variant
  const contextUsage = useMemo(() => {
    for (let index = transcript.length - 1; index >= 0; index -= 1) {
      const usage = transcript[index]?.contextUsage
      if (!usage) {
        continue
      }
      const model = models.find((entry) => entry.name === usage.model) ?? selectedModelSummary
      if (model?.contextWindow) {
        return { usage, contextWindow: model.contextWindow }
      }
    }
    return selectedModelSummary?.contextWindow
      ? {
          usage: { usedTokens: 0, model: selectedModelSummary.name },
          contextWindow: selectedModelSummary.contextWindow
        }
      : null
  }, [models, selectedModelSummary, transcript])

  const [modelDialogOpen, setModelDialogOpen] = useState(false)
  const [providerSettingsOpen, setProviderSettingsOpen] = useState(false)
  const [sessionDialogOpen, setSessionDialogOpen] = useState(false)
  const [timelineDialogOpen, setTimelineDialogOpen] = useState(false)
  const [exportDialogOpen, setExportDialogOpen] = useState(false)
  const [exportDialogBusy, setExportDialogBusy] = useState(false)
  const [exportDialogError, setExportDialogError] = useState<string | null>(null)
  const [timelineItems, setTimelineItems] = useState<SessionTimelineItem[]>([])
  const [timelineLoading, setTimelineLoading] = useState(false)
  const [timelineError, setTimelineError] = useState<string | null>(null)
  const [timelineRevertMessageId, setTimelineRevertMessageId] = useState<string | null>(null)
  const [pendingPermission, setPendingPermission] = useState<null | {
    permissionId: string
    toolName: string
    patterns: string[]
    message?: string
  }>(null)
  const [pendingQuestion, setPendingQuestion] = useState<PendingQuestionState | null>(null)

  const [lastRunPartKind, setLastRunPartKind] = useState<'text' | 'tool' | 'reasoning' | 'image' | 'unknown' | null>(null)

  const readyRequestIdRef = useRef<string>('')
  const sessionsRequestIdsRef = useRef<Map<string, SessionListRequestMeta>>(new Map())
  const exportRequestIdsRef = useRef<Map<string, ExportRequestMeta>>(new Map())
  const markdownExportRequestIdsRef = useRef<Set<string>>(new Set())
  const subtaskTranscriptRequestIdsRef = useRef<Map<string, string>>(new Map())
  const deleteRequestIdsRef = useRef<Map<string, string>>(new Map())
  const timelineRequestIdsRef = useRef<Map<string, string>>(new Map())
  const undoRequestIdsRef = useRef<Map<string, string>>(new Map())
  const redoRequestIdsRef = useRef<Map<string, string>>(new Map())
  const permissionReplyRequestIdsRef = useRef<Map<string, string>>(new Map())
  const questionReplyRequestIdsRef = useRef<Map<string, string>>(new Map())
  const questionRejectRequestIdsRef = useRef<Map<string, string>>(new Map())
  const inlineDiffOpenRequestIdsRef = useRef<Map<string, string>>(new Map())
  const inlineDiffDismissRequestIdsRef = useRef<Map<string, string>>(new Map())
  const inlineDiffRevisionRef = useRef(-1)
  const providersRequestIdsRef = useRef<Set<string>>(new Set())
  const modelsRequestIdsRef = useRef<Set<string>>(new Set())
  const agentsRequestIdsRef = useRef<Set<string>>(new Set())
  const composerResourcesRequestIdsRef = useRef<Set<string>>(new Set())
  const latestComposerResourcesRequestIdRef = useRef<string | null>(null)
  const mcpRequestIdsRef = useRef<Map<string, { name: string; enabled: boolean }>>(new Map())
  const workspaceSearchRequestIdsRef = useRef<Set<string>>(new Set())
  const latestWorkspaceSearchRequestIdRef = useRef<string | null>(null)
  const workspaceResolveRequestIdsRef = useRef<Set<string>>(new Set())
  const fileOpenRequestIdsRef = useRef<Set<string>>(new Set())
  const tempfileRequestIdsRef = useRef<Map<string, { previewUrl: string }>>(new Map())
  const runStartRequestIdRef = useRef<string | null>(null)
  const runStopRequestIdsRef = useRef<Set<string>>(new Set())
  const pendingInitialSelectedModelRef = useRef<string | null>(null)
  const pendingInitialSelectedAgentRef = useRef<string | null>(null)
  const activeRunRef = useRef<{
    requestId: string
    assistantIndex: number
    sessionId: string | null
    placeholderTitle: string
    startedNewSession: boolean
  } | null>(null)

  const lastCompletedRunRef = useRef<{
    sessionId: string
    completedAt: number
    localTranscript: TranscriptMessage[]
    exportAttempts: number
  } | null>(null)
  const runErrorTranscriptsRef = useRef<Map<string, TranscriptMessage[]>>(new Map())

  const allowAutoSelectSessionRef = useRef(true)
  const isRunningRef = useRef(false)
  const suppressNextSessionAutoExportRef = useRef(true)

  const sessionsRef = useRef<SessionSummary[]>([])
  const transcriptRef = useRef<TranscriptMessage[]>([])
  const activeSubtaskRef = useRef<ActiveSubtask | null>(null)

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, themeMode)
    } catch {
      // Webview storage can be unavailable in constrained hosts; keep the in-memory theme active.
    }
  }, [themeMode])

  useEffect(() => {
    writeThinkingPreferences(window.localStorage, thinkingPreferences)
  }, [thinkingPreferences])

  const selectThinkingOption = useCallback(
    (value: string) => {
      if (!selectedModel) {
        return
      }
      const option = findThinkingOption(thinkingOptions, value) ?? THINKING_OFF_VALUE
      setThinkingPreferences((current) => ({ ...current, [selectedModel]: option }))
    },
    [selectedModel, thinkingOptions]
  )

  // biome-ignore lint/correctness/useExhaustiveDependencies: We intentionally register the message handler once.
  // biome-ignore lint/correctness/useExhaustiveDependencies: Handler reads transcriptRef instead of transcript.
  // biome-ignore lint/correctness/useExhaustiveDependencies: Avoid re-registering listeners on transcript changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: Handler reads transcriptRef instead of transcript.
  // biome-ignore lint/correctness/useExhaustiveDependencies: Avoid re-registering listeners on transcript changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: transcript is intentionally not a dependency.
  useEffect(() => {
    isRunningRef.current = isRunning
  }, [isRunning])

  useEffect(() => {
    transcriptRef.current = transcript
  }, [transcript])

  useEffect(() => {
    activeSubtaskRef.current = activeSubtask
  }, [activeSubtask])

  useEffect(() => {
    sessionsRef.current = sessions
  }, [sessions])

  const requestSessions = useCallback((options?: { background?: boolean }) => {
    const vscode = getVsCodeApi()
    if (!vscode) {
      setSessionsError('Not running in VS Code')
      return
    }

    const requestId = createRequestId()
    const background = options?.background === true
    pushDebug({
      at: new Date().toISOString(),
      kind: 'tx',
      type: 'sessions.list',
      requestId,
      detail: background ? 'background=true' : undefined
    })

    if (!background) {
      setSelfcheck((current) => ({
        ...current,
        sessions: {
          state: 'pending',
          detail: 'Request sent',
          lastRequestId: requestId
        }
      }))
      startSelfcheckTimer('sessions', requestId)
      setLoadingSessions(true)
      setSessionsError(null)
    }
    sessionsRequestIdsRef.current.set(requestId, { background })

    vscode.postMessage({
      type: 'sessions.list',
      requestId
    })
  }, [pushDebug, startSelfcheckTimer])

  const requestSelfcheck = useCallback(() => {
    try {
      const vscode = getVsCodeApi()
      if (!vscode) {
        pushDebug({
          at: new Date().toISOString(),
          kind: 'tx',
          type: 'selfcheck.run',
          detail: 'Not running in VS Code'
        })
        setSelfcheck({
          health: { state: 'error', detail: 'Not running in VS Code' },
          sessions: { state: 'error', detail: 'Not running in VS Code' },
          models: { state: 'error', detail: 'Not running in VS Code' },
          agents: { state: 'error', detail: 'Not running in VS Code' }
        })
        return
      }

      const requestId = createRequestId()
      pushDebug({
        at: new Date().toISOString(),
        kind: 'tx',
        type: 'selfcheck.run',
        requestId
      })

      setSelfcheck((current) => ({
        health:
          current.health.state === 'ok'
            ? { ...current.health, detail: 'Refreshing', lastRequestId: requestId }
            : { state: 'pending', detail: 'Request sent', lastRequestId: requestId },
        sessions: { state: 'pending', detail: 'Request sent', lastRequestId: requestId },
        models: { state: 'pending', detail: 'Request sent', lastRequestId: requestId },
        agents: { state: 'pending', detail: 'Request sent', lastRequestId: requestId }
      }))

      startSelfcheckTimer('health', requestId)
      startSelfcheckTimer('sessions', requestId)
      startSelfcheckTimer('models', requestId)
      startSelfcheckTimer('agents', requestId)

      vscode.postMessage({
        type: 'selfcheck.run',
        requestId
      })
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      pushDebug({
        at: new Date().toISOString(),
        kind: 'rx',
        type: 'selfcheck.run',
        ok: false,
        detail
      })
      setSelfcheck({
        health: { state: 'error', detail },
        sessions: { state: 'error', detail },
        models: { state: 'error', detail },
        agents: { state: 'error', detail }
      })
    }
  }, [pushDebug, startSelfcheckTimer])

  const requestSessionExport = useCallback((sessionId: string, options?: { background?: boolean }) => {
    const vscode = getVsCodeApi()
    if (!vscode) {
      setTranscriptError('Not running in VS Code')
      return
    }

    // Avoid stale export responses racing with a live run for the same session.
    const active = activeRunRef.current
    if (active?.sessionId === sessionId) {
      return
    }

    const background = options?.background === true
    for (const [pendingRequestId, pending] of exportRequestIdsRef.current.entries()) {
      if (pending.sessionId === sessionId) {
        if (!background && pending.background) {
          exportRequestIdsRef.current.set(pendingRequestId, {
            ...pending,
            background: false
          })
          setLoadingTranscript(true)
        }
        return
      }
    }

    const requestId = createRequestId()
    pushDebug({
      at: new Date().toISOString(),
      kind: 'tx',
      type: 'session.export',
      requestId,
      detail: sessionId
    })
    exportRequestIdsRef.current.set(requestId, { sessionId, background })
    if (!background) {
      setLoadingTranscript(true)
    }
    setTranscriptError(null)

    vscode.postMessage({
      type: 'session.export',
      requestId,
      payload: {
        sessionId
      }
    })
  }, [pushDebug])

  const requestSessionMarkdownExport = useCallback((options: SessionExportOptions) => {
    const vscode = getVsCodeApi()
    const sessionId = selectedSessionIdRef.current
    if (!vscode || !sessionId) {
      setExportDialogError(vscode ? 'No session selected' : 'Not running in VS Code')
      return
    }

    const requestId = createRequestId()
    markdownExportRequestIdsRef.current.add(requestId)
    setExportDialogBusy(true)
    setExportDialogError(null)
    pushDebug({
      at: new Date().toISOString(),
      kind: 'tx',
      type: 'session.export.markdown',
      requestId,
      detail: `${sessionId} | ${options.openWithoutSaving ? 'open' : options.filename}`
    })
    vscode.postMessage({
      type: 'session.export.markdown',
      requestId,
      payload: {
        sessionId,
        filename: options.filename,
        includeThinking: options.includeThinking,
        includeToolDetails: options.includeToolDetails,
        includeAssistantMetadata: options.includeAssistantMetadata,
        openWithoutSaving: options.openWithoutSaving
      }
    })
  }, [pushDebug])

  const requestSubtaskTranscript = useCallback((sessionId: string) => {
    const vscode = getVsCodeApi()
    if (!vscode) {
      setSubtaskTranscriptError('Not running in VS Code')
      return
    }

    if ([...subtaskTranscriptRequestIdsRef.current.values()].includes(sessionId)) {
      return
    }

    const requestId = createRequestId()
    subtaskTranscriptRequestIdsRef.current.set(requestId, sessionId)
    setLoadingSubtaskTranscript(true)
    setSubtaskTranscriptError(null)
    vscode.postMessage({
      type: 'subtask.transcript',
      requestId,
      payload: { sessionId }
    })
  }, [])

  const openSubtask = useCallback((subtask: ActiveSubtask) => {
    subtaskTranscriptRequestIdsRef.current.clear()
    activeSubtaskRef.current = subtask
    setActiveSubtask(subtask)
    setSubtaskTranscript([])
    setSubtaskTranscriptError(null)
    requestSubtaskTranscript(subtask.sessionId)
  }, [requestSubtaskTranscript])

  useEffect(() => {
    if (!activeSubtask) {
      return
    }
    const timer = window.setInterval(() => {
      requestSubtaskTranscript(activeSubtask.sessionId)
    }, 1500)
    return () => window.clearInterval(timer)
  }, [activeSubtask, requestSubtaskTranscript])

  const applyLiveRunEvent = useCallback((event: Extract<UiRunEvent, { type: 'part' } | { type: 'context.usage' } | { type: 'error' }>, assistantIndex: number) => {
    const nextTranscript = applyRunEventToTranscript(transcriptRef.current, event, assistantIndex)
    transcriptRef.current = nextTranscript
    setTranscript(nextTranscript)
    const assistantMessage = nextTranscript[assistantIndex]
    setEditedFiles(assistantMessage ? summarizeEditedFiles([assistantMessage], workspaceFolderPath) : [])
    return nextTranscript
  }, [workspaceFolderPath])

  const moveSessionExportsToBackground = useCallback((sessionId: string | null) => {
    if (!sessionId) {
      return
    }

    let changed = false
    for (const [requestId, pending] of exportRequestIdsRef.current.entries()) {
      if (pending.sessionId === sessionId && !pending.background) {
        exportRequestIdsRef.current.set(requestId, {
          ...pending,
          background: true
        })
        changed = true
      }
    }

    if (changed) {
      setLoadingTranscript(hasBlockingExportRequests(exportRequestIdsRef.current))
    }
  }, [])

  const completeRun = useCallback((completion: PendingRunCompletion) => {
    const active = activeRunRef.current
    const assistantMessage = typeof active?.assistantIndex === 'number' ? transcriptRef.current[active.assistantIndex] : undefined
    setEditedFiles(assistantMessage ? summarizeEditedFiles([assistantMessage], workspaceFolderPath) : [])
    setIsRunning(false)
    setLastRunPartKind(null)
    setPendingPermission(null)
    setPendingQuestion(null)

    if (completion.type === 'done') {
      setRunStatus('Completed')
    } else if (completion.type === 'stopped') {
      setRunStatus('Stopped')
    } else {
      setRunStatus('Failed')
      if (completion.sessionId) {
        runErrorTranscriptsRef.current.set(completion.sessionId, transcriptRef.current)
      }
    }

    if (completion.sessionId && completion.type !== 'stopped') {
      lastCompletedRunRef.current = {
        sessionId: completion.sessionId,
        completedAt: Date.now(),
        localTranscript: transcriptRef.current,
        exportAttempts: 0
      }
    }

    activeRunRef.current = null

    const finalSessionId = completion.sessionId
    if (finalSessionId) {
      window.setTimeout(() => requestSessionExport(finalSessionId, { background: true }), 350)
    }
  }, [requestSessionExport, workspaceFolderPath])

  const selectSession = useCallback((sessionId: string | null, options?: { suppressAutoExport?: boolean; allowDuringRun?: boolean }) => {
    if (isRunningRef.current && options?.allowDuringRun !== true) {
      setRunStatus('Cannot switch session while running')
      return
    }
    suppressNextSessionAutoExportRef.current = options?.suppressAutoExport ?? false
    if (!isRunningRef.current) {
      setEditedFiles([])
    }
    activeSubtaskRef.current = null
    setActiveSubtask(null)
    setSubtaskTranscript([])
    setSubtaskTranscriptError(null)
    clearSettledRunIndicator()
    setSelectedSessionId(sessionId)
  }, [clearSettledRunIndicator])

  const requestSessionDelete = useCallback(
    (sessionId: string) => {
      const vscode = getVsCodeApi()
      if (!vscode) {
        setSessionsError('Not running in VS Code')
        return
      }
      if (!sessionId) {
        return
      }

      const requestId = createRequestId()
      pushDebug({
        at: new Date().toISOString(),
        kind: 'tx',
        type: 'session.delete',
        requestId,
        detail: sessionId
      })
      deleteRequestIdsRef.current.set(requestId, sessionId)
      vscode.postMessage({
        type: 'session.delete',
        requestId,
        payload: { sessionId }
      })
    },
    [pushDebug]
  )

  const requestSessionTimeline = useCallback(
    (sessionId: string) => {
      const vscode = getVsCodeApi()
      if (!vscode) {
        setTimelineError('Not running in VS Code')
        return
      }
      if (!sessionId) {
        return
      }

      const requestId = createRequestId()
      timelineRequestIdsRef.current.set(requestId, sessionId)
      setTimelineLoading(true)
      setTimelineError(null)
      pushDebug({
        at: new Date().toISOString(),
        kind: 'tx',
        type: 'session.timeline',
        requestId,
        detail: sessionId
      })
      vscode.postMessage({
        type: 'session.timeline',
        requestId,
        payload: { sessionId }
      })
    },
    [pushDebug]
  )

  const requestSessionUndo = useCallback(
    (sessionId: string) => {
      const vscode = getVsCodeApi()
      if (!vscode) {
        setRunStatus('Not running in VS Code')
        return
      }
      if (!sessionId) {
        return
      }

      const requestId = createRequestId()
      undoRequestIdsRef.current.set(requestId, sessionId)
      pushDebug({
        at: new Date().toISOString(),
        kind: 'tx',
        type: 'session.undo',
        requestId,
        detail: sessionId
      })
      vscode.postMessage({
        type: 'session.undo',
        requestId,
        payload: { sessionId }
      })
    },
    [pushDebug]
  )

  const requestSessionRedo = useCallback(
    (sessionId: string) => {
      const vscode = getVsCodeApi()
      if (!vscode) {
        setRunStatus('Not running in VS Code')
        return
      }
      if (!sessionId) {
        return
      }

      const requestId = createRequestId()
      redoRequestIdsRef.current.set(requestId, sessionId)
      pushDebug({
        at: new Date().toISOString(),
        kind: 'tx',
        type: 'session.redo',
        requestId,
        detail: sessionId
      })
      vscode.postMessage({
        type: 'session.redo',
        requestId,
        payload: { sessionId }
      })
    },
    [pushDebug]
  )

  const requestPermissionReply = useCallback(
    (permissionId: string, reply: 'once' | 'always' | 'reject', message?: string) => {
      const vscode = getVsCodeApi()
      if (!vscode) {
        setRunStatus('Not running in VS Code')
        return
      }
      const requestId = createRequestId()
      permissionReplyRequestIdsRef.current.set(requestId, permissionId)
      pushDebug({
        at: new Date().toISOString(),
        kind: 'tx',
        type: 'permission.reply',
        requestId,
        detail: `${permissionId} | ${reply}`
      })
      vscode.postMessage({
        type: 'permission.reply',
        requestId,
        payload: {
          permissionId,
          reply,
          message
        }
      })
    },
    [pushDebug]
  )

  const requestQuestionReply = useCallback(
    (questionId: string, answers: string[][]) => {
      const vscode = getVsCodeApi()
      if (!vscode) {
        setRunStatus('Not running in VS Code')
        return
      }
      const requestId = createRequestId()
      questionReplyRequestIdsRef.current.set(requestId, questionId)
      pushDebug({
        at: new Date().toISOString(),
        kind: 'tx',
        type: 'question.reply',
        requestId,
        detail: questionId
      })
      vscode.postMessage({
        type: 'question.reply',
        requestId,
        payload: {
          questionId,
          answers
        }
      })
    },
    [pushDebug]
  )

  const requestQuestionReject = useCallback(
    (questionId: string) => {
      const vscode = getVsCodeApi()
      if (!vscode) {
        setRunStatus('Not running in VS Code')
        return
      }
      const requestId = createRequestId()
      questionRejectRequestIdsRef.current.set(requestId, questionId)
      pushDebug({
        at: new Date().toISOString(),
        kind: 'tx',
        type: 'question.reject',
        requestId,
        detail: questionId
      })
      vscode.postMessage({
        type: 'question.reject',
        requestId,
        payload: {
          questionId
        }
      })
    },
    [pushDebug]
  )

  const openEditedFile = useCallback(
    (file: DisplayEditedFile) => {
      const vscode = getVsCodeApi()
      if (!vscode) {
        setRunStatus('Not running in VS Code')
        return
      }

      const requestId = createRequestId()
      if (file.fileId) {
        inlineDiffOpenRequestIdsRef.current.set(requestId, file.fileId)
        pushDebug({
          at: new Date().toISOString(),
          kind: 'tx',
          type: 'inlineDiff.open',
          requestId,
          detail: file.fileId
        })
        vscode.postMessage({
          type: 'inlineDiff.open',
          requestId,
          payload: {
            fileId: file.fileId
          }
        })
        return
      }

      fileOpenRequestIdsRef.current.add(requestId)
      pushDebug({
        at: new Date().toISOString(),
        kind: 'tx',
        type: 'file.open',
        requestId,
        detail: file.path
      })
      vscode.postMessage({
        type: 'file.open',
        requestId,
        payload: {
          path: file.path
        }
      })
    },
    [pushDebug]
  )

  const openFileReference = useCallback(
    (reference: { path: string; line?: number; column?: number }) => {
      const vscode = getVsCodeApi()
      if (!vscode) {
        setRunStatus('Not running in VS Code')
        return
      }
      const requestId = createRequestId()
      fileOpenRequestIdsRef.current.add(requestId)
      pushDebug({
        at: new Date().toISOString(),
        kind: 'tx',
        type: 'file.open',
        requestId,
        detail: `${reference.path}${reference.line ? `:${String(reference.line)}` : ''}`
      })
      vscode.postMessage({
        type: 'file.open',
        requestId,
        payload: reference
      })
    },
    [pushDebug]
  )

  const dismissEditedFile = useCallback(
    (fileId: string) => {
      const vscode = getVsCodeApi()
      if (!vscode) {
        setRunStatus('Not running in VS Code')
        return
      }

      const requestId = createRequestId()
      inlineDiffDismissRequestIdsRef.current.set(requestId, fileId)
      pushDebug({
        at: new Date().toISOString(),
        kind: 'tx',
        type: 'inlineDiff.dismiss',
        requestId,
        detail: fileId
      })
      vscode.postMessage({
        type: 'inlineDiff.dismiss',
        requestId,
        payload: { fileId }
      })
    },
    [pushDebug]
  )

  const handleDeleteSession = useCallback(
    (sessionId: string) => {
      if (!sessionId) {
        return
      }
      const active = activeRunRef.current
      if (isRunningRef.current && active?.sessionId === sessionId) {
        setSessionsError('当前会话正在运行，无法删除。')
        return
      }

      // TUI-like: the second Ctrl+D is the confirmation.
      requestSessionDelete(sessionId)
    },
    [requestSessionDelete]
  )

  const requestModels = useCallback((options?: { forceRefresh?: boolean }) => {
    const vscode = getVsCodeApi()
    if (!vscode) {
      setModelsError('Not running in VS Code')
      return
    }

    const requestId = createRequestId()
    const forceRefresh = options?.forceRefresh === true
    pushDebug({
      at: new Date().toISOString(),
      kind: 'tx',
      type: 'models.list',
      requestId,
      detail: forceRefresh ? 'forceRefresh=true' : undefined
    })

    setSelfcheck((current) => ({
      ...current,
      models: {
        state: 'pending',
        detail: 'Request sent',
        lastRequestId: requestId
      }
    }))
    startSelfcheckTimer('models', requestId)
    modelsRequestIdsRef.current.add(requestId)
    setLoadingModels(true)
    setModelsError(null)
    if (forceRefresh) {
      setModelsLoaded(false)
    }
    vscode.postMessage({
      type: 'models.list',
      requestId,
      payload: forceRefresh ? { forceRefresh: true } : undefined
    })
  }, [pushDebug, startSelfcheckTimer])

  const requestProviders = useCallback((options?: { forceRefresh?: boolean }) => {
    const vscode = getVsCodeApi()
    if (!vscode) {
      setProvidersError('Not running in VS Code')
      return
    }

    const requestId = createRequestId()
    const forceRefresh = options?.forceRefresh === true
    pushDebug({
      at: new Date().toISOString(),
      kind: 'tx',
      type: 'providers.list',
      requestId,
      detail: forceRefresh ? 'forceRefresh=true' : undefined
    })

    setLoadingProviders(true)
    setProvidersError(null)
    providersRequestIdsRef.current.add(requestId)
    vscode.postMessage({
      type: 'providers.list',
      requestId,
      payload: forceRefresh ? { forceRefresh: true } : undefined
    })
  }, [pushDebug])

  const requestAgents = useCallback(() => {
    const vscode = getVsCodeApi()
    if (!vscode) {
      setAgentsError('Not running in VS Code')
      return
    }

    const requestId = createRequestId()
    pushDebug({
      at: new Date().toISOString(),
      kind: 'tx',
      type: 'agents.list',
      requestId
    })

    setSelfcheck((current) => ({
      ...current,
      agents: {
        state: 'pending',
        detail: 'Request sent',
        lastRequestId: requestId
      }
    }))
    startSelfcheckTimer('agents', requestId)
    agentsRequestIdsRef.current.add(requestId)
    setLoadingAgents(true)
    setAgentsError(null)
    vscode.postMessage({
      type: 'agents.list',
      requestId
    })
  }, [pushDebug, startSelfcheckTimer])

  const requestComposerResources = useCallback(() => {
    const vscode = getVsCodeApi()
    if (!vscode) {
      setRefreshingResources(false)
      setMcpError('Not running in VS Code')
      return
    }
    const requestId = createRequestId()
    composerResourcesRequestIdsRef.current.add(requestId)
    latestComposerResourcesRequestIdRef.current = requestId
    setRefreshingResources(true)
    setMcpError(null)
    pushDebug({
      at: new Date().toISOString(),
      kind: 'tx',
      type: 'composer.resources.list',
      requestId
    })
    vscode.postMessage({
      type: 'composer.resources.list',
      requestId
    })
  }, [pushDebug])

  const toggleMcpServer = useCallback(
    (server: ComposerMcpServerSummary) => {
      const vscode = getVsCodeApi()
      if (!vscode) {
        setMcpError('Not running in VS Code')
        return
      }
      const requestId = createRequestId()
      const enabled = !server.enabled
      mcpRequestIdsRef.current.set(requestId, { name: server.name, enabled })
      setPendingMcpTargets((current) => new Map(current).set(server.name, enabled))
      setMcpError(null)
      pushDebug({
        at: new Date().toISOString(),
        kind: 'tx',
        type: 'mcp.setEnabled',
        requestId,
        detail: `${server.name} -> ${String(enabled)}`
      })
      vscode.postMessage({
        type: 'mcp.setEnabled',
        requestId,
        payload: {
          name: server.name,
          enabled
        }
      })
    },
    [pushDebug]
  )

  const requestWorkspaceResources = useCallback((query: string) => {
    const vscode = getVsCodeApi()
    if (!vscode) {
      return
    }
    const requestId = createRequestId()
    latestWorkspaceSearchRequestIdRef.current = requestId
    workspaceSearchRequestIdsRef.current.add(requestId)
    vscode.postMessage({
      type: 'workspace.resources.search',
      requestId,
      payload: { query }
    })
  }, [])

  const resolveDroppedWorkspaceResources = useCallback((values: string[]) => {
    const vscode = getVsCodeApi()
    if (!vscode || values.length === 0) {
      return
    }
    const requestId = createRequestId()
    workspaceResolveRequestIdsRef.current.add(requestId)
    vscode.postMessage({
      type: 'workspace.resources.resolve',
      requestId,
      payload: { values }
    })
  }, [])

  const openModelDialog = useCallback(() => {
    const nextProviderId = splitModel(selectedModel)?.providerID
    if (nextProviderId) {
      setSelectedProviderId(nextProviderId)
    }
    setModelDialogOpen(true)
  }, [selectedModel])

  const refreshModelCatalog = useCallback(() => {
    requestProviders({ forceRefresh: true })
    requestModels({ forceRefresh: true })
  }, [requestModels, requestProviders])

  const startRun = useCallback(() => {
    const vscode = getVsCodeApi()
    if (!vscode) {
      setRunStatus('Not running in VS Code')
      return
    }

    const message = composerValue.trim()
    if (!selectedModel || !selectedAgent || message.length === 0 || isRunning) {
      return
    }

    const requestId = createRequestId()
    const command = resolveComposerCommandInvocation(message, composerCommands)
    pushDebug({
      at: new Date().toISOString(),
      kind: 'tx',
      type: 'run.start',
      requestId,
      detail: `${selectedSessionId ?? 'new'} | ${selectedModel} | ${selectedAgent}`
    })
    moveSessionExportsToBackground(selectedSessionId)
    runStartRequestIdRef.current = requestId
    setIsRunning(true)
    setRunStatus('Running…')
    setEditedFiles([])
    setPendingPermission(null)
    setPendingQuestion(null)

    const assistantIndex = transcript.length + 1
    activeRunRef.current = {
      requestId,
      assistantIndex,
      sessionId: selectedSessionId,
      placeholderTitle: summarizePendingSessionTitle(message),
      startedNewSession: selectedSessionId === null
    }

    // If this is a brand-new session (no selectedSessionId), keep the local transcript visible
    // until we receive the sessionId event.
    setTranscript((current) => {
      const nextTranscript: TranscriptMessage[] = [
        ...current,
        {
          role: 'user',
          parts: [
            ...(pastedImage
              ? [
                  {
                    type: 'image' as const,
                    src: pastedImage.previewUrl,
                    alt: pastedImage.fileName
                  }
                ]
              : []),
            {
              type: 'text',
              text: message
            }
          ]
        },
        {
          role: 'assistant',
          parts: []
        }
      ]
      transcriptRef.current = nextTranscript
      return nextTranscript
    })
    setComposerValue('')
    setComposerCursor(0)
    setSelectedNativeCommandName(null)

    const attachedFiles = [
      ...(pastedImageFilePath ? [pastedImageFilePath] : []),
      ...workspaceAttachments.filter((resource) => resource.kind === 'file').map((resource) => resource.absolutePath)
    ].filter((filePath, index, files) => files.indexOf(filePath) === index)

    vscode.postMessage({
      type: 'run.start',
      requestId,
      payload: {
        message,
        model: selectedModel,
        agent: selectedAgent,
        sessionId: selectedSessionId ?? undefined,
        title: undefined,
        thinking: thinkingEnabled,
        variant: thinkingVariant || undefined,
        files: attachedFiles.length > 0 ? attachedFiles : undefined,
        command: command ?? undefined
      }
    })
    if (pastedImage) {
      setPastedImage(null)
      setPastedImageFilePath(null)
    }
    setWorkspaceAttachments([])
  }, [composerCommands, composerValue, isRunning, moveSessionExportsToBackground, pastedImage, pastedImageFilePath, pushDebug, selectedSessionId, selectedModel, selectedAgent, thinkingEnabled, thinkingVariant, transcript.length, workspaceAttachments])

  const commands = useMemo(() => {
    type Cmd = {
      name: string
      hint: string
      source?: 'command' | 'mcp' | 'skill'
      preserveComposer?: boolean
      nativeCommand?: string
      run: (args: string[]) => void
    }

    const setThinkingDepth = (value: string) => {
      const option = findThinkingOption(thinkingOptions, value)
      if (!option) {
        setResourceDialogKind('thinking')
        return
      }
      selectThinkingOption(option)
    }

    const cmds: Cmd[] = [
      {
        name: '/new',
        hint: 'Start new session',
        run: () => {
          if (isRunningRef.current) {
            setRunStatus('Cannot start new session while running')
            return
          }
          allowAutoSelectSessionRef.current = false
          selectSession(null, { suppressAutoExport: true })
          transcriptRef.current = []
          setTranscript([])
          setTranscriptError(null)
          setRunStatus(null)
        }
      },
      {
        name: '/undo',
        hint: 'Undo latest user turn',
        run: () => {
          const sessionId = selectedSessionIdRef.current
          if (!sessionId) {
            setRunStatus('No session selected')
            return
          }
          if (isRunningRef.current) {
            setRunStatus('Cannot undo while running')
            return
          }
          requestSessionUndo(sessionId)
        }
      },
      {
        name: '/redo',
        hint: 'Redo previously undone turn',
        run: () => {
          const sessionId = selectedSessionIdRef.current
          if (!sessionId) {
            setRunStatus('No session selected')
            return
          }
          if (isRunningRef.current) {
            setRunStatus('Cannot redo while running')
            return
          }
          requestSessionRedo(sessionId)
        }
      },
      {
        name: '/timeline',
        hint: 'Open session timeline',
        run: () => {
          const sessionId = selectedSessionIdRef.current
          if (!sessionId) {
            setRunStatus('No session selected')
            return
          }
          setTimelineDialogOpen(true)
          requestSessionTimeline(sessionId)
        }
      },
      {
        name: '/switch',
        hint: 'Switch session dialog',
        run: () => setSessionDialogOpen(true)
      },
      {
        name: '/refresh',
        hint: 'Refresh sessions',
        run: () => requestSessions()
      },
      {
        name: '/model',
        hint: 'Open model picker',
        run: () => openModelDialog()
      },
      {
        name: '/agent',
        hint: 'Select agent',
        run: (args) => {
          const next = (args[0] || '').toLowerCase()
          if (!next) {
            setResourceDialogKind('agents')
            return
          }
          if (!agents.some((agent) => agent.name.toLowerCase() === next)) {
            setResourceDialogKind('agents')
            return
          }
          setSelectedAgent(agents.find((agent) => agent.name.toLowerCase() === next)?.name ?? next)
        }
      },
      {
        name: '/thinking',
        hint: `Set depth: ${thinkingOptions.join('|')}`,
        run: (args) => {
          const v = args[0] || ''
          if (!v) {
            setResourceDialogKind('thinking')
            return
          }
          setThinkingDepth(v)
        }
      },
      {
        name: '/export',
        hint: 'Export current session',
        run: () => {
          if (!selectedSessionIdRef.current) {
            setRunStatus('No session selected')
            return
          }
          setExportDialogError(null)
          setExportDialogOpen(true)
        }
      },
      {
        name: '/mcp',
        hint: composerMcpServers.length > 0 ? `MCP servers: ${composerMcpServers.length}` : 'List configured MCP servers',
        source: 'mcp',
        preserveComposer: true,
        run: (args) => {
          const requested = args.join(' ').trim().toLowerCase()
          if (!requested) {
            setComposerValue('')
            setMcpError(null)
            setResourceDialogKind('mcp')
            return
          }
          const server = composerMcpServers.find((entry) => entry.name.toLowerCase() === requested)
          if (!server) {
            setComposerValue('')
            setMcpError(`Unknown MCP server: ${args.join(' ')}`)
            setResourceDialogKind('mcp')
            return
          }
          setComposerValue(`Use the "${server.name}" MCP server to `)
          window.requestAnimationFrame(() => composerRef.current?.focus())
        }
      },
      {
        name: '/skill',
        hint: 'Use an available OpenCode skill',
        source: 'skill',
        preserveComposer: true,
        run: (args) => {
          const requested = args.join(' ').trim().toLowerCase()
          const skill = composerSkills.find((entry) => entry.name.toLowerCase() === requested)
          if (!skill) {
            setComposerValue('')
            setResourceDialogKind('skills')
            return
          }
          setComposerValue(`Use the "${skill.name}" skill to `)
          window.requestAnimationFrame(() => composerRef.current?.focus())
        }
      },
      {
        name: '/skills',
        hint: composerSkills.length > 0 ? `Available skills: ${composerSkills.length}` : 'List available OpenCode skills',
        source: 'skill',
        run: () => {
          setResourceDialogKind('skills')
        }
      },
      {
        name: '/delete',
        hint: 'Delete current session (run twice)',
        run: () => {
          const sessionId = selectedSessionIdRef.current
          if (!sessionId) {
            setRunStatus('No session selected')
            return
          }
          const now = Date.now()
          if (deleteArmed?.sessionId === sessionId && now - deleteArmed.armedAt < 2000) {
            setDeleteArmed(null)
            handleDeleteSession(sessionId)
            return
          }
          setDeleteArmed({ sessionId, armedAt: now })
          setRunStatus('Run /delete again to confirm')
        }
      },
      {
        name: '/debug',
        hint: 'Toggle diagnostics panel',
        run: (args) => {
          const v = (args[0] || '').toLowerCase()
          if (!v || v === 'toggle') {
            setDebugEnabled((current) => {
              const next = !current
              if (next) {
                setDebugPopoverOpen(true)
              }
              return next
            })
            return
          }
          if (v === 'on') {
            setDebugEnabled(true)
            setDebugPopoverOpen(true)
            return
          }
          if (v === 'off') {
            setDebugEnabled(false)
            return
          }
          setRunStatus('Usage: /debug on|off|toggle')
        }
      }
    ]

    const builtInNames = new Set(cmds.map((command) => command.name.toLowerCase()))
    for (const command of composerCommands) {
      const name = `/${command.name.replace(/^\/+/, '')}`
      if (builtInNames.has(name.toLowerCase())) {
        continue
      }
      builtInNames.add(name.toLowerCase())
      cmds.push({
        name,
        hint: command.description || `${command.source ?? 'command'}${command.hints.length > 0 ? ` · ${command.hints.join(', ')}` : ''}`,
        source: command.source,
        preserveComposer: true,
        nativeCommand: command.name,
        run: (args) => {
          setComposerValue(`${name}${args.length > 0 ? ` ${args.join(' ')}` : ''}`)
          window.requestAnimationFrame(() => composerRef.current?.focus())
        }
      })
    }

    for (const server of composerMcpServers) {
      cmds.push({
        name: `/mcp ${server.name}`,
        hint: `${server.status} · MCP server`,
        source: 'mcp',
        preserveComposer: true,
        run: () => {
          setComposerValue(`Use the "${server.name}" MCP server to `)
          window.requestAnimationFrame(() => composerRef.current?.focus())
        }
      })
    }

    for (const skill of composerSkills) {
      cmds.push({
        name: `/skill ${skill.name}`,
        hint: skill.description || 'OpenCode skill',
        source: 'skill',
        preserveComposer: true,
        run: () => {
          setComposerValue(`Use the "${skill.name}" skill to `)
          window.requestAnimationFrame(() => composerRef.current?.focus())
        }
      })
    }

    return cmds
  }, [agents, composerCommands, composerMcpServers, composerSkills, deleteArmed, handleDeleteSession, openModelDialog, requestSessionRedo, requestSessions, requestSessionTimeline, requestSessionUndo, selectSession, selectThinkingOption, thinkingOptions])

  const commandState = useMemo(() => {
    const raw = composerValue
    if (selectedNativeCommandName && isComposerCommandInvocation(raw, selectedNativeCommandName)) {
      return { open: false as const, query: '', filter: '', args: [] as string[] }
    }
    const isSingleLine = !raw.includes('\n')
    if (!isSingleLine) {
      return { open: false as const, query: '', filter: '', args: [] as string[] }
    }
    const trimmed = raw.trimStart()
    if (!trimmed.startsWith('/')) {
      return { open: false as const, query: '', filter: '', args: [] as string[] }
    }
    const text = trimmed.slice(1)
    const tokens = text.split(/\s+/).filter(Boolean)
    const query = tokens[0] ? `/${tokens[0]}` : '/'
    const args = tokens.slice(1)
    return { open: true as const, query, filter: trimmed.toLowerCase(), args }
  }, [composerValue, selectedNativeCommandName])

  const workspaceMentionState = useMemo(
    () => (commandState.open ? null : getWorkspaceMentionState(composerValue, composerCursor)),
    [commandState.open, composerCursor, composerValue]
  )

  useEffect(() => {
    if (!workspaceMentionState) {
      latestWorkspaceSearchRequestIdRef.current = null
      setWorkspaceResources([])
      return
    }
    const timer = window.setTimeout(() => requestWorkspaceResources(workspaceMentionState.query), 120)
    return () => window.clearTimeout(timer)
  }, [requestWorkspaceResources, workspaceMentionState])

  useEffect(() => {
    if (workspaceResourceIndex >= workspaceResources.length && workspaceResources.length > 0) {
      setWorkspaceResourceIndex(0)
    }
  }, [workspaceResourceIndex, workspaceResources.length])

  useEffect(() => {
    const selected = workspaceMenuRef.current?.querySelector<HTMLElement>(
      `[data-resource-index="${String(workspaceResourceIndex)}"]`
    )
    selected?.scrollIntoView({ block: 'nearest' })
  }, [workspaceResourceIndex])

  const selectWorkspaceResource = useCallback(
    (resource: WorkspaceResourceSummary) => {
      const cursor = composerRef.current?.selectionStart ?? composerCursor
      const state = getWorkspaceMentionState(composerValue, cursor)
      const inserted = state
        ? insertWorkspaceMention(composerValue, state, resource)
        : appendWorkspaceMentions(composerValue, [resource])
      setComposerValue(inserted.value)
      setComposerCursor(inserted.cursor)
      setWorkspaceAttachments((current) => mergeWorkspaceResources(current, [resource]))
      setWorkspaceResources([])
      window.requestAnimationFrame(() => {
        composerRef.current?.focus()
        composerRef.current?.setSelectionRange(inserted.cursor, inserted.cursor)
      })
    },
    [composerCursor, composerValue]
  )

  const filteredCommands = useMemo(() => {
    if (!commandState.open) {
      return []
    }
    const q = commandState.query.toLowerCase()
    const filter = commandState.filter
    return commands
      .filter((cmd) => {
        const name = cmd.name.toLowerCase()
        return q === '/' || name.startsWith(filter) || filter.startsWith(`${name} `) || cmd.hint.toLowerCase().includes(filter.slice(1))
      })
  }, [commandState.filter, commandState.open, commandState.query, commands])

  useEffect(() => {
    if (commandIndex >= filteredCommands.length && filteredCommands.length > 0) {
      setCommandIndex(0)
    }
  }, [commandIndex, filteredCommands.length])

  useEffect(() => {
    const selected = commandMenuRef.current?.querySelector<HTMLElement>(`[data-command-index="${String(commandIndex)}"]`)
    selected?.scrollIntoView({ block: 'nearest' })
  }, [commandIndex])

  const runCommand = useCallback(
    (cmdName: string, args: string[]) => {
      const cmd = commands.find((c) => c.name === cmdName)
      if (!cmd) {
        setRunStatus(`Unknown command: ${cmdName}`)
        return
      }
      cmd.run(args)
      setSelectedNativeCommandName(cmd.nativeCommand ?? null)
      if (!cmd.preserveComposer) {
        setComposerValue('')
      }
    },
    [commands]
  )

  const submitComposer = useCallback(() => {
    if (commandState.open) {
      const selected = filteredCommands[commandIndex]
      runCommand(selected?.name ?? commandState.query, commandState.args)
      return
    }
    startRun()
  }, [commandIndex, commandState, filteredCommands, runCommand, startRun])

  const stopRun = useCallback(() => {
    const vscode = getVsCodeApi()
    if (!vscode || !isRunning) {
      return
    }

    const requestId = createRequestId()
    pushDebug({
      at: new Date().toISOString(),
      kind: 'tx',
      type: 'run.stop',
      requestId
    })
    runStopRequestIdsRef.current.add(requestId)
    setRunStatus('Stopping…')
    vscode.postMessage({
      type: 'run.stop',
      requestId
    })
  }, [isRunning, pushDebug])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // TUI-like: Esc cancels run when active, otherwise closes overlays.
      if (event.key !== 'Escape') {
        return
      }

      if (resourceDialogKind) {
        event.preventDefault()
        setResourceDialogKind(null)
        return
      }
      if (modelDialogOpen) {
        event.preventDefault()
        setModelDialogOpen(false)
        return
      }
      if (sessionDialogOpen) {
        event.preventDefault()
        setSessionDialogOpen(false)
        return
      }
      if (pendingPermission) {
        event.preventDefault()
        requestPermissionReply(pendingPermission.permissionId, 'reject')
        return
      }
      if (isRunning) {
        event.preventDefault()
        stopRun()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isRunning, modelDialogOpen, pendingPermission, requestPermissionReply, resourceDialogKind, sessionDialogOpen, stopRun])

  useEffect(() => {
    if (!pendingPermission) {
      return
    }
    window.requestAnimationFrame(() => permissionAllowButtonRef.current?.focus())
  }, [pendingPermission])

  useEffect(() => {
    const vscode = getVsCodeApi()
    if (!vscode) {
      setStatus('Not running in VS Code')
      return
    }

    const requestId = createRequestId()
    readyRequestIdRef.current = requestId

    pushDebug({
      at: new Date().toISOString(),
      kind: 'tx',
      type: 'webview.ready',
      requestId
    })

    const onMessage = (event: MessageEvent<unknown>) => {
      const message = event.data
      if (!isExtensionResponseMessage(message)) {
        return
      }

      if (message.type === 'webview.ready.ack' && message.ok && message.requestId === readyRequestIdRef.current) {
        pushDebug({
          at: new Date().toISOString(),
          kind: 'rx',
          type: 'webview.ready.ack',
          requestId: message.requestId,
          ok: true,
          detail: JSON.stringify({
            hostKind: message.payload.hostKind,
            isSupportedHost: message.payload.isSupportedHost,
            remoteName: message.payload.remoteName,
            lastSelectedModel: message.payload.lastSelectedModel,
            lastSelectedAgent: message.payload.lastSelectedAgent,
            opencodeVersion: message.payload.opencode?.version,
            opencodeCompatible: message.payload.opencode?.isCompatible
          })
        })
        const location = formatHostLabel(message.payload.hostKind, message.payload.remoteName)
        const versionLabel = message.payload.opencode?.version ? ` · opencode ${message.payload.opencode.version}` : ''
        setStatus(message.payload.isSupportedHost ? `Connected: ${location}${versionLabel}` : `Unsupported host: ${location}`)
        setWorkspaceFolderPath(message.payload.workspaceFolderPath)
        if (message.payload.opencode?.warning) {
          setRunStatus(message.payload.opencode.warning)
        }
        pendingInitialSelectedModelRef.current = message.payload.lastSelectedModel ?? null
        pendingInitialSelectedAgentRef.current = message.payload.lastSelectedAgent ?? null
        setSelectedModel(message.payload.lastSelectedModel ?? '')
        setSelectedAgent(message.payload.lastSelectedAgent ?? '')
        requestSessions()
        requestProviders()
        requestModels()
        requestAgents()
        requestComposerResources()
        requestSelfcheck()
        return
      }

      if (message.type === 'inlineDiff.state' && message.ok) {
        if (message.payload.revision < inlineDiffRevisionRef.current) {
          return
        }
        inlineDiffRevisionRef.current = message.payload.revision
        setReviewFiles(message.payload.files)
        return
      }

      if (message.type === 'providers.list.response' && message.ok) {
        pushDebug({
          at: new Date().toISOString(),
          kind: 'rx',
          type: 'providers.list.response',
          requestId: message.requestId,
          ok: true,
          detail: `count=${String(message.payload.providers.length)}`
        })

        if (!providersRequestIdsRef.current.has(message.requestId)) {
          return
        }

        providersRequestIdsRef.current.delete(message.requestId)
        setProviders(message.payload.providers)
        setProvidersError(null)
        setLoadingProviders(false)
        setSelectedProviderId((current) => current || message.payload.providers[0]?.id || '')
        return
      }

      if (message.type === 'sessions.list.response' && message.ok) {
        pushDebug({
          at: new Date().toISOString(),
          kind: 'rx',
          type: 'sessions.list.response',
          requestId: message.requestId,
          ok: true,
            detail: `count=${String(message.payload.sessions.length)}`
        })
        const requestMeta = sessionsRequestIdsRef.current.get(message.requestId)
        if (!requestMeta) {
          return
        }

        sessionsRequestIdsRef.current.delete(message.requestId)
        // Initial load: do not auto-open and auto-export the newest session.
        if (selectedSessionIdRef.current === null && transcriptRef.current.length === 0 && !isRunningRef.current) {
          allowAutoSelectSessionRef.current = false
        }
        const protectedSessionId = activeRunRef.current?.sessionId ?? lastCompletedRunRef.current?.sessionId ?? null
        const protectedSession = protectedSessionId
          ? sessionsRef.current.find((session) => session.id === protectedSessionId)
          : undefined
        const nextSessions = preserveProtectedSessionSummary(message.payload.sessions, protectedSessionId, protectedSession)
        sessionsRef.current = nextSessions
        setSessions(nextSessions)
        setSelectedSessionId((current) => {
          const next = resolveSessionSelectionAfterList({
            currentSessionId: current,
            listedSessionIds: nextSessions.map((session) => session.id),
            allowAutoSelect: allowAutoSelectSessionRef.current,
            protectedSessionId
          })
          suppressNextSessionAutoExportRef.current = next.suppressAutoExport
          return next.selectedSessionId
        })
        setSessionsError(null)
        setLoadingSessions(hasBlockingSessionListRequests(sessionsRequestIdsRef.current))
        return
      }

      if (message.type === 'session.export.response' && message.ok) {
        const exportMeta = exportRequestIdsRef.current.get(message.requestId)
        if (!exportMeta) {
          return
        }
        const targetSessionId = exportMeta.sessionId

        exportRequestIdsRef.current.delete(message.requestId)
        if (targetSessionId !== selectedSessionIdRef.current) {
          setLoadingTranscript(hasBlockingExportRequests(exportRequestIdsRef.current))
          return
        }

        const active = activeRunRef.current
        if (active?.sessionId === targetSessionId) {
          setLoadingTranscript(hasBlockingExportRequests(exportRequestIdsRef.current))
          return
        }

        // If we just completed a run, export can be eventually consistent. Avoid overwriting
        // a streamed answer with an older export that has not caught up yet.
        const lastCompleted = lastCompletedRunRef.current
        if (lastCompleted && lastCompleted.sessionId === targetSessionId) {
          const exported = mergeLocalRunErrors(
            runErrorTranscriptsRef.current.get(targetSessionId) ?? lastCompleted.localTranscript,
            mergeLocalImageParts(lastCompleted.localTranscript, compactTranscript(message.payload.messages))
          )
          const hasLocalAssistantText = hasAnyAssistantText(lastCompleted.localTranscript)
          const exportCaughtUp = isExportAtLeastAsComplete(exported, lastCompleted.localTranscript)

          if (!exportCaughtUp && hasLocalAssistantText) {
            if (lastCompleted.exportAttempts < 5) {
              lastCompletedRunRef.current = {
                ...lastCompleted,
                exportAttempts: lastCompleted.exportAttempts + 1
              }
              // Keep the streamed transcript visible; retry export shortly.
              window.setTimeout(() => requestSessionExport(targetSessionId, { background: exportMeta.background }), 500)
              setLoadingTranscript(hasBlockingExportRequests(exportRequestIdsRef.current))
              return
            }

            lastCompletedRunRef.current = null
            setLoadingTranscript(hasBlockingExportRequests(exportRequestIdsRef.current))
            return
          }

          lastCompletedRunRef.current = null
          transcriptRef.current = exported
          setTranscript(exported)
        } else {
          const exported = mergeLocalRunErrors(
            runErrorTranscriptsRef.current.get(targetSessionId) ?? transcriptRef.current,
            mergeLocalImageParts(transcriptRef.current, compactTranscript(message.payload.messages))
          )
          transcriptRef.current = exported
          setTranscript(exported)
        }
        setTranscriptError(null)
        setLoadingTranscript(hasBlockingExportRequests(exportRequestIdsRef.current))
        return
      }

      if (message.type === 'session.export.markdown.response' && message.ok) {
        if (!markdownExportRequestIdsRef.current.has(message.requestId)) {
          return
        }
        markdownExportRequestIdsRef.current.delete(message.requestId)
        setExportDialogBusy(markdownExportRequestIdsRef.current.size > 0)
        setExportDialogError(null)
        setExportDialogOpen(false)
        setRunStatus(message.payload.filePath ? `Exported to ${message.payload.filePath}` : 'Session opened as Markdown')
        return
      }

      if (message.type === 'subtask.transcript.response' && message.ok) {
        const targetSessionId = subtaskTranscriptRequestIdsRef.current.get(message.requestId)
        if (!targetSessionId) {
          return
        }
        subtaskTranscriptRequestIdsRef.current.delete(message.requestId)
        if (targetSessionId !== message.payload.sessionId || activeSubtaskRef.current?.sessionId !== targetSessionId) {
          return
        }
        setSubtaskTranscript(compactTranscript(message.payload.messages))
        setSubtaskTranscriptError(null)
        setLoadingSubtaskTranscript(
          [...subtaskTranscriptRequestIdsRef.current.values()].includes(targetSessionId)
        )
        return
      }

      if (message.type === 'session.timeline.response' && message.ok) {
        const targetSessionId = timelineRequestIdsRef.current.get(message.requestId)
        if (!targetSessionId) {
          return
        }
        timelineRequestIdsRef.current.delete(message.requestId)
        setTimelineItems(message.payload.items)
        setTimelineRevertMessageId(message.payload.revertMessageId ?? null)
        setTimelineError(null)
        setTimelineLoading(timelineRequestIdsRef.current.size > 0)
        return
      }

      if (message.type === 'session.undo.response' && message.ok) {
        const targetSessionId = undoRequestIdsRef.current.get(message.requestId)
        if (!targetSessionId) {
          return
        }
        undoRequestIdsRef.current.delete(message.requestId)
        if (!message.payload.changed) {
          setRunStatus('Nothing to undo')
          return
        }
        setRunStatus('Undone')
        setTimelineRevertMessageId(message.payload.revertMessageId ?? null)
        if (typeof message.payload.composerText === 'string') {
          setComposerValue(message.payload.composerText)
        }
        if (selectedSessionIdRef.current === targetSessionId) {
          requestSessionExport(targetSessionId)
          if (timelineDialogOpen) {
            requestSessionTimeline(targetSessionId)
          }
        }
        return
      }

      if (message.type === 'session.redo.response' && message.ok) {
        const targetSessionId = redoRequestIdsRef.current.get(message.requestId)
        if (!targetSessionId) {
          return
        }
        redoRequestIdsRef.current.delete(message.requestId)
        if (!message.payload.changed) {
          setRunStatus('Nothing to redo')
          return
        }
        setRunStatus('Redone')
        setTimelineRevertMessageId(message.payload.revertMessageId ?? null)
        if (typeof message.payload.composerText === 'string') {
          setComposerValue(message.payload.composerText)
        }
        if (selectedSessionIdRef.current === targetSessionId) {
          requestSessionExport(targetSessionId)
          if (timelineDialogOpen) {
            requestSessionTimeline(targetSessionId)
          }
        }
        return
      }

      if (message.type === 'session.delete.response' && message.ok) {
        const targetSessionId = deleteRequestIdsRef.current.get(message.requestId)
        if (!targetSessionId) {
          return
        }
        deleteRequestIdsRef.current.delete(message.requestId)
        runErrorTranscriptsRef.current.delete(targetSessionId)
        pushDebug({
          at: new Date().toISOString(),
          kind: 'rx',
          type: 'session.delete.response',
          requestId: message.requestId,
          ok: true,
          detail: `deleted=${String(message.payload.deleted)} | ${targetSessionId}`
        })

        if (selectedSessionIdRef.current === targetSessionId) {
          allowAutoSelectSessionRef.current = false
          selectSession(null, { suppressAutoExport: true })
          transcriptRef.current = []
          setTranscript([])
          setTranscriptError(null)
        }
        requestSessions()
        return
      }

      if (message.type === 'tempfile.write.response' && message.ok) {
        const meta = tempfileRequestIdsRef.current.get(message.requestId)
        if (!meta) {
          return
        }
        tempfileRequestIdsRef.current.delete(message.requestId)
        setPastedImageFilePath(message.payload.filePath)
        return
      }

      if (message.type === 'file.open.response' && message.ok) {
        if (!fileOpenRequestIdsRef.current.has(message.requestId)) {
          return
        }
        fileOpenRequestIdsRef.current.delete(message.requestId)
        return
      }

      if (message.type === 'inlineDiff.open.response' && message.ok) {
        if (!inlineDiffOpenRequestIdsRef.current.has(message.requestId)) {
          return
        }
        inlineDiffOpenRequestIdsRef.current.delete(message.requestId)
        return
      }

      if (message.type === 'inlineDiff.dismiss.response' && message.ok) {
        if (!inlineDiffDismissRequestIdsRef.current.has(message.requestId)) {
          return
        }
        inlineDiffDismissRequestIdsRef.current.delete(message.requestId)
        return
      }

      if (message.type === 'models.list.response' && message.ok) {
        pushDebug({
          at: new Date().toISOString(),
          kind: 'rx',
          type: 'models.list.response',
          requestId: message.requestId,
          ok: true,
          detail: `count=${String(message.payload.models.length)}`
        })
        if (!modelsRequestIdsRef.current.has(message.requestId)) {
          return
        }

        modelsRequestIdsRef.current.delete(message.requestId)
        setModels(message.payload.models)
        setModelsLoaded(true)
        setSelectedModel((current) => {
          if (!current) {
            const persisted = pendingInitialSelectedModelRef.current
            pendingInitialSelectedModelRef.current = null
            if (persisted && message.payload.models.some((model) => model.name === persisted)) {
              return persisted
            }
            return message.payload.models[0]?.name ?? ''
          }
          return message.payload.models.some((model) => model.name === current)
            ? current
            : (message.payload.models[0]?.name ?? '')
        })
        setModelsError(null)
        setLoadingModels(modelsRequestIdsRef.current.size > 0)
        return
      }

      if (message.type === 'agents.list.response' && message.ok) {
        pushDebug({
          at: new Date().toISOString(),
          kind: 'rx',
          type: 'agents.list.response',
          requestId: message.requestId,
          ok: true,
          detail: `count=${String(message.payload.agents.length)}`
        })
        if (!agentsRequestIdsRef.current.has(message.requestId)) {
          return
        }

        agentsRequestIdsRef.current.delete(message.requestId)
        setAgents(message.payload.agents)
        setSelectedAgent((current) => {
          if (isVisibleAgentSelection(message.payload.agents, current)) {
            return current
          }
          if (!current) {
            const persisted = pendingInitialSelectedAgentRef.current
            pendingInitialSelectedAgentRef.current = null
            if (persisted && isVisibleAgentSelection(message.payload.agents, persisted)) {
              return persisted
            }
            return getDefaultAgentName(message.payload.agents)
          }
          return getDefaultAgentName(message.payload.agents)
        })
        setAgentsError(null)
        setLoadingAgents(agentsRequestIdsRef.current.size > 0)
        return
      }

      if (message.type === 'composer.resources.list.response' && message.ok) {
        if (!composerResourcesRequestIdsRef.current.has(message.requestId)) {
          return
        }
        composerResourcesRequestIdsRef.current.delete(message.requestId)
        setRefreshingResources(composerResourcesRequestIdsRef.current.size > 0)
        if (latestComposerResourcesRequestIdRef.current !== message.requestId) {
          return
        }
        setComposerCommands(message.payload.commands)
        setComposerSkills(message.payload.skills)
        if (!message.payload.mcpError) {
          setComposerMcpServers(message.payload.mcpServers)
        }
        setMcpError(message.payload.mcpError ?? null)
        return
      }

      if (message.type === 'mcp.setEnabled.response' && message.ok) {
        const pending = mcpRequestIdsRef.current.get(message.requestId)
        if (!pending) {
          return
        }
        mcpRequestIdsRef.current.delete(message.requestId)
        setPendingMcpTargets((current) => {
          const next = new Map(current)
          next.delete(pending.name)
          return next
        })
        setComposerMcpServers((current) =>
          current.map((server) => (server.name === message.payload.server.name ? message.payload.server : server))
        )
        setMcpError(null)
        return
      }

      if (message.type === 'workspace.resources.search.response' && message.ok) {
        if (!workspaceSearchRequestIdsRef.current.has(message.requestId)) {
          return
        }
        workspaceSearchRequestIdsRef.current.delete(message.requestId)
        if (latestWorkspaceSearchRequestIdRef.current !== message.requestId) {
          return
        }
        setWorkspaceResources(message.payload.resources)
        setWorkspaceResourceIndex(0)
        return
      }

      if (message.type === 'workspace.resources.resolve.response' && message.ok) {
        if (!workspaceResolveRequestIdsRef.current.has(message.requestId)) {
          return
        }
        workspaceResolveRequestIdsRef.current.delete(message.requestId)
        if (message.payload.resources.length === 0) {
          return
        }
        setWorkspaceAttachments((current) => mergeWorkspaceResources(current, message.payload.resources))
        setComposerValue((current) => {
          const inserted = appendWorkspaceMentions(current, message.payload.resources)
          setComposerCursor(inserted.cursor)
          window.requestAnimationFrame(() => {
            composerRef.current?.focus()
            composerRef.current?.setSelectionRange(inserted.cursor, inserted.cursor)
          })
          return inserted.value
        })
        return
      }

      if (message.type === 'selfcheck.response' && message.ok) {
        const rid = message.requestId
        pushDebug({
          at: new Date().toISOString(),
          kind: 'rx',
          type: 'selfcheck.response',
          requestId: rid,
          ok: true,
          detail: `opencode=${message.payload.opencode?.version ?? message.payload.opencodeBinary}`
        })
        if (message.payload.opencode?.warning) {
          setRunStatus(message.payload.opencode.warning)
        }

        setSelfcheck((current) => {
          const currentRid = current.health.lastRequestId
          if (currentRid && currentRid !== rid) {
            return current
          }

          const toState = (v: { ok: true; count: number } | { ok: false; error: string }): SelfcheckState =>
            v.ok
              ? { state: 'ok', detail: `count=${String(v.count)}`, lastRequestId: rid }
              : { state: 'error', detail: v.error, lastRequestId: rid }

          return {
            health: message.payload.health.ok
              ? {
                  state: 'ok',
                  detail: message.payload.health.version ? `version=${message.payload.health.version}` : 'healthy',
                  lastRequestId: rid
                }
              : { state: 'error', detail: message.payload.health.error, lastRequestId: rid },
            sessions: toState(message.payload.sessions),
            models: toState(message.payload.models),
            agents: toState(message.payload.agents)
          }
        })
        return
      }

      if (message.type === 'run.start.response' && message.ok) {
        if (runStartRequestIdRef.current !== message.requestId) {
          return
        }
        runStartRequestIdRef.current = null
        return
      }

      if (message.type === 'run.event' && message.ok) {
        pushDebug({
          at: new Date().toISOString(),
          kind: 'rx',
          type: 'run.event',
          requestId: message.requestId,
          ok: true,
          detail:
            message.payload.event.type === 'part'
              ? `part:${message.payload.event.part.type}`
              : message.payload.event.type
        })
        const active = activeRunRef.current
        if (!active || active.requestId !== message.requestId) {
          return
        }

        if (message.payload.event.type === 'session') {
          active.sessionId = message.payload.event.sessionId
          allowAutoSelectSessionRef.current = true
          const optimisticSession = {
            id: message.payload.event.sessionId,
            title: active.placeholderTitle,
            updated: new Date().toISOString()
          }
          const currentSessions = sessionsRef.current
          const nextSessions = upsertPendingSessionSummary(currentSessions, optimisticSession, {
            startedNewSession: active.startedNewSession
          })
          if (nextSessions !== currentSessions) {
            sessionsRef.current = nextSessions
            setSessions(nextSessions)
          }
          selectSession(message.payload.event.sessionId, { allowDuringRun: true })
          requestSessions({ background: true })
          return
        }

        if (message.payload.event.type === 'permission') {
          setPendingPermission({
            permissionId: message.payload.event.permissionId,
            toolName: message.payload.event.toolName,
            patterns: message.payload.event.patterns,
            message: message.payload.event.message
          })
          return
        }

        if (message.payload.event.type === 'question') {
          setPendingQuestion({
            questionId: message.payload.event.questionId,
            questions: message.payload.event.questions
          })
          setRunStatus('Question needs input')
          return
        }

        if (message.payload.event.type === 'part') {
          setLastRunPartKind(message.payload.event.part.type)
          applyLiveRunEvent(message.payload.event, active.assistantIndex)
          return
        }

        if (message.payload.event.type === 'context.usage') {
          applyLiveRunEvent(message.payload.event, active.assistantIndex)
          return
        }

        if (message.payload.event.type === 'done') {
          completeRun({
            type: 'done',
            sessionId: active.sessionId
          })
          return
        }

        if (message.payload.event.type === 'stopped') {
          completeRun({
            type: 'stopped',
            sessionId: active.sessionId
          })
          return
        }

        if (message.payload.event.type === 'error') {
          applyLiveRunEvent(message.payload.event, active.assistantIndex)
          completeRun({
            type: 'error',
            sessionId: active.sessionId
          })
          return
        }

        return
      }

      if (message.type === 'run.stop.response' && message.ok) {
        pushDebug({
          at: new Date().toISOString(),
          kind: 'rx',
          type: 'run.stop.response',
          requestId: message.requestId,
          ok: true,
          detail: `stopped=${String(message.payload.stopped)}`
        })
        if (!runStopRequestIdsRef.current.has(message.requestId)) {
          return
        }

        runStopRequestIdsRef.current.delete(message.requestId)
        return
      }

      if (message.type === 'permission.reply.response' && message.ok) {
        const permissionId = permissionReplyRequestIdsRef.current.get(message.requestId)
        if (!permissionId) {
          return
        }
        permissionReplyRequestIdsRef.current.delete(message.requestId)
        setPendingPermission((current) => (current?.permissionId === permissionId ? null : current))
        setRunStatus(`Permission ${message.payload.reply}`)
        return
      }

      if (message.type === 'question.reply.response' && message.ok) {
        const questionId = questionReplyRequestIdsRef.current.get(message.requestId)
        if (!questionId) {
          return
        }
        questionReplyRequestIdsRef.current.delete(message.requestId)
        setPendingQuestion((current) => (current?.questionId === questionId ? null : current))
        setRunStatus('Running…')
        return
      }

      if (message.type === 'question.reject.response' && message.ok) {
        const questionId = questionRejectRequestIdsRef.current.get(message.requestId)
        if (!questionId) {
          return
        }
        questionRejectRequestIdsRef.current.delete(message.requestId)
        setPendingQuestion((current) => (current?.questionId === questionId ? null : current))
        setRunStatus('Running…')
        return
      }

      if (message.type === 'webview.error' && !message.ok) {
        pushDebug({
          at: new Date().toISOString(),
          kind: 'rx',
          type: 'webview.error',
          requestId: message.requestId,
          ok: false,
          detail: message.error
        })
        if (message.requestId === readyRequestIdRef.current) {
          setStatus(`Connection failed: ${message.error}`)
          return
        }

        if (markdownExportRequestIdsRef.current.has(message.requestId)) {
          markdownExportRequestIdsRef.current.delete(message.requestId)
          setExportDialogBusy(markdownExportRequestIdsRef.current.size > 0)
          setExportDialogError(message.error)
          return
        }

        const sessionRequestMeta = sessionsRequestIdsRef.current.get(message.requestId)
        if (sessionRequestMeta) {
          sessionsRequestIdsRef.current.delete(message.requestId)
          if (!sessionRequestMeta.background) {
            setSessionsError(message.error)
          }
          setLoadingSessions(hasBlockingSessionListRequests(sessionsRequestIdsRef.current))
          return
        }

        if (exportRequestIdsRef.current.has(message.requestId)) {
          const exportMeta = exportRequestIdsRef.current.get(message.requestId) ?? null
          const targetSessionId = exportMeta?.sessionId ?? null
          exportRequestIdsRef.current.delete(message.requestId)

          if (targetSessionId && activeRunRef.current?.sessionId === targetSessionId) {
            setLoadingTranscript(hasBlockingExportRequests(exportRequestIdsRef.current))
            return
          }

          const lastCompleted = lastCompletedRunRef.current
          const canRetryFreshSessionExport =
            targetSessionId &&
            lastCompleted &&
            lastCompleted.sessionId === targetSessionId &&
            /session not found|notfounderror/i.test(message.error) &&
            lastCompleted.exportAttempts < 6

          if (canRetryFreshSessionExport) {
            lastCompletedRunRef.current = {
              ...lastCompleted,
              exportAttempts: lastCompleted.exportAttempts + 1
            }
            window.setTimeout(() => requestSessionExport(targetSessionId, { background: exportMeta?.background === true }), 700)
            setLoadingTranscript(hasBlockingExportRequests(exportRequestIdsRef.current))
            return
          }

          if (!exportMeta?.background) {
            setTranscriptError(message.error)
          }
          setLoadingTranscript(hasBlockingExportRequests(exportRequestIdsRef.current))
          return
        }

        if (subtaskTranscriptRequestIdsRef.current.has(message.requestId)) {
          const targetSessionId = subtaskTranscriptRequestIdsRef.current.get(message.requestId) ?? null
          subtaskTranscriptRequestIdsRef.current.delete(message.requestId)
          if (targetSessionId && activeSubtaskRef.current?.sessionId === targetSessionId) {
            setSubtaskTranscriptError(message.error)
            setLoadingSubtaskTranscript(
              [...subtaskTranscriptRequestIdsRef.current.values()].includes(targetSessionId)
            )
          }
          return
        }

        if (timelineRequestIdsRef.current.has(message.requestId)) {
          timelineRequestIdsRef.current.delete(message.requestId)
          setTimelineError(message.error)
          setTimelineLoading(timelineRequestIdsRef.current.size > 0)
          return
        }

        if (undoRequestIdsRef.current.has(message.requestId)) {
          undoRequestIdsRef.current.delete(message.requestId)
          setRunStatus(`Undo failed: ${message.error}`)
          return
        }

        if (redoRequestIdsRef.current.has(message.requestId)) {
          redoRequestIdsRef.current.delete(message.requestId)
          setRunStatus(`Redo failed: ${message.error}`)
          return
        }

        if (permissionReplyRequestIdsRef.current.has(message.requestId)) {
          permissionReplyRequestIdsRef.current.delete(message.requestId)
          setRunStatus(`Permission reply failed: ${message.error}`)
          return
        }

        if (questionReplyRequestIdsRef.current.has(message.requestId)) {
          questionReplyRequestIdsRef.current.delete(message.requestId)
          setRunStatus(`Question reply failed: ${message.error}`)
          return
        }

        if (questionRejectRequestIdsRef.current.has(message.requestId)) {
          questionRejectRequestIdsRef.current.delete(message.requestId)
          setRunStatus(`Question dismiss failed: ${message.error}`)
          return
        }

        if (tempfileRequestIdsRef.current.has(message.requestId)) {
          tempfileRequestIdsRef.current.delete(message.requestId)
          setPastedImage(null)
          setPastedImageFilePath(null)
          setRunStatus(`Image rejected: ${message.error}`)
          return
        }

        if (modelsRequestIdsRef.current.has(message.requestId)) {
          modelsRequestIdsRef.current.delete(message.requestId)
          setModelsLoaded(false)
          setModelsError(message.error)
          setLoadingModels(modelsRequestIdsRef.current.size > 0)
          return
        }

        if (providersRequestIdsRef.current.has(message.requestId)) {
          providersRequestIdsRef.current.delete(message.requestId)
          setProvidersError(message.error)
          setLoadingProviders(providersRequestIdsRef.current.size > 0)
          return
        }

        if (composerResourcesRequestIdsRef.current.has(message.requestId)) {
          composerResourcesRequestIdsRef.current.delete(message.requestId)
          setRefreshingResources(composerResourcesRequestIdsRef.current.size > 0)
          if (latestComposerResourcesRequestIdRef.current === message.requestId) {
            setMcpError(message.error)
          }
          return
        }

        if (mcpRequestIdsRef.current.has(message.requestId)) {
          const pending = mcpRequestIdsRef.current.get(message.requestId)
          mcpRequestIdsRef.current.delete(message.requestId)
          setPendingMcpTargets((current) => {
            const next = new Map(current)
            if (pending) {
              next.delete(pending.name)
            }
            return next
          })
          setMcpError(message.error)
          return
        }

        if (workspaceSearchRequestIdsRef.current.has(message.requestId)) {
          workspaceSearchRequestIdsRef.current.delete(message.requestId)
          if (latestWorkspaceSearchRequestIdRef.current === message.requestId) {
            setWorkspaceResources([])
          }
          return
        }

        if (workspaceResolveRequestIdsRef.current.has(message.requestId)) {
          workspaceResolveRequestIdsRef.current.delete(message.requestId)
          setRunStatus(`File drop failed: ${message.error}`)
          return
        }

        if (agentsRequestIdsRef.current.has(message.requestId)) {
          agentsRequestIdsRef.current.delete(message.requestId)
          setAgentsError(message.error)
          setLoadingAgents(agentsRequestIdsRef.current.size > 0)
          return
        }

        if (inlineDiffOpenRequestIdsRef.current.has(message.requestId)) {
          inlineDiffOpenRequestIdsRef.current.delete(message.requestId)
          setRunStatus(`Open review failed: ${message.error}`)
          return
        }

        if (inlineDiffDismissRequestIdsRef.current.has(message.requestId)) {
          inlineDiffDismissRequestIdsRef.current.delete(message.requestId)
          setRunStatus(`Dismiss review failed: ${message.error}`)
          return
        }

        if (fileOpenRequestIdsRef.current.has(message.requestId)) {
          fileOpenRequestIdsRef.current.delete(message.requestId)
          setRunStatus(`Open file failed: ${message.error}`)
          return
        }

        if (runStartRequestIdRef.current === message.requestId) {
          runStartRequestIdRef.current = null
          setIsRunning(false)
          setRunStatus(`Failed: ${message.error}`)
          const active = activeRunRef.current
          if (active) {
            const failedTranscript = applyLiveRunEvent(
              {
                type: 'error',
                error: message.error
              },
              active.assistantIndex
            )
            if (active.sessionId) {
              runErrorTranscriptsRef.current.set(active.sessionId, failedTranscript)
            }
          }
          activeRunRef.current = null
          return
        }

        if (runStopRequestIdsRef.current.has(message.requestId)) {
          runStopRequestIdsRef.current.delete(message.requestId)
          setRunStatus(`Stop failed: ${message.error}`)
        }
      }
    }

    window.addEventListener('message', onMessage)
    vscode.postMessage({
      type: 'webview.ready',
      requestId
    })

    return () => {
      window.removeEventListener('message', onMessage)
    }
  }, [
    applyLiveRunEvent,
    completeRun,
    pushDebug,
    requestAgents,
    requestComposerResources,
    requestModels,
    requestProviders,
    requestSelfcheck,
    requestSessions,
    requestSessionExport,
    timelineDialogOpen,
    requestSessionTimeline,
    selectSession
  ])

  useEffect(() => {
    if (!status.startsWith('Connected:')) {
      return
    }
    const refresh = () => {
      if (document.visibilityState === 'visible') {
        requestSelfcheck()
      }
    }
    const interval = window.setInterval(refresh, 30_000)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [requestSelfcheck, status])

  // Startup preloads models; this remains as a retry path if the first load failed or was skipped.
  useEffect(() => {
    if (!modelDialogOpen) {
      return
    }
    if (modelsLoaded || loadingModels) {
      return
    }
    requestModels()
  }, [loadingModels, modelDialogOpen, modelsLoaded, requestModels])

  const selectedSessionIdRef = useRef<string | null>(null)

  useEffect(() => {
    selectedSessionIdRef.current = selectedSessionId
  }, [selectedSessionId])

  const visibleModels = useMemo(() => {
    if (!selectedProviderId) {
      return models
    }

    return models.filter((model) => splitModel(model.name)?.providerID === selectedProviderId)
  }, [models, selectedProviderId])
  const activeTodos = useMemo(() => extractLatestTodosFromTranscript(transcript), [transcript])
  const diagnosticsState = getDiagnosticsState(selfcheck)
  const diagnosticsLabel = t(getDiagnosticsLabel(diagnosticsState))
  const diagnosticsTriggerClass = [
    'diagnostics-trigger',
    `diagnostics-trigger--${diagnosticsState}`,
    debugEnabled ? 'diagnostics-trigger--capturing' : ''
  ]
    .filter(Boolean)
    .join(' ')

  useEffect(() => {
    // When no session is selected, keep the chat area visually stable but do not fetch/export.
    if (!selectedSessionId) {
      if (!isRunning) {
        transcriptRef.current = []
        setTranscript([])
        setTranscriptError(null)
        setLoadingTranscript(false)
      }
      return
    }

    // Only export on explicit session switches after initial load or after a run completes.
    const active = activeRunRef.current
    if (isRunning && active?.sessionId === selectedSessionId) {
      return
    }

    if (suppressNextSessionAutoExportRef.current) {
      suppressNextSessionAutoExportRef.current = false
      return
    }

    requestSessionExport(selectedSessionId)
  }, [isRunning, requestSessionExport, selectedSessionId])

  const handleProviderSettingsChanged = useCallback(() => {
    requestProviders({ forceRefresh: true })
    requestModels({ forceRefresh: true })
  }, [requestModels, requestProviders])

  if (providerSettingsOpen) {
    return (
      <ProviderSettingsPage
        onClose={() => setProviderSettingsOpen(false)}
        onCatalogChanged={handleProviderSettingsChanged}
      />
    )
  }

  return (
    <main
      className="app"
      onPointerDownCapture={clearSettledRunIndicator}
      onKeyDownCapture={clearSettledRunIndicator}
    >
      <header className="topbar">
        <div className="topbar__brand">
          <div className="topbar__title">OpenCode</div>
          <div className="topbar__meta">
            <button
              type="button"
              className="theme-toggle"
              onClick={() => setThemeMode((current) => (current === 'light' ? 'dark' : 'light'))}
              aria-label={themeMode === 'light' ? t('Switch to dark theme') : t('Switch to light theme')}
              title={themeMode === 'light' ? t('Switch to dark theme') : t('Switch to light theme')}
            >
              <span className="theme-toggle__icon" aria-hidden="true">
                {themeMode === 'light' ? <Moon size={14} strokeWidth={1.8} /> : <Sun size={14} strokeWidth={1.8} />}
              </span>
            </button>
            <label className="language-selector" title={t('Interface language')}>
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
            <div className="topbar__status">{t(status)}</div>
            <div className="topbar__diagnostics">
              <button
                type="button"
                className={diagnosticsTriggerClass}
                onClick={() => setDebugPopoverOpen((current) => !current)}
                aria-label={diagnosticsLabel}
                aria-expanded={debugPopoverOpen}
                aria-controls="diagnostics-popover"
                title={diagnosticsLabel}
              >
                <span className="diagnostics-trigger__dot" aria-hidden="true" />
              </button>
              {debugPopoverOpen ? (
                <div className="diagnostics-popover" id="diagnostics-popover" role="dialog" aria-label={t('Diagnostics')}>
                  <div className="diagnostics-popover__header">
                    <h2>{t('Self-check')}</h2>
                    <div className="diagnostics-popover__actions">
                      <label className="debug-toggle">
                        <input
                          type="checkbox"
                          checked={debugEnabled}
                          onChange={(event) => {
                            setDebugEnabled(event.target.checked)
                          }}
                        />
                        {t('Enable')}
                      </label>
                      <button type="button" onClick={requestSelfcheck}>
                        {t('Run')}
                      </button>
                      <button type="button" onClick={() => setDebugLog([])}>
                        {t('Clear')}
                      </button>
                    </div>
                  </div>

                  <div className="diagnostics-popover__status">
                    <div>
                      health: {selfcheck.health.state}
                      {selfcheck.health.detail ? ` (${selfcheck.health.detail})` : ''}
                    </div>
                    <div>
                      sessions: {selfcheck.sessions.state}
                      {selfcheck.sessions.detail ? ` (${selfcheck.sessions.detail})` : ''}
                    </div>
                    <div>
                      models: {selfcheck.models.state}
                      {selfcheck.models.detail ? ` (${selfcheck.models.detail})` : ''}
                    </div>
                    <div>
                      agents: {selfcheck.agents.state}
                      {selfcheck.agents.detail ? ` (${selfcheck.agents.detail})` : ''}
                    </div>
                  </div>

                  {debugEnabled ? (
                    <pre className="diagnostics-popover__log">
                      {debugLog
                        .map((entry) => {
                          const parts = [
                            entry.at,
                            entry.kind.toUpperCase(),
                            entry.type,
                            entry.requestId ? `rid=${entry.requestId}` : '',
                            typeof entry.ok === 'boolean' ? `ok=${String(entry.ok)}` : '',
                            entry.detail ? entry.detail : ''
                          ].filter(Boolean)
                          return parts.join(' | ')
                        })
                        .join('\n')}
                    </pre>
                  ) : (
                    <p className="empty-line">{t('Enable to capture request/response logs.')}</p>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="topbar__session">
          <div className="session-chip">
            <div className="session-chip__label">{t('Session')}</div>
            <div className="session-chip__value">
              {selectedSessionId
                ? (sessions.find((s) => s.id === selectedSessionId)?.title ?? selectedSessionId)
                : t('None')}
            </div>
          </div>
          <div className="topbar__actions">
            <RunActivityIndicator status={runStatus} />
            <button
              type="button"
              className="topbar__icon-button"
              onClick={() => setProviderSettingsOpen(true)}
              disabled={isRunning}
              aria-label={t('Provider settings')}
              title={t('Provider settings')}
            >
              <Settings2 size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="topbar__icon-button"
              onClick={() => {
                if (isRunningRef.current) {
                  setRunStatus('Cannot start new session while running')
                  return
                }
                allowAutoSelectSessionRef.current = false
                selectSession(null, { suppressAutoExport: true })
                transcriptRef.current = []
                setTranscript([])
                setTranscriptError(null)
                setRunStatus(null)
                setEditedFiles([])
                setPendingPermission(null)
                setPendingQuestion(null)
              }}
              aria-label={t('New session')}
              title={t('New session')}
            >
              <Plus size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="topbar__icon-button"
              onClick={() => setSessionDialogOpen(true)}
              disabled={sessions.length === 0}
              aria-label={t('Switch session')}
              title={t('Switch session')}
            >
              <History size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              className={`topbar__icon-button${loadingSessions ? ' is-loading' : ''}`}
              onClick={() => requestSessions()}
              disabled={loadingSessions}
              aria-label={loadingSessions ? t('Refreshing sessions') : t('Refresh sessions')}
              title={loadingSessions ? t('Refreshing sessions') : t('Refresh sessions')}
            >
              <RefreshCw size={15} aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      {sessionsError ? <p className="error-line">{t(sessionsError)}</p> : null}
      <RunStatusDetails
        status={runStatus}
        files={displayedEditedFiles}
        onOpenFile={openEditedFile}
        onDismissFile={dismissEditedFile}
      />

      <section className={`main-shell${activeSubtask ? ' has-subtask' : ''}`} aria-label="main">
        {activeSubtask ? (
          <section className="subtask-detail" aria-label={`Subtask: ${activeSubtask.title}`}>
            <header className="subtask-detail__header">
              <button
                type="button"
                className="subtask-detail__iconButton"
                onClick={() => {
                  subtaskTranscriptRequestIdsRef.current.clear()
                  activeSubtaskRef.current = null
                  setActiveSubtask(null)
                  setSubtaskTranscript([])
                  setSubtaskTranscriptError(null)
                  setLoadingSubtaskTranscript(false)
                }}
                aria-label={t('Back to parent task')}
                title={t('Back to parent task')}
              >
                <ArrowLeft size={16} aria-hidden="true" />
              </button>
              <div className="subtask-detail__heading">
                <span className="subtask-detail__eyebrow">{t('Subtask')}</span>
                <strong>{activeSubtask.title}</strong>
              </div>
              <button
                type="button"
                className={`subtask-detail__iconButton${loadingSubtaskTranscript ? ' is-loading' : ''}`}
                onClick={() => requestSubtaskTranscript(activeSubtask.sessionId)}
                disabled={loadingSubtaskTranscript}
                aria-label={t('Refresh subtask')}
                title={t('Refresh subtask')}
              >
                <RefreshCw size={15} aria-hidden="true" />
              </button>
            </header>
            <div className="subtask-detail__body">
              {subtaskTranscriptError ? <p className="error-panel">{t(subtaskTranscriptError)}</p> : null}
              {!subtaskTranscriptError && subtaskTranscript.length === 0 ? (
                <p className="empty-line">{loadingSubtaskTranscript ? t('Loading subtask...') : t('No subtask messages yet')}</p>
              ) : null}
              {!subtaskTranscriptError && subtaskTranscript.length > 0 ? (
                <Transcript
                  messages={subtaskTranscript}
                  isRunning={false}
                  onOpenSubtask={openSubtask}
                  onOpenFileReference={openFileReference}
                />
              ) : null}
            </div>
          </section>
        ) : null}
        <div className="chat">
          {pendingQuestion ? (
            <QuestionBanner pending={pendingQuestion} onReply={requestQuestionReply} onReject={requestQuestionReject} />
          ) : null}
          {transcriptError ? <p className="error-panel">{t(transcriptError)}</p> : null}
          {!loadingTranscript && !transcriptError && transcript.length === 0 ? <p className="empty-line">{t('No messages')}</p> : null}
          {!transcriptError && transcript.length > 0 ? (
            <Transcript
              messages={compactTranscript(transcript)}
              isRunning={isRunning}
              onOpenSubtask={openSubtask}
              onOpenFileReference={openFileReference}
            />
          ) : null}
        </div>

        {pendingPermission ? (
          <section
            className="permission-banner"
            role="alertdialog"
            aria-modal="false"
            aria-labelledby="permission-title"
            aria-describedby="permission-detail"
          >
            <div className="permission-banner__body">
              <div className="permission-banner__header">
                <ShieldCheck size={14} aria-hidden="true" />
                <span>{t('Permission request')}</span>
              </div>
              <strong className="permission-banner__title" id="permission-title">
                {t('Allow {tool}?', { tool: pendingPermission.toolName })}
              </strong>
              <div className="permission-banner__text" id="permission-detail">
                {pendingPermission.message ||
                  (pendingPermission.patterns.length > 0
                    ? pendingPermission.patterns.join(', ')
                    : t('OpenCode needs permission to continue this task.'))}
              </div>
            </div>
            <div className="permission-banner__actions">
              <button
                type="button"
                className="permission-banner__button permission-banner__button--secondary permission-banner__button--always"
                onClick={() => requestPermissionReply(pendingPermission.permissionId, 'always')}
              >
                {t('Always allow')}
              </button>
              <div className="permission-banner__primary-actions">
                <button
                  type="button"
                  className="permission-banner__button permission-banner__button--secondary"
                  onClick={() => requestPermissionReply(pendingPermission.permissionId, 'reject')}
                >
                  {t('Deny')}
                </button>
                <button
                  ref={permissionAllowButtonRef}
                  type="button"
                  className="permission-banner__button permission-banner__button--primary"
                  onClick={() => requestPermissionReply(pendingPermission.permissionId, 'once')}
                >
                  {t('Allow once')}
                </button>
              </div>
            </div>
          </section>
        ) : null}

        <section
          className={`composer-stack${pastedImage ? ' has-preview' : ''}${activeTodos.length > 0 ? ' has-todos' : ''}`}
          aria-label={t('Message composer')}
        >
          {pastedImage ? (
            <div className="composer-stack__preview">
              <img className="composer-stack__thumb" src={pastedImage.previewUrl} alt={t('Pasted image')} />
              <button
                type="button"
                className="composer-stack__thumbRemove"
                onClick={() => {
                  setPastedImage(null)
                  setPastedImageFilePath(null)
                }}
                aria-label={t('Remove image')}
              >
                ×
              </button>
            </div>
          ) : null}

          <TodoPanel todos={activeTodos} />

          <textarea
            ref={composerRef}
            className="composer-stack__textarea"
            value={composerValue}
            onChange={(e) => {
              const nextValue = e.target.value
              setComposerValue(nextValue)
              setComposerCursor(e.target.selectionStart)
              setWorkspaceAttachments((current) => current.filter((resource) => hasWorkspaceMention(nextValue, resource)))
              setSelectedNativeCommandName((current) =>
                current && isComposerCommandInvocation(nextValue, current) ? current : null
              )
              setCommandIndex(0)
            }}
            onSelect={(event) => setComposerCursor(event.currentTarget.selectionStart)}
            aria-controls={
              workspaceMentionState ? 'composer-workspace-menu' : commandState.open ? 'composer-command-menu' : undefined
            }
            aria-activedescendant={
              workspaceMentionState && workspaceResources[workspaceResourceIndex]
                ? `workspace-option-${String(workspaceResourceIndex)}`
                : commandState.open && filteredCommands[commandIndex]
                  ? `command-option-${String(commandIndex)}`
                  : undefined
            }
            placeholder={t('Type a message...')}
            rows={2}
            onPaste={(e) => {
              const items = e.clipboardData?.items
              if (!items) {
                return
              }
              for (const item of items) {
                if (item.kind !== 'file') {
                  continue
                }
                const file = item.getAsFile()
                if (!file || !file.type.startsWith('image/')) {
                  continue
                }
                e.preventDefault()

                const reader = new FileReader()
                reader.onload = () => {
                  const result = reader.result
                  if (typeof result !== 'string') {
                    return
                  }
                  const comma = result.indexOf(',')
                  const base64 = comma >= 0 ? result.slice(comma + 1) : ''
                  if (!base64) {
                    return
                  }

                  const previewUrl = result
                  setPastedImage({ fileName: file.name || 'pasted.png', bytesBase64: base64, previewUrl, mimeType: file.type })
                  setPastedImageFilePath(null)

                  const vscode = getVsCodeApi()
                  if (!vscode) {
                    setRunStatus('Not running in VS Code')
                    return
                  }
                  const requestId = createRequestId()
                  tempfileRequestIdsRef.current.set(requestId, { previewUrl })
                  pushDebug({
                    at: new Date().toISOString(),
                    kind: 'tx',
                    type: 'tempfile.write',
                    requestId,
                    detail: file.name
                  })
                  vscode.postMessage({
                    type: 'tempfile.write',
                    requestId,
                    payload: {
                      fileName: file.name || 'pasted.png',
                      bytesBase64: base64,
                      mimeType: file.type
                    }
                  })
                }
                reader.readAsDataURL(file)
                return
              }
            }}
            onDragOver={(event) => {
              if (event.dataTransfer.types.some((type) => type.includes('uri-list') || type === 'Files')) {
                event.preventDefault()
                event.dataTransfer.dropEffect = 'copy'
              }
            }}
            onDrop={(event) => {
              const values = ['text/uri-list', 'application/vnd.code.uri-list', 'text/plain']
                .map((type) => event.dataTransfer.getData(type))
                .filter((value) => value.trim().length > 0)
              for (const file of Array.from(event.dataTransfer.files)) {
                if (file.name) {
                  values.push(file.name)
                }
              }
              if (values.length === 0) {
                return
              }
              event.preventDefault()
              resolveDroppedWorkspaceResources([...new Set(values)])
            }}
          onKeyDown={(event) => {
            if (workspaceMentionState && workspaceResources.length > 0) {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setWorkspaceResourceIndex((index) => (index + 1) % workspaceResources.length)
                return
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                setWorkspaceResourceIndex((index) => (index - 1 + workspaceResources.length) % workspaceResources.length)
                return
              }
              if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
                event.preventDefault()
                const resource = workspaceResources[workspaceResourceIndex]
                if (resource) {
                  selectWorkspaceResource(resource)
                }
                return
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                setWorkspaceResources([])
                return
              }
            }

            if (commandState.open && filteredCommands.length > 0) {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setCommandIndex((i) => (i + 1) % filteredCommands.length)
                return
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                setCommandIndex((i) => (i - 1 + filteredCommands.length) % filteredCommands.length)
                return
              }
              if (event.key === 'Tab') {
                event.preventDefault()
                setCommandIndex((i) => (i + 1) % filteredCommands.length)
                return
              }
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                const selected = filteredCommands[commandIndex]
                const name = selected?.name
                if (name) {
                  runCommand(name, commandState.args)
                }
                return
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                setComposerValue('')
                return
              }
            }

            if (commandState.open && event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              // Execute even if filtered list is empty (unknown command).
              runCommand(commandState.query, commandState.args)
              return
            }
            if (event.key !== 'Enter' || event.shiftKey) {
              return
            }
            event.preventDefault()
            if (composerValue.length > 0 && composerValue[composerValue.length - 1] === '\\') {
              setComposerValue(`${composerValue.slice(0, -1)}\n`)
              return
            }
            if (!isRunning && composerValue.trim().length > 0 && selectedModel && selectedAgent) {
              startRun()
            }
          }}
        />

        {workspaceMentionState ? (
          <div
            ref={workspaceMenuRef}
            id="composer-workspace-menu"
            className="command-menu workspace-menu"
            role="listbox"
            aria-label={t('workspace files and folders')}
          >
            {workspaceResources.length === 0 ? (
              <div className="command-menu__empty">{t('No matching files')}</div>
            ) : (
              workspaceResources.map((resource, index) => (
                <button
                  key={`${resource.kind}:${resource.absolutePath}`}
                  id={`workspace-option-${String(index)}`}
                  type="button"
                  role="option"
                  aria-selected={index === workspaceResourceIndex}
                  data-resource-index={index}
                  className={`command-menu__item${index === workspaceResourceIndex ? ' is-selected' : ''}`}
                  onMouseEnter={() => setWorkspaceResourceIndex(index)}
                  onMouseDown={(event) => {
                    event.preventDefault()
                    selectWorkspaceResource(resource)
                  }}
                >
                  <span className="command-menu__name">@{resource.path}</span>
                  <span className="command-menu__source">{resource.kind}</span>
                </button>
              ))
            )}
          </div>
        ) : null}

        {commandState.open && !workspaceMentionState ? (
          <div
            ref={commandMenuRef}
            id="composer-command-menu"
            className="command-menu"
            role="listbox"
            aria-label={t('commands')}
          >
            {filteredCommands.length === 0 ? (
              <div className="command-menu__empty">{t('No commands')}</div>
            ) : (
              filteredCommands.map((cmd, idx) => (
                <button
                  key={cmd.name}
                  id={`command-option-${String(idx)}`}
                  type="button"
                  role="option"
                  aria-selected={idx === commandIndex}
                  data-command-index={idx}
                  className={`command-menu__item${idx === commandIndex ? ' is-selected' : ''}`}
                  onMouseEnter={() => setCommandIndex(idx)}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    runCommand(cmd.name, commandState.args)
                  }}
                >
                  <span className="command-menu__name">{cmd.name}</span>
                  <span className="command-menu__hint">{cmd.hint}</span>
                  {cmd.source ? <span className="command-menu__source">{cmd.source}</span> : null}
                </button>
              ))
            )}
          </div>
        ) : null}

        <div className="composer-stack__row">
          <AgentMenu
            agents={agents}
            selectedAgent={selectedAgent}
            onSelect={setSelectedAgent}
            loading={loadingAgents}
            error={agentsError}
          />

          <button
            type="button"
            className="composer-chip composer-chip--model"
            onClick={openModelDialog}
            disabled={providers.length === 0}
          >
            {selectedModel || t('Model')}
          </button>

          <select
            className="composer-chip composer-chip--depth"
            value={selectedThinkingOption}
            onChange={(e) => selectThinkingOption(e.target.value)}
            aria-label={t('thinking depth')}
            disabled={thinkingOptions.length <= 1}
          >
            {thinkingOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>

          {contextUsage ? <ContextUsageIndicator usage={contextUsage.usage} contextWindow={contextUsage.contextWindow} /> : null}

          <button
            type="button"
            className={`composer-stack__send${isRunning ? ' composer-stack__send--running' : ''}`}
            onClick={isRunning ? stopRun : submitComposer}
            disabled={!isRunning && (composerValue.trim().length === 0 || (!commandState.open && (!selectedModel || !selectedAgent)))}
            aria-label={isRunning ? t('Stop') : t('Send')}
            title={isRunning ? t('Stop') : t('Send')}
          >
            {isRunning ? (
              <span className="composer-stack__stop-icon" aria-hidden="true">
                <Square size={11} fill="currentColor" strokeWidth={0} />
              </span>
            ) : (
              <span className="composer-stack__send-arrow" aria-hidden="true">
                <ArrowUp size={19} strokeWidth={2.4} />
              </span>
            )}
          </button>
        </div>
        </section>
      </section>

      <ModelDialog
        open={modelDialogOpen}
        providers={providers}
        selectedProviderId={selectedProviderId}
        setSelectedProviderId={setSelectedProviderId}
        models={visibleModels}
        loadingModels={loadingModels}
        loadingProviders={loadingProviders}
        modelsError={modelsError ?? providersError}
        onRefresh={refreshModelCatalog}
        onSelectModel={setSelectedModel}
        onClose={() => setModelDialogOpen(false)}
      />

      <TimelineDialog
        open={timelineDialogOpen}
        items={timelineItems}
        revertMessageId={timelineRevertMessageId}
        loading={timelineLoading}
        error={timelineError}
        onClose={() => setTimelineDialogOpen(false)}
      />

      <ExportDialog
        open={exportDialogOpen}
        defaultFilename={`session-${(selectedSessionId ?? 'session').slice(0, 8)}.md`}
        busy={exportDialogBusy}
        error={exportDialogError}
        onClose={() => {
          if (!exportDialogBusy) {
            setExportDialogOpen(false)
            setExportDialogError(null)
          }
        }}
        onConfirm={requestSessionMarkdownExport}
      />

      <ResourceDialog
        kind={resourceDialogKind}
        mcpServers={composerMcpServers}
        skills={composerSkills}
        agents={agents}
        thinkingOptions={thinkingOptions}
        selectedAgent={selectedAgent}
        selectedThinking={selectedThinkingOption}
        pendingMcpTargets={pendingMcpTargets}
        refreshing={refreshingResources}
        mcpError={mcpError}
        onToggleMcp={toggleMcpServer}
        onSelectSkill={(skill) => {
          setComposerValue(`Use the "${skill.name}" skill to `)
          setResourceDialogKind(null)
          window.requestAnimationFrame(() => composerRef.current?.focus())
        }}
        onSelectAgent={(agent) => {
          setSelectedAgent(agent)
          setResourceDialogKind(null)
        }}
        onSelectThinking={(value) => {
          selectThinkingOption(value)
          setResourceDialogKind(null)
        }}
        onRefresh={requestComposerResources}
        onClose={() => setResourceDialogKind(null)}
      />

        <SessionDialog
          open={sessionDialogOpen}
          sessions={sessions}
          selectedSessionId={selectedSessionId}
          onSelectSessionId={(sessionId) => selectSession(sessionId)}
          onDeleteSessionId={handleDeleteSession}
          onClose={() => setSessionDialogOpen(false)}
        />
    </main>
  )
}

function splitModel(model: string): { providerID: string; modelID: string } | null {
  const slash = model.indexOf('/')
  if (slash <= 0 || slash >= model.length - 1) {
    return null
  }

  return {
    providerID: model.slice(0, slash),
    modelID: model.slice(slash + 1)
  }
}
