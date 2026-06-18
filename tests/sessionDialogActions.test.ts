import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('session dialog actions', () => {
  it('renders an inline delete icon for each deletable session row', () => {
    const source = readFileSync(join(root, 'webview-ui/src/components/dialog/SessionDialog.tsx'), 'utf8');

    expect(source).toContain('className="dialog__itemDelete"');
    expect(source).toContain('aria-label={`Delete ${session.title}`}');
    expect(source).toContain('title="Delete session"');
    expect(source).toContain('event.stopPropagation()');
    expect(source).toContain('onDeleteSessionId(session.id)');
    expect(source).toContain('className="dialog__itemDeleteIcon"');
    expect(source).toContain('tabIndex={selected ? 0 : -1}');
  });

  it('keeps the context menu anchored to the right-clicked session row', () => {
    const source = readFileSync(join(root, 'webview-ui/src/components/dialog/SessionDialog.tsx'), 'utf8');
    const styles = readFileSync(join(root, 'webview-ui/src/styles.css'), 'utf8');

    expect(source).toContain('const dialogRef = useRef<HTMLDivElement | null>(null)');
    expect(source).toContain('const dialogRect = dialogRef.current?.getBoundingClientRect()');
    expect(source).toContain('const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()');
    expect(source).toContain('rect.right - (dialogRect?.left ?? 0) - 12');
    expect(source).toContain('rect.top - (dialogRect?.top ?? 0) + 10');
    expect(source).toContain('className="context-menu context-menu--session"');
    expect(styles).toContain('.context-menu--session');
    expect(styles).toContain('position: absolute;');
  });

  it('formats session timestamps into a readable local date time', () => {
    const source = readFileSync(join(root, 'webview-ui/src/components/dialog/SessionDialog.tsx'), 'utf8');

    expect(source).toContain('function formatSessionUpdated(updated: string)');
    expect(source).toContain("replace('T', ' ')");
    expect(source).toContain("replace(/Z$/, '')");
    expect(source).toContain('formatSessionUpdated(session.updated)');
    expect(source).not.toContain('<span className="dialog__itemMeta">{session.updated}</span>');
  });

  it('styles session rows as compact action rows with a recognizable delete icon', () => {
    const styles = readFileSync(join(root, 'webview-ui/src/styles.css'), 'utf8');

    expect(styles).toContain('.dialog__item--session');
    expect(styles).toContain('grid-template-columns: minmax(0, 1fr) auto;');
    expect(styles).toContain('.dialog__itemMain');
    expect(styles).toContain('.dialog__itemDelete');
    expect(styles).toContain('.dialog__itemDeleteIcon::before');
    expect(styles).toContain('.dialog__itemDeleteIcon::after');
  });
});
