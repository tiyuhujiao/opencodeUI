import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRequestId, getVsCodeApi } from './vscodeApi'
import { Transcript } from './components/Transcript'
import { ModelDialog } from './components/dialog/ModelDialog'
import { SessionDialog } from './components/dialog/SessionDialog'
import { TimelineDialog } from './components/dialog/TimelineDialog'
import { resolveSessionSelectionAfterList } from './sessionSelection'
import {
  applyRunEventToTranscript,
  compactTranscript,
  hasAnyAssistantText,
  isExportAtLeastAsComplete,
  mergeLocalImageParts,
  preserveProtectedSessionSummary,
  summarizePendingSessionTitle,
  upsertPendingSessionSummary
} from './transcriptState'
import {
  isExtensionResponseMessage,
  type AgentSummary,
  type HostKind,
  type ModelSummary,
  type ProviderSummary,
  type QuestionInfo,
  type RunStreamEvent,
  type SessionSummary,
  type SessionTimelineItem,
  type TranscriptMessage
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
  getThinkingSelectionValue,
  THINKING_OFF_VALUE,
  toThinkingSelection
} from './thinkingOptions'

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

export type UiRunEvent = RunStreamEvent

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

function formatHostLabel(hostKind: HostKind, remoteName?: string): string {
  if (hostKind === 'local-windows') {
    return 'Windows'
  }

  if (hostKind === 'local-linux') {
    return 'Linux'
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
  const states = [selfcheck.sessions.state, selfcheck.models.state, selfcheck.agents.state]
  if (states.some((state) => state === 'error' || state === 'timeout')) {
    return 'error'
  }
  if (states.some((state) => state === 'pending')) {
    return 'pending'
  }
  if (states.every((state) => state === 'ok')) {
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
    return { kind: 'running', label: '运行中' }
  }

  if (status === 'Completed') {
    return { kind: 'completed', label: '已完成' }
  }

  if (status === 'Stopped') {
    return { kind: 'stopped', label: '已停止' }
  }

  if (status === 'Failed') {
    return { kind: 'failed', label: '运行失败' }
  }

  return null
}

function RunStatusIndicator({
  status,
  editedFiles,
  onOpenFile
}: {
  status: string
  editedFiles: EditedFileSummary[]
  onOpenFile: (filePath: string) => void
}) {
  const activity = getRunActivity(status)
  if (!activity) {
    return (
      <div className="run-status-row">
        <p className="status-line status-line--message">{status}</p>
        <EditedFilesSummary files={editedFiles} onOpenFile={onOpenFile} />
      </div>
    )
  }

  return (
    <div className="run-status-row">
      <output className={`run-indicator run-indicator--${activity.kind}`} aria-label={activity.label}>
        <span className="run-indicator__icon" aria-hidden="true" />
      </output>
      <EditedFilesSummary files={editedFiles} onOpenFile={onOpenFile} />
    </div>
  )
}

function EditedFilesSummary({ files, onOpenFile }: { files: EditedFileSummary[]; onOpenFile: (filePath: string) => void }) {
  if (files.length === 0) {
    return null
  }

  const additions = files.reduce((sum, file) => sum + file.additions, 0)
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0)
  const label = files.length === 1 ? files[0]?.displayPath : `${String(files.length)} files`

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
        {files.map((file) => (
          <button key={file.path} type="button" className="edit-summary__item" onClick={() => onOpenFile(file.path)}>
            <span className="edit-summary__path">{file.displayPath}</span>
            <span className="edit-summary__stats">
              <span className="edit-summary__add">+{file.additions}</span>
              <span className="edit-summary__del">-{file.deletions}</span>
            </span>
          </button>
        ))}
      </div>
    </details>
  )
}

