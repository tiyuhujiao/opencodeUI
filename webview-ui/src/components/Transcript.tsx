import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Check, ChevronRight, Copy, GitFork, LoaderCircle, Undo2 } from 'lucide-react'
import { renderMarkdown } from '../markdown/renderMarkdown'
import {
  computeAnchoredScrollTop,
  computeRunSpacerHeight,
  findLatestAssistantTextOutput,
  interpolateFastScrollTop,
  TURN_ANCHOR_SCROLL_DURATION_MS
} from '../transcriptScroll'
import { useI18n, type TranslationValues } from '../i18n'
import { isFinalAssistantResponse } from '../transcriptState'
import {
  buildTranscriptDisplayBlocks,
  formatTurnDuration,
  resolveTranscriptRunTiming,
  type IndexedTranscriptMessage,
  type TranscriptRun
} from '../transcriptTurns'
import type { TranscriptMessage, TranscriptPart, TranscriptPartTool } from '../../../src/shared/protocol'

type Translate = (source: string, values?: TranslationValues) => string

type TranscriptProps = {
  messages: TranscriptMessage[]
  isRunning: boolean
  onOpenSubtask?: (subtask: { sessionId: string; title: string }) => void
  onOpenFileReference?: (reference: { path: string; line?: number; column?: number }) => void
  onRevertMessage?: (messageId: string) => void
  onForkMessage?: (messageId: string) => void
  revertingMessageId?: string | null
  forkingMessageId?: string | null
}

