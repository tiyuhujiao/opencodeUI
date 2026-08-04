import { describe, expect, it } from 'vitest';
import type { RunStreamEvent, SessionSummary, TranscriptMessage } from '../src/shared/protocol';
import {
  applyRunEventToTranscript,
  mergeLocalImageParts,
  preserveContextUsage,
  upsertPendingSessionSummary
} from '../webview-ui/src/transcriptState';

describe('webview transcript state helpers', () => {
  it('keeps an existing session title when a new prompt starts inside that session', () => {
    const current: SessionSummary[] = [
      { id: 'session-1', title: 'Stable project summary', updated: '2026-06-08T10:00:00.000Z' }
    ];

    const next = upsertPendingSessionSummary(
      current,
      { id: 'session-1', title: 'Second prompt text should not flash', updated: '2026-06-08T10:05:00.000Z' },
      { startedNewSession: false }
    );

    expect(next).toBe(current);
    expect(next[0]?.title).toBe('Stable project summary');
  });

  it('adds a pending title while a brand-new session waits for the session list refresh', () => {
    const current: SessionSummary[] = [
      { id: 'session-1', title: 'Stable project summary', updated: '2026-06-08T10:00:00.000Z' }
    ];

    const next = upsertPendingSessionSummary(
      current,
      { id: 'session-2', title: 'Initial prompt title', updated: '2026-06-08T10:06:00.000Z' },
      { startedNewSession: true }
    );

    expect(next).not.toBe(current);
    expect(next[0]).toMatchObject({ id: 'session-2', title: 'Initial prompt title' });
  });
  it('追加文本增量并过滤低信号 step 事件', () => {
    const base: TranscriptMessage[] = [
      { role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      { role: 'assistant', parts: [] }
    ];

    const textEvent: RunStreamEvent = { type: 'part', part: { type: 'text', text: 'hello' } };
    const stepEvent: RunStreamEvent = {
      type: 'part',
      part: {
        type: 'tool',
        toolName: 'status',
        status: 'running',
        raw: { type: 'step_start' }
      }
    };

    const streamed = applyRunEventToTranscript(base, textEvent, 1);
    expect(streamed[1]?.parts).toEqual([{ type: 'text', text: 'hello' }]);
    expect(applyRunEventToTranscript(streamed, stepEvent, 1)).toBe(streamed);
  });

  it('导出 transcript 未返回图片时保留本地用户图片 part', () => {
    const local: TranscriptMessage[] = [
      {
        role: 'user',
        parts: [
          { type: 'text', text: 'look' },
          { type: 'image', src: 'blob:image', alt: 'pasted' }
        ]
      }
    ];
    const exported: TranscriptMessage[] = [
      {
        role: 'user',
        parts: [{ type: 'text', text: 'look' }]
      }
    ];

    expect(mergeLocalImageParts(local, exported)[0]?.parts).toEqual(local[0]?.parts);
  });

  it('updates the same task tool part instead of appending duplicate subtask rows', () => {
    const base: TranscriptMessage[] = [
      { role: 'user', parts: [{ type: 'text', text: 'analyze' }] },
      { role: 'assistant', parts: [] }
    ];

    const running: RunStreamEvent = {
      type: 'part',
      part: {
        type: 'tool',
        toolName: 'task',
        status: 'running',
        raw: {
          part: {
            id: 'task-part-1',
            type: 'tool',
            tool: 'task',
            state: {
              status: 'running',
              input: { description: 'Deep code quality analysis' },
              output: ''
            }
          }
        }
      }
    };
    const completed: RunStreamEvent = {
      type: 'part',
      part: {
        type: 'tool',
        toolName: 'task',
        status: 'completed',
        raw: {
          part: {
            id: 'task-part-1',
            type: 'tool',
            tool: 'task',
            state: {
              status: 'completed',
              input: { description: 'Deep code quality analysis' },
              output: 'finished'
            }
          }
        }
      }
    };

    const streamed = applyRunEventToTranscript(base, running, 1);
    const updated = applyRunEventToTranscript(streamed, completed, 1);

    expect(updated[1]?.parts).toHaveLength(1);
    expect(updated[1]?.parts[0]).toMatchObject({
      type: 'tool',
      toolName: 'task',
      status: 'completed'
    });
  });

  it('把实时 context 用量写入当前 assistant 消息且不改变正文', () => {
    const base: TranscriptMessage[] = [
      { role: 'user', parts: [{ type: 'text', text: 'hello' }] },
      { role: 'assistant', parts: [{ type: 'text', text: 'world' }] }
    ];

    const updated = applyRunEventToTranscript(base, {
      type: 'context.usage',
      usage: { usedTokens: 4096, model: 'cpa/gpt-5' }
    }, 1);

    expect(updated[1]).toEqual({
      role: 'assistant',
      parts: [{ type: 'text', text: 'world' }],
      contextUsage: { usedTokens: 4096, model: 'cpa/gpt-5' }
    });
  });

  it('新一轮的临时零值不会覆盖上一轮有效 context 用量', () => {
    const base: TranscriptMessage[] = [
      { role: 'assistant', parts: [], contextUsage: { usedTokens: 4096, model: 'cpa/gpt-5' } },
      { role: 'user', parts: [{ type: 'text', text: 'continue' }] },
      { role: 'assistant', parts: [] }
    ];

    const updated = applyRunEventToTranscript(base, {
      type: 'context.usage',
      usage: { usedTokens: 0, model: 'cpa/gpt-5' }
    }, 2);

    expect(updated[2]?.contextUsage).toEqual({ usedTokens: 4096, model: 'cpa/gpt-5' });
  });

  it('空会话仍允许以零值初始化 context 圆环', () => {
    expect(preserveContextUsage(undefined, { usedTokens: 0, model: 'cpa/gpt-5' }))
      .toEqual({ usedTokens: 0, model: 'cpa/gpt-5' });
  });
});
