import { useCallback, useEffect, useRef, useState } from 'react'
import { renderMarkdown } from '../markdown/renderMarkdown'
import type { TranscriptMessage, TranscriptPart, TranscriptPartTool } from '../../../src/shared/protocol'

type TranscriptProps = {
  messages: TranscriptMessage[]
  isRunning: boolean
}

export function Transcript({ messages, isRunning }: TranscriptProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const autoScrollPausedRef = useRef(false)
  const scrollLockRef = useRef<{ top: number; until: number } | null>(null)

  const pauseAutoScrollForUserAction = useCallback(() => {
    const el = containerRef.current
    if (!el) {
      return
    }

    autoScrollPausedRef.current = true
    scrollLockRef.current = { top: el.scrollTop, until: Date.now() + 450 }

    window.requestAnimationFrame(() => {
      const lock = scrollLockRef.current
      if (lock && Date.now() <= lock.until) {
        el.scrollTop = lock.top
      }
    })
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) {
      return
    }

    const scrollIfNeeded = () => {
      const lock = scrollLockRef.current
      if (lock) {
        if (Date.now() <= lock.until) {
          el.scrollTop = lock.top
          return
        }
        scrollLockRef.current = null
      }

      if (autoScrollPausedRef.current) {
        return
      }

      if (isRunning) {
        el.scrollTop = el.scrollHeight
        return
      }

      const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight
      if (distanceToBottom < 80) {
        el.scrollTop = el.scrollHeight
      }
    }

    // Initial sync.
    scrollIfNeeded()

    // Observe DOM changes so we scroll on streaming updates without depending on `messages`.
    const observer = new MutationObserver(() => {
      scrollIfNeeded()
    })
    observer.observe(el, {
      subtree: true,
      childList: true,
      characterData: true
    })

    const onScroll = () => {
      if (!autoScrollPausedRef.current) {
        return
      }

      const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight
      if (distanceToBottom < 80) {
        autoScrollPausedRef.current = false
        scrollLockRef.current = null
      }
    }

    el.addEventListener('scroll', onScroll)

    return () => {
      observer.disconnect()
      el.removeEventListener('scroll', onScroll)
    }
  }, [isRunning])

  const rendered = buildDisplayBlocks(messages)

  return (
    <div className="transcript" aria-live="polite" ref={containerRef}>
      {rendered.map((entry, messageIndex) => {
        if (entry.kind === 'tool-group') {
          return <ToolGroupBlock key={`tool-group-${String(messageIndex)}`} items={entry.items} onUserToggle={pauseAutoScrollForUserAction} />
        }

        const message = entry.message
        const visibleParts = compressVisibleParts(message.parts.filter((part) => part.type !== 'unknown'))
        if (visibleParts.length === 0) {
          return null
        }

        const isStreamingBubble = isRunning && message.role === 'assistant' && messageIndex === messages.length - 1
        const renderItems = buildMessageRenderItems(visibleParts, messageIndex, !isStreamingBubble)
        if (renderItems.length === 0) {
          return null
        }

        const currentActivityKey = isStreamingBubble && renderItems[renderItems.length - 1]?.kind === 'activity'
          ? renderItems[renderItems.length - 1]?.key
          : null

        return (
          <div
            key={`${message.role}-${String(messageIndex)}`}
            className={`msg-row msg-row--${message.role}`}
          >
            <article
              className={`msg msg--${message.role}${isStreamingBubble ? ' is-streaming' : ''}`}
            >
              <MessageContent
                items={renderItems}
                isStreamingBubble={isStreamingBubble}
                currentActivityKey={currentActivityKey}
                onUserToggle={pauseAutoScrollForUserAction}
              />
            </article>
          </div>
        )
      })}
    </div>
  )
}

type ToolGroupEntry = {
  summary: string
  output?: string | null
  isError?: boolean
  toolName?: string
  title?: string
  detail?: string
  status?: string
  mergeKey?: string
}

type ActivityEntry = {
  key: string
  part: TranscriptPart
}

type MessageRenderItem =
  | { kind: 'activity'; key: string; entries: ActivityEntry[] }
  | { kind: 'part'; key: string; part: TranscriptPart; isFinalAnswer?: boolean }

function MessageContent({
  items,
  isStreamingBubble,
  currentActivityKey,
  onUserToggle
}: {
  items: MessageRenderItem[]
  isStreamingBubble: boolean
  currentActivityKey: string | null
  onUserToggle: () => void
}) {
  const finalAnswerIndex = items.findIndex((item) => item.kind === 'part' && item.isFinalAnswer)
  const workDurationLabel = usePrefinalWorkDuration(items, isStreamingBubble)

  if (finalAnswerIndex > 0) {
    const prefinalItems = items.slice(0, finalAnswerIndex)
    const finalItems = items.slice(finalAnswerIndex)
    return (
      <div className="msg__content">
        <PrefinalWorkBlock
          items={prefinalItems}
          durationLabel={workDurationLabel}
          currentActivityKey={currentActivityKey}
          onUserToggle={onUserToggle}
        />
        {finalItems.map((item) => renderMessageItem(item, { currentActivityKey, onUserToggle }))}
      </div>
    )
  }

  return (
    <div className="msg__content">
      {items.map((item) => renderMessageItem(item, { currentActivityKey, onUserToggle }))}
    </div>
  )
}

