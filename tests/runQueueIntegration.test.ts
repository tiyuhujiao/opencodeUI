import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ensureServeRunning: vi.fn()
}));

vi.mock('vscode', () => ({ workspace: {} }), { virtual: true });
vi.mock('../src/bridge/serveManager', () => ({
  ensureServeRunning: mocks.ensureServeRunning,
  restartServeForConfigChange: vi.fn()
}));

import type { RunPromptPayload } from '../src/shared/protocol';
import { SidebarProvider } from '../src/webview/SidebarProvider';

type Completion = 'done' | 'stopped' | Error;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

afterEach(() => {
  mocks.ensureServeRunning.mockReset();
});

describe('run Queue integration', () => {
  it('pre-submits follow-ups through blockers and promotes the consumed batch on the next assistant boundary', async () => {
    mocks.ensureServeRunning.mockResolvedValue({ baseUrl: 'http://127.0.0.1:4096' });
    const provider = new SidebarProvider(
      { fsPath: '/ext' } as never,
      { get: () => undefined, update: async () => {} } as never,
      'wsl',
      'wsl'
    ) as unknown as {
      currentRun?: {
        queue: Array<{ id: string; delivery: string; messageId: string }>;
        pendingPermission?: unknown;
        pendingQuestion?: unknown;
      };
      runEventWebview?: { postMessage: (message: unknown) => Thenable<boolean> };
      requestServeJson: <T>(pathname: string, init?: RequestInit) => Promise<T>;
      requestServeNoContent: (pathname: string, init?: RequestInit) => Promise<void>;
      consumeServeEvents: (
        webview: unknown,
        requestId: string,
        sessionId: string,
        baseUrl: string,
        signal: AbortSignal,
        streamState: unknown,
        onReady?: () => void
      ) => Promise<Completion>;
      startBlockerPoll: () => NodeJS.Timeout;
      handleRunStartRequest: (
        webview: { postMessage: (message: unknown) => Thenable<boolean> },
        requestId: string,
        payload: RunPromptPayload
      ) => Promise<void>;
      handleRunQueueAddRequest: (
        webview: { postMessage: (message: unknown) => Thenable<boolean> },
        requestId: string,
        payload: RunPromptPayload
      ) => void;
      observeQueuedUserMessage: (
        webview: { postMessage: (message: unknown) => Thenable<boolean> },
        requestId: string,
        messageId: string
      ) => void;
      observeQueuedAssistantMessage: (
        webview: { postMessage: (message: unknown) => Thenable<boolean> },
        requestId: string,
        message: { id: string; parentId?: string }
      ) => void;
      reconcileQueuedAssistantBoundary: (
        webview: { postMessage: (message: unknown) => Thenable<boolean> },
        requestId: string,
        sessionId: string
      ) => Promise<boolean>;
      dispose: () => void;
    };
    const completions: Array<ReturnType<typeof deferred<Completion>>> = [];
    const sentPrompts: Array<{ message: string; messageId?: string }> = [];
    const sentCommands: Array<{ command: string; messageId?: string }> = [];
    const commandCompletion = deferred<unknown>();
    const posted: unknown[] = [];
    let messageHistory: unknown[] = [];
    const webview = {
      postMessage: async (message: unknown) => {
        posted.push(message);
        return true;
      }
    };
    provider.runEventWebview = webview;
    provider.requestServeJson = vi.fn(async (pathname: string, init?: RequestInit) => {
      if (pathname === '/session/status') {
        return {} as never;
      }
      if (pathname === '/session/session-1/message') {
        return messageHistory as never;
      }
      if (pathname === '/session/session-1/command') {
        const body = JSON.parse(String(init?.body)) as { command: string; messageID?: string };
        sentCommands.push({
          command: body.command,
          ...(body.messageID ? { messageId: body.messageID } : {})
        });
        return commandCompletion.promise as never;
      }
      throw new Error(`Unexpected JSON request: ${pathname}`);
    });
    provider.requestServeNoContent = vi.fn(async (pathname, init) => {
      expect(pathname).toBe('/session/session-1/prompt_async');
      const body = JSON.parse(String(init?.body)) as {
        messageID?: string;
        parts: Array<{ type: string; text?: string }>;
      };
      sentPrompts.push({
        message: body.parts.find((part) => part.type === 'text')?.text ?? '',
        ...(body.messageID ? { messageId: body.messageID } : {})
      });
    });
    provider.consumeServeEvents = vi.fn(async (_webview, _requestId, _sessionId, _baseUrl, _signal, _state, onReady) => {
      const completion = deferred<Completion>();
      completions.push(completion);
      onReady?.();
      return completion.promise;
    });
    provider.startBlockerPoll = () => {
      const timer = setTimeout(() => undefined, 60_000);
      timer.unref?.();
      return timer;
    };

    const basePayload: RunPromptPayload = {
      message: 'first',
      model: 'provider/model',
      agent: 'build',
      sessionId: 'session-1'
    };
    const run = provider.handleRunStartRequest(webview, 'run-1', basePayload);
    await vi.waitFor(() => expect(sentPrompts.map((item) => item.message)).toEqual(['first']));

    if (provider.currentRun) {
      provider.currentRun.pendingPermission = { id: 'permission-1' };
      provider.currentRun.pendingQuestion = { id: 'question-1' };
    }
    provider.handleRunQueueAddRequest(webview, 'queue-1', { ...basePayload, message: 'second' });
    provider.handleRunQueueAddRequest(webview, 'queue-2', { ...basePayload, message: 'third' });
    expect(provider.currentRun?.queue.map((item) => item.id)).toEqual(['queue-1', 'queue-2']);
    const [secondMessageId, thirdMessageId] = provider.currentRun?.queue.map((item) => item.messageId) ?? [];
    expect(secondMessageId).toMatch(/^msg_/);
    expect(thirdMessageId).toMatch(/^msg_/);
    await vi.waitFor(() => expect(sentPrompts.map((item) => item.message)).toEqual(['first', 'second', 'third']));
    expect(sentPrompts[1]?.messageId).toBe(secondMessageId);
    expect(sentPrompts[2]?.messageId).toBe(thirdMessageId);
    await vi.waitFor(() => {
      expect(provider.currentRun?.queue.map((item) => item.delivery)).toEqual(['submitted', 'submitted']);
    });

    provider.observeQueuedUserMessage(webview, 'run-1', secondMessageId ?? '');
    provider.observeQueuedUserMessage(webview, 'run-1', thirdMessageId ?? '');
    provider.observeQueuedAssistantMessage(webview, 'run-1', {
      id: 'msg-assistant-2',
      parentId: thirdMessageId
    });
    expect(provider.currentRun?.queue).toEqual([]);
    expect(posted).toContainEqual(expect.objectContaining({
      type: 'run.event',
      payload: expect.objectContaining({
        event: expect.objectContaining({
          type: 'turn.start',
          prompts: [
            expect.objectContaining({ queueId: 'queue-1', messageId: secondMessageId, message: 'second' }),
            expect.objectContaining({ queueId: 'queue-2', messageId: thirdMessageId, message: 'third' })
          ]
        })
      })
    }));
    expect(posted).not.toContainEqual(expect.objectContaining({
      type: 'run.event',
      payload: expect.objectContaining({ event: { type: 'done' } })
    }));

    provider.handleRunQueueAddRequest(webview, 'queue-3', { ...basePayload, message: 'fourth' });
    await vi.waitFor(() => expect(sentPrompts.map((item) => item.message)).toEqual(['first', 'second', 'third', 'fourth']));
    const fourthMessageId = provider.currentRun?.queue[0]?.messageId;
    provider.observeQueuedUserMessage(webview, 'run-1', fourthMessageId ?? '');
    messageHistory = [{
      info: {
        id: 'msg-assistant-3',
        parentID: fourthMessageId,
        role: 'assistant'
      },
      parts: []
    }];
    await expect(provider.reconcileQueuedAssistantBoundary(webview, 'run-1', 'session-1')).resolves.toBe(true);
    expect(provider.currentRun?.queue).toEqual([]);
    expect(posted).toContainEqual(expect.objectContaining({
      type: 'run.event',
      payload: expect.objectContaining({
        event: expect.objectContaining({
          type: 'turn.start',
          prompts: [expect.objectContaining({ queueId: 'queue-3', messageId: fourthMessageId, message: 'fourth' })]
        })
      })
    }));

    provider.handleRunQueueAddRequest(webview, 'queue-4', {
      ...basePayload,
      message: '/review queued command',
      command: { name: 'review', arguments: 'queued command' }
    });
    provider.handleRunQueueAddRequest(webview, 'queue-5', { ...basePayload, message: 'after command' });
    const [commandMessageId, afterCommandMessageId] = provider.currentRun?.queue.map((item) => item.messageId) ?? [];
    await vi.waitFor(() => expect(sentCommands).toEqual([
      { command: 'review', messageId: commandMessageId }
    ]));
    expect(sentPrompts.map((item) => item.message)).toEqual(['first', 'second', 'third', 'fourth']);

    provider.observeQueuedUserMessage(webview, 'run-1', commandMessageId ?? '');
    await vi.waitFor(() => {
      expect(sentPrompts.map((item) => item.message)).toEqual([
        'first',
        'second',
        'third',
        'fourth',
        'after command'
      ]);
    });
    provider.observeQueuedUserMessage(webview, 'run-1', afterCommandMessageId ?? '');
    provider.observeQueuedAssistantMessage(webview, 'run-1', {
      id: 'msg-assistant-5',
      parentId: afterCommandMessageId
    });
    expect(provider.currentRun?.queue).toEqual([]);
    commandCompletion.resolve({});

    completions[0]?.resolve('done');
    await run;

    const doneEvents = posted.filter((message) => {
      const event = (message as { payload?: { event?: { type?: string } } }).payload?.event;
      return event?.type === 'done';
    });
    expect(doneEvents).toHaveLength(1);
    expect(provider.currentRun).toBeUndefined();
    provider.dispose();
  });
});
