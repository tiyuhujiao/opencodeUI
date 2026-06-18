type ToolBlockProps = {
  label: string
  raw: unknown
  defaultOpen?: boolean
  preview?: string
}

export function ToolBlock({ label, raw, defaultOpen, preview }: ToolBlockProps) {
  return (
    <details className="tool-block" open={defaultOpen}>
      <summary>
        <span className="tool-block__name">{label}</span>
        {preview ? <span className="tool-block__preview">{preview}</span> : null}
      </summary>
      <pre>{formatToolDetails(raw)}</pre>
    </details>
  )
}

function formatToolDetails(raw: unknown): string {
  const extracted = extractToolOutput(raw)
  if (extracted) {
    return extracted
  }
  try {
    return JSON.stringify(raw, null, 2)
  } catch {
    return String(raw)
  }
}

function extractToolOutput(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) {
    return null
  }
  const record = raw as { part?: unknown }
  const part = record.part && typeof record.part === 'object' ? (record.part as { state?: unknown }) : null
  const state = part?.state && typeof part.state === 'object'
    ? (part.state as { metadata?: unknown; output?: unknown; title?: unknown; input?: unknown; status?: unknown })
    : null

  const metadata = state?.metadata && typeof state.metadata === 'object' ? (state.metadata as { output?: unknown }) : null
  const output = typeof state?.output === 'string' ? state.output : (typeof metadata?.output === 'string' ? metadata.output : null)
  if (output && output.trim().length > 0) {
    return output
  }

  const title = typeof state?.title === 'string' ? state.title.trim() : ''
  const status = typeof state?.status === 'string' ? state.status.trim() : ''
  const input = state?.input && typeof state.input === 'object' ? (state.input as Record<string, unknown>) : null
  const command = typeof input?.command === 'string' ? (input.command as string).trim() : ''
  const filePath = typeof input?.filePath === 'string' ? (input.filePath as string).trim() : ''

  const line = [title || command || filePath, status ? `[${status}]` : ''].filter(Boolean).join(' ')
  return line.trim().length > 0 ? line : null
}
