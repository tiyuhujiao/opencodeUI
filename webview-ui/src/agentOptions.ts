import type { AgentSummary } from '../../src/shared/protocol'

function normalizeAgentName(name: string) {
  return name.trim().toLowerCase()
}

/**
 * The CLI agent switcher lists every primary agent and skips the hidden ones
 * (and subagents). The extension mirrors that list instead of hardcoding agent
 * names, so custom agents installed later (for example by the omo project)
 * show up as soon as `opencode serve` reports them.
 */
export function isSelectableAgent(agent: AgentSummary) {
  return agent.hidden !== true && agent.isPrimary !== false
}

export function getSelectableAgents(agents: AgentSummary[]) {
  return agents.filter(isSelectableAgent)
}

export function getVisibleAgentOptions(agents: AgentSummary[], selectedAgent = '') {
  const seen = new Set<string>()
  const merged: AgentSummary[] = []

  const add = (agent: AgentSummary) => {
    const name = agent.name.trim()
    const normalized = normalizeAgentName(name)
    if (!name || seen.has(normalized)) {
      return
    }
    seen.add(normalized)
    merged.push({ ...agent, name })
  }

  if (selectedAgent) {
    const selected = agents.find((agent) => normalizeAgentName(agent.name) === normalizeAgentName(selectedAgent))
    add(selected ?? { name: selectedAgent, isPrimary: true })
  }
  for (const agent of getSelectableAgents(agents)) {
    add(agent)
  }

  return merged
}

export function isSelectableAgentSelection(agents: AgentSummary[], name: string) {
  const normalized = normalizeAgentName(name)
  if (!normalized) {
    return false
  }
  return getSelectableAgents(agents).some((agent) => normalizeAgentName(agent.name) === normalized)
}

export function getDefaultAgentName(agents: AgentSummary[]) {
  const options = getSelectableAgents(agents)
  return (
    options.find((agent) => normalizeAgentName(agent.name) === 'build')?.name ??
    options[0]?.name ??
    'build'
  )
}

export function getAgentLabel(agent: AgentSummary) {
  const label = agent.displayName?.trim()
  return label && label.length > 0 ? label : agent.name
}
