import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  computeAnchoredScrollTop,
  computeRunSpacerHeight,
  interpolateFastScrollTop,
  TURN_ANCHOR_SCROLL_DURATION_MS,
  TURN_ANCHOR_TOP_GAP
} from '../webview-ui/src/transcriptScroll';

describe('anchored transcript scrolling', () => {
  it('新一轮回复仍在视口内时让用户消息在顶部保留间距', () => {
    expect(computeAnchoredScrollTop({
      anchorTop: 420,
      contentBottom: 760,
      clientHeight: 520,
      maxScrollTop: 900
    })).toBe(400);
    expect(TURN_ANCHOR_TOP_GAP).toBe(20);
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
    expect(source).toContain('animateToTurnAnchor');
    expect(source).toContain('interpolateFastScrollTop');
    expect(source).toContain("matchMedia('(prefers-reduced-motion: reduce)')");
    expect(source).toContain('transcript__run-spacer');
  });

  it('使用短促 ease-out 动画而不是瞬间跳到锚点', () => {
    expect(TURN_ANCHOR_SCROLL_DURATION_MS).toBe(180);
    expect(interpolateFastScrollTop(100, 500, 0)).toBe(100);
    expect(interpolateFastScrollTop(100, 500, 90)).toBe(450);
    expect(interpolateFastScrollTop(100, 500, 180)).toBe(500);
  });

  it('按真实视口和用户消息高度计算足够的尾部占位空间', () => {
    expect(computeRunSpacerHeight({
      clientHeight: 558,
      anchorHeight: 38,
      rowGap: 18.4,
      paddingBottom: 20
    })).toBe(482);

    expect(computeRunSpacerHeight({
      clientHeight: 320,
      anchorHeight: 400,
      rowGap: 12,
      paddingBottom: 16
    })).toBe(0);
  });
});