function renderMessageItem(
  item: MessageRenderItem,
  options: { currentActivityKey: string | null; onUserToggle: () => void; insidePrefinal?: boolean }
) {
  if (item.kind === 'activity') {
    return (
      <ActivityBlock
        key={item.key}
        entries={item.entries}
        isCurrent={item.key === options.currentActivityKey}
        onUserToggle={options.onUserToggle}
      />
    )
  }

  const part = item.part
  if (part.type === 'text') {
    return (
      <div
        key={item.key}
        className={`md-body${item.isFinalAnswer && !options.insidePrefinal ? ' md-body--final-answer' : ''}${options.insidePrefinal ? ' prefinal-work__text' : ''}`}
        // biome-ignore lint/security/noDangerouslySetInnerHtml: Markdown rendering is sanitized.
        dangerouslySetInnerHTML={{ __html: renderMarkdown(part.text) }}
      />
    )
  }

  if (part.type === 'image') {
    return (
      <div key={item.key} className="image-part">
        <img className="image-part__img" src={part.src} alt={part.alt ?? 'image'} />
      </div>
    )
  }

  return null
}

function buildMessageRenderItems(parts: TranscriptPart[], messageIndex: number, markFinalAnswer: boolean): MessageRenderItem[] {
  const items: MessageRenderItem[] = []
  let activityEntries: ActivityEntry[] = []
  let activityIndex = 0

  const flushActivity = () => {
    if (activityEntries.length === 0) {
      return
    }
    items.push({
      kind: 'activity',
      key: `${String(messageIndex)}-activity-${String(activityIndex)}`,
      entries: activityEntries
    })
    activityEntries = []
    activityIndex += 1
  }

  parts.forEach((part, partIndex) => {
    const key = `${String(messageIndex)}-${String(partIndex)}`
    if (part.type === 'tool') {
      if (part.toolName === 'status') {
        return
      }
      if (part.toolName === 'todowrite') {
        return
      }
    }

    if (part.type === 'reasoning' || part.type === 'tool') {
      activityEntries.push({ key, part })
      return
    }

    flushActivity()
    items.push({ kind: 'part', key, part })
  })

  flushActivity()
  return markFinalAnswer ? markFinalAnswerItem(items) : items
}

function markFinalAnswerItem(items: MessageRenderItem[]): MessageRenderItem[] {
  let finalTextIndex = -1
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item.kind === 'part' && item.part.type === 'text') {
      finalTextIndex = index
      break
    }
  }

  if (finalTextIndex < 0) {
    return items
  }

  const hasPriorActivity = items.slice(0, finalTextIndex).some((item) => item.kind === 'activity')
  const hasLaterActivity = items.slice(finalTextIndex + 1).some((item) => item.kind === 'activity')
  if (!hasPriorActivity || hasLaterActivity) {
    return items
  }

  const next = [...items]
  const finalItem = next[finalTextIndex]
  if (finalItem.kind === 'part') {
    next[finalTextIndex] = { ...finalItem, isFinalAnswer: true }
  }
  return next
}

function PrefinalWorkBlock({
  items,
  durationLabel,
  currentActivityKey,
  onUserToggle
}: {
  items: MessageRenderItem[]
  durationLabel: string
  currentActivityKey: string | null
  onUserToggle: () => void
}) {
  const [open, setOpen] = useState(false)
  const title = durationLabel ? `Worked for ${durationLabel}` : 'Worked before final answer'

  return (
    <section className="prefinal-work">
      <button
        type="button"
        className="prefinal-work__summary"
        onClick={() => {
          onUserToggle()
          setOpen((current) => !current)
        }}
        aria-expanded={open}
      >
        <span className="prefinal-work__chevron" aria-hidden="true">{open ? 'v' : '>'}</span>
        <span className="prefinal-work__title">{title}</span>
      </button>
      {open ? (
        <div className="prefinal-work__body">
          {items.map((item) => renderMessageItem(item, { currentActivityKey, onUserToggle, insidePrefinal: true }))}
        </div>
      ) : null}
    </section>
  )
}

