export type FileReference = {
  path: string
  line?: number
  column?: number
}

export type ParseFileReferenceOptions = {
  allowBareFilename?: boolean
}

const FILE_EXTENSION = /\.(?:[cm]?[jt]sx?|py|rb|rs|go|java|kt|kts|swift|cs|cpp|cc|cxx|c|h|hpp|css|scss|sass|less|html?|vue|svelte|jsonc?|ya?ml|toml|mdx?|txt|xml|sql|sh|bash|zsh|fish|ps1|bat|cmd|gradle|properties|ini|env)$/i

export function parseFileReference(value: string, options: ParseFileReferenceOptions = {}): FileReference | null {
  let candidate = value.trim().replace(/^['"`]|['"`]$/g, '')
  if (!candidate || /^(?:https?|mailto|data|javascript):/i.test(candidate)) {
    return null
  }

  let line: number | undefined
  let column: number | undefined
  const hashLocation = /#L(\d+)(?:C(\d+))?$/i.exec(candidate)
  if (hashLocation) {
    line = Number(hashLocation[1])
    column = hashLocation[2] ? Number(hashLocation[2]) : undefined
    candidate = candidate.slice(0, hashLocation.index)
  } else {
    const colonLocation = /:(\d+)(?::(\d+))?$/.exec(candidate)
    if (colonLocation) {
      line = Number(colonLocation[1])
      column = colonLocation[2] ? Number(colonLocation[2]) : undefined
      candidate = candidate.slice(0, colonLocation.index)
    }
  }

  const normalized = candidate.replace(/\\/g, '/')
  const basename = normalized.split('/').pop() ?? normalized
  const looksLikePath = normalized.includes('/') || /^[A-Za-z]:[\\/]/.test(candidate) || candidate.startsWith('.')
  if (!FILE_EXTENSION.test(basename) || (!looksLikePath && !line && !options.allowBareFilename)) {
    return null
  }

  return { path: candidate, line, column }
}
