import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({ workspace: {} }), { virtual: true });

import { SidebarProvider } from '../src/webview/SidebarProvider';

function createProvider() {
  return new SidebarProvider(
    { fsPath: '/ext' } as never,
    { get: () => undefined, update: async () => undefined } as never,
    'wsl',
    'wsl'
  );
}

function createWebview(posted: unknown[]) {
  return {
    postMessage: async (message: unknown) => {
      posted.push(message);
      return true;
    }
  };
}

describe('session history message actions', () => {
  it('把显式用户消息锚点提交给 OpenCode revert', async () => {
    const provider = createProvider() as unknown as {
      computeRevertPayload: (sessionId: string, messageId: string) => Promise<{ messageId: string; composerText: string }>;
      getSessionInfoForRead: (sessionId: string) => Promise<{ revert?: { messageID?: string } }>;
      requestServeJson: (pathname: string, init?: { method?: string; body?: string }) => Promise<unknown>;
      handleSessionRevertRequest: (
        webview: ReturnType<typeof createWebview>,
        requestId: string,
        sessionId: string,
        messageId: string
      ) => Promise<void>;
    };
    const posted: unknown[] = [];
    provider.computeRevertPayload = vi.fn(async () => ({
      messageId: 'msg_user_2',
      composerText: 'restore this prompt'
    }));
    provider.getSessionInfoForRead = vi.fn(async () => ({}));
    provider.requestServeJson = vi.fn(async () => ({ revert: { messageID: 'msg_user_2' } }));

    await provider.handleSessionRevertRequest(createWebview(posted), 'request-1', 'ses_parent', 'msg_user_2');

    expect(provider.computeRevertPayload).toHaveBeenCalledWith('ses_parent', 'msg_user_2');
    expect(provider.requestServeJson).toHaveBeenCalledWith(
      '/session/ses_parent/revert',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ messageID: 'msg_user_2' }) })
    );
    expect(posted).toEqual([
      expect.objectContaining({
        type: 'session.revert.response',
        payload: expect.objectContaining({
          changed: true,
          sessionId: 'ses_parent',
          revertMessageId: 'msg_user_2',
          composerText: 'restore this prompt'
        })
      })
    ]);
  });

  it('在指定助手消息处创建分支并返回新会话 ID', async () => {
    const provider = createProvider() as unknown as {
      computeForkBoundaryMessageId: (sessionId: string, messageId: string) => Promise<string | undefined>;
      requestServeJson: (pathname: string, init?: { method?: string; body?: string }) => Promise<unknown>;
      handleSessionForkRequest: (
        webview: ReturnType<typeof createWebview>,
        requestId: string,
        sessionId: string,
        messageId: string
      ) => Promise<void>;
    };
    const posted: unknown[] = [];
    provider.computeForkBoundaryMessageId = vi.fn(async () => 'msg_user_3');
    provider.requestServeJson = vi.fn(async () => ({ id: 'ses_forked' }));

    await provider.handleSessionForkRequest(createWebview(posted), 'request-2', 'ses_parent', 'msg_assistant_2');

    expect(provider.computeForkBoundaryMessageId).toHaveBeenCalledWith('ses_parent', 'msg_assistant_2');
    expect(provider.requestServeJson).toHaveBeenCalledWith(
      '/session/ses_parent/fork',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ messageID: 'msg_user_3' }) })
    );
    expect(posted).toEqual([
      expect.objectContaining({
        type: 'session.fork.response',
        payload: { sourceSessionId: 'ses_parent', sessionId: 'ses_forked' }
      })
    ]);
  });

  it('所选最终回复位于会话末尾时不传截断边界', async () => {
    const provider = createProvider() as unknown as {
      computeForkBoundaryMessageId: (sessionId: string, messageId: string) => Promise<string | undefined>;
      requestServeJson: (pathname: string, init?: { method?: string; body?: string }) => Promise<unknown>;
      handleSessionForkRequest: (
        webview: ReturnType<typeof createWebview>,
        requestId: string,
        sessionId: string,
        messageId: string
      ) => Promise<void>;
    };
    const posted: unknown[] = [];
    provider.computeForkBoundaryMessageId = vi.fn(async () => undefined);
    provider.requestServeJson = vi.fn(async () => ({ id: 'ses_latest_fork' }));

    await provider.handleSessionForkRequest(createWebview(posted), 'request-latest', 'ses_parent', 'msg_final');

    expect(provider.requestServeJson).toHaveBeenCalledWith('/session/ses_parent/fork', { method: 'POST' });
    expect(posted).toEqual([
      expect.objectContaining({
        type: 'session.fork.response',
        payload: { sourceSessionId: 'ses_parent', sessionId: 'ses_latest_fork' }
      })
    ]);
  });

  it('使用所选最终回复的下一条消息作为 OpenCode Fork 排他边界', async () => {
    const provider = createProvider() as unknown as {
      getSessionExportData: (sessionId: string) => Promise<{
        data: { messages: Array<{ info: unknown; parts: unknown[] }> };
      }>;
      computeForkBoundaryMessageId: (sessionId: string, messageId: string) => Promise<string | undefined>;
    };
    provider.getSessionExportData = vi.fn(async () => ({
      data: {
        messages: [
          { info: { id: 'msg_user_1', role: 'user' }, parts: [{ type: 'text', text: 'first prompt' }] },
          {
            info: { id: 'msg_tool_step', role: 'assistant', finish: 'tool-calls' },
            parts: [{ type: 'tool', tool: 'read', state: { status: 'completed' } }]
          },
          {
            info: { id: 'msg_final_1', role: 'assistant', finish: 'stop' },
            parts: [{ type: 'text', text: 'first final response' }]
          },
          { info: { id: 'msg_user_2', role: 'user' }, parts: [{ type: 'text', text: 'second prompt' }] },
          {
            info: { id: 'msg_unclassified', role: 'assistant' },
            parts: [{ type: 'text', text: 'missing completion metadata' }]
          },
          {
            info: { id: 'msg_final_2', role: 'assistant', finish: 'stop' },
            parts: [{ type: 'text', text: 'second final response' }]
          }
        ]
      }
    }));

    await expect(provider.computeForkBoundaryMessageId('ses_parent', 'msg_tool_step')).rejects.toThrow(
      'Only a completed assistant response can be forked.'
    );
    await expect(provider.computeForkBoundaryMessageId('ses_parent', 'msg_unclassified')).rejects.toThrow(
      'Only a completed assistant response can be forked.'
    );
    await expect(provider.computeForkBoundaryMessageId('ses_parent', 'msg_final_1')).resolves.toBe('msg_user_2');
    await expect(provider.computeForkBoundaryMessageId('ses_parent', 'msg_final_2')).resolves.toBeUndefined();
  });

  it('用 Lucide 图标暴露消息操作，并让 Timeline 项可直接回退', () => {
    const transcript = readFileSync(join(process.cwd(), 'webview-ui/src/components/Transcript.tsx'), 'utf8');
    const timeline = readFileSync(join(process.cwd(), 'webview-ui/src/components/dialog/TimelineDialog.tsx'), 'utf8');
    const app = readFileSync(join(process.cwd(), 'webview-ui/src/App.tsx'), 'utf8');
    const styles = readFileSync(join(process.cwd(), 'webview-ui/src/styles.css'), 'utf8');

    expect(transcript).toContain("import { Check, ChevronRight, Copy, GitFork, LoaderCircle, Undo2 } from 'lucide-react'");
    expect(transcript).toContain('className={`msg-stack msg-stack--${message.role}`}');
    expect(transcript).toContain('className={`msg__actions msg__actions--${message.role}`}');
    expect(transcript).toContain("title={t('Undo to this message')}");
    expect(transcript).toContain("title={t('Fork conversation')}");
    expect(transcript).toContain("title={t(copied ? 'Copied' : 'Copy response')}");
    expect(transcript).toContain('&& (finalResponseOverride ?? isFinalAssistantResponse(message))');
    expect(transcript).toContain("finalResponseOverride={item.contentMode === 'final'}");
    expect(transcript).toContain("const canFork = isFinalResponse && contentMode !== 'process'");
    expect(timeline).toContain('onClick={() => onRevert(item.messageId)}');
    expect(timeline).toContain("import { LoaderCircle, Undo2 } from 'lucide-react'");
    expect(app).toContain("type: 'session.revert'");
    expect(app).toContain("type: 'session.fork'");
    expect(app).toContain('selectSession(message.payload.sessionId)');
    const messageArticleStart = transcript.indexOf('className={`msg msg--${message.role}');
    const messageArticleEnd = transcript.indexOf('</article>', messageArticleStart);
    const messageActions = transcript.indexOf('className={`msg__actions', messageArticleStart);
    expect(messageArticleStart).toBeGreaterThanOrEqual(0);
    expect(messageArticleEnd).toBeGreaterThan(messageArticleStart);
    expect(messageActions).toBeGreaterThan(messageArticleEnd);
    expect(transcript).toContain('<Undo2 size={12}');
    expect(transcript).toContain('<Copy size={12}');
    expect(transcript).toContain('<GitFork size={12}');
    expect(styles).toContain('.msg-stack--user');
    expect(styles).toContain('.msg__actions--assistant');
    expect(styles).toContain('.msg__actions--user');
    expect(styles).toContain('width: 1.25rem;');
    expect(styles).toContain('.timeline-item__action');
  });
});
