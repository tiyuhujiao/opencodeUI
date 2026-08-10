import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({ workspace: {} }), { virtual: true });

import type { RunStreamEvent, TranscriptMessage } from '../src/shared/protocol';
import { SidebarProvider } from '../src/webview/SidebarProvider';
import type { QueuedPromptEntry } from '../src/webview/promptQueue';

type FakeWebview = {
  postMessage: (message: unknown) => Thenable<boolean>;
};

type TestRun = {
  requestId: string;
  revision: number;
  controller: AbortController;
  eventAbort: AbortController;
  startedAt: number;
  promptText: string;
  placeholderTitle: string;
  startedNewSession: boolean;
  recoveryTranscript: TranscriptMessage[];
  recoveryAssistantIndex: number;
  queue: QueuedPromptEntry[];
  sessionId?: string;
  pendingPermission?: {
    type: 'permission';
    permissionId: string;
    sessionId: string;
    toolName: string;
    patterns: string[];
    message?: string;
  };
};

type TestProvider = {
  currentRun?: TestRun;
  lastTerminalRun?: {
    requestId: string;
    outcome: 'done' | 'stopped' | 'failed';
    completedAt: number;
    transcript: TranscriptMessage[];
  };
  runEventWebview?: FakeWebview;
  getActiveRunSnapshot: () => {
    transcript: TranscriptMessage[];
    pendingPermission?: { patterns: string[] };
  } | undefined;
  postRunSnapshot: (webview: FakeWebview) => void;
  respondRunEvent: (webview: FakeWebview, requestId: string, event: RunStreamEvent) => void;
  clearCurrentRunForRequest: (requestId: string) => void;
  requestServeJson: (pathname: string) => Promise<unknown>;
  requestServeNoContent: (pathname: string) => Promise<void>;
  handleRunStartRequest: (
    webview: FakeWebview,
    requestId: string,
    payload: {
      message: string;
      model: string;
      agent: string;
      sessionId?: string;
    }
  ) => Promise<void>;
  dispose: () => void;
};

function createProvider(workspaceUpdate = vi.fn(async () => {})): TestProvider {
  return new SidebarProvider(
    { fsPath: '/ext' } as never,
    {
      get: () => undefined,
      update: workspaceUpdate
    } as never,
    'wsl',
    'wsl'
  ) as unknown as TestProvider;
}

