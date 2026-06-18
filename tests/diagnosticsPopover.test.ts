import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('diagnostics popover', () => {
  it('moves diagnostics out of the bottom panel and into a topbar trigger', () => {
    const source = readFileSync(join(root, 'webview-ui/src/App.tsx'), 'utf8');

    expect(source).toContain("const [debugPopoverOpen, setDebugPopoverOpen] = useState(false)");
    expect(source).toContain("className=\"topbar__diagnostics\"");
    expect(source).toContain("className={diagnosticsTriggerClass}");
    expect(source).toContain("className=\"diagnostics-popover\"");
    expect(source).toContain("aria-controls=\"diagnostics-popover\"");
    expect(source).not.toContain('<details className="debug-panel"');
    expect(source).not.toContain('debug-panel__summary');
  });

  it('keeps /debug as the command entry and opens the popover when capture is enabled', () => {
    const source = readFileSync(join(root, 'webview-ui/src/App.tsx'), 'utf8');

    expect(source).toContain("name: '/debug'");
    expect(source).toContain("hint: 'Toggle diagnostics panel'");
    expect(source).toContain('setDebugEnabled((current) => {');
    expect(source).toContain('setDebugPopoverOpen(true)');
    expect(source).toContain("setRunStatus('Usage: /debug on|off|toggle')");
  });

  it('styles the diagnostics trigger, state colors, and floating panel', () => {
    const styles = readFileSync(join(root, 'webview-ui/src/styles.css'), 'utf8');

    expect(styles).toContain('.diagnostics-trigger');
    expect(styles).toContain('.diagnostics-trigger--pending');
    expect(styles).toContain('.diagnostics-trigger--ok');
    expect(styles).toContain('.diagnostics-trigger--error');
    expect(styles).toContain('.diagnostics-trigger--capturing');
    expect(styles).toContain('.diagnostics-popover');
    expect(styles).toContain('width: min(24rem, calc(100vw - 2rem));');
    expect(styles).toContain('width: calc(100vw - 2rem);');
    expect(styles).not.toContain('.debug-panel {');
    expect(styles).not.toContain('.debug-panel__summary');
  });
});
