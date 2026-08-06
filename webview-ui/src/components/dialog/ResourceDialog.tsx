import { useEffect } from 'react'
import { Bot, BrainCircuit, Check, LoaderCircle, RefreshCw, Server, Sparkles, X } from 'lucide-react'
import type {
  AgentSummary,
  ComposerMcpServerSummary,
  ComposerSkillSummary
} from '../../../../src/shared/protocol'
import { useI18n } from '../../i18n'

export type ResourceDialogKind = 'mcp' | 'skills' | 'agents' | 'thinking'

type ResourceDialogProps = {
  kind: ResourceDialogKind | null
  mcpServers: ComposerMcpServerSummary[]
  skills: ComposerSkillSummary[]
  agents: AgentSummary[]
  thinkingOptions: string[]
  selectedAgent: string
  selectedThinking: string
  pendingMcpTargets: Map<string, boolean>
  refreshing: boolean
  mcpError: string | null
  onToggleMcp: (server: ComposerMcpServerSummary) => void
  onSelectSkill: (skill: ComposerSkillSummary) => void
  onSelectAgent: (agent: string) => void
  onSelectThinking: (value: string) => void
  onRefresh: () => void
  onClose: () => void
}

const titles: Record<ResourceDialogKind, string> = {
  mcp: 'MCP Servers',
  skills: 'Skills',
  agents: 'Agents',
  thinking: 'Thinking'
}

function ResourceKindIcon({ kind }: { kind: ResourceDialogKind }) {
  if (kind === 'mcp') {
    return <Server size={14} strokeWidth={1.8} />
  }
  if (kind === 'skills') {
    return <Sparkles size={14} strokeWidth={1.8} />
  }
  if (kind === 'agents') {
    return <Bot size={14} strokeWidth={1.8} />
  }
  return <BrainCircuit size={14} strokeWidth={1.8} />
}

export function ResourceDialog(props: ResourceDialogProps) {
  const { t } = useI18n()
  const { kind, onClose } = props

  useEffect(() => {
    if (!kind) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [kind, onClose])

  if (!kind) {
    return null
  }

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={t(titles[kind])}>
      <button type="button" className="overlay__backdrop" onClick={onClose} aria-label={t('Close')} />
      <div className="dialog resource-dialog">
        <header className="dialog__header">
          <div className="resource-dialog__heading">
            <span className={`resource-dialog__kindIcon resource-dialog__kindIcon--${kind}`} aria-hidden="true">
              <ResourceKindIcon kind={kind} />
            </span>
            <div className="dialog__title">{t(titles[kind])}</div>
          </div>
          <div className="resource-dialog__headerActions">
            {(kind === 'mcp' || kind === 'skills') ? (
              <button
                type="button"
                className={`icon-button resource-dialog__refresh${props.refreshing ? ' is-loading' : ''}`}
                onClick={props.onRefresh}
                aria-label={props.refreshing ? t('Refreshing') : t('Refresh')}
                aria-busy={props.refreshing}
                title={props.refreshing ? t('Refreshing') : t('Refresh')}
                disabled={props.refreshing}
              >
                <RefreshCw size={14} strokeWidth={1.8} />
              </button>
            ) : null}
            <button type="button" className="icon-button" onClick={onClose} aria-label={t('Close')} title={t('Close')}>
              <X size={15} strokeWidth={1.8} />
            </button>
          </div>
        </header>

        {kind === 'mcp' ? <McpList {...props} /> : null}
        {kind === 'skills' ? <SkillList {...props} /> : null}
        {kind === 'agents' ? <AgentList {...props} /> : null}
        {kind === 'thinking' ? <ThinkingList {...props} /> : null}
      </div>
    </div>
  )
}