export function Transcript({
  messages,
  isRunning,
  onOpenSubtask,
  onOpenFileReference,
  onRevertMessage,
  onForkMessage,
  revertingMessageId = null,
  forkingMessageId = null
}: TranscriptProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const autoScrollPausedRef = useRef(false)
  const scrollLockRef = useRef<{ top: number; until: number } | null>(null)
  const programmaticScrollTargetRef = useRef<number | null>(null)
  const turnAnchorRef = useRef<HTMLElement | null>(null)
  const runSpacerRef = useRef<HTMLDivElement | null>(null)
  const anchorScrollFrameRef = useRef<number | null>(null)
  const anchorScrollActiveRef = useRef(false)
  const followLatestOutputRef = useRef<() => void>(() => undefined)
  const copyResetTimerRef = useRef<number | null>(null)
  const [copiedMessageKey, setCopiedMessageKey] = useState<string | null>(null)
  const [expandedRuns, setExpandedRuns] = useState<Record<string, boolean>>({})
  const latestAssistantTextOutput = findLatestAssistantTextOutput(messages)
  const latestAssistantTextKey = latestAssistantTextOutput?.key ?? null
  const latestAssistantText = latestAssistantTextOutput?.text ?? null

  useEffect(() => () => {
    if (copyResetTimerRef.current !== null) {
      window.clearTimeout(copyResetTimerRef.current)
    }
  }, [])

  const copyAssistantMessage = useCallback(async (messageKey: string, text: string) => {
    try {
      await writeClipboardText(text)
      setCopiedMessageKey(messageKey)
      if (copyResetTimerRef.current !== null) {
        window.clearTimeout(copyResetTimerRef.current)
      }
      copyResetTimerRef.current = window.setTimeout(() => {
        setCopiedMessageKey((current) => (current === messageKey ? null : current))
        copyResetTimerRef.current = null
      }, 1400)
    } catch {
      setCopiedMessageKey(null)
    }
  }, [])

  const cancelAnchorScroll = useCallback(() => {
    if (anchorScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(anchorScrollFrameRef.current)
      anchorScrollFrameRef.current = null
    }
    anchorScrollActiveRef.current = false
  }, [])

  const pauseAutoScroll = useCallback(() => {
    cancelAnchorScroll()
    autoScrollPausedRef.current = true
    scrollLockRef.current = null
  }, [cancelAnchorScroll])

  const pauseAutoScrollForUserAction = useCallback(() => {
    const el = containerRef.current
    if (!el) {
      return
    }

    pauseAutoScroll()
    scrollLockRef.current = { top: el.scrollTop, until: Date.now() + 450 }

    window.requestAnimationFrame(() => {
      const lock = scrollLockRef.current
      if (lock && Date.now() <= lock.until) {
        el.scrollTop = lock.top
      }
    })
  }, [pauseAutoScroll])

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) {
      return
    }

    const contentBottom = () => {
      const rows = el.querySelectorAll<HTMLElement>(':scope > .msg-row, :scope > .assistant-turn, :scope > .tool-group')
      const last = rows.item(rows.length - 1)
      return last ? last.offsetTop + last.offsetHeight : 0
    }

    const setProgrammaticScrollTop = (top: number) => {
      const target = Math.max(0, Math.min(top, Math.max(0, el.scrollHeight - el.clientHeight)))
      programmaticScrollTargetRef.current = target
      el.scrollTop = target
    }

    const updateRunSpacerHeight = () => {
      const anchor = turnAnchorRef.current
      const spacer = runSpacerRef.current
      if (!isRunning || !anchor || !spacer) {
        return
      }

      const styles = window.getComputedStyle(el)
      spacer.style.height = `${computeRunSpacerHeight({
        clientHeight: el.clientHeight,
        anchorHeight: anchor.offsetHeight,
        rowGap: parseCssPixels(styles.rowGap),
        paddingBottom: parseCssPixels(styles.paddingBottom)
      })}px`
    }

    const anchoredScrollTop = () => {
      const anchor = turnAnchorRef.current
      if (!anchor || !el.contains(anchor)) {
        return null
      }
      return computeAnchoredScrollTop({
        anchorTop: anchor.offsetTop,
        contentBottom: contentBottom(),
        clientHeight: el.clientHeight,
        maxScrollTop: Math.max(0, el.scrollHeight - el.clientHeight)
      })
    }

    const scrollIfNeeded = () => {
      const lock = scrollLockRef.current
      if (lock) {
        if (Date.now() <= lock.until) {
          setProgrammaticScrollTop(lock.top)
          return
        }
        scrollLockRef.current = null
      }

      if (autoScrollPausedRef.current) {
        return
      }

      if (anchorScrollActiveRef.current) {
        return
      }

      if (isRunning) {
        const target = anchoredScrollTop()
        if (target === null) {
          setProgrammaticScrollTop(el.scrollHeight)
          return
        }
        setProgrammaticScrollTop(target)
        return
      }

      const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight
      if (distanceToBottom < 80) {
        setProgrammaticScrollTop(el.scrollHeight)
      }
    }

    const animateToTurnAnchor = () => {
      const initialTarget = anchoredScrollTop()
      if (initialTarget === null) {
        scrollIfNeeded()
        return
      }

      const start = el.scrollTop
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      if (reduceMotion || Math.abs(initialTarget - start) < 0.5) {
        setProgrammaticScrollTop(initialTarget)
        return
      }

      const startedAt = window.performance.now()
      anchorScrollActiveRef.current = true
      const step = (now: number) => {
        if (!anchorScrollActiveRef.current) {
          return
        }
        const target = anchoredScrollTop() ?? initialTarget
        const elapsed = now - startedAt
        setProgrammaticScrollTop(interpolateFastScrollTop(start, target, elapsed))
        if (elapsed >= TURN_ANCHOR_SCROLL_DURATION_MS) {
          anchorScrollFrameRef.current = null
          anchorScrollActiveRef.current = false
          scrollIfNeeded()
          return
        }
        anchorScrollFrameRef.current = window.requestAnimationFrame(step)
      }
      anchorScrollFrameRef.current = window.requestAnimationFrame(step)
    }

    followLatestOutputRef.current = scrollIfNeeded

    if (isRunning) {
      const userRows = el.querySelectorAll<HTMLElement>(':scope > .msg-row--user')
      turnAnchorRef.current = userRows.item(userRows.length - 1)
      autoScrollPausedRef.current = false
      scrollLockRef.current = null
      updateRunSpacerHeight()
      animateToTurnAnchor()
    } else {
      turnAnchorRef.current = null
      scrollIfNeeded()
    }

    // Observe DOM changes so we scroll on streaming updates without depending on `messages`.
    const observer = new MutationObserver(() => {
      scrollIfNeeded()
    })
    observer.observe(el, {
      subtree: true,
      childList: true,
      characterData: true
    })

    const resizeObserver = new ResizeObserver(() => {
      updateRunSpacerHeight()
      scrollIfNeeded()
    })
    resizeObserver.observe(el)

    const onScroll = () => {
      const programmaticTarget = programmaticScrollTargetRef.current
      if (programmaticTarget !== null && Math.abs(el.scrollTop - programmaticTarget) < 1) {
        programmaticScrollTargetRef.current = null
        return
      }
      programmaticScrollTargetRef.current = null

      if (!autoScrollPausedRef.current) {
        return
      }

      const followTarget = isRunning
        ? anchoredScrollTop()
        : Math.max(0, el.scrollHeight - el.clientHeight)
      if (followTarget !== null && Math.abs(followTarget - el.scrollTop) < 24) {
        autoScrollPausedRef.current = false
        scrollLockRef.current = null
      }
    }

    el.addEventListener('scroll', onScroll)

    return () => {
      cancelAnchorScroll()
      followLatestOutputRef.current = () => undefined
      observer.disconnect()
      resizeObserver.disconnect()
      el.removeEventListener('scroll', onScroll)
    }
  }, [cancelAnchorScroll, isRunning])

  useLayoutEffect(() => {
    if (!isRunning || latestAssistantTextKey === null || latestAssistantText === null) {
      return
    }
    followLatestOutputRef.current()
  }, [isRunning, latestAssistantTextKey, latestAssistantText])

  const rendered = buildTranscriptDisplayBlocks(messages)
  let activeRunKey: string | null = null
  if (isRunning) {
    for (let index = rendered.length - 1; index >= 0; index -= 1) {
      const entry = rendered[index]
      if (entry.kind === 'run') {
        activeRunKey = entry.run.key
        break
      }
    }
  }

  const runPresentations = new Map<string, TranscriptRunPresentation>()
  for (const block of rendered) {
    if (block.kind !== 'run') {
      continue
    }
    runPresentations.set(block.run.key, buildTranscriptRunPresentation(block.run, block.run.key === activeRunKey))
  }

  return (
    <div
      className="transcript"
      role="log"
      aria-live="polite"
      ref={containerRef}
      onWheel={pauseAutoScroll}
      onTouchStart={pauseAutoScroll}
      onPointerDown={pauseAutoScroll}
      onClick={(event) => {
        const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-file-path]') : null
        const filePath = target?.dataset.filePath
        if (!filePath || !onOpenFileReference) {
          return
        }
        event.preventDefault()
        onOpenFileReference({
          path: filePath,
          line: parsePositiveInteger(target.dataset.fileLine),
          column: parsePositiveInteger(target.dataset.fileColumn)
        })
      }}
      onKeyDown={(event) => {
        if (['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown', ' '].includes(event.key)) {
          pauseAutoScroll()
        }
        if (event.key !== 'Enter' && event.key !== ' ') {
          return
        }
        const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-file-path]') : null
        const filePath = target?.dataset.filePath
        if (!filePath || !onOpenFileReference) {
          return
        }
        event.preventDefault()
        onOpenFileReference({
          path: filePath,
          line: parsePositiveInteger(target.dataset.fileLine),
          column: parsePositiveInteger(target.dataset.fileColumn)
        })
      }}
    >
      {rendered.map((block) => {
        if (block.kind === 'run') {
          const presentation = runPresentations.get(block.run.key)
            ?? buildTranscriptRunPresentation(block.run, false)
          const defaultExpanded = presentation.hasProcessContent
            && (block.run.key === activeRunKey || !presentation.hasFinalResponse)
          const expanded = presentation.hasProcessContent
            && (expandedRuns[block.run.key] ?? defaultExpanded)
          return (
            <TranscriptRunBlock
              key={block.run.key}
              run={block.run}
              presentation={presentation}
              isActive={block.run.key === activeRunKey}
              expanded={expanded}
              isRunning={isRunning}
              onToggle={() => {
                pauseAutoScrollForUserAction()
                setExpandedRuns((current) => ({ ...current, [block.run.key]: !expanded }))
              }}
              onUserToggle={pauseAutoScrollForUserAction}
              onOpenSubtask={onOpenSubtask}
              onRevertMessage={onRevertMessage}
              onForkMessage={onForkMessage}
              copyAssistantMessage={copyAssistantMessage}
              copiedMessageKey={copiedMessageKey}
              revertingMessageId={revertingMessageId}
              forkingMessageId={forkingMessageId}
            />
          )
        }

        return (
          <MessageRow
            key={getMessageKey(block.entry)}
            entry={block.entry}
            isStreamingBubble={false}
            contentMode="all"
            isRunning={isRunning}
            onUserToggle={pauseAutoScrollForUserAction}
            onOpenSubtask={onOpenSubtask}
            onRevertMessage={onRevertMessage}
            onForkMessage={onForkMessage}
            revertingMessageId={revertingMessageId}
            forkingMessageId={forkingMessageId}
            copiedMessageKey={copiedMessageKey}
            copyAssistantMessage={copyAssistantMessage}
          />
        )
      })}
      {isRunning ? <div ref={runSpacerRef} className="transcript__run-spacer" aria-hidden="true" /> : null}
    </div>
  )
}

