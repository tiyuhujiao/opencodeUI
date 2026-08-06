import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  defaultSessionExportFilename,
  formatSessionMarkdown,
  resolveSessionExportPath
} from '../src/sessionMarkdown';

describe('session markdown export', () => {
  it('按 OpenCode TUI 的结构导出标题、消息、thinking、工具和助手元数据', () => {
    const markdown = formatSessionMarkdown({
      sessionId: 'ses_1234567890',
      sessionInfo: {
        title: 'Export example',
        time: { created: 1_700_000_000_000, updated: 1_700_000_010_000 }
      },
      exportPayload: {
        info: undefined,
        messages: [
          {
            info: { role: 'user' },
            parts: [{ type: 'text', text: 'Hello' }]
          },
          {
            info: {
              role: 'assistant',
              agent: 'build',
              providerID: 'openai',
              modelID: 'gpt-5',
              time: { created: 10_000, completed: 12_500 }
            },
            parts: [
              { type: 'reasoning', text: 'Check the request.' },
              {
                type: 'tool',
                tool: 'read',
                state: { status: 'completed', input: { filePath: 'src/app.ts' }, output: 'done' }
              },
              { type: 'text', text: 'Finished.' }
            ]
          }
        ]
      },
      options: {
        includeThinking: true,
        includeToolDetails: true,
        includeAssistantMetadata: true
      },
      modelNames: new Map([['openai/gpt-5', 'GPT-5']])
    });

    expect(markdown).toContain('# Export example');
    expect(markdown).toContain('**Session ID:** ses_1234567890');
    expect(markdown).toContain('## User\n\nHello');
    expect(markdown).toContain('## Assistant (Build · GPT-5 · 2.5s)');
    expect(markdown).toContain('_Thinking:_\n\nCheck the request.');
    expect(markdown).toContain('**Tool: read**');
    expect(markdown).toContain('**Input:**\n```json');
    expect(markdown).toContain('**Output:**\n```\ndone');
  });

  it('关闭详情选项时不泄露 thinking 和工具输入输出', () => {
    const markdown = formatSessionMarkdown({
      sessionId: 'ses_test',
      exportPayload: {
        info: { title: 'Minimal' },
        messages: [{
          info: { role: 'assistant' },
          parts: [
            { type: 'reasoning', text: 'private thought' },
            { type: 'tool', tool: 'bash', state: { status: 'completed', input: { command: 'pwd' }, output: 'secret' } }
          ]
        }]
      },
      options: {
        includeThinking: false,
        includeToolDetails: false,
        includeAssistantMetadata: false
      }
    });

    expect(markdown).toContain('## Assistant');
    expect(markdown).toContain('**Tool: bash**');
    expect(markdown).not.toContain('private thought');
    expect(markdown).not.toContain('pwd');
    expect(markdown).not.toContain('secret');
  });

  it('生成上游默认文件名并拒绝写出工作区', () => {
    const workspaceRoot = path.resolve('workspace');
    expect(defaultSessionExportFilename('ses_1234567890')).toBe('session-ses_1234.md');
    expect(resolveSessionExportPath(workspaceRoot, path.join('exports', 'session-1')))
      .toBe(path.join(workspaceRoot, 'exports', 'session-1.md'));
    expect(() => resolveSessionExportPath(workspaceRoot, path.join('..', 'outside.md'))).toThrow(/工作区/);
  });

  it('没有 provider catalog 时与上游一致回退到原始 model id', () => {
    const markdown = formatSessionMarkdown({
      sessionId: 'ses_test',
      exportPayload: {
        messages: [{
          info: {
            role: 'assistant',
            agent: 'build',
            providerID: 'openai',
            modelID: 'gpt-5',
            time: { created: 1, completed: 1001 }
          },
          parts: [{ type: 'text', text: 'Done' }]
        }]
      },
      options: {
        includeThinking: true,
        includeToolDetails: true,
        includeAssistantMetadata: true
      }
    });

    expect(markdown).toContain('## Assistant (Build · gpt-5 · 1.0s)');
    expect(markdown).not.toContain('openai/gpt-5');
  });
});
