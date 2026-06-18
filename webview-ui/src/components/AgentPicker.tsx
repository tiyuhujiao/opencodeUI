import type { AgentSummary } from '../../../src/shared/protocol'

type AgentPickerProps = {
  agents: AgentSummary[]
  selectedAgent: string
  onSelect: (name: string) => void
  loading: boolean
  error: string | null
}

export function AgentPicker({ agents, selectedAgent, onSelect, loading, error }: AgentPickerProps) {
  return (
    <section className="picker" aria-label="agent picker">
      <header className="picker__header">
        <h3>Agent</h3>
        {loading ? <span>Loading…</span> : null}
      </header>

      {error ? <p className="error-line">{error}</p> : null}

      <select
        className="picker__select"
        value={selectedAgent}
        onChange={(event) => onSelect(event.target.value)}
      >
        {agents.map((agent) => (
          <option key={agent.name} value={agent.name}>
            {agent.name}{agent.isPrimary ? ' (primary)' : ''}
          </option>
        ))}
      </select>
    </section>
  )
}
