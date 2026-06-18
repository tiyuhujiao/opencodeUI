import { describe, expect, it } from 'vitest';
import { exportToTranscript } from '../src/bridge/parsers';

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
});