type MessageRowProps = {
  entry: IndexedTranscriptMessage
  isStreamingBubble: boolean
  contentMode: MessageContentMode
  finalResponseOverride?: boolean
  isRunning: boolean
  onUserToggle: () => void
  onOpenSubtask?: (subtask: { sessionId: string; title: string }) => void
  onRevertMessage?: (messageId: string) => void
  onForkMessage?: (messageId: string) => void
  revertingMessageId: string | null
  forkingMessageId: string | null
  copiedMessageKey: string | null
  copyAssistantMessage: (messageKey: string, text: string) => Promise<void>
}

type TranscriptRunPresentation = {
  finalResponseIndices: Set<number>
  lastAssistantMessageIndex: number
  hasFinalResponse: boolean
  hasProcessContent: boolean
}

function buildTranscriptRunPresentation(run: TranscriptRun, isActive: boolean): TranscriptRunPresentation {
  let lastAssistantMessageIndex = -1
  let lastUserMessageIndex = run.initialUser.messageIndex
  for (const entry of run.events) {
    if (entry.message.role === 'assistant') {
      lastAssistantMessageIndex = entry.messageIndex
    } else if (entry.message.role === 'user') {
      lastUserMessageIndex = entry.messageIndex
    }
  }

  let finalCandidate: IndexedTranscriptMessage | undefined
  for (let index = run.events.length - 1; index >= 0; index -= 1) {
    const entry = run.events[index]
    if (
      entry?.message.role === 'assistant'
      && entry.messageIndex > lastUserMessageIndex
      && (isActive ? entry.messageIndex === lastAssistantMessageIndex : isFinalAssistantResponse(entry.message))
    ) {
      finalCandidate = entry
      break
    }
  }
  const finalResponseIndices = new Set<number>()
  if (finalCandidate) {
    const visibleParts = compressVisibleParts(finalCandidate.message.parts.filter((part) => part.type !== 'unknown'))
    const items = buildMessageRenderItems(visibleParts, finalCandidate.messageIndex, true)
    if (items.some((item) => item.kind === 'part' && item.isFinalAnswer)) {
      finalResponseIndices.add(finalCandidate.messageIndex)
    }
  }
  const hasFinalResponse = finalResponseIndices.size > 0
  return {
    finalResponseIndices,
    lastAssistantMessageIndex,
    hasFinalResponse,
    hasProcessContent: run.events.some((entry) => entry.message.role !== 'user' &&
      messageHasProcessContent(entry, finalResponseIndices.has(entry.messageIndex))
    )
  }
}

