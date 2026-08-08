import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('live run timer lifecycle', () => {
  it('从发送时记录起点，并在完成事件到达时冻结当前 assistant 消息', () => {
    const source = readFileSync(join(root, 'webview-ui/src/App.tsx'), 'utf8');

    expect(source).toContain('const created = Date.now()');
    expect(source).toMatch(/created,\s+role: 'user'/s);
    expect(source).toMatch(/created,\s+role: 'assistant'/s);
    expect(source).toContain('const completedAt = Date.now()');
    expect(source).toContain('completed: completedAt');
    expect(source).toContain("completion.type === 'done' && !assistantMessage.finish ? { finish: 'stop' } : {}");
    expect(source).toContain('localTranscript: completedTranscript');
  });
});
