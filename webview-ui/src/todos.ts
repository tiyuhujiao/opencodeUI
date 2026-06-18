import type { TranscriptMessage } from '../../src/shared/protocol'

export type TodoItem = {
  content: string
  status: string
  priority: string
}

export function extractLatestTodosFromTranscript(messages: TranscriptMessage[]): TodoItem[] {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex]
    if (!message) {
      continue
    }

    for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = message.parts[partIndex]
      if (part?.type !== 'tool' || !isTodoToolName(part.toolName)) {
        continue
      }

      const todos = extractTodosFromToolRaw(part.raw)
      if (todos.length > 0) {
        return todos
      }
    }
  }

  return []
}

export function countCompletedTodos(todos: TodoItem[]): number {
  return todos.filter((todo) => normalizeTodoStatus(todo.status) === 'completed').length
}

export function normalizeTodoStatus(status: string): 'completed' | 'in_progress' | 'pending' | string {
  const normalized = status.trim().toLowerCase()
  if (normalized === 'complete' || normalized === 'done') {
    return 'completed'
  }
  if (normalized === 'in-progress' || normalized === 'in progress' || normalized === 'doing') {
    return 'in_progress'
  }
  return normalized || 'pending'
}

export function todoStatusLabel(status: string): string {
  const normalized = normalizeTodoStatus(status)
  if (normalized === 'in_progress') {
    return 'in progress'
  }
  return normalized
}

export function extractTodosFromToolRaw(raw: unknown): TodoItem[] {
  const todos =
    extractTodosArray(
      // runtime: { part: { state: { input: { todos } } } }
      pickNested(raw, ['part', 'state', 'input', 'todos'])
    ) ??
    extractTodosArray(
      // export: { state: { input: { todos } } }
      pickNested(raw, ['state', 'input', 'todos'])
    ) ??
    extractTodosArray(
      // runtime+export: metadata.todos
      pickNested(raw, ['part', 'state', 'metadata', 'todos'])
    ) ??
    extractTodosArray(pickNested(raw, ['state', 'metadata', 'todos']))

  return todos ?? []
}

function isTodoToolName(toolName: string): boolean {
  return toolName.trim().toLowerCase() === 'todowrite'
}

function pickNested(value: unknown, path: string[]): unknown {
  let current: unknown = value
  for (const key of path) {
    if (typeof current !== 'object' || current === null) {
      return undefined
    }
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

function extractTodosArray(value: unknown): TodoItem[] | null {
  if (!Array.isArray(value)) {
    return null
  }

  const out: TodoItem[] = []
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) {
      continue
    }
    const todo = entry as Record<string, unknown>
    const content = typeof todo.content === 'string' ? todo.content.trim() : ''
    if (!content) {
      continue
    }
    out.push({
      content,
      status: typeof todo.status === 'string' ? todo.status : 'pending',
      priority: typeof todo.priority === 'string' ? todo.priority : ''
    })
  }

  return out
}
