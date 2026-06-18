import type { TranscriptMessage, TranscriptPartTool } from '../../src/shared/protocol'

export type EditedFileSummary = {
  path: string
  displayPath: string
  additions: number
  deletions: number
}

type MutableEditedFileSummary = EditedFileSummary & {
  score: number
}

const EDIT_TOOL_NAMES = new Set([
  'edit',
  'multiedit',
  'multi_edit',
  'write',
  'patch',
  'apply_patch',
  'str_replace_editor',
  'create',
  'insert'
])

const PATH_KEYS = [
  'filePath',
  'filepath',
  'file_path',
  'path',
  'relativePath',
  'relative_path',
  'target',
  'targetFile',
  'target_file'
]

const DIFF_TEXT_KEYS = ['diff', 'patch', 'output', 'stdout', 'result']

export function summarizeEditedFiles(messages: TranscriptMessage[], workspaceFolderPath?: string): EditedFileSummary[] {
  const byToolAndPath = new Map<string, MutableEditedFileSummary>()

  messages.forEach((message, messageIndex) => {
    message.parts.forEach((part, partIndex) => {
      if (part.type !== 'tool' || !isEditToolName(part.toolName)) {
        return
      }

      const toolId = extractToolId(part.raw) ?? `${String(messageIndex)}:${String(partIndex)}`
      const summaries = summarizeToolPart(part, workspaceFolderPath)
      for (const summary of summaries) {
        const key = `${toolId}:${summary.path}`
        const scored = {
          ...summary,
          score: summary.additions + summary.deletions
        }
        const existing = byToolAndPath.get(key)
        if (!existing || scored.score >= existing.score) {
          byToolAndPath.set(key, scored)
        }
      }
    })
  })

  const merged = new Map<string, EditedFileSummary>()
  for (const summary of byToolAndPath.values()) {
    const existing = merged.get(summary.path)
    if (existing) {
      existing.additions += summary.additions
      existing.deletions += summary.deletions
      continue
    }
    merged.set(summary.path, {
      path: summary.path,
      displayPath: summary.displayPath,
      additions: summary.additions,
      deletions: summary.deletions
    })
  }

  return [...merged.values()]
}

function summarizeToolPart(part: TranscriptPartTool, workspaceFolderPath?: string): EditedFileSummary[] {
  const raw = part.raw
  const diffSummaries = summarizeDiffText(raw, workspaceFolderPath)
  if (diffSummaries.length > 0) {
    return diffSummaries
  }

  const state = pickToolState(raw)
  const input = pickRecord(state?.input)
  const paths = collectPathCandidates(input ?? state ?? raw)
  if (paths.length === 0) {
    return []
  }

  const explicitAdditions = pickNumberByKeys(state, ['additions', 'added', 'insertions', 'inserted'])
  const explicitDeletions = pickNumberByKeys(state, ['deletions', 'deleted', 'removals', 'removed'])
  const inputAdditions = pickNumberByKeys(input, ['additions', 'added', 'insertions', 'inserted'])
  const inputDeletions = pickNumberByKeys(input, ['deletions', 'deleted', 'removals', 'removed'])
  const oldString = pickStringByKeys(input, ['oldString', 'old_string', 'oldText', 'old_text'])
  const newString = pickStringByKeys(input, ['newString', 'new_string', 'newText', 'new_text', 'content'])

  const fallbackStats = inferStatsFromText(oldString, newString)
  const additions = explicitAdditions ?? inputAdditions ?? fallbackStats.additions
  const deletions = explicitDeletions ?? inputDeletions ?? fallbackStats.deletions

  return paths.map((filePath) => ({
    path: filePath,
    displayPath: formatEditedFileDisplayPath(filePath, workspaceFolderPath),
    additions,
    deletions
  }))
}

function summarizeDiffText(raw: unknown, workspaceFolderPath?: string): EditedFileSummary[] {
  const texts = collectDiffTexts(raw)
  const byPath = new Map<string, { additions: number; deletions: number }>()

  for (const text of texts) {
    const parsed = parseUnifiedDiff(text)
    for (const [filePath, stats] of parsed.entries()) {
      const existing = byPath.get(filePath) ?? { additions: 0, deletions: 0 }
      existing.additions += stats.additions
      existing.deletions += stats.deletions
      byPath.set(filePath, existing)
    }
  }

  return [...byPath.entries()].map(([filePath, stats]) => ({
    path: filePath,
    displayPath: formatEditedFileDisplayPath(filePath, workspaceFolderPath),
    additions: stats.additions,
    deletions: stats.deletions
  }))
}

function parseUnifiedDiff(text: string): Map<string, { additions: number; deletions: number }> {
  const byPath = new Map<string, { additions: number; deletions: number }>()
  let currentPath = ''

  for (const line of text.split(/\r?\n/u)) {
    const gitMatch = /^diff --git a\/(.+?) b\/(.+)$/u.exec(line)
    if (gitMatch?.[2]) {
      currentPath = cleanDiffPath(gitMatch[2])
      ensureDiffStats(byPath, currentPath)
      continue
    }

    const plusMatch = /^\+\+\+\s+(?:b\/)?(.+)$/u.exec(line)
    if (plusMatch?.[1] && plusMatch[1] !== '/dev/null') {
      currentPath = cleanDiffPath(plusMatch[1])
      ensureDiffStats(byPath, currentPath)
      continue
    }

    if (!currentPath) {
      continue
    }

    if (line.startsWith('+++') || line.startsWith('---')) {
      continue
    }

    const stats = ensureDiffStats(byPath, currentPath)
    if (line.startsWith('+')) {
      stats.additions += 1
    } else if (line.startsWith('-')) {
      stats.deletions += 1
    }
  }

  for (const [filePath, stats] of byPath.entries()) {
    if (stats.additions === 0 && stats.deletions === 0) {
      byPath.delete(filePath)
    }
  }

  return byPath
}

