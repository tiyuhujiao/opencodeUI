import type { AgentSummary } from './protocol';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Turns the raw `/agent` payload from `opencode serve` into the picker view model.
 * The CLI lists every primary, non-hidden agent it knows about, including custom presets
 * installed later (for example the omo agent set) — this mapping keeps exactly that set.
 */
export function mapAgentSummaries(rawAgents: unknown): AgentSummary[] {
  if (!Array.isArray(rawAgents)) {
    return [];
  }
  const seen = new Set<string>();
  return rawAgents.flatMap((entry): AgentSummary[] => {
    if (!isRecord(entry)) {
      return [];
    }
    const rawName = typeof entry.id === 'string' ? entry.id : typeof entry.name === 'string' ? entry.name : '';
    const name = rawName.trim();
    const key = name.toLowerCase();
    if (!key || seen.has(key) || entry.hidden === true) {
      return [];
    }
    seen.add(key);
    const displayName = typeof entry.displayName === 'string' ? entry.displayName.trim() : '';
    const description = typeof entry.description === 'string' ? entry.description.trim() : '';
    return [
      {
        name,
        isPrimary: entry.isPrimary !== false,
        ...(displayName && displayName !== name ? { displayName } : {}),
        ...(description ? { description } : {}),
      },
    ];
  });
}