type TranscriptRunTimelineItem = {
  key: string
  kind: 'process' | 'visible'
  entry: IndexedTranscriptMessage
  contentMode: MessageContentMode
}

function buildTranscriptRunTimeline(
  run: TranscriptRun,
  presentation: TranscriptRunPresentation
): TranscriptRunTimelineItem[] {
  const items: TranscriptRunTimelineItem[] = []
  for (const entry of run.events) {
    if (entry.message.role === 'user') {
      items.push({
        key: `${getMessageKey(entry)}-queued-user`,
        kind: 'visible',
        entry,
        contentMode: 'all'
      })
      continue
    }

    const isFinal = presentation.finalResponseIndices.has(entry.messageIndex)
    if (messageHasProcessContent(entry, isFinal)) {
      items.push({
        key: `${getMessageKey(entry)}-process`,
        kind: 'process',
        entry,
        contentMode: isFinal ? 'process' : 'all'
      })
    }
    if (isFinal) {
      items.push({
        key: `${getMessageKey(entry)}-final`,
        kind: 'visible',
        entry,
        contentMode: 'final'
      })
    }
  }
  return items
}

function TranscriptRunBlock({
  run,
  presentation,
  isActive,
  expanded,
  isRunning,
  onToggle,
  onUserToggle,
  onOpenSubtask,
  onRevertMessage,
  onForkMessage,
  copyAssistantMessage,
  copiedMessageKey,
  revertingMessageId,
  forkingMessageId
}: {
  run: TranscriptRun
  presentation: TranscriptRunPresentation
  isActive: boolean
  expanded: boolean
  isRunning: boolean
  onToggle: () => void
  onUserToggle: () => void
  onOpenSubtask?: (subtask: { sessionId: string; title: string }) => void
  onRevertMessage?: (messageId: string) => void
  onForkMessage?: (messageId: string) => void
  copyAssistantMessage: (messageKey: string, text: string) => Promise<void>
  copiedMessageKey: string | null
  revertingMessageId: string | null
  forkingMessageId: string | null
}) {
  const { t } = useI18n()
  const fallbackStartedAtRef = useRef(Date.now())
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    if (!isActive) {
      return
    }
    const tick = () => setNow(Date.now())
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [isActive])

  const timing = resolveTranscriptRunTiming(run, {
    isActive,
    now,
    fallbackStartedAt: fallbackStartedAtRef.current
  })
  const { lastAssistantMessageIndex, hasProcessContent } = presentation
  const durationLabel = timing.elapsedMs === null ? null : formatTurnDuration(timing.elapsedMs)
  const title = isActive
    ? timing.elapsedMs !== null && timing.elapsedMs >= 1000
      ? t('Working for {duration}', { duration: durationLabel ?? '<1s' })
      : t('Working')
    : durationLabel
      ? t('Worked for {duration}', { duration: durationLabel })
      : t('Worked')
  const timeline = buildTranscriptRunTimeline(run, presentation)

  return (
    <section className={`assistant-turn${isActive ? ' assistant-turn--active' : ''}`} data-run-key={run.key}>
      <div className="turn-work">
        {hasProcessContent ? (
          <button
            type="button"
            className="turn-work__summary"
            onClick={onToggle}
            aria-expanded={expanded}
          >
            <span className="turn-work__title">{title}</span>
            <ChevronRight
              className={`turn-work__chevron${expanded ? ' is-expanded' : ''}`}
              size={12}
              strokeWidth={1.8}
              aria-hidden="true"
            />
          </button>
        ) : (
          <div className="turn-work__summary turn-work__summary--static">
            <span className="turn-work__title">{title}</span>
          </div>
        )}
        <div className="turn-work__divider" aria-hidden="true" />
      </div>
      <div className="assistant-turn__timeline">
        {timeline.map((item, index) => {
          const itemVisible = item.kind === 'visible' || expanded
          const hasGapAfter = itemVisible && timeline
            .slice(index + 1)
            .some((candidate) => candidate.kind === 'visible' || expanded)
          const row = (
              <MessageRow
                entry={item.entry}
                isStreamingBubble={isActive && item.entry.messageIndex === lastAssistantMessageIndex}
                contentMode={item.contentMode}
                finalResponseOverride={item.contentMode === 'final'}
                isRunning={isRunning}
                onUserToggle={onUserToggle}
                onOpenSubtask={onOpenSubtask}
                onRevertMessage={item.entry.message.role === 'user' ? onRevertMessage : undefined}
                onForkMessage={onForkMessage}
                revertingMessageId={revertingMessageId}
                forkingMessageId={forkingMessageId}
                copiedMessageKey={copiedMessageKey}
                copyAssistantMessage={copyAssistantMessage}
              />
          )
          if (item.kind === 'process') {
            return (
              <div
                key={item.key}
                className={`assistant-turn__process${expanded ? ' is-expanded' : ''}${hasGapAfter ? ' has-gap-after' : ''}`}
                aria-hidden={!expanded}
              >
                <div className="assistant-turn__process-inner">{row}</div>
              </div>
            )
          }
          return (
            <div key={item.key} className={`assistant-turn__visible${hasGapAfter ? ' has-gap-after' : ''}`}>
              {row}
            </div>
          )
        })}
      </div>
    </section>
  )
}

