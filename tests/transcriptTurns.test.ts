import { describe, expect, it } from 'vitest';
import type { TranscriptMessage } from '../src/shared/protocol';
import {
  buildTranscriptDisplayBlocks,
  formatTurnDuration,
  resolveAssistantTurnTiming
} from '../webview-ui/src/transcriptTurns';

describe('transcript turn timing', () => {
  const messages: TranscriptMessage[] = [
    {
      id: 'msg_user',
      created: 1_000,
      role: 'user',
      parts: [{ type: 'text', text: 'inspect the project' }]
    },
    {
      id: 'msg_tool_1',
      created: 1_021,
      completed: 6_351,
      finish: 'tool-calls',
      role: 'assistant',
      parts: [{ type: 'tool', toolName: 'read', status: 'completed', raw: {} }]
    },
    {
      id: 'msg_tool_2',
      created: 6_355,
      completed: 10_846,
      finish: 'tool-calls',
      role: 'assistant',
      parts: [{ type: 'reasoning', text: 'checking another file' }]
    },
    {
      id: 'msg_final',
      created: 10_849,
      completed: 2_036_000,
      finish: 'stop',
      role: 'assistant',
      parts: [{ type: 'text', text: 'done' }]
    }
  ];

  it('把同一用户消息后的多个 assistant 步骤归入一个计时轮次', () => {
    const blocks = buildTranscriptDisplayBlocks(messages);

    expect(blocks.map((block) => block.kind)).toEqual(['message', 'assistant-turn']);
    const turnBlock = blocks[1];
    expect(turnBlock?.kind).toBe('assistant-turn');
    if (turnBlock?.kind !== 'assistant-turn') {
      throw new Error('expected assistant turn');
    }
    expect(turnBlock.turn.responses.map((entry) => entry.message.id)).toEqual([
      'msg_tool_1',
      'msg_tool_2',
      'msg_final'
    ]);
  });

  it('历史轮次从用户发出时间计到最终 assistant 完成时间', () => {
    const blocks = buildTranscriptDisplayBlocks(messages);
    const turnBlock = blocks[1];
    if (turnBlock?.kind !== 'assistant-turn') {
      throw new Error('expected assistant turn');
    }

    expect(resolveAssistantTurnTiming(turnBlock.turn, { isActive: false, now: 9_999_999 })).toEqual({
      startedAt: 1_000,
      completedAt: 2_036_000,
      elapsedMs: 2_035_000
    });
    expect(formatTurnDuration(2_035_000)).toBe('33m 55s');
  });

  it('运行中跟随当前时间，完成后冻结且忽略之后的 now', () => {
    const blocks = buildTranscriptDisplayBlocks(messages);
    const turnBlock = blocks[1];
    if (turnBlock?.kind !== 'assistant-turn') {
      throw new Error('expected assistant turn');
    }

    expect(resolveAssistantTurnTiming(turnBlock.turn, { isActive: true, now: 34_000 }).elapsedMs).toBe(33_000);
    expect(resolveAssistantTurnTiming(turnBlock.turn, { isActive: false, now: 50_000_000 }).elapsedMs).toBe(2_035_000);
  });

  it('显示秒、分钟与小时且不把运行时间四舍五入到下一秒', () => {
    expect(formatTurnDuration(999)).toBe('<1s');
    expect(formatTurnDuration(1_999)).toBe('1s');
    expect(formatTurnDuration(65_900)).toBe('1m 5s');
    expect(formatTurnDuration(3_665_000)).toBe('1h 1m 5s');
  });
});