function usePrefinalWorkDuration(items: MessageRenderItem[], isStreamingBubble: boolean) {
  const startedAtRef = useRef<number | null>(null)
  const candidateFinalStartedAtRef = useRef<number | null>(null)
  const completedMsRef = useRef<number | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)

  const hasContent = items.length > 0
  const hasFinalAnswer = items.some((item) => item.kind === 'part' && item.isFinalAnswer)
  const candidateFinalStarted = isStreamingBubble && isLastItemTextWithPriorWork(items)

  useEffect(() => {
    if (!hasContent) {
      startedAtRef.current = null
      candidateFinalStartedAtRef.current = null
      completedMsRef.current = null
      setElapsedMs(0)
      return
    }

    if (startedAtRef.current === null) {
      startedAtRef.current = Date.now()
    }

    if (hasFinalAnswer && completedMsRef.current === null) {
      const endedAt = candidateFinalStartedAtRef.current ?? Date.now()
      const nextElapsed = Math.max(0, endedAt - startedAtRef.current)
      completedMsRef.current = nextElapsed
      setElapsedMs(nextElapsed)
      return
    }

    if (!isStreamingBubble || hasFinalAnswer) {
      return
    }

    if (candidateFinalStarted) {
      if (candidateFinalStartedAtRef.current === null) {
        candidateFinalStartedAtRef.current = Date.now()
      }
      return
    }

    candidateFinalStartedAtRef.current = null
  }, [candidateFinalStarted, hasContent, hasFinalAnswer, isStreamingBubble])

  const value = completedMsRef.current ?? elapsedMs
  return startedAtRef.current === null ? '' : formatDuration(value)
}

function isLastItemTextWithPriorWork(items: MessageRenderItem[]) {
  const lastItem = items[items.length - 1]
  if (!lastItem || lastItem.kind !== 'part' || lastItem.part.type !== 'text') {
    return false
  }

  return items.slice(0, -1).some((item) => item.kind === 'activity' || (item.kind === 'part' && item.part.type === 'text'))
}