function createRun(): TestRun {
  return {
    requestId: 'run-1',
    revision: 0,
    controller: new AbortController(),
    eventAbort: new AbortController(),
    startedAt: 1_000,
    promptText: 'inspect recovery',
    placeholderTitle: 'inspect recovery',
    startedNewSession: false,
    sessionId: 'session-1',
    recoveryAssistantIndex: 1,
    queue: [],
    recoveryTranscript: [
      { role: 'user', created: 1_000, parts: [{ type: 'text', text: 'inspect recovery' }] },
      { role: 'assistant', created: 1_000, parts: [] }
    ],
    pendingPermission: {
      type: 'permission',
      permissionId: 'permission-1',
      sessionId: 'session-1',
      toolName: 'edit',
      patterns: ['src/file.ts']
    }
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('run snapshot recovery', () => {
  it('在 Webview 不可投递时继续累积输出，重连后用 snapshot 完整恢复', () => {
    const provider = createProvider();
    provider.currentRun = createRun();
    const hiddenWebview: FakeWebview = { postMessage: vi.fn(async () => false) };
    const visibleMessages: unknown[] = [];
    const visibleWebview: FakeWebview = {
      postMessage: async (message) => {
        visibleMessages.push(message);
        return true;
      }
    };

    provider.respondRunEvent(hiddenWebview, 'run-1', {
      type: 'part',
      part: {
        type: 'reasoning',
        text: '**分析一**',
        streamKey: 'message-1:reasoning-1'
      }
    });
    provider.respondRunEvent(hiddenWebview, 'run-1', {
      type: 'part',
      part: {
        type: 'reasoning',
        text: '**分析二**',
        streamKey: 'message-1:reasoning-2'
      }
    });

    expect(hiddenWebview.postMessage).not.toHaveBeenCalled();
    provider.postRunSnapshot(visibleWebview);

    expect(visibleMessages).toHaveLength(1);
    expect(visibleMessages[0]).toMatchObject({
      type: 'run.snapshot',
      ok: true,
      payload: {
        queue: { items: [] },
        activeRun: {
          requestId: 'run-1',
          sessionId: 'session-1',
          assistantIndex: 1,
          pendingPermission: {
            permissionId: 'permission-1',
            patterns: ['src/file.ts']
          },
          transcript: [
            expect.objectContaining({ role: 'user' }),
            expect.objectContaining({
              role: 'assistant',
              parts: [
                { type: 'reasoning', text: '**分析一**', streamKey: 'message-1:reasoning-1' },
                { type: 'reasoning', text: '**分析二**', streamKey: 'message-1:reasoning-2' }
              ]
            })
          ]
        }
      }
    });

    provider.dispose();
  });

  it('防止 Webview 修改 snapshot 污染扩展宿主中的 canonical run', () => {
    const provider = createProvider();
    provider.currentRun = createRun();

    const first = provider.getActiveRunSnapshot();
    expect(first).toBeDefined();
    const firstReasoning = { type: 'reasoning' as const, text: 'mutated' };
    first?.transcript[1]?.parts.push(firstReasoning);
    first?.pendingPermission?.patterns.push('mutated.ts');

    const second = provider.getActiveRunSnapshot();
    expect(second?.transcript[1]?.parts).toEqual([]);
    expect(second?.pendingPermission?.patterns).toEqual(['src/file.ts']);

    provider.dispose();
  });

  it('隐藏期间完成时保留真实 terminal 时间与完整 transcript', () => {
    vi.spyOn(Date, 'now').mockReturnValue(9_000);
    const provider = createProvider();
    provider.currentRun = createRun();
    const visibleMessages: unknown[] = [];
    const visibleWebview: FakeWebview = {
      postMessage: async (message) => {
        visibleMessages.push(message);
        return true;
      }
    };

    provider.respondRunEvent(visibleWebview, 'run-1', {
      type: 'part',
      part: { type: 'text', text: '已完成', streamKey: 'message-1:text-1' }
    });
    provider.respondRunEvent(visibleWebview, 'run-1', { type: 'done' });
    provider.clearCurrentRunForRequest('run-1');
    provider.postRunSnapshot(visibleWebview);

    expect(provider.lastTerminalRun).toMatchObject({
      requestId: 'run-1',
      outcome: 'done',
      completedAt: 9_000,
      transcript: [
        expect.objectContaining({ role: 'user' }),
        expect.objectContaining({
          role: 'assistant',
          completed: 9_000,
          finish: 'stop',
          parts: [{ type: 'text', text: '已完成', streamKey: 'message-1:text-1' }]
        })
      ]
    });
    expect(visibleMessages.at(-1)).toMatchObject({
      type: 'run.snapshot',
      payload: {
        terminalRun: {
          requestId: 'run-1',
          outcome: 'done',
          completedAt: 9_000
        }
      }
    });

    provider.dispose();
  });

  it('keeps the first terminal outcome when an error is followed by done', () => {
    vi.spyOn(Date, 'now').mockReturnValue(9_000);
    const provider = createProvider();
    provider.currentRun = createRun();
    const visibleWebview: FakeWebview = { postMessage: vi.fn(async () => true) };

    provider.respondRunEvent(visibleWebview, 'run-1', {
      type: 'error',
      error: 'provider rejected the request'
    });
    const failedSnapshot = provider.lastTerminalRun;
    provider.respondRunEvent(visibleWebview, 'run-1', { type: 'done' });

    expect(failedSnapshot).toMatchObject({
      requestId: 'run-1',
      outcome: 'failed',
      completedAt: 9_000,
      transcript: [
        expect.objectContaining({ role: 'user' }),
        expect.objectContaining({
          role: 'assistant',
          parts: [expect.objectContaining({
            type: 'text',
            text: expect.stringContaining('provider rejected the request')
          })]
        })
      ]
    });
    expect(provider.lastTerminalRun).toBe(failedSnapshot);

    provider.dispose();
  });
});

describe('busy session send protection', () => {
  it.each(['busy', 'retry'] as const)('在 session 为 %s 时不写入新消息也不建立本地 run', async (status) => {
    const workspaceUpdate = vi.fn(async () => {});
    const provider = createProvider(workspaceUpdate);
    provider.requestServeJson = vi.fn(async (pathname) => {
      expect(pathname).toBe('/session/status');
      return { 'session-1': { type: status } };
    });
    provider.requestServeNoContent = vi.fn(async () => {});
    const messages: unknown[] = [];
    const webview: FakeWebview = {
      postMessage: async (message) => {
        messages.push(message);
        return true;
      }
    };

    await provider.handleRunStartRequest(webview, 'request-1', {
      message: '这条消息不能被吞',
      model: 'openai/gpt-5',
      agent: 'build',
      sessionId: 'session-1'
    });

    expect(provider.requestServeJson).toHaveBeenCalledTimes(1);
    expect(provider.requestServeNoContent).not.toHaveBeenCalled();
    expect(workspaceUpdate).not.toHaveBeenCalled();
    expect(provider.currentRun).toBeUndefined();
    expect(messages).toEqual([
      expect.objectContaining({
        type: 'webview.error',
        requestId: 'request-1',
        ok: false,
        error: expect.stringContaining('消息未发送')
      })
    ]);

    provider.dispose();
  });

  it('前端在 run.start 被拒绝时回滚乐观 transcript 并恢复输入', () => {
    const source = readFileSync(join(process.cwd(), 'webview-ui/src/App.tsx'), 'utf8');
    const branchStart = source.indexOf('if (runStartRequestIdRef.current === message.requestId)');
    const branchEnd = source.indexOf('if (runStopRequestIdsRef.current.has(message.requestId))', branchStart);
    const branch = source.slice(branchStart, branchEnd);

    expect(branchStart).toBeGreaterThan(0);
    expect(branch).toContain('active?.previousTranscript');
    expect(branch).toContain('transcriptRef.current = active.previousTranscript');
    expect(branch).toContain('setTranscript(active.previousTranscript)');
    expect(branch).toContain('active?.submittedText');
    expect(branch).toContain('setComposerValue');
    expect(branch.indexOf('setTranscript(active.previousTranscript)')).toBeLessThan(branch.indexOf('activeRunRef.current = null'));
    expect(branch.indexOf('setComposerValue')).toBeLessThan(branch.indexOf('activeRunRef.current = null'));
  });
});
