import { describe, expect, it } from 'vitest';
import { exportToTranscript, liveMessagesToTranscript } from '../src/bridge/parsers';

describe('exportToTranscript', () => {
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
