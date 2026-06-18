import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('transcript activity block', () => {
  it('groups consecutive reasoning, tool calls, and subtasks without moving later thinking above text', () => {
    const source = readFileSync(join(root, 'webview-ui/src/components/Transcript.tsx'), 'utf8');

    expect(source).toContain('const renderItems = buildMessageRenderItems(visibleParts, messageIndex, !isStreamingBubble)');
    expect(source).toContain('if (renderItems.length === 0) {');
    expect(source).toContain('function buildMessageRenderItems(parts: TranscriptPart[], messageIndex: number, markFinalAnswer: boolean): MessageRenderItem[]');
    expect(source).toContain('let activityEntries: ActivityEntry[] = []');
    expect(source).toContain('let activityIndex = 0');
    expect(source).toContain('const flushActivity = () => {');
    expect(source).toContain('key: `${String(messageIndex)}-activity-${String(activityIndex)}`,');
    expect(source).toContain("if (part.toolName === 'status') {");
    expect(source).toContain("if (part.toolName === 'todowrite') {");
    expect(source).toContain("if (part.type === 'reasoning' || part.type === 'tool') {");
    expect(source).toContain('activityEntries.push({ key, part })');
    expect(source).toContain('flushActivity()');
    expect(source).toContain('return markFinalAnswer ? markFinalAnswerItem(items) : items');
    expect(source).not.toContain('let hasActivity = false');
  });

  it('keeps process blocks summarized, collapsed by default, and separates final answer text', () => {
    const source = readFileSync(join(root, 'webview-ui/src/components/Transcript.tsx'), 'utf8');

    expect(source).toContain('function MessageContent({');
    expect(source).toContain('<PrefinalWorkBlock');
    expect(source).toContain('const finalAnswerIndex = items.findIndex((item) => item.kind ===');
    expect(source).toContain('const workDurationLabel = usePrefinalWorkDuration(items, isStreamingBubble)');
    expect(source).toContain('function ActivityBlock({');
    expect(source).toContain('const [open, setOpen] = useState(false)');
    expect(source).toContain('const summary = getActivitySummary(entries)');
    expect(source).toContain('aria-expanded={open}');
    expect(source).toContain('className="activity-block__summary"');
    expect(source).toContain('className="activity-block__current"');
    expect(source).toContain("md-body${item.isFinalAnswer && !options.insidePrefinal ? ' md-body--final-answer' : ''}");
    expect(source).toContain('function markFinalAnswerItem(items: MessageRenderItem[]): MessageRenderItem[]');
    expect(source).toContain('function PrefinalWorkBlock({');
    expect(source).toContain("const title = durationLabel ? `Worked for ${durationLabel}` : 'Worked before final answer'");
    expect(source).toContain('function usePrefinalWorkDuration(items: MessageRenderItem[], isStreamingBubble: boolean)');
    expect(source).toContain('const candidateFinalStarted = isStreamingBubble && isLastItemTextWithPriorWork(items)');
    expect(source).toContain('candidateFinalStartedAtRef.current ?? Date.now()');
    expect(source).toContain('Subtask: ${summarizeActivityText(activeTask.title || activeTask.summary)}');
    expect(source).toContain('Tool: ${summarizeActivityText(latestTool.title || latestTool.summary)}');
    expect(source).toContain('Thinking ${summarizeActivityText(latestThinking.part.text)}');
    expect(source).not.toContain('activity-block__meta');
    expect(source).not.toContain('prefinal-work__meta');
    expect(source).not.toContain('function getPrefinalWorkSummary');
    expect(source).not.toContain('function useActivityDuration');
    expect(source).not.toContain('activity-block__title');
  });

  it('renders grouped subtasks and tools inside activity without auto-expanding nested details', () => {
    const source = readFileSync(join(root, 'webview-ui/src/components/Transcript.tsx'), 'utf8');

    expect(source).toContain("if (part.toolName === '__tool_group__') {");
    expect(source).toContain('return <ToolGroupBlock items={group} onUserToggle={onUserToggle} defaultExpanded={false} autoOpenActive={false} />');
    expect(source).toContain('autoOpenActive = false');
    expect(source).toContain('const [expanded, setExpanded] = useState(defaultExpanded || (autoOpenActive && hasActiveSubtasks))');
  });

  it('keeps thinking collapsible and styles active activity with a slower wider sheen', () => {
    const source = readFileSync(join(root, 'webview-ui/src/components/Transcript.tsx'), 'utf8');
    const styles = readFileSync(join(root, 'webview-ui/src/styles.css'), 'utf8');

    expect(source).toContain('<details className="activity-thinking" open onToggle={onUserToggle}>');
    expect(source).toContain('<summary className="activity-thinking__summary">Thinking</summary>');
    expect(source).toContain('const isLive = isCurrent && summary.isLive');
    expect(source).toContain('activity-block--active');
    expect(styles).toContain('.activity-block');
    expect(styles).toContain('.prefinal-work');
    expect(styles).toContain('.prefinal-work__summary');
    expect(styles).toContain('.prefinal-work__body');
    expect(styles).toContain('.prefinal-work__text');
    expect(styles).toContain('.activity-block__summary::after');
    expect(styles).toContain('.activity-block--active .activity-block__summary::after');
    expect(styles).toContain('animation: activity-sheen 2.2s ease-in-out infinite;');
    expect(styles).toContain('@keyframes activity-sheen');
    expect(styles).toContain('transform: translateX(-145%);');
    expect(styles).toContain('transform: translateX(145%);');
    expect(styles).toContain('.activity-thinking__summary');
    expect(styles).toContain('.activity-thinking__body');
    expect(styles).toContain('.md-body--final-answer');
    expect(styles).toContain('.activity-block__body');
    expect(styles).toContain('max-height: min(48vh, 32rem);');
    expect(styles).toContain('overflow: auto;');
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(styles).toContain('@media (max-width: 420px)');
    expect(styles).not.toContain('.log-block');
    expect(styles).not.toContain('.activity-block__meta');
    expect(styles).not.toContain('.prefinal-work__meta');
  });
});