function TodoPanel({ todos }: { todos: TodoItem[] }) {
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
  const summaryText = activeTodo?.content ?? todos.find((todo) => normalizeTodoStatus(todo.status) !== 'completed')?.content ?? 'All done'

  return (
    <details
      className="composer-todo"
      open={open}
      onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="composer-todo__summary">
        <span className="composer-todo__chevron" aria-hidden="true" />
        <span className="composer-todo__title">Todos</span>
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
              <span className="composer-todo__state">{todoStatusLabel(todo.status)}</span>
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
  const detailsRef = useRef<HTMLDetailsElement | null>(null)
  const options = useMemo(() => getVisibleAgentOptions(agents, selectedAgent), [agents, selectedAgent])
  const selected = options.find((agent) => normalizeAgentName(agent.name) === normalizeAgentName(selectedAgent))?.name ?? options[0]?.name ?? ''

  return (
    <details className="agent-menu" ref={detailsRef}>
      <summary className="agent-menu__summary" aria-label={`agent mode ${selected || 'not selected'}`}>
        <span className="agent-menu__value">{selected || (loading ? 'Loading' : 'Agent')}</span>
        <span className="agent-menu__chevron" aria-hidden="true" />
      </summary>
      <div className="agent-menu__panel" role="listbox" aria-label="agent mode">
        {loading ? <div className="agent-menu__hint">Loading...</div> : null}
        {error ? <div className="agent-menu__error">{error}</div> : null}
        {options.length === 0 ? <div className="agent-menu__hint">No agents</div> : null}
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
      <div className="question-banner__header">Question needs input</div>
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
                  placeholder="Custom answer"
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
          Reply
        </button>
        <button type="button" onClick={() => onReject(pending.questionId)}>
          Dismiss
        </button>
      </div>
    </div>
  )
}

export default function App() {
  const [status, setStatus] = useState('Connecting...')
  const [workspaceFolderPath, setWorkspaceFolderPath] = useState<string | undefined>(undefined)
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => readInitialTheme())
  const [debugEnabled, setDebugEnabled] = useState(false)
  const [debugPopoverOpen, setDebugPopoverOpen] = useState(false)
  const [debugLog, setDebugLog] = useState<DebugEntry[]>([])

  const [selfcheck, setSelfcheck] = useState<SelfcheckSnapshot>({
    sessions: { state: 'idle' },
    models: { state: 'idle' },
    agents: { state: 'idle' }
  })

  const pushDebug = useCallback((entry: DebugEntry) => {
    setDebugLog((current) => [...current, entry].slice(-200))
  }, [])

  const selfcheckTimersRef = useRef<{ sessions?: number; models?: number; agents?: number }>({})

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
      }, 2500)
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
  const [models, setModels] = useState<ModelSummary[]>([])
  const [agents, setAgents] = useState<AgentSummary[]>([])
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
  const composerRef = useRef<HTMLTextAreaElement | null>(null)

  const [commandIndex, setCommandIndex] = useState(0)
  const [deleteArmed, setDeleteArmed] = useState<null | { sessionId: string; armedAt: number }>(null)
  const [pastedImage, setPastedImage] = useState<null | { fileName: string; bytesBase64: string; previewUrl: string; mimeType: string }>(
    null
  )
  const [pastedImageFilePath, setPastedImageFilePath] = useState<string | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [runStatus, setRunStatus] = useState<string | null>(null)
  const [editedFiles, setEditedFiles] = useState<EditedFileSummary[]>([])

  const [thinkingEnabled, setThinkingEnabled] = useState(false)
  const [thinkingVariant, setThinkingVariant] = useState('')
  const selectedModelSummary = useMemo(() => models.find((model) => model.name === selectedModel), [models, selectedModel])
  const thinkingOptions = useMemo(() => getThinkingOptionsForModel(selectedModelSummary), [selectedModelSummary])
  const thinkingSelectionValue = getThinkingSelectionValue(thinkingEnabled, thinkingVariant)
  const selectedThinkingOption = findThinkingOption(thinkingOptions, thinkingSelectionValue) ?? THINKING_OFF_VALUE

  const [modelDialogOpen, setModelDialogOpen] = useState(false)
  const [sessionDialogOpen, setSessionDialogOpen] = useState(false)
  const [timelineDialogOpen, setTimelineDialogOpen] = useState(false)
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
  const deleteRequestIdsRef = useRef<Map<string, string>>(new Map())
  const timelineRequestIdsRef = useRef<Map<string, string>>(new Map())
  const undoRequestIdsRef = useRef<Map<string, string>>(new Map())
  const redoRequestIdsRef = useRef<Map<string, string>>(new Map())
  const permissionReplyRequestIdsRef = useRef<Map<string, string>>(new Map())
  const questionReplyRequestIdsRef = useRef<Map<string, string>>(new Map())
  const questionRejectRequestIdsRef = useRef<Map<string, string>>(new Map())
  const providersRequestIdsRef = useRef<Set<string>>(new Set())
  const modelsRequestIdsRef = useRef<Set<string>>(new Set())
  const agentsRequestIdsRef = useRef<Set<string>>(new Set())
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

  const allowAutoSelectSessionRef = useRef(true)
  const isRunningRef = useRef(false)
  const suppressNextSessionAutoExportRef = useRef(true)

  const sessionsRef = useRef<SessionSummary[]>([])
  const transcriptRef = useRef<TranscriptMessage[]>([])

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, themeMode)
    } catch {
      // Webview storage can be unavailable in constrained hosts; keep the in-memory theme active.
    }
  }, [themeMode])

  useEffect(() => {
    if (findThinkingOption(thinkingOptions, thinkingSelectionValue)) {
      return
    }
    setThinkingEnabled(false)
    setThinkingVariant('')
  }, [thinkingOptions, thinkingSelectionValue])

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

      setSelfcheck({
        sessions: { state: 'pending', detail: 'Request sent', lastRequestId: requestId },
        models: { state: 'pending', detail: 'Request sent', lastRequestId: requestId },
        agents: { state: 'pending', detail: 'Request sent', lastRequestId: requestId }
      })

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

  const applyLiveRunEvent = useCallback((event: Extract<UiRunEvent, { type: 'part' } | { type: 'error' }>, assistantIndex: number) => {
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
      if (completion.sessionId) {
        lastCompletedRunRef.current = {
          sessionId: completion.sessionId,
          completedAt: Date.now(),
          localTranscript: transcriptRef.current,
          exportAttempts: 0
        }
      }
    } else if (completion.type === 'stopped') {
      setRunStatus('Stopped')
    } else {
      setRunStatus('Failed')
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
    setSelectedSessionId(sessionId)
  }, [])

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
    (filePath: string) => {
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
        detail: filePath
      })
      vscode.postMessage({
        type: 'file.open',
        requestId,
        payload: {
          path: filePath
        }
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
        files: pastedImageFilePath ? [pastedImageFilePath] : undefined
      }
    })
    if (pastedImage) {
      setPastedImage(null)
      setPastedImageFilePath(null)
    }
  }, [composerValue, isRunning, moveSessionExportsToBackground, pastedImage, pastedImageFilePath, pushDebug, selectedSessionId, selectedModel, selectedAgent, thinkingEnabled, thinkingVariant, transcript.length])

  const commands = useMemo(() => {
    type Cmd = {
      name: string
      hint: string
      run: (args: string[]) => void
    }

    const thinkingUsage = `Usage: /thinking ${thinkingOptions.join('|')}`
    const setThinkingDepth = (value: string) => {
      const option = findThinkingOption(thinkingOptions, value)
      if (!option) {
        setRunStatus(thinkingUsage)
        return
      }
      const next = toThinkingSelection(option)
      setThinkingEnabled(next.enabled)
      setThinkingVariant(next.variant)
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
        hint: 'Set agent: build|plan',
        run: (args) => {
          const next = (args[0] || '').toLowerCase()
          if (next !== 'build' && next !== 'plan') {
            setRunStatus('Usage: /agent build|plan')
            return
          }
          setSelectedAgent(next)
        }
      },
      {
        name: '/thinking',
        hint: `Set depth: ${thinkingOptions.join('|')}`,
        run: (args) => {
          const v = args[0] || ''
          if (!v) {
            setRunStatus(thinkingUsage)
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
          requestSessionExport(selectedSessionIdRef.current)
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
    return cmds
  }, [deleteArmed, handleDeleteSession, openModelDialog, requestSessionExport, requestSessionRedo, requestSessions, requestSessionTimeline, requestSessionUndo, selectSession, thinkingOptions])

  const commandState = useMemo(() => {
    const raw = composerValue
    const isSingleLine = !raw.includes('\n')
    if (!isSingleLine) {
      return { open: false as const, query: '', args: [] as string[] }
    }
    const trimmed = raw.trimStart()
    if (!trimmed.startsWith('/')) {
      return { open: false as const, query: '', args: [] as string[] }
    }
    const text = trimmed.slice(1)
    const tokens = text.split(/\s+/).filter(Boolean)
    const query = tokens[0] ? `/${tokens[0]}` : '/'
    const args = tokens.slice(1)
    return { open: true as const, query, args }
  }, [composerValue])

  const filteredCommands = useMemo(() => {
    if (!commandState.open) {
      return []
    }
    const q = commandState.query.toLowerCase()
    return commands
      .filter((cmd) => cmd.name.startsWith(q) || q === '/')
      .slice(0, 12)
  }, [commandState.open, commandState.query, commands])

  const runCommand = useCallback(
    (cmdName: string, args: string[]) => {
      const cmd = commands.find((c) => c.name === cmdName)
      if (!cmd) {
        setRunStatus(`Unknown command: ${cmdName}`)
        return
      }
      cmd.run(args)
      setComposerValue('')
    },
    [commands]
  )

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
      if (isRunning) {
        event.preventDefault()
        stopRun()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isRunning, modelDialogOpen, sessionDialogOpen, stopRun])

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
          const exported = mergeLocalImageParts(lastCompleted.localTranscript, compactTranscript(message.payload.messages))
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
          const exported = mergeLocalImageParts(transcriptRef.current, compactTranscript(message.payload.messages))
          transcriptRef.current = exported
          setTranscript(exported)
        }
        setTranscriptError(null)
        setLoadingTranscript(hasBlockingExportRequests(exportRequestIdsRef.current))
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
          const currentRid = current.sessions.lastRequestId
          if (currentRid && currentRid !== rid) {
            return current
          }

          const toState = (v: { ok: true; count: number } | { ok: false; error: string }): SelfcheckState =>
            v.ok
              ? { state: 'ok', detail: `count=${String(v.count)}`, lastRequestId: rid }
              : { state: 'error', detail: v.error, lastRequestId: rid }

          return {
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

        if (agentsRequestIdsRef.current.has(message.requestId)) {
          agentsRequestIdsRef.current.delete(message.requestId)
          setAgentsError(message.error)
          setLoadingAgents(agentsRequestIdsRef.current.size > 0)
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
            applyLiveRunEvent(
              {
                type: 'error',
                error: message.error
              },
              active.assistantIndex
            )
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
    requestModels,
    requestProviders,
    requestSessions,
    requestSessionExport,
    timelineDialogOpen,
    requestSessionTimeline,
    selectSession
  ])

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
  const diagnosticsLabel = getDiagnosticsLabel(diagnosticsState)
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

  return (
    <main className="app">
      <header className="topbar">
        <div className="topbar__brand">
          <div className="topbar__title">OpenCode</div>
          <div className="topbar__meta">
            <button
              type="button"
              className="theme-toggle"
              onClick={() => setThemeMode((current) => (current === 'light' ? 'dark' : 'light'))}
              aria-label={themeMode === 'light' ? '切换到黑色主题' : '切换到白色主题'}
              title={themeMode === 'light' ? '切换到黑色主题' : '切换到白色主题'}
            >
              <span className="theme-toggle__icon" aria-hidden="true">☀</span>
            </button>
            <div className="topbar__status">{status}</div>
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
                <div className="diagnostics-popover" id="diagnostics-popover" role="dialog" aria-label="Diagnostics">
                  <div className="diagnostics-popover__header">
                    <h2>Self-check</h2>
                    <div className="diagnostics-popover__actions">
                      <label className="debug-toggle">
                        <input
                          type="checkbox"
                          checked={debugEnabled}
                          onChange={(event) => {
                            setDebugEnabled(event.target.checked)
                          }}
                        />
                        Enable
                      </label>
                      <button type="button" onClick={requestSelfcheck}>
                        Run
                      </button>
                      <button type="button" onClick={() => setDebugLog([])}>
                        Clear
                      </button>
                    </div>
                  </div>

                  <div className="diagnostics-popover__status">
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
                    <p className="empty-line">Enable to capture request/response logs.</p>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="topbar__session">
          <div className="session-chip">
            <div className="session-chip__label">Session</div>
            <div className="session-chip__value">
              {selectedSessionId
                ? (sessions.find((s) => s.id === selectedSessionId)?.title ?? selectedSessionId)
                : 'None'}
            </div>
          </div>
          <div className="topbar__actions">
            <button
              type="button"
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
            >
              New
            </button>
            <button type="button" onClick={() => setSessionDialogOpen(true)} disabled={sessions.length === 0}>
              Switch
            </button>
            <button type="button" onClick={() => requestSessions()} disabled={loadingSessions}>
              {loadingSessions ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>
      </header>

      {sessionsError ? <p className="error-line">{sessionsError}</p> : null}
      {runStatus ? <RunStatusIndicator status={runStatus} editedFiles={editedFiles} onOpenFile={openEditedFile} /> : null}

      <section className="main-shell" aria-label="main">
        <div className="chat">
          {pendingPermission ? (
            <div className="permission-banner" role="alert">
              <div className="permission-banner__text">
                <strong>{pendingPermission.toolName}</strong>
                {pendingPermission.patterns.length > 0 ? ` wants ${pendingPermission.patterns.join(', ')}` : ' requests permission'}
                {pendingPermission.message ? ` - ${pendingPermission.message}` : ''}
              </div>
              <div className="permission-banner__actions">
                <button type="button" onClick={() => requestPermissionReply(pendingPermission.permissionId, 'once')}>
                  Allow once
                </button>
                <button type="button" onClick={() => requestPermissionReply(pendingPermission.permissionId, 'always')}>
                  Always allow
                </button>
                <button type="button" onClick={() => requestPermissionReply(pendingPermission.permissionId, 'reject')}>
                  Reject
                </button>
              </div>
            </div>
          ) : null}
          {pendingQuestion ? (
            <QuestionBanner pending={pendingQuestion} onReply={requestQuestionReply} onReject={requestQuestionReject} />
          ) : null}
          {transcriptError ? <p className="error-panel">{transcriptError}</p> : null}
          {!loadingTranscript && !transcriptError && transcript.length === 0 ? <p className="empty-line">No messages</p> : null}
          {!transcriptError && transcript.length > 0 ? <Transcript messages={compactTranscript(transcript)} isRunning={isRunning} /> : null}
        </div>

        <section
          className={`composer-stack${pastedImage ? ' has-preview' : ''}${activeTodos.length > 0 ? ' has-todos' : ''}`}
          aria-label="composer"
        >
          {pastedImage ? (
            <div className="composer-stack__preview">
              <img className="composer-stack__thumb" src={pastedImage.previewUrl} alt="pasted" />
              <button
                type="button"
                className="composer-stack__thumbRemove"
                onClick={() => {
                  setPastedImage(null)
                  setPastedImageFilePath(null)
                }}
                aria-label="remove image"
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
            onChange={(e) => setComposerValue(e.target.value)}
            placeholder="输入消息…"
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
          onKeyDown={(event) => {
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

        {commandState.open ? (
          <div className="command-menu" role="listbox" aria-label="commands">
            {filteredCommands.length === 0 ? (
              <div className="command-menu__empty">No commands</div>
            ) : (
              filteredCommands.map((cmd, idx) => (
                <button
                  key={cmd.name}
                  type="button"
                  className={`command-menu__item${idx === commandIndex ? ' is-selected' : ''}`}
                  onMouseEnter={() => setCommandIndex(idx)}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    runCommand(cmd.name, commandState.args)
                  }}
                >
                  <span className="command-menu__name">{cmd.name}</span>
                  <span className="command-menu__hint">{cmd.hint}</span>
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
            {selectedModel || 'Model'}
          </button>

          <select
            className="composer-chip composer-chip--depth"
            value={selectedThinkingOption}
            onChange={(e) => {
              const next = toThinkingSelection(e.target.value)
              setThinkingEnabled(next.enabled)
              setThinkingVariant(next.variant)
            }}
            aria-label="thinking depth"
            disabled={thinkingOptions.length <= 1}
          >
            {thinkingOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>

          <button
            type="button"
            className={`composer-stack__send${isRunning ? ' composer-stack__send--running' : ''}`}
            onClick={isRunning ? stopRun : startRun}
            disabled={!isRunning && (!selectedModel || !selectedAgent || composerValue.trim().length === 0)}
            aria-label={isRunning ? 'stop' : 'send'}
            title={isRunning ? 'Stop' : 'Send'}
          >
            {isRunning ? (
              <span className="composer-stack__stop-icon" aria-hidden="true" />
            ) : (
              <span className="composer-stack__send-arrow" aria-hidden="true">↑</span>
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
