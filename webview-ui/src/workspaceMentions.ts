import type { WorkspaceResourceSummary } from '../../src/shared/protocol'

export type WorkspaceMentionState = {
  start: number
  end: number
  query: string
}

export function getWorkspaceMentionState(value: string, cursor: number): WorkspaceMentionState | null {
  const beforeCursor = value.slice(0, Math.max(0, cursor))
  const match = /(?:^|\s)@(?:"([^"]*)|([^\s@]*))$/.exec(beforeCursor)
  if (!match) {
    return null
  }

  const atOffset = match[0].lastIndexOf('@')
  const start = (match.index ?? 0) + atOffset
  return {
    start,
    end: cursor,
    query: (match[1] ?? match[2] ?? '').replace(/\\/g, '/')
  }
}

export function insertWorkspaceMention(
  value: string,
  state: WorkspaceMentionState,
  resource: WorkspaceResourceSummary
): { value: string; cursor: number } {
  const escapedPath = resource.path.replace(/"/g, '\\"')
  const mention = /\s/.test(escapedPath) ? `@"${escapedPath}"` : `@${escapedPath}`
  const suffix = value.slice(state.end)
  const separator = suffix.startsWith(' ') || suffix.startsWith('\n') ? '' : ' '
  const nextValue = `${value.slice(0, state.start)}${mention}${separator}${suffix}`
  return {
    value: nextValue,
    cursor: state.start + mention.length + separator.length
  }
}

export function appendWorkspaceMentions(
  value: string,
  resources: WorkspaceResourceSummary[]
): { value: string; cursor: number } {
  let nextValue = value
  if (nextValue.length > 0 && !/\s$/.test(nextValue)) {
    nextValue += ' '
  }
  for (const resource of resources) {
    const escapedPath = resource.path.replace(/"/g, '\\"')
    nextValue += /\s/.test(escapedPath) ? `@"${escapedPath}" ` : `@${escapedPath} `
  }
  return { value: nextValue, cursor: nextValue.length }
}

export function mergeWorkspaceResources(
  current: WorkspaceResourceSummary[],
  additions: WorkspaceResourceSummary[]
): WorkspaceResourceSummary[] {
  const resources = new Map(current.map((resource) => [`${resource.kind}:${resource.absolutePath}`, resource]))
  for (const resource of additions) {
    resources.set(`${resource.kind}:${resource.absolutePath}`, resource)
  }
  return [...resources.values()]
}

export function hasWorkspaceMention(value: string, resource: WorkspaceResourceSummary): boolean {
  const escapedPath = resource.path.replace(/"/g, '\\"')
  return value.includes(`@${escapedPath}`) || value.includes(`@"${escapedPath}"`)
}
