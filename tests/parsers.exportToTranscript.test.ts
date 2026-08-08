import { describe, expect, it } from 'vitest';
import { exportToTranscript, liveMessagesToTranscript } from '../src/bridge/parsers';

describe('exportToTranscript', () => {
  it('保留 OpenCode 消息 ID、创建时间与完成时间作为历史操作和计时锚点', () => {
    const transcript = exportToTranscript({
      info: {},
      messages: [
        {
          info: { id: 'msg_user_1', role: 'user', time: { created: 1_786_154_400_000 } },
          parts: [{ type: 'text', text: 'checkpoint' }]
        },
        {
          info: {
            id: 'msg_assistant_1',
            role: 'assistant',
            time: {
              created: '2026-08-08T06:00:00.000Z',
              completed: '2026-08-08T06:01:02.855Z'
            }
          },
          parts: [{ type: 'text', text: 'done' }]
        }
      ]
    });

    expect(transcript).toEqual([
      {
        id: 'msg_user_1',
        created: 1_786_154_400_000,
        role: 'user',
        parts: [{ type: 'text', text: 'checkpoint' }]
      },
      {
        id: 'msg_assistant_1',
        created: Date.parse('2026-08-08T06:00:00.000Z'),
        completed: Date.parse('2026-08-08T06:01:02.855Z'),
        role: 'assistant',
        parts: [{ type: 'text', text: 'done' }]
      }
    ]);
  });

  it('将 text/tool/unknown parts 映射为 transcript 消息', () => {
    const transcript = exportToTranscript({
      info: {},
      messages: [
        {
          info: { role: 'user' },
          parts: [{ type: 'text', text: 'hello **world**' }]
        },
        {
          info: { role: 'assistant' },
          parts: [
            { type: 'tool_call', toolName: 'read', status: 'ok', output: { lines: 2 } },
            { foo: 'bar' }
          ]
        }
      ]
    });

    expect(transcript).toEqual([
      {
        role: 'user',
        parts: [{ type: 'text', text: 'hello **world**' }]
      },
      {
        role: 'assistant',
        parts: [
          {
            type: 'tool',
            toolName: 'read',
            status: 'ok',
            raw: { type: 'tool_call', toolName: 'read', status: 'ok', output: { lines: 2 } }
          },
          {
            type: 'unknown',
            raw: { foo: 'bar' }
          }
        ]
      }
    ]);
  });

  it('保留 assistant 完成原因以区分工具步骤与最终回复', () => {
    const transcript = exportToTranscript({
      info: {},
      messages: [
        {
          info: { id: 'msg_tool_step', role: 'assistant', finish: 'tool-calls' },
          parts: [{ type: 'tool', tool: 'read', state: { status: 'completed' } }]
        },
        {
          info: { id: 'msg_final', role: 'assistant', finish: 'stop' },
          parts: [{ type: 'text', text: 'final response' }]
        }
      ]
    });

    expect(transcript.map((message) => ({ id: message.id, finish: message.finish }))).toEqual([
      { id: 'msg_tool_step', finish: 'tool-calls' },
      { id: 'msg_final', finish: 'stop' }
    ]);
  });

  it('未知 role 映射为 unknown', () => {
    const transcript = exportToTranscript({
      info: {},
      messages: [
        {
          info: { role: 'system' },
          parts: [{ type: 'text', text: 'meta' }]
        }
      ]
    });

    expect(transcript[0]?.role).toBe('unknown');
  });

  it('从历史 assistant 消息恢复真实 context token 用量与模型', () => {
    const transcript = exportToTranscript({
      info: {},
      messages: [{
        info: {
          role: 'assistant',
          providerID: 'cpa',
          modelID: 'gpt-5',
          tokens: {
            input: 1200,
            output: 300,
            cache: { read: 800, write: 50 }
          }
        },
        parts: []
      }]
    });

    expect(transcript[0]?.contextUsage).toEqual({
      usedTokens: 2000,
      model: 'cpa/gpt-5'
    });
  });

  it('把实时 session message 接口转换为子任务 transcript', () => {
    expect(liveMessagesToTranscript([
      {
        info: { role: 'user' },
        parts: [{ type: 'text', text: 'inspect the parser' }]
      },
      {
        info: {
          role: 'assistant',
          providerID: 'openai',
          modelID: 'gpt-5',
          tokens: { input: 120, cache: { read: 30 } }
        },
        parts: [{ type: 'text', text: 'done' }]
      }
    ])).toEqual([
      { role: 'user', parts: [{ type: 'text', text: 'inspect the parser' }] },
      {
        role: 'assistant',
        parts: [{ type: 'text', text: 'done' }],
        contextUsage: { usedTokens: 150, model: 'openai/gpt-5' }
      }
    ]);
  });
});
