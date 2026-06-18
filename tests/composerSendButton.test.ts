import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('composer send button', () => {
  it('switches from send to stop while a run is active', () => {
    const source = readFileSync(join(root, 'webview-ui/src/App.tsx'), 'utf8');

    expect(source).toContain("className={`composer-stack__send${isRunning ? ' composer-stack__send--running' : ''}`}");
    expect(source).toContain('onClick={isRunning ? stopRun : startRun}');
    expect(source).toContain('disabled={!isRunning && (!selectedModel || !selectedAgent || composerValue.trim().length === 0)}');
    expect(source).toContain("aria-label={isRunning ? 'stop' : 'send'}");
    expect(source).toContain('className="composer-stack__send-arrow"');
    expect(source).toContain('className="composer-stack__stop-icon"');
  });

  it('keeps the send and stop glyphs visually stable', () => {
    const styles = readFileSync(join(root, 'webview-ui/src/styles.css'), 'utf8');

    expect(styles).toContain('width: 2.5rem;');
    expect(styles).toContain('height: 2.5rem;');
    expect(styles).toContain('.composer-stack__send-arrow');
    expect(styles).toContain('font-size: 1.62rem;');
    expect(styles).toContain('scaleX(1.28)');
    expect(styles).toContain('.composer-stack__send--running');
    expect(styles).toContain('.composer-stack__stop-icon');
    expect(styles).toContain('animation: composer-stop-pulse');
    expect(styles).toContain('@keyframes composer-stop-pulse');
  });
});