function ActivityBlock({
  entries,
  isCurrent,
  onUserToggle
}: {
  entries: ActivityEntry[]
  isCurrent: boolean
  onUserToggle: () => void
}) {
  const [open, setOpen] = useState(false)
  const summary = getActivitySummary(entries)
  const isLive = isCurrent && summary.isLive

  return (
    <div className={`activity-block${isLive ? ' activity-block--active' : ''}`}>
      <button
        type="button"
        className="activity-block__summary"
        onClick={() => {
          onUserToggle()
          setOpen((current) => !current)
        }}
        aria-expanded={open}
      >
        <span className="activity-block__chevron" aria-hidden="true">{open ? 'v' : '>'}</span>
        <span className="activity-block__current">{summary.current}</span>
      </button>
      {open ? (
        <div className="activity-block__body">
          {entries.map((entry) => (
            <ActivityEntryBlock key={entry.key} entry={entry} onUserToggle={onUserToggle} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function ActivityEntryBlock({
  entry,
  onUserToggle
}: {
  entry: ActivityEntry
  onUserToggle: () => void
}) {
  const part = entry.part

  if (part.type === 'reasoning') {
    return (
      <details className="activity-thinking" open onToggle={onUserToggle}>
        <summary className="activity-thinking__summary">Thinking</summary>
        <div className="md-body activity-thinking__body stream-thinking">
          <div
            // biome-ignore lint/security/noDangerouslySetInnerHtml: Markdown rendering is sanitized.
            dangerouslySetInnerHTML={{ __html: renderMarkdown(part.text) }}
          />
        </div>
      </details>
    )
  }

  if (part.type === 'tool') {
    if (part.toolName === '__tool_group__') {
      const group = extractToolGroup(part.raw).filter((item) => !isTodoWriteSummary(item.summary))
      if (group.length === 0) {
        return null
      }
      return <ToolGroupBlock items={group} onUserToggle={onUserToggle} defaultExpanded={false} autoOpenActive={false} />
    }

    const item = createToolGroupEntry(part)
    return (
      <section className={`activity-entry activity-entry--tool${item.isError ? ' is-error' : ''}`}>
        <div className="activity-entry__head">{item.summary}</div>
        {item.output ? <pre className="activity-entry__output">{item.output}</pre> : <div className="activity-entry__empty">No output</div>}
      </section>
    )
  }

  return null
}

function getActivitySummary(entries: ActivityEntry[]) {
  const thinkingEntries = entries.filter((entry) => entry.part.type === 'reasoning' && entry.part.text.trim().length > 0)
  const toolEntries = getActivityToolEntries(entries)
  const taskEntries = toolEntries.filter((item) => isTaskEntry(item))
  const activeTool = toolEntries.find((item) => isToolEntryActive(item))
  const activeTask = taskEntries.find((item) => {
    const kind = getTaskStatusKind(item)
    return kind === 'running' || kind === 'pending'
  })
  const latestTool = [...toolEntries].reverse().find((item) => !isTaskEntry(item)) ?? toolEntries[toolEntries.length - 1]
  const latestThinking = thinkingEntries[thinkingEntries.length - 1]

  const current = activeTask
    ? `Subtask: ${summarizeActivityText(activeTask.title || activeTask.summary)} (${formatTaskStatus(activeTask)})`
    : activeTool
      ? `Tool: ${summarizeActivityText(activeTool.title || activeTool.summary)}`
      : latestTool
      ? `Tool: ${summarizeActivityText(latestTool.title || latestTool.summary)}`
      : latestThinking?.part.type === 'reasoning'
        ? `Thinking ${summarizeActivityText(latestThinking.part.text)}`
        : 'Working'

  return {
    current,
    isLive: Boolean(activeTask || activeTool || (thinkingEntries.length > 0 && toolEntries.length === 0))
  }
}

function isToolEntryActive(item: ToolGroupEntry) {
  const status = normalizeToolStatus(item.status ?? '')
  if (['running', 'in_progress', 'active', 'processing', 'started', 'pending', 'queued', 'waiting', 'created'].includes(status)) {
    return true
  }
  if (['completed', 'complete', 'done', 'success', 'succeeded', 'error', 'failed', 'failure'].includes(status)) {
    return false
  }
  return !item.output
}

function getActivityToolEntries(entries: ActivityEntry[]) {
  const items: ToolGroupEntry[] = []
  for (const entry of entries) {
    const part = entry.part
    if (part.type !== 'tool') {
      continue
    }

    if (part.toolName === '__tool_group__') {
      items.push(...extractToolGroup(part.raw).filter((item) => !isTodoWriteSummary(item.summary)))
      continue
    }

    items.push(createToolGroupEntry(part))
  }

  return mergeToolGroupEntries(items)
}

function summarizeActivityText(value: string, maxLength = 78) {
  const text = value.replace(/\s+/g, ' ').trim()
  if (text.length <= maxLength) {
    return text
  }
  return `${text.slice(0, maxLength - 3)}...`
}

function formatDuration(ms: number) {
  if (ms < 1000) {
    return '<1s'
  }

  const totalSeconds = Math.max(1, Math.round(ms / 1000))
  if (totalSeconds < 60) {
    return `${String(totalSeconds)}s`
  }

  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return seconds === 0 ? `${String(minutes)}m` : `${String(minutes)}m ${String(seconds)}s`
}

function ToolGroupBlock({
  items,
  onUserToggle,
  defaultExpanded = false,
  autoOpenActive = false
}: {
  items: ToolGroupEntry[]
  onUserToggle: () => void
  defaultExpanded?: boolean
  autoOpenActive?: boolean
}) {
  const displayItems = mergeToolGroupEntries(items)
  const indexedTasks = displayItems
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => isTaskEntry(item))
  const otherItems = displayItems
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => !isTaskEntry(item))
  const taskStats = getTaskStats(indexedTasks.map(({ item }) => item))
  const hasActiveSubtasks = taskStats.running + taskStats.pending > 0
  const activeTaskKey = getActiveTaskKey(indexedTasks)
  const [expanded, setExpanded] = useState(defaultExpanded || (autoOpenActive && hasActiveSubtasks))
  const [openTaskKeys, setOpenTaskKeys] = useState<Set<string>>(() => (autoOpenActive && activeTaskKey ? new Set([activeTaskKey]) : new Set()))
  const [openToolIndex, setOpenToolIndex] = useState<number | null>(null)
  const autoOpenedTaskKeysRef = useRef<Set<string>>(new Set(autoOpenActive && activeTaskKey ? [activeTaskKey] : []))
  const previewRef = useRef<HTMLDivElement | null>(null)
  const previewItems = expanded ? [] : (indexedTasks.length > 0 ? indexedTasks : displayItems.map((item, index) => ({ item, index })))

  useEffect(() => {
    if (autoOpenActive && hasActiveSubtasks) {
      setExpanded(true)
    }
  }, [autoOpenActive, hasActiveSubtasks])

  useEffect(() => {
    if (!autoOpenActive || !activeTaskKey) {
      return
    }

    setOpenTaskKeys((current) => {
      if (current.has(activeTaskKey) || autoOpenedTaskKeysRef.current.has(activeTaskKey)) {
        return current
      }

      autoOpenedTaskKeysRef.current.add(activeTaskKey)
      const next = new Set(current)
      next.add(activeTaskKey)
      return next
    })
  }, [activeTaskKey, autoOpenActive])

  useEffect(() => {
    if (expanded) {
      return
    }
    const el = previewRef.current
    if (!el) {
      return
    }
    // Keep the two-line preview window pinned to the newest lines so newly added
    // tool summaries "push" older ones away with a subtle rolling feel.
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  })

  const toggleTask = (key: string) => {
    onUserToggle()
    setOpenTaskKeys((current) => {
      const next = new Set(current)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  return (
    <div className={`tool-group${indexedTasks.length > 0 ? ' tool-group--subtasks' : ''}`}>
      <button
        type="button"
        className="tool-group__summary"
        onClick={() => {
          onUserToggle()
          setExpanded((current) => !current)
        }}
        aria-expanded={expanded}
      >
        <span className="tool-group__chevron" aria-hidden="true">{expanded ? 'v' : '>'}</span>
        <span>{indexedTasks.length > 0 ? `Subtasks (${indexedTasks.length})` : `Tools (${items.length})`}</span>
        {indexedTasks.length > 0 ? <span className="tool-group__summaryStats">{formatTaskStats(taskStats)}</span> : null}
      </button>
      <div className="tool-group__preview" ref={previewRef}>
        {previewItems.map(({ item, index }) => (
          <TaskSummaryLine key={getEntryRenderKey(item, index)} item={item} compact={indexedTasks.length > 0} />
        ))}
      </div>
      {expanded ? (
        <div className="tool-group__all">
          {indexedTasks.length > 0 ? (
            <div className="subtask-panel">
              {indexedTasks.map(({ item, index }) => {
                const taskKey = getTaskEntryOpenKey(item, index)
                return (
                  <TaskEntry
                    key={getEntryRenderKey(item, index)}
                    item={item}
                    open={openTaskKeys.has(taskKey)}
                    onToggle={() => toggleTask(taskKey)}
                  />
                )
              })}
            </div>
          ) : null}
          {otherItems.length > 0 && indexedTasks.length > 0 ? <div className="tool-group__sectionLabel">Other tools</div> : null}
          {otherItems.map(({ item, index }) => (
            <div key={`${item.summary}-all-${String(index)}`} className="tool-group__entry">
              <button
                type="button"
                className={`tool-group__itemButton${item.isError ? ' is-error' : ''}`}
                onClick={() => {
                  onUserToggle()
                  setOpenToolIndex((current) => (current === index ? null : index))
                }}
              >
                <span className="tool-group__itemLabel">{item.summary}</span>
              </button>
              {openToolIndex === index && item.output ? <pre className="tool-group__output">{item.output}</pre> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function TaskSummaryLine({ item, compact }: { item: ToolGroupEntry; compact: boolean }) {
  const statusKind = getTaskStatusKind(item)
  if (!compact) {
    return (
      <div className={`tool-group__line${item.isError ? ' is-error' : ''}`}>
        {item.summary}
      </div>
    )
  }

  return (
    <div className={`tool-group__line tool-group__line--subtask is-${statusKind}`}>
      <span className="subtask-dot" aria-hidden="true" />
      <span className="tool-group__lineTitle">{item.title || item.summary}</span>
      <span className="subtask-status">{formatTaskStatus(item)}</span>
    </div>
  )
}

function TaskEntry({ item, open, onToggle }: { item: ToolGroupEntry; open: boolean; onToggle: () => void }) {
  const statusKind = getTaskStatusKind(item)
  const emptyMessage =
    statusKind === 'done'
      ? 'No output'
      : statusKind === 'pending'
        ? 'Queued and waiting to start...'
        : 'Running subtask...'
  return (
    <div className={`subtask-entry is-${statusKind}`}>
      <button type="button" className="subtask-entry__button" onClick={onToggle} aria-expanded={open}>
        <span className="subtask-dot" aria-hidden="true" />
        <span className="subtask-entry__title">{item.title || item.summary}</span>
        <span className="subtask-status">{formatTaskStatus(item)}</span>
        <span className="subtask-entry__chevron" aria-hidden="true">{open ? 'v' : '>'}</span>
      </button>
      {open ? (
        <div className="subtask-entry__detail">
          {item.detail ? <div className="subtask-entry__input">{item.detail}</div> : null}
          {item.output ? (
            <pre className="subtask-entry__output">{item.output}</pre>
          ) : (
            <div className="subtask-entry__empty">{emptyMessage}</div>
          )}
        </div>
      ) : null}
    </div>
  )
}

function buildDisplayBlocks(messages: TranscriptMessage[]): Array<
  | { kind: 'message'; message: TranscriptMessage }
  | { kind: 'tool-group'; items: ToolGroupEntry[] }
> {
  return messages
    .filter((message) => message.parts.some((part) => part.type !== 'unknown'))
    .map((message) => ({ kind: 'message', message }))
}

function compressVisibleParts(parts: TranscriptPart[]): TranscriptPart[] {
  const next: TranscriptPart[] = []
  let pendingTools: TranscriptPartTool[] = []

  const flushTools = () => {
    if (pendingTools.length === 0) {
      return
    }
    const entries = pendingTools.map(createToolGroupEntry)
    next.push({
      type: 'tool',
      toolName: '__tool_group__',
      status: 'group',
      raw: { toolGroup: entries }
    })
    pendingTools = []
  }

  for (const part of parts) {
    if (part.type === 'tool' && part.toolName !== 'todowrite' && part.toolName !== 'status') {
      pendingTools.push(part)
      continue
    }

    flushTools()
    next.push(part)
  }

  flushTools()
  return next
}

function formatToolSummary(toolName: string, raw: unknown): string {
  const { description, command, filePath, path, url, prompt, offset, limit, status } = extractToolState(raw)
  const main = description || command || filePath || path || url || prompt
  const args: string[] = []
  if (typeof offset === 'number') args.push(`offset=${String(offset)}`)
  if (typeof limit === 'number') args.push(`limit=${String(limit)}`)

  const bits: string[] = []
  bits.push(`→ ${toolName}`)
  if (main) bits.push(main)
  if (args.length > 0) bits.push(`[${args.join(', ')}]`)
  if (status && status !== 'completed') bits.push(`[${status}]`)
  return bits.join(' ')
}

function createToolGroupEntry(part: TranscriptPartTool): ToolGroupEntry {
  const state = extractToolState(part.raw)
  const status = normalizeToolStatus(part.status || state.status)
  return {
    summary: formatToolSummary(part.toolName, part.raw),
    output: extractToolOutput(part.raw),
    isError: isToolError(part.raw),
    toolName: part.toolName,
    title: getToolTitle(part.toolName, state),
    detail: getToolDetail(part.toolName, state),
    status,
    mergeKey: getToolPartMergeKey(part)
  }
}

function mergeToolGroupEntries(items: ToolGroupEntry[]): ToolGroupEntry[] {
  const merged: ToolGroupEntry[] = []
  const taskIndexByKey = new Map<string, number>()

  for (const item of items) {
    if (!isTaskEntry(item)) {
      merged.push(item)
      continue
    }

    const key = getTaskEntryMergeKey(item)
    if (!key) {
      merged.push(item)
      continue
    }

    const existingIndex = taskIndexByKey.get(key)
    if (existingIndex === undefined) {
      taskIndexByKey.set(key, merged.length)
      merged.push(item)
      continue
    }

    merged[existingIndex] = mergeTaskEntry(merged[existingIndex], item)
  }

  const hasInformativeTask = merged.some((item) => isTaskEntry(item) && !isGenericTaskPlaceholder(item))
  return hasInformativeTask ? merged.filter((item) => !isGenericTaskPlaceholder(item)) : merged
}

function mergeTaskEntry(previous: ToolGroupEntry, next: ToolGroupEntry): ToolGroupEntry {
  return {
    summary: preferSpecificText(next.summary, previous.summary),
    output: next.output ?? previous.output,
    isError: previous.isError === true || next.isError === true,
    toolName: next.toolName || previous.toolName,
    title: preferSpecificText(next.title, previous.title),
    detail: next.detail || previous.detail,
    status: next.status || previous.status,
    mergeKey: next.mergeKey || previous.mergeKey
  }
}

function preferSpecificText(next: string | undefined, previous: string | undefined): string {
  if (!next) {
    return previous ?? ''
  }
  if (!previous) {
    return next
  }
  return normalizeTaskText(next) === 'task' ? previous : next
}

function getTaskEntryMergeKey(item: ToolGroupEntry): string | null {
  if (item.mergeKey) {
    return item.mergeKey
  }

  const title = normalizeTaskText(item.title ?? '')
  const detail = normalizeTaskText(item.detail ?? '')
  if (title && title !== 'task') {
    return `task:title:${title}|${detail}`
  }
  if (detail) {
    return `task:detail:${detail}`
  }
  return null
}

function isGenericTaskPlaceholder(item: ToolGroupEntry) {
  const title = normalizeTaskText(item.title ?? item.summary.replace(/^→\s*/, '').replace(/\s*\[[^\]]+\]\s*$/, ''))
  return (
    isTaskEntry(item) &&
    getTaskStatusKind(item) === 'pending' &&
    title === 'task' &&
    !item.detail &&
    !item.output
  )
}

function getToolPartMergeKey(part: TranscriptPartTool): string | undefined {
  const toolName = part.toolName.trim().toLowerCase()
  const raw = toRecord(part.raw)
  const nestedPart = toRecord(raw?.part)
  const state = toRecord(nestedPart?.state) ?? toRecord(raw?.state)
  const input = toRecord(state?.input)
  const id = pickFirstString([
    nestedPart?.id,
    nestedPart?.partID,
    nestedPart?.partId,
    nestedPart?.toolCallID,
    nestedPart?.toolCallId,
    raw?.id,
    raw?.partID,
    raw?.partId,
    raw?.toolCallID,
    raw?.toolCallId,
    state?.id,
    state?.partID,
    state?.partId,
    state?.toolCallID,
    state?.toolCallId
  ])
  if (id) {
    return `${toolName}:id:${id}`
  }

  if (toolName !== 'task') {
    return undefined
  }

  const semantic = pickFirstString([input?.description, input?.prompt])
  return semantic ? `task:semantic:${normalizeTaskText(semantic)}` : undefined
}

function getEntryRenderKey(item: ToolGroupEntry, index: number) {
  return `${item.mergeKey ?? item.summary}-${String(index)}`
}

function getTaskEntryOpenKey(item: ToolGroupEntry, index: number) {
  return getTaskEntryMergeKey(item) ?? `task:index:${String(index)}`
}

function getToolTitle(toolName: string, state: ReturnType<typeof extractToolState>) {
  if (toolName.trim().toLowerCase() === 'task') {
    return state.description || state.prompt || toolName
  }
  return state.description || state.command || state.filePath || state.path || state.url || state.prompt || toolName
}

function getToolDetail(toolName: string, state: ReturnType<typeof extractToolState>) {
  if (toolName.trim().toLowerCase() === 'task') {
    return state.prompt || state.description
  }
  return state.description || state.command || state.filePath || state.path || state.url || state.prompt
}

function normalizeToolStatus(status: string | null | undefined) {
  return typeof status === 'string' ? status.trim().toLowerCase() : ''
}

function normalizeTaskText(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

function pickFirstString(values: unknown[]) {
  for (const value of values) {
    if (typeof value !== 'string') {
      continue
    }
    const trimmed = value.trim()
    if (trimmed.length > 0) {
      return trimmed
    }
  }
  return null
}

function isTaskEntry(item: ToolGroupEntry) {
  const toolName = item.toolName?.trim().toLowerCase()
  if (toolName) {
    return toolName === 'task'
  }

  return item.summary.trim().toLowerCase().replace(/^\W+/, '').startsWith('task')
}

function getTaskStatusKind(item: ToolGroupEntry): 'running' | 'pending' | 'done' | 'error' {
  if (item.isError) {
    return 'error'
  }

  const status = normalizeToolStatus(item.status ?? '')
  if (['running', 'in_progress', 'active', 'processing', 'started'].includes(status)) {
    return 'running'
  }
  if (['pending', 'queued', 'waiting', 'created'].includes(status)) {
    return 'pending'
  }
  if (['completed', 'complete', 'done', 'success', 'succeeded'].includes(status)) {
    return 'done'
  }
  if (['error', 'failed', 'failure'].includes(status)) {
    return 'error'
  }
  return item.output ? 'done' : 'pending'
}

function formatTaskStatus(item: ToolGroupEntry) {
  const status = normalizeToolStatus(item.status ?? '')
  if (status) {
    return status.replace(/_/g, ' ')
  }
  return getTaskStatusKind(item)
}

function getTaskStats(tasks: ToolGroupEntry[]) {
  return tasks.reduce(
    (stats, item) => {
      const kind = getTaskStatusKind(item)
      stats[kind] += 1
      return stats
    },
    { running: 0, pending: 0, done: 0, error: 0 }
  )
}

function getActiveTaskKey(tasks: Array<{ item: ToolGroupEntry; index: number }>) {
  const running = tasks.find(({ item }) => getTaskStatusKind(item) === 'running')
  if (running) {
    return getTaskEntryOpenKey(running.item, running.index)
  }

  const pending = tasks.find(({ item }) => getTaskStatusKind(item) === 'pending')
  return pending ? getTaskEntryOpenKey(pending.item, pending.index) : null
}

function formatTaskStats(stats: ReturnType<typeof getTaskStats>) {
  const parts: string[] = []
  if (stats.running > 0) parts.push(`${String(stats.running)} running`)
  if (stats.pending > 0) parts.push(`${String(stats.pending)} pending`)
  if (stats.error > 0) parts.push(`${String(stats.error)} error`)
  if (stats.done > 0) parts.push(`${String(stats.done)} done`)
  return parts.join(' / ')
}

function isTodoWriteSummary(summary: string): boolean {
  return /→\s+todowrite\b/i.test(summary)
}

function extractToolState(raw: unknown): {
  description: string
  command: string
  filePath: string
  path: string
  url: string
  prompt: string
  offset?: number
  limit?: number
  status: string
} {
  const empty = { description: '', command: '', filePath: '', path: '', url: '', prompt: '', status: '' as string }
  if (typeof raw !== 'object' || raw === null) {
    return empty
  }

  // Runtime event shape: { type, part: { type: 'tool', tool, state: { status, input, ... } } }
  // Export shape: { type: 'tool', tool, state: { ... } }
  const record = raw as { part?: unknown; state?: unknown; tool?: unknown; status?: unknown }
  const part = record.part && typeof record.part === 'object' ? (record.part as { state?: unknown }) : null
  const state =
    (part?.state && typeof part.state === 'object' ? (part.state as Record<string, unknown>) : null) ??
    (record.state && typeof record.state === 'object' ? (record.state as Record<string, unknown>) : null)

  const status = typeof state?.status === 'string' ? (state.status as string) : ''
  const input = state?.input && typeof state.input === 'object' ? (state.input as Record<string, unknown>) : null

  return {
    description: typeof input?.description === 'string' ? (input.description as string).trim() : '',
    command: typeof input?.command === 'string' ? (input.command as string).trim() : '',
    filePath: typeof input?.filePath === 'string' ? (input.filePath as string).trim() : '',
    path: typeof input?.path === 'string' ? (input.path as string).trim() : '',
    url: typeof input?.url === 'string' ? (input.url as string).trim() : '',
    prompt: typeof input?.prompt === 'string' ? (input.prompt as string).trim() : '',
    offset: typeof input?.offset === 'number' ? (input.offset as number) : undefined,
    limit: typeof input?.limit === 'number' ? (input.limit as number) : undefined,
    status
  }
}

function extractToolOutput(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) {
    return null
  }

  const record = raw as { part?: unknown; state?: unknown }
  const part = record.part && typeof record.part === 'object' ? (record.part as { state?: unknown }) : null
  const state =
    (part?.state && typeof part.state === 'object' ? (part.state as Record<string, unknown>) : null) ??
    (record.state && typeof record.state === 'object' ? (record.state as Record<string, unknown>) : null)

  const output = typeof state?.output === 'string' ? (state.output as string) : ''
  if (output.trim().length > 0) {
    return output
  }

  const errorText = pickToolErrorText(state)
  if (errorText) {
    return errorText
  }

  const metadata = state?.metadata && typeof state.metadata === 'object' ? (state.metadata as Record<string, unknown>) : null
  const metaOutput = typeof metadata?.output === 'string' ? (metadata.output as string) : ''
  if (metaOutput.trim().length > 0) {
    return metaOutput
  }

  const metadataError = pickToolErrorText(metadata)
  if (metadataError) {
    return metadataError
  }

  const topLevelError = pickToolErrorText(raw as Record<string, unknown>, { includeOutput: true })
  if (topLevelError) {
    return topLevelError
  }

  return null
}

function pickToolErrorText(value: Record<string, unknown> | null, options: { includeOutput?: boolean } = {}): string | null {
  if (!value) {
    return null
  }

  const direct = options.includeOutput ? [value.error, value.message, value.stderr, value.output] : [value.error, value.message, value.stderr]
  for (const item of direct) {
    if (typeof item === 'string' && item.trim().length > 0) {
      return item.trim()
    }
  }

  if (typeof value.error === 'object' && value.error !== null) {
    const nested = value.error as Record<string, unknown>
    for (const item of [nested.message, nested.error, nested.stderr]) {
      if (typeof item === 'string' && item.trim().length > 0) {
        return item.trim()
      }
    }
  }

  return null
}

function isToolError(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null) {
    return false
  }

  const record = raw as Record<string, unknown>
  const part = record.part && typeof record.part === 'object' ? (record.part as Record<string, unknown>) : null
  const state =
    (part?.state && typeof part.state === 'object' ? (part.state as Record<string, unknown>) : null) ??
    (record.state && typeof record.state === 'object' ? (record.state as Record<string, unknown>) : null)

  const statusCandidates = [record.status, record.state, part?.status, state?.status]
  for (const value of statusCandidates) {
    if (typeof value === 'string' && value.trim().toLowerCase() === 'error') {
      return true
    }
  }

  return Boolean(pickToolErrorText(state) || pickToolErrorText(part) || pickToolErrorText(record))
}

function extractToolGroup(raw: unknown): ToolGroupEntry[] {
  if (typeof raw !== 'object' || raw === null) {
    return []
  }
  const record = raw as { toolGroup?: unknown }
  if (!Array.isArray(record.toolGroup)) {
    return []
  }
  return record.toolGroup.flatMap((item) => {
    if (typeof item === 'string') {
      return [{ summary: item }]
    }
    if (typeof item !== 'object' || item === null) {
      return []
    }
    const entry = item as {
      summary?: unknown
      output?: unknown
      isError?: unknown
      toolName?: unknown
      title?: unknown
      detail?: unknown
      status?: unknown
      mergeKey?: unknown
    }
    if (typeof entry.summary !== 'string' || entry.summary.trim().length === 0) {
      return []
    }
    return [
      {
        summary: entry.summary,
        output: typeof entry.output === 'string' ? entry.output : null,
        isError: entry.isError === true,
        toolName: typeof entry.toolName === 'string' ? entry.toolName : undefined,
        title: typeof entry.title === 'string' ? entry.title : undefined,
        detail: typeof entry.detail === 'string' ? entry.detail : undefined,
        status: typeof entry.status === 'string' ? entry.status : undefined,
        mergeKey: typeof entry.mergeKey === 'string' ? entry.mergeKey : undefined
      }
    ]
  })
}
