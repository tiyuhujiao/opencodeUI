import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('subtask progress panel', () => {
  it('keeps task metadata after tool compression so subtasks render as their own panel', () => {
    const source = readFileSync(join(root, 'webview-ui/src/components/Transcript.tsx'), 'utf8');

    expect(source).toContain('const entries = pendingTools.map(createToolGroupEntry)');
    expect(source).toContain("toolName: part.toolName");
    expect(source).toContain('title: getToolTitle(part.toolName, state)');
    expect(source).toContain('detail: getToolDetail(part.toolName, state)');
    expect(source).toContain('status');
    expect(source).toContain('toolName: typeof entry.toolName');
    expect(source).toContain('status: typeof entry.status');
    expect(source).toContain('mergeKey: getToolPartMergeKey(part)');
    expect(source).toContain('mergeKey: typeof entry.mergeKey');
    expect(source).toContain("item.toolName?.trim().toLowerCase()");
    expect(source).toContain('Subtasks (');
  });

  it('deduplicates task status updates before rendering counts', () => {
    const source = readFileSync(join(root, 'webview-ui/src/components/Transcript.tsx'), 'utf8');

    expect(source).toContain('const displayItems = mergeToolGroupEntries(items)');
    expect(source).toContain('const indexedTasks = displayItems');
    expect(source).toContain('function mergeToolGroupEntries(items: ToolGroupEntry[]): ToolGroupEntry[]');
    expect(source).toContain('taskIndexByKey.set(key, merged.length)');
    expect(source).toContain('merged[existingIndex] = mergeTaskEntry(merged[existingIndex], item)');
    expect(source).toContain('isGenericTaskPlaceholder(item)');
  });

  it('opens active task progress and exposes a visible running state', () => {
    const source = readFileSync(join(root, 'webview-ui/src/components/Transcript.tsx'), 'utf8');

    expect(source).toContain('const activeTaskKey = getActiveTaskKey(indexedTasks)');
    expect(source).toContain('const [openTaskKeys, setOpenTaskKeys] = useState<Set<string>>');
    expect(source).toContain('autoOpenedTaskKeysRef.current.has(activeTaskKey)');
    expect(source).toContain('setExpanded(true)');
    expect(source).toContain('next.add(activeTaskKey)');
    expect(source).toContain('Running subtask...');
    expect(source).toContain('Queued and waiting to start...');
    expect(source).toContain("prompt: typeof input?.prompt === 'string'");
  });

  it('keeps subtask toggles independent and pauses forced autoscroll after user expansion', () => {
    const source = readFileSync(join(root, 'webview-ui/src/components/Transcript.tsx'), 'utf8');

    expect(source).toContain('const autoScrollPausedRef = useRef(false)');
    expect(source).toContain('const scrollLockRef = useRef<{ top: number; until: number } | null>(null)');
    expect(source).toContain('const pauseAutoScrollForUserAction = useCallback(() => {');
    expect(source).toContain('autoScrollPausedRef.current = true');
    expect(source).toContain('scrollLockRef.current = { top: el.scrollTop, until: Date.now() + 450 }');
    expect(source).toContain('if (autoScrollPausedRef.current) {');
    expect(source).toContain('return');
    expect(source).toContain('el.addEventListener(\'scroll\', onScroll)');
    expect(source).toContain('getTaskEntryOpenKey(item, index)');
    expect(source).toContain('open={openTaskKeys.has(taskKey)}');
    expect(source).toContain('onToggle={() => toggleTask(taskKey)}');
    expect(source).toContain('next.delete(key)');
    expect(source).not.toContain('setOpenTaskIndex');
    expect(source).not.toContain('userClosedActiveTaskRef');
  });

  it('does not classify ordinary tool output as a subtask error', () => {
    const source = readFileSync(join(root, 'webview-ui/src/components/Transcript.tsx'), 'utf8');

    expect(source).toContain('function pickToolErrorText(value: Record<string, unknown> | null, options: { includeOutput?: boolean } = {})');
    expect(source).toContain('options.includeOutput ? [value.error, value.message, value.stderr, value.output] : [value.error, value.message, value.stderr]');
    expect(source).toContain('pickToolErrorText(raw as Record<string, unknown>, { includeOutput: true })');
  });

  it('styles task states without relying on undefined theme variables', () => {
    const styles = readFileSync(join(root, 'webview-ui/src/styles.css'), 'utf8');

    expect(styles).toContain('.tool-group--subtasks');
    expect(styles).toContain('.subtask-entry.is-running');
    expect(styles).toContain('.subtask-status');
    expect(styles).toContain('.tool-group__line--subtask.is-running .subtask-dot');
    expect(styles).toContain('@keyframes subtask-pulse');
    expect(styles).not.toContain('var(--ui-warning)');
    expect(styles).not.toContain('var(--ui-success)');
  });
});
