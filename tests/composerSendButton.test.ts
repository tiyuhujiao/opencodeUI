import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('composer send button', () => {
  it('switches from send to stop while a run is active', () => {
    const source = readFileSync(join(root, 'webview-ui/src/App.tsx'), 'utf8');

    expect(source).toContain("className={`composer-stack__send${isRunning ? ' composer-stack__send--running' : ''}`}");
    expect(source).toContain('onClick={isRunning ? stopRun : submitComposer}');
    expect(source).toContain("if (commandState.open) {");
    expect(source).toContain('runCommand(selected?.name ?? commandState.query, commandState.args)');
    expect(source).toContain('disabled={!isRunning && (composerValue.trim().length === 0 || (!commandState.open && (!selectedModel || !selectedAgent)))}');
    expect(source).toContain("aria-label={isRunning ? 'stop' : 'send'}");
    expect(source).toContain('className="composer-stack__send-arrow"');
    expect(source).toContain('className="composer-stack__stop-icon"');
  });

  it('keeps the send and stop glyphs visually stable', () => {
    const source = readFileSync(join(root, 'webview-ui/src/App.tsx'), 'utf8');
    const styles = readFileSync(join(root, 'webview-ui/src/styles.css'), 'utf8');
    const codexStyles = styles.slice(styles.indexOf('/* Codex-like editor shell'));

    expect(source).toContain('<ArrowUp size={19} strokeWidth={2.4} />');
    expect(source).toContain('<Square size={11} fill="currentColor" strokeWidth={0} />');
    expect(codexStyles).toContain('width: 2rem;');
    expect(codexStyles).toContain('height: 2rem;');
    expect(codexStyles).toContain('border-radius: 999px;');
    expect(codexStyles).toContain('.composer-stack__send-arrow,');
    expect(codexStyles).toContain('.composer-stack__stop-icon');
    expect(codexStyles).toContain('transform: none;');
    expect(codexStyles).toContain('animation: none;');
    expect(codexStyles).toContain('background: transparent;');
    expect(codexStyles).toContain('.composer-stack__stop-icon svg');
    expect(codexStyles).toContain('flex: 0 0 11px;');
  });
});