function MessageRow({
  entry,
  isStreamingBubble,
  contentMode,
  finalResponseOverride,
  isRunning,
  onUserToggle,
  onOpenSubtask,
  onRevertMessage,
  onForkMessage,
  revertingMessageId,
  forkingMessageId,
  copiedMessageKey,
  copyAssistantMessage
}: MessageRowProps) {
  const { t } = useI18n()
  const { message, messageIndex } = entry
  const visibleParts = compressVisibleParts(message.parts.filter((part) => part.type !== 'unknown'))
  if (visibleParts.length === 0) {
    return null
  }

  const isFinalResponse = !isStreamingBubble
    && (finalResponseOverride ?? isFinalAssistantResponse(message))
  const renderItems = buildMessageRenderItems(visibleParts, messageIndex, isFinalResponse || contentMode !== 'all')
  const visibleItems = selectMessageRenderItems(renderItems, contentMode)
  if (visibleItems.length === 0) {
    return null
  }

  const currentActivityKey = isStreamingBubble && visibleItems[visibleItems.length - 1]?.kind === 'activity'
    ? visibleItems[visibleItems.length - 1]?.key
    : null
  const messageId = message.id
  const messageKey = getMessageKey(entry)
  const assistantCopyText = isFinalResponse && contentMode !== 'process' ? getAssistantCopyText(message.parts) : ''
  const canRevert = message.role === 'user' && Boolean(messageId && onRevertMessage)
  const canFork = isFinalResponse && contentMode !== 'process' && Boolean(messageId && onForkMessage)
  const copied = copiedMessageKey === messageKey

  return (
    <div className={`msg-row msg-row--${message.role}`}>
      <div className={`msg-stack msg-stack--${message.role}`}>
        <article className={`msg msg--${message.role}${isStreamingBubble ? ' is-streaming' : ''}`}>
          <MessageContent
            items={visibleItems}
            currentActivityKey={currentActivityKey}
            onUserToggle={onUserToggle}
            onOpenSubtask={onOpenSubtask}
          />
        </article>
        {canRevert || assistantCopyText || canFork ? (
          <div className={`msg__actions msg__actions--${message.role}`}>
            {canRevert && messageId ? (
              <button
                type="button"
                className={`msg__action${revertingMessageId === messageId ? ' is-loading' : ''}`}
                onClick={() => {
                  onUserToggle()
                  onRevertMessage?.(messageId)
                }}
                disabled={isRunning || revertingMessageId !== null}
                aria-label={t('Undo to this message')}
                title={t('Undo to this message')}
                aria-busy={revertingMessageId === messageId}
              >
                {revertingMessageId === messageId
                  ? <LoaderCircle size={12} aria-hidden="true" />
                  : <Undo2 size={12} aria-hidden="true" />}
              </button>
            ) : null}
            {assistantCopyText ? (
              <button
                type="button"
                className={`msg__action${copied ? ' is-success' : ''}`}
                onClick={() => {
                  onUserToggle()
                  void copyAssistantMessage(messageKey, assistantCopyText)
                }}
                aria-label={t(copied ? 'Copied' : 'Copy response')}
                title={t(copied ? 'Copied' : 'Copy response')}
              >
                {copied
                  ? <Check size={12} aria-hidden="true" />
                  : <Copy size={12} aria-hidden="true" />}
              </button>
            ) : null}
            {canFork && messageId ? (
              <button
                type="button"
                className={`msg__action${forkingMessageId === messageId ? ' is-loading' : ''}`}
                onClick={() => {
                  onUserToggle()
                  onForkMessage?.(messageId)
                }}
                disabled={isRunning || forkingMessageId !== null}
                aria-label={t('Fork conversation')}
                title={t('Fork conversation')}
                aria-busy={forkingMessageId === messageId}
              >
                {forkingMessageId === messageId
                  ? <LoaderCircle size={12} aria-hidden="true" />
                  : <GitFork size={12} aria-hidden="true" />}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function getMessageKey(entry: IndexedTranscriptMessage): string {
  return `${entry.message.role}-${String(entry.messageIndex)}`
}

type MessageContentMode = 'all' | 'process' | 'final'

function messageHasProcessContent(entry: IndexedTranscriptMessage, hasFinalAnswer: boolean): boolean {
  const visibleParts = compressVisibleParts(entry.message.parts.filter((part) => part.type !== 'unknown'))
  const items = buildMessageRenderItems(visibleParts, entry.messageIndex, hasFinalAnswer)
  return selectMessageRenderItems(items, hasFinalAnswer ? 'process' : 'all').length > 0
}

export function getAssistantCopyText(parts: TranscriptPart[]): string {
  return parts
    .filter((part): part is Extract<TranscriptPart, { type: 'text' }> => part.type === 'text')
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join('\n\n')
}

async function writeClipboardText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.append(textarea)
  textarea.select()
  try {
    if (!document.execCommand('copy')) {
      throw new Error('Clipboard copy was rejected.')
    }
  } finally {
    textarea.remove()
  }
}

function parseCssPixels(value: string): number {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value) {
    return undefined
  }
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
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
  sessionId?: string
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
  currentActivityKey,
  onUserToggle,
  onOpenSubtask
}: {
  items: MessageRenderItem[]
  currentActivityKey: string | null
  onUserToggle: () => void
  onOpenSubtask?: (subtask: { sessionId: string; title: string }) => void
}) {
  return (
    <div className="msg__content">
      {items.map((item) => renderMessageItem(item, { currentActivityKey, onUserToggle, onOpenSubtask }))}
    </div>
  )
}

function selectMessageRenderItems(items: MessageRenderItem[], mode: MessageContentMode): MessageRenderItem[] {
  if (mode === 'all') {
    return items
  }
  const finalAnswerIndex = items.findIndex((item) => item.kind === 'part' && item.isFinalAnswer)
  if (finalAnswerIndex < 0) {
    return mode === 'process' ? items : []
  }
  return mode === 'process' ? items.slice(0, finalAnswerIndex) : items.slice(finalAnswerIndex)
}

function renderMessageItem(
  item: MessageRenderItem,
  options: {
    currentActivityKey: string | null
    onUserToggle: () => void
    onOpenSubtask?: (subtask: { sessionId: string; title: string }) => void
  }
) {
  if (item.kind === 'activity') {
    return (
      <ActivityBlock
        key={item.key}
        entries={item.entries}
        isCurrent={item.key === options.currentActivityKey}
        onUserToggle={options.onUserToggle}
        onOpenSubtask={options.onOpenSubtask}
      />
    )
  }

  const part = item.part
  if (part.type === 'text') {
    return (
      <MarkdownTextBlock
        key={item.key}
        text={part.text}
        isFinalAnswer={item.isFinalAnswer === true}
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

const MarkdownTextBlock = memo(function MarkdownTextBlock({
  text,
  isFinalAnswer
}: {
  text: string
  isFinalAnswer: boolean
}) {
  return (
    <div
      className={`md-body${isFinalAnswer ? ' md-body--final-answer' : ''}`}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: Markdown rendering is sanitized.
      dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }}
    />
  )
})

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
    const key = getPartRenderKey(part, messageIndex, partIndex)
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

function getPartRenderKey(part: TranscriptPart, messageIndex: number, partIndex: number): string {
  if ((part.type === 'text' || part.type === 'reasoning') && part.streamKey) {
    return `${String(messageIndex)}-${part.type}-${part.streamKey}`
  }
  return `${String(messageIndex)}-${String(partIndex)}`
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

  const hasLaterActivity = items.slice(finalTextIndex + 1).some((item) => item.kind === 'activity')
  if (hasLaterActivity) {
    return items
  }

  const next = [...items]
  const finalItem = next[finalTextIndex]
  if (finalItem.kind === 'part') {
    next[finalTextIndex] = { ...finalItem, isFinalAnswer: true }
  }
  return next
}

function ActivityBlock({
  entries,
  isCurrent,
  onUserToggle,
  onOpenSubtask
}: {
  entries: ActivityEntry[]
  isCurrent: boolean
  onUserToggle: () => void
  onOpenSubtask?: (subtask: { sessionId: string; title: string }) => void
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const summary = getActivitySummary(entries, t)
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
            <ActivityEntryBlock
              key={entry.key}
              entry={entry}
              onUserToggle={onUserToggle}
              onOpenSubtask={onOpenSubtask}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

const ActivityEntryBlock = memo(function ActivityEntryBlock({
  entry,
  onUserToggle,
  onOpenSubtask
}: {
  entry: ActivityEntry
  onUserToggle: () => void
  onOpenSubtask?: (subtask: { sessionId: string; title: string }) => void
}) {
  const { t } = useI18n()
  const part = entry.part

  if (part.type === 'reasoning') {
    return (
      <details className="activity-thinking" open onToggle={onUserToggle}>
        <summary className="activity-thinking__summary">{t('Thinking')}</summary>
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
      return (
        <ToolGroupBlock
          items={group}
          onUserToggle={onUserToggle}
          onOpenSubtask={onOpenSubtask}
          defaultExpanded={false}
          autoOpenActive={false}
        />
      )
    }

    const item = createToolGroupEntry(part)
    return (
      <section className={`activity-entry activity-entry--tool${item.isError ? ' is-error' : ''}`}>
        <div className="activity-entry__head">{item.summary}</div>
        {item.output ? <pre className="activity-entry__output">{item.output}</pre> : <div className="activity-entry__empty">{t('No output')}</div>}
      </section>
    )
  }

  return null
}, (previous, next) => (
  previous.entry.key === next.entry.key
  && previous.entry.part === next.entry.part
  && previous.onUserToggle === next.onUserToggle
  && previous.onOpenSubtask === next.onOpenSubtask
))

function getActivitySummary(entries: ActivityEntry[], t: Translate) {
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
    ? `${t('Subtask')}: ${summarizeActivityText(activeTask.title || activeTask.summary)} (${t(formatTaskStatus(activeTask))})`
    : activeTool
      ? `${t('Tool')}: ${summarizeActivityText(activeTool.title || activeTool.summary)}`
      : latestTool
      ? `${t('Tool')}: ${summarizeActivityText(latestTool.title || latestTool.summary)}`
      : latestThinking?.part.type === 'reasoning'
        ? `${t('Thinking')} ${summarizeActivityText(latestThinking.part.text)}`
        : t('Working')

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

function ToolGroupBlock({
  items,
  onUserToggle,
  onOpenSubtask,
  defaultExpanded = false,
  autoOpenActive = false
}: {
  items: ToolGroupEntry[]
  onUserToggle: () => void
  onOpenSubtask?: (subtask: { sessionId: string; title: string }) => void
  defaultExpanded?: boolean
  autoOpenActive?: boolean
}) {
  const { t } = useI18n()
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
        <span>{indexedTasks.length > 0
          ? t('Subtasks ({count})', { count: indexedTasks.length })
          : t('Tools ({count})', { count: items.length })}</span>
        {indexedTasks.length > 0 ? <span className="tool-group__summaryStats">{formatTaskStats(taskStats, t)}</span> : null}
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
                    onOpenSubtask={onOpenSubtask}
                  />
                )
              })}
            </div>
          ) : null}
          {otherItems.length > 0 && indexedTasks.length > 0 ? <div className="tool-group__sectionLabel">{t('Other tools')}</div> : null}
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
  const { t } = useI18n()
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
      <span className="subtask-status">{t(formatTaskStatus(item))}</span>
    </div>
  )
}