function cleanDiffPath(filePath: string): string {
  return filePath.replace(/^"|"$/gu, '').trim()
}

function ensureDiffStats(map: Map<string, { additions: number; deletions: number }>, filePath: string) {
  const existing = map.get(filePath)
  if (existing) {
    return existing
  }
  const next = { additions: 0, deletions: 0 }
  map.set(filePath, next)
  return next
}

function collectDiffTexts(value: unknown): string[] {
  const texts: string[] = []
  const seen = new Set<unknown>()

  const visit = (current: unknown): void => {
    if (typeof current === 'string') {
      if (looksLikeUnifiedDiff(current)) {
        texts.push(current)
      }
      return
    }

    if (!current || typeof current !== 'object' || seen.has(current)) {
      return
    }
    seen.add(current)

    const record = current as Record<string, unknown>
    for (const key of DIFF_TEXT_KEYS) {
      visit(record[key])
    }
    visit(record.state)
    visit(record.input)
    visit(record.metadata)
    visit(record.part)
  }

  visit(value)
  return texts
}

function looksLikeUnifiedDiff(text: string): boolean {
  return /(^|\n)(diff --git|@@\s|---\s|\+\+\+\s)/u.test(text)
}

function collectPathCandidates(value: unknown): string[] {
  const paths: string[] = []
  const seen = new Set<unknown>()

  const visit = (current: unknown): void => {
    if (!current || typeof current !== 'object' || seen.has(current)) {
      return
    }
    seen.add(current)

    const record = current as Record<string, unknown>
    for (const key of PATH_KEYS) {
      const value = normalizeFilePath(record[key])
      if (value && !paths.includes(value)) {
        paths.push(value)
      }
    }

    visit(record.input)
    visit(record.metadata)
    visit(record.state)
    visit(record.part)
  }

  visit(value)
  return paths
}

function normalizeFilePath(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  if (!trimmed || /^https?:\/\//iu.test(trimmed)) {
    return null
  }

  if (trimmed.startsWith('file://')) {
    try {
      const url = new URL(trimmed)
      return decodeURIComponent(url.pathname).replace(/^\/([A-Za-z]:)/u, '$1')
    } catch {
      return null
    }
  }

  return trimmed
}

function formatEditedFileDisplayPath(filePath: string, workspaceFolderPath?: string): string {
  const normalizedFile = normalizeSlashes(filePath)
  const normalizedWorkspace = workspaceFolderPath ? normalizeSlashes(workspaceFolderPath).replace(/\/+$/u, '') : ''

  if (normalizedWorkspace && normalizedFile.toLowerCase().startsWith(`${normalizedWorkspace.toLowerCase()}/`)) {
    return normalizedFile.slice(normalizedWorkspace.length + 1)
  }

  return normalizedFile
}

function normalizeSlashes(value: string): string {
  return value.replace(/\\/gu, '/')
}

function pickToolState(raw: unknown): Record<string, unknown> | null {
  const record = pickRecord(raw)
  const part = pickRecord(record?.part)
  return pickRecord(part?.state) ?? pickRecord(record?.state)
}

function pickRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function pickNumberByKeys(value: Record<string, unknown> | null, keys: string[]): number | undefined {
  if (!value) {
    return undefined
  }

  for (const key of keys) {
    const item = value[key]
    if (typeof item === 'number' && Number.isFinite(item)) {
      return Math.max(0, Math.trunc(item))
    }
  }

  return undefined
}

function pickStringByKeys(value: Record<string, unknown> | null, keys: string[]): string | undefined {
  if (!value) {
    return undefined
  }

  for (const key of keys) {
    const item = value[key]
    if (typeof item === 'string') {
      return item
    }
  }

  return undefined
}

function inferStatsFromText(oldString: string | undefined, newString: string | undefined): { additions: number; deletions: number } {
  if (typeof oldString === 'string' && typeof newString === 'string') {
    return {
      additions: countChangedLines(newString),
      deletions: countChangedLines(oldString)
    }
  }

  if (typeof newString === 'string') {
    return {
      additions: countChangedLines(newString),
      deletions: 0
    }
  }

  return { additions: 0, deletions: 0 }
}

function countChangedLines(text: string): number {
  if (!text) {
    return 0
  }
  return text.split(/\r?\n/u).filter((line, index, lines) => line.length > 0 || index < lines.length - 1).length
}

function isEditToolName(toolName: string): boolean {
  const normalized = toolName.trim().toLowerCase()
  return EDIT_TOOL_NAMES.has(normalized) || normalized.includes('edit') || normalized.includes('write') || normalized.includes('patch')
}

function extractToolId(raw: unknown): string | null {
  const record = pickRecord(raw)
  const part = pickRecord(record?.part)
  const state = pickRecord(part?.state) ?? pickRecord(record?.state)
  const candidates = [part?.id, part?.partID, part?.toolCallID, state?.id, state?.toolCallID, record?.id]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim()
    }
  }
  return null
}