function McpList(props: ResourceDialogProps) {
  const { t } = useI18n()
  return (
    <div className="resource-dialog__list" aria-live="polite">
      {props.mcpError ? <div className="dialog__error resource-dialog__error" role="alert">{t(props.mcpError)}</div> : null}
      {props.mcpServers.length === 0 ? (
        <div className="dialog__empty">{props.refreshing ? t('Loading MCP servers...') : t('No MCP servers')}</div>
      ) : null}
      {props.mcpServers.map((server) => {
        const pending = props.pendingMcpTargets.has(server.name)
        const targetEnabled = props.pendingMcpTargets.get(server.name)
        const visualEnabled = pending ? targetEnabled === true : server.enabled
        const normalizedStatus = server.status.trim().toLowerCase()
        const failed = Boolean(server.error) || normalizedStatus === 'failed' || normalizedStatus === 'error'
        const visualState = pending
          ? targetEnabled
            ? 'connecting'
            : 'disconnecting'
          : failed
            ? 'error'
            : server.enabled
              ? 'connected'
              : 'disabled'
        const statusLabel = pending
          ? targetEnabled
            ? 'Connecting...'
            : 'Disconnecting...'
          : server.error || (server.enabled ? 'Connected' : normalizedStatus === 'disabled' ? 'Disabled' : server.status)
        return (
          <div className={`resource-dialog__item resource-dialog__item--mcp is-${visualState}`} key={server.name} aria-busy={pending}>
            <div className="resource-dialog__main">
              <div className="resource-dialog__name">{server.name}</div>
              <div className={`resource-dialog__status is-${visualState}`}>
                {pending ? (
                  <LoaderCircle className="resource-dialog__statusSpinner" size={11} strokeWidth={2} aria-hidden="true" />
                ) : (
                  <span className="resource-dialog__statusDot" aria-hidden="true" />
                )}
                <span>{t(statusLabel)}</span>
              </div>
            </div>
            <button
              type="button"
              className={`resource-switch${visualEnabled ? ' is-on' : ''}${pending ? ' is-pending' : ''}`}
              role="switch"
              aria-checked={visualEnabled}
              aria-busy={pending}
              aria-label={pending ? `${statusLabel} ${server.name}` : `${server.enabled ? 'Disable' : 'Enable'} ${server.name}`}
              disabled={pending}
              onClick={() => props.onToggleMcp(server)}
            >
              <span className="resource-switch__thumb" />
            </button>
          </div>
        )
      })}
    </div>
  )
}

function SkillList(props: ResourceDialogProps) {
  const { t } = useI18n()
  return (
    <div className="resource-dialog__list">
      {props.skills.length === 0 ? <div className="dialog__empty">{props.refreshing ? t('Loading skills...') : t('No skills')}</div> : null}
      {props.skills.map((skill) => (
        <button type="button" className="resource-dialog__item" key={skill.name} onClick={() => props.onSelectSkill(skill)}>
          <span className="resource-dialog__main">
            <span className="resource-dialog__name">{skill.name}</span>
            {skill.description ? <span className="resource-dialog__status">{skill.description}</span> : null}
          </span>
        </button>
      ))}
    </div>
  )
}

function AgentList(props: ResourceDialogProps) {
  return (
    <div className="resource-dialog__list">
      {props.agents.map((agent) => {
        const selected = agent.name === props.selectedAgent
        return (
          <button type="button" className={`resource-dialog__item${selected ? ' is-selected' : ''}`} key={agent.name} onClick={() => props.onSelectAgent(agent.name)}>
            <span className="resource-dialog__name">{agent.name}</span>
            {selected ? <Check size={14} strokeWidth={2} aria-hidden="true" /> : null}
          </button>
        )
      })}
    </div>
  )
}

function ThinkingList(props: ResourceDialogProps) {
  return (
    <div className="resource-dialog__list">
      {props.thinkingOptions.map((option) => {
        const selected = option === props.selectedThinking
        return (
          <button type="button" className={`resource-dialog__item${selected ? ' is-selected' : ''}`} key={option} onClick={() => props.onSelectThinking(option)}>
            <span className="resource-dialog__name">{option}</span>
            {selected ? <Check size={14} strokeWidth={2} aria-hidden="true" /> : null}
          </button>
        )
      })}
    </div>
  )
}
