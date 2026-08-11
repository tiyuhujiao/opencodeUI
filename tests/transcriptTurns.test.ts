import { describe, expect, it } from 'vitest';
import type { TranscriptMessage } from '../src/shared/protocol';
import {
  buildTranscriptDisplayBlocks,
  formatTurnDuration,
  resolveTranscriptRunTiming,
  type TranscriptRun
} from '../webview-ui/src/transcriptTurns';

function getRuns(messages: TranscriptMessage[]): TranscriptRun[] {
  return buildTranscriptDisplayBlocks(messages)
    .filter((block) => block.kind === 'run')
    .map((block) => block.run);
}

describe('transcript run timing', () => {
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

  it('把同一用户消息后的多个 assistant 步骤归入一个运行轮次', () => {
    const blocks = buildTranscriptDisplayBlocks(messages);

    expect(blocks.map((block) => block.kind)).toEqual(['message', 'run']);
    const run = getRuns(messages)[0];
    expect(run?.events.map((entry) => entry.message.id)).toEqual([
      'msg_tool_1',
      'msg_tool_2',
      'msg_final'
    ]);
  });

  it('历史轮次从初始用户消息计到最终 assistant 完成时间', () => {
    const run = getRuns(messages)[0];
    if (!run) {
      throw new Error('expected transcript run');
    }

    expect(resolveTranscriptRunTiming(run, { isActive: false, now: 9_999_999 })).toEqual({
      startedAt: 1_000,
      completedAt: 2_036_000,
      elapsedMs: 2_035_000
    });
    expect(formatTurnDuration(2_035_000)).toBe('33m 55s');
  });

  it('运行中跟随当前时间，完成后冻结且忽略之后的 now', () => {
    const run = getRuns(messages)[0];
    if (!run) {
      throw new Error('expected transcript run');
    }

    expect(resolveTranscriptRunTiming(run, { isActive: true, now: 34_000 }).elapsedMs).toBe(33_000);
    expect(resolveTranscriptRunTiming(run, { isActive: false, now: 50_000_000 }).elapsedMs).toBe(2_035_000);
  });

  it('显示秒、分钟与小时且不把运行时间四舍五入到下一秒', () => {
    expect(formatTurnDuration(999)).toBe('<1s');
    expect(formatTurnDuration(1_999)).toBe('1s');
    expect(formatTurnDuration(65_900)).toBe('1m 5s');
    expect(formatTurnDuration(3_665_000)).toBe('1h 1m 5s');
  });

  it('把 Queue 用户消息与前后 assistant 事件保留在同一个有序运行轮次', () => {
    const queuedMessages: TranscriptMessage[] = [
      {
        id: 'msg_user_1',
        created: 1_000,
        role: 'user',
        parts: [{ type: 'text', text: 'start' }]
      },
      {
        id: 'msg_assistant_1',
        created: 1_100,
        completed: 8_000,
        role: 'assistant',
        parts: [{ type: 'tool', toolName: 'bash', status: 'completed', raw: {} }]
      },
      {
        id: 'msg_queue_1',
        created: 3_000,
        role: 'user',
        parts: [{ type: 'text', text: 'also check tests' }]
      },
      {
        id: 'msg_queue_2',
        created: 4_000,
        role: 'user',
        parts: [{ type: 'text', text: 'and report timing' }]
      },
      {
        id: 'msg_assistant_2',
        created: 8_100,
        completed: 12_000,
        finish: 'stop',
        role: 'assistant',
        parts: [{ type: 'text', text: 'done' }]
      }
    ];

    const blocks = buildTranscriptDisplayBlocks(queuedMessages);
    const runs = getRuns(queuedMessages);
    expect(blocks.map((block) => block.kind)).toEqual(['message', 'run']);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.events.map((entry) => entry.message.id)).toEqual([
      'msg_assistant_1',
      'msg_queue_1',
      'msg_queue_2',
      'msg_assistant_2'
    ]);
    expect(resolveTranscriptRunTiming(runs[0]!, { isActive: false, now: 99_000 })).toEqual({
      startedAt: 1_000,
      completedAt: 12_000,
      elapsedMs: 11_000
    });
  });

  it('工具步骤完成后才落库的 Queue 仍属于同一运行轮次', () => {
    const queuedAfterToolCompletion: TranscriptMessage[] = [
      {
        id: 'msg_user_start',
        created: 1_000,
        role: 'user',
        parts: [{ type: 'text', text: 'start' }]
      },
      {
        id: 'msg_tool_step',
        created: 1_100,
        completed: 2_000,
        finish: 'tool-calls',
        role: 'assistant',
        parts: [{ type: 'tool', toolName: 'bash', status: 'completed', raw: {} }]
      },
      {
        id: 'msg_queue_after_tool',
        created: 2_100,
        role: 'user',
        parts: [{ type: 'text', text: 'also check the output' }]
      },
      {
        id: 'msg_final_after_queue',
        created: 2_200,
        completed: 5_000,
        finish: 'stop',
        role: 'assistant',
        parts: [{ type: 'text', text: 'done' }]
      }
    ];

    const runs = getRuns(queuedAfterToolCompletion);
    expect(runs).toHaveLength(1);
    expect(resolveTranscriptRunTiming(runs[0]!, { isActive: false, now: 99_000 })).toEqual({
      startedAt: 1_000,
      completedAt: 5_000,
      elapsedMs: 4_000
    });
  });

  it('assistant 建立前连续落库的 Queue 也按发送顺序归入当前轮次', () => {
    const queuedBeforeAssistant: TranscriptMessage[] = [
      { id: 'user-1', created: 1_000, role: 'user', parts: [{ type: 'text', text: 'start' }] },
      { id: 'queue-1', created: 1_100, role: 'user', parts: [{ type: 'text', text: 'second' }] },
      { id: 'queue-2', created: 1_200, role: 'user', parts: [{ type: 'text', text: 'third' }] },
      {
        id: 'assistant-1',
        created: 1_300,
        completed: 2_000,
        finish: 'stop',
        role: 'assistant',
        parts: [{ type: 'text', text: 'done' }]
      }
    ];

    const runs = getRuns(queuedBeforeAssistant);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.events.map((entry) => entry.message.id)).toEqual(['queue-1', 'queue-2', 'assistant-1']);
  });

  it('空闲后新发起的普通消息会建立新的运行轮次', () => {
    const separateMessages: TranscriptMessage[] = [
      ...messages,
      {
        id: 'msg_user_next',
        created: 2_040_000,
        role: 'user',
        parts: [{ type: 'text', text: 'new turn' }]
      },
      {
        id: 'msg_assistant_next',
        created: 2_040_100,
        completed: 2_043_000,
        finish: 'stop',
        role: 'assistant',
        parts: [{ type: 'text', text: 'new answer' }]
      }
    ];
    const runs = getRuns(separateMessages);

    expect(runs).toHaveLength(2);
    expect(runs.map((run) => run.initialUser.message.id)).toEqual(['msg_user', 'msg_user_next']);
    expect(resolveTranscriptRunTiming(runs[1]!, { isActive: false, now: 99_000 }).startedAt).toBe(2_040_000);
  });
});
