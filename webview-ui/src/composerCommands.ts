import type { ComposerCommandSummary } from '../../src/shared/protocol'

export type ComposerCommandInvocation = {
  name: string
  arguments: string
}

export function resolveComposerCommandInvocation(
  value: string,
  commands: ComposerCommandSummary[]
): ComposerCommandInvocation | null {
  const parsed = parseSlashInvocation(value)
  if (!parsed) {
    return null
  }

  const command = commands.find((entry) => entry.name.toLowerCase() === parsed.name.toLowerCase())
  return command ? { name: command.name, arguments: parsed.arguments } : null
}

export function isComposerCommandInvocation(value: string, commandName: string): boolean {
  const parsed = parseSlashInvocation(value)
  return parsed?.name.toLowerCase() === commandName.toLowerCase()
}

function parseSlashInvocation(value: string): ComposerCommandInvocation | null {
  const trimmed = value.trimStart()
  if (!trimmed.startsWith('/')) {
    return null
  }

  const body = trimmed.slice(1)
  const separator = body.search(/\s/)
  const name = (separator < 0 ? body : body.slice(0, separator)).trim()
  if (!name) {
    return null
  }

  return {
    name,
    arguments: separator < 0 ? '' : body.slice(separator).trim()
  }
}
