import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('composer todo panel', () => {
  it('derives the latest todo state from transcript and renders it above the textarea', () => {
    const source = readFileSync(join(root, 'webview-ui/src/App.tsx'), 'utf8');

    expect(source).toContain('function TodoPanel');
    expect(source).toContain('extractLatestTodosFromTranscript(transcript)');
    expect(source).toContain('const activeTodos = useMemo(() => extractLatestTodosFromTranscript(transcript), [transcript])');
    expect(source).toContain('<TodoPanel todos={activeTodos} />');
    expect(source).toContain("${activeTodos.length > 0 ? ' has-todos' : ''}");
    expect(source.indexOf('<TodoPanel todos={activeTodos} />')).toBeLessThan(source.indexOf('<textarea'));
  });

  it('keeps todowrite out of transcript tool output so the composer panel is the single surface', () => {
    const source = readFileSync(join(root, 'webview-ui/src/components/Transcript.tsx'), 'utf8');

    expect(source).toContain("if (part.toolName === 'todowrite') {");
    expect(source).toContain('return null');
    expect(source).not.toContain('function TodoBlock');
  });

  it('styles the todo panel as a compact collapsible composer band', () => {
    const styles = readFileSync(join(root, 'webview-ui/src/styles.css'), 'utf8');

    expect(styles).toContain('.composer-todo');
    expect(styles).toContain('.composer-todo__summary');
    expect(styles).toContain('.composer-todo__item');
    expect(styles).toContain('.composer-todo__mark--active::before');
    expect(styles).toContain('@keyframes composer-todo-pulse');
    expect(styles).toContain('.composer-stack.has-preview.has-todos .composer-stack__preview');
  });
});
