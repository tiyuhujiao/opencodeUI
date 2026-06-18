import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('composer layout', () => {
  it('anchors the composer at the bottom of the webview after diagnostics moved to the topbar', () => {
    const styles = readFileSync(join(root, 'webview-ui/src/styles.css'), 'utf8');
    const composerStackBlock = styles.slice(styles.indexOf('.composer-stack {'), styles.indexOf('.command-menu {'));

    expect(styles).toContain('height: 100vh;');
    expect(styles).toContain('display: flex;');
    expect(styles).toContain('flex-direction: column;');
    expect(styles).toContain('overflow: hidden;');
    expect(styles).toContain('flex: 1 1 auto;');
    expect(styles).toContain('grid-template-rows: minmax(0, 1fr) auto;');
    expect(styles).toContain('height: auto;');
    expect(composerStackBlock).toContain('position: relative;');
    expect(composerStackBlock).not.toContain('position: sticky;');
    expect(styles).not.toContain('calc(100vh - 250px)');
  });

  it('keeps todo and pasted-image affordances attached to the composer above the textarea', () => {
    const source = readFileSync(join(root, 'webview-ui/src/App.tsx'), 'utf8');

    expect(source.indexOf("className={`composer-stack${pastedImage ? ' has-preview' : ''}${activeTodos.length > 0 ? ' has-todos' : ''}`")).toBeGreaterThan(-1);
    expect(source.indexOf('className="composer-stack__preview"')).toBeLessThan(source.indexOf('<textarea'));
    expect(source.indexOf('<TodoPanel todos={activeTodos} />')).toBeLessThan(source.indexOf('<textarea'));
  });
});