function TaskEntry({
  item,
  open,
  onToggle,
  onOpenSubtask
}: {
  item: ToolGroupEntry
  open: boolean
  onToggle: () => void
  onOpenSubtask?: (subtask: { sessionId: string; title: string }) => void
}) {
  const { t } = useI18n()
  const statusKind = getTaskStatusKind(item)
  const canNavigate = Boolean(item.sessionId && onOpenSubtask)
  const emptyMessage =
    statusKind === 'done'
      ? t('No output')
      : statusKind === 'pending'
        ? t('Queued and waiting to start...')
        : t('Running subtask...')
  return (
    <div className={`subtask-entry is-${statusKind}`}>
      <button
        type="button"
        className="subtask-entry__button"
        onClick={() => {
          if (item.sessionId && onOpenSubtask) {
            onOpenSubtask({ sessionId: item.sessionId, title: item.title || item.summary })
            return
          }
          onToggle()
        }}
        aria-expanded={canNavigate ? undefined : open}
        aria-label={canNavigate ? t('Open subtask: {title}', { title: item.title || item.summary }) : undefined}
      >
        <span className="subtask-dot" aria-hidden="true" />
        <span className="subtask-entry__title">{item.title || item.summary}</span>
        <span className="subtask-status">{t(formatTaskStatus(item))}</span>
        <span className="subtask-entry__chevron" aria-hidden="true">
          {canNavigate ? <ChevronRight size={14} strokeWidth={1.8} /> : open ? 'v' : '>'}
        </span>
      </button>
      {!canNavigate && open ? (
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
  const output = extractToolOutput(part.raw)
  return {
    summary: formatToolSummary(part.toolName, part.raw),
    output,
    isError: isToolError(part.raw),
    toolName: part.toolName,
    title: getToolTitle(part.toolName, state),
    detail: getToolDetail(part.toolName, state),
    status,
    mergeKey: getToolPartMergeKey(part),
    sessionId: extractSubtaskSessionId(part.raw, output)
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
    mergeKey: next.mergeKey || previous.mergeKey,
    sessionId: next.sessionId || previous.sessionId
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

function formatTaskStats(stats: ReturnType<typeof getTaskStats>, t: Translate) {
  const parts: string[] = []
  if (stats.running > 0) parts.push(t('{count} running', { count: stats.running }))
  if (stats.pending > 0) parts.push(t('{count} pending', { count: stats.pending }))
  if (stats.error > 0) parts.push(t('{count} error', { count: stats.error }))
  if (stats.done > 0) parts.push(t('{count} done', { count: stats.done }))
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

export function extractSubtaskSessionId(raw: unknown, output: string | null): string | undefined {
  const record = toRecord(raw)
  const part = toRecord(record?.part)
  const state = toRecord(part?.state) ?? toRecord(record?.state)
  const metadata = toRecord(state?.metadata)
  const direct = pickFirstString([
    metadata?.sessionId,
    metadata?.sessionID,
    state?.sessionId,
    state?.sessionID,
    part?.sessionId,
    part?.sessionID,
    record?.sessionId,
    record?.sessionID
  ])
  if (direct) {
    return direct
  }

  const taskOutput = output ?? pickFirstString([state?.output, metadata?.output])
  return taskOutput?.match(/<task\s+id=["']([^"']+)["']/i)?.[1]?.trim() || undefined
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
      sessionId?: unknown
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
        mergeKey: typeof entry.mergeKey === 'string' ? entry.mergeKey : undefined,
        sessionId: typeof entry.sessionId === 'string' ? entry.sessionId : undefined
      }
    ]
  })
}
