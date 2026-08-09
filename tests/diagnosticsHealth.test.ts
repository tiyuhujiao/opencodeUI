import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('authoritative diagnostics health', () => {
  it('使用 OpenCode global health、重试与可见状态定时刷新', () => {
    const provider = readFileSync(join(process.cwd(), 'src/webview/SidebarProvider.ts'), 'utf8');
    const app = readFileSync(join(process.cwd(), 'webview-ui/src/App.tsx'), 'utf8');
    expect(provider).toContain('"/global/health"');
    expect(provider).toContain('for (let attempt = 0; attempt < 2; attempt += 1)');
    expect(app).toContain("document.visibilityState === 'visible'");
    expect(app).toContain('window.setInterval(refresh, 30_000)');
    expect(app).toContain('const states = Object.values(selfcheck).map((entry) => entry.state)');
    expect(app).toContain('opencode: {selfcheck.opencode.state}');
  });
});
