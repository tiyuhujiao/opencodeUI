import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { computeAnchoredScrollTop } from '../webview-ui/src/transcriptScroll';

describe('anchored transcript scrolling', () => {
  it('新一轮回复仍在视口内时保持用户消息贴顶', () => {
    expect(computeAnchoredScrollTop({
      anchorTop: 420,
      contentBottom: 760,
      clientHeight: 520,
      maxScrollTop: 900
    })).toBe(420);
  });

  it('回复超过视口后只滚动到足以看见最新输出的位置', () => {
    expect(computeAnchoredScrollTop({
      anchorTop: 420,
      contentBottom: 1120,
      clientHeight: 520,
      maxScrollTop: 900
    })).toBe(620);
  });

  it('Transcript 使用最后一条用户消息和运行占位空间建立锚点', () => {
    const source = readFileSync('webview-ui/src/components/Transcript.tsx', 'utf8');
    expect(source).toContain("querySelectorAll<HTMLElement>(':scope > .msg-row--user')");
    expect(source).toContain('computeAnchoredScrollTop');
    expect(source).toContain('transcript__run-spacer');
  });
});
