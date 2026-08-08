import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('transcript activity block', () => {
  it('groups consecutive reasoning, tool calls, and subtasks without moving later thinking above text', () => {
    const source = readFileSync(join(root, 'webview-ui/src/components/Transcript.tsx'), 'utf8');

    expect(source).toContain('const renderItems = buildMessageRenderItems(visibleParts, messageIndex, isFinalResponse)');
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

  it('renders one turn-level timer before process blocks and keeps the final answer outside process collapse', () => {
    const source = readFileSync(join(root, 'webview-ui/src/components/Transcript.tsx'), 'utf8');

    expect(source).toContain('function MessageContent({');
    expect(source).toContain('const rendered = buildTranscriptDisplayBlocks(messages)');
    expect(source).toContain('<AssistantTurnBlock');
    expect(source).toContain('<div className="turn-work">');
    expect(source).toContain('{turn.responses.map((entry) => {');
    expect(source.indexOf('<div className="turn-work">')).toBeLessThan(source.indexOf('{turn.responses.map((entry) => {'));
    expect(source).toContain('const finalAnswerIndex = items.findIndex((item) => item.kind ===');
    expect(source).toContain('const visibleItems = !showProcess && finalAnswerIndex >= 0 ? items.slice(finalAnswerIndex) : items');
    expect(source).toContain('const timer = window.setInterval(tick, 1000)');
    expect(source).toContain('const timing = resolveAssistantTurnTiming(turn, {');
    expect(source).toContain("t('Working for {duration}', { duration: durationLabel ?? '<1s' })");
    expect(source).toContain("t('Worked for {duration}', { duration: durationLabel })");
    expect(source).toContain('function ActivityBlock({');
    expect(source).toContain('const [open, setOpen] = useState(false)');
    expect(source).toContain('const summary = getActivitySummary(entries, t)');
    expect(source).toContain('aria-expanded={open}');
    expect(source).toContain('className="activity-block__summary"');
    expect(source).toContain('className="activity-block__current"');
    expect(source).toContain("className={`md-body${item.isFinalAnswer ? ' md-body--final-answer' : ''}`}");
    expect(source).toContain('function markFinalAnswerItem(items: MessageRenderItem[]): MessageRenderItem[]');
    expect(source).toContain("${t('Subtask')}: ${summarizeActivityText(activeTask.title || activeTask.summary)}");
    expect(source).toContain("${t('Tool')}: ${summarizeActivityText(latestTool.title || latestTool.summary)}");
    expect(source).toContain("${t('Thinking')} ${summarizeActivityText(latestThinking.part.text)}");
    expect(source).not.toContain('PrefinalWorkBlock');
    expect(source).not.toContain('usePrefinalWorkDuration');
    expect(source).not.toContain('activity-block__meta');
    expect(source).not.toContain('function getPrefinalWorkSummary');
    expect(source).not.toContain('function useActivityDuration');
    expect(source).not.toContain('activity-block__title');
  });

  it('renders grouped subtasks and tools inside activity without auto-expanding nested details', () => {
    const source = readFileSync(join(root, 'webview-ui/src/components/Transcript.tsx'), 'utf8');

    expect(source).toContain("if (part.toolName === '__tool_group__') {");
    expect(source).toContain('onOpenSubtask={onOpenSubtask}');
    expect(source).toContain('defaultExpanded={false}');
    expect(source).toContain('autoOpenActive={false}');
    expect(source).toContain('autoOpenActive = false');
    expect(source).toContain('const [expanded, setExpanded] = useState(defaultExpanded || (autoOpenActive && hasActiveSubtasks))');
  });

  it('keeps thinking collapsible and styles active activity with a slower wider sheen', () => {
    const source = readFileSync(join(root, 'webview-ui/src/components/Transcript.tsx'), 'utf8');
    const styles = readFileSync(join(root, 'webview-ui/src/styles.css'), 'utf8');

    expect(source).toContain('<details className="activity-thinking" open onToggle={onUserToggle}>');
    expect(source).toContain('<summary className="activity-thinking__summary">{t(\'Thinking\')}</summary>');
    expect(source).toContain('const isLive = isCurrent && summary.isLive');
    expect(source).toContain('activity-block--active');
    expect(styles).toContain('.activity-block');
    expect(styles).toContain('.assistant-turn');
    expect(styles).toContain('.turn-work');
    expect(styles).toContain('.turn-work__summary');
    expect(styles).toContain('.turn-work__divider');
    expect(styles).toContain('.turn-work__chevron.is-expanded');
    expect(styles).toContain('.activity-block__summary::after');
    expect(styles).toContain('.activity-block--active .activity-block__summary::after');
    expect(styles).toContain('.msg--assistant.is-streaming');
    expect(styles).toContain('.activity-block__summary:focus-visible');
    expect(styles).toContain('outline: 0;');
    expect(styles).toContain('box-shadow: none;');
    expect(styles).toContain('animation: activity-sheen 2.2s ease-in-out infinite;');
    expect(styles).toContain('@keyframes activity-sheen');
    expect(styles).toContain('transform: translateX(-145%);');
    expect(styles).toContain('transform: translateX(145%);');
    expect(styles).toContain('.activity-thinking__summary');
    expect(styles).toContain('.activity-thinking__body');
    expect(styles).toContain('.md-body--final-answer');
    expect(styles).toContain('.activity-block__body');
    const nestedWorkStyles = [
      styles.slice(styles.indexOf('.activity-block__body {'), styles.indexOf('.activity-entry {')),
      styles.slice(styles.indexOf('.activity-thinking__body {'), styles.indexOf('.md-body--final-answer {'))
    ]
    for (const block of nestedWorkStyles) {
      expect(block).toContain('max-height: none;')
      expect(block).toContain('overflow: visible;')
      expect(block).not.toContain('overflow: auto;')
    }
    const toolPreviewStyles = styles.slice(
      styles.indexOf('.tool-group__preview {'),
      styles.indexOf('.tool-group__line {')
    )
    expect(toolPreviewStyles).toContain('overflow-y: hidden;')
    expect(toolPreviewStyles).not.toContain('overflow-y: auto;')
    expect(toolPreviewStyles).not.toContain('scrollbar-width:')
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(styles).toContain('@media (max-width: 420px)');
    expect(styles).not.toContain('.log-block');
    expect(styles).not.toContain('.activity-block__meta');
    expect(styles).not.toContain('.prefinal-work');
  });
});
