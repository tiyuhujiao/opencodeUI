import type { AgentSummary } from '../../../src/shared/protocol'
import { useI18n } from '../i18n'

type AgentPickerProps = {
  agents: AgentSummary[]
  selectedAgent: string
  onSelect: (name: string) => void
  loading: boolean
  error: string | null
}

export function AgentPicker({ agents, selectedAgent, onSelect, loading, error }: AgentPickerProps) {
  const { t } = useI18n()
  return (
    <section className="picker" aria-label={t('Agent picker')}>
      <header className="picker__header">
        <h3>{t('Agent')}</h3>
        {loading ? <span>{t('Loading...')}</span> : null}
      </header>

      {error ? <p className="error-line">{error}</p> : null}

      <select
        className="picker__select"
        value={selectedAgent}
        onChange={(event) => onSelect(event.target.value)}
      >
        {agents.map((agent) => (
          <option key={agent.name} value={agent.name}>
            {agent.name}{agent.isPrimary ? ` (${t('primary')})` : ''}
          </option>
        ))}
      </select>
    </section>
  )
}
