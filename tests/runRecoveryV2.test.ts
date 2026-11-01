import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({ workspace: {} }), { virtual: true });
vi.mock('../src/bridge/serveManager', () => ({ ensureServeRunning: vi.fn(), restartServeForConfigChange: vi.fn() }));

import { SidebarProvider } from '../src/webview/SidebarProvider';
import { normalizeSessionMessages } from '../src/bridge/opencodeV2Adapter';
import { armServeStreamTurn, createServeStreamState, recoverV2TurnTerminal } from '../src/webview/runLifecycle';

const previous = [
  { id: 'msg_old_user', type: 'user', text: 'old', time: { created: 1 } },
  { id: 'msg_old_idle', type: 'idle', outcome: 'succeeded', time: { created: 2 } }
];

function messages(outcome = 'succeeded', error?: string) {
  return normalizeSessionMessages([
    ...previous,
    { id: 'msg_user', type: 'user', text: 'inspect', time: { created: 1000 } },
    { id: 'msg_assistant', type: 'assistant', content: [{ type: 'text', text: 'Native content' }], time: { created: 1001 } },
    { id: 'msg_idle', type: 'idle', outcome, ...(error ? { error: { type: 'unknown', message: error } } : {}), time: { created: 1002 } }
  ], 'ses_root');
}

function fixture(history: unknown = messages(), disconnected = false) {
  vi.useFakeTimers();
  const provider = new SidebarProvider(
    { fsPath: '/ext' } as never, { get: () => undefined, update: async () => {} } as never, 'wsl', 'wsl'
  ) as any;
  const posted: any[] = [];
  const webview = { postMessage: async (message: unknown) => { posted.push(message); return true; } };
  provider.runEventWebview = webview;
  provider.currentRun = {
    requestId: 'run', revision: 0, controller: new AbortController(), startedAt: 1000,
    promptText: 'inspect', placeholderTitle: 'inspect', startedNewSession: false, sessionId: 'ses_root',
    recoveryTranscript: [{ role: 'user', parts: [] }, { role: 'assistant', parts: [] }],
    recoveryAssistantIndex: 1, queue: [], initialPromptSubmitted: true
  };
  const request = vi.fn(async (path: string) => {
    if (path === '/session/status') return {};
    if (path === '/permission' || path === '/question') return [];
    if (path === '/session/ses_root/message') return history;
    throw new Error(path);
  });
  provider.requestServeJson = request;
  provider.scheduleQueuedPromptDelivery = vi.fn();
  provider.serveClient.openEventStream = vi.fn(async () => new ReadableStream({
    start(controller) { if (disconnected) controller.error(new Error('stream lost')); }
  }));
  const state = createServeStreamState();
  state.baselineMessageIds = new Set(previous.map((message) => message.id));
  armServeStreamTurn(state);
  const controller = new AbortController();
  const consume = () => provider.consumeServeEvents(webview, 'run', 'ses_root', { baseUrl: 'http://localhost:4096', apiVersion: 'v2' }, controller.signal, state);
  return { provider, request, state, posted, controller, consume };
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('native turn recovery', () => {
  it('finishes a connected but silent stream from the current native terminal and restores content', async () => {
    const f = fixture();
    const completion = f.consume();
    await vi.advanceTimersByTimeAsync(300);
    await expect(completion).resolves.toBe('done');
    expect(f.request).toHaveBeenCalledWith('/session/status', expect.anything());
    expect(f.provider.currentRun.recoveryTranscript.at(-1).parts).toContainEqual(expect.objectContaining({ text: 'Native content' }));
    expect(f.posted.some((message) => message.type === 'run.snapshot')).toBe(true);
  });

  it.each(['failed', 'interrupted'])('recovers %s after SSE loss without reporting success', async (outcome) => {
    const f = fixture(messages(outcome, outcome === 'failed' ? 'Provider unavailable' : undefined), true);
    const completion = f.consume();
    await vi.advanceTimersByTimeAsync(300);
    const result = await completion;
    if (outcome === 'failed') expect(result).toMatchObject({ message: 'Provider unavailable' });
    else expect(result).toBe('stopped');
  });

  it('never uses an earlier terminal or a terminal before a newer prompt', () => {
    const baseline = new Set(previous.map((message) => message.id));
    expect(recoverV2TurnTerminal(normalizeSessionMessages(previous, 'ses_root'), baseline)).toBeUndefined();
    expect(recoverV2TurnTerminal([
      ...messages(), { info: { id: 'msg_later', role: 'user' }, parts: [] }
    ], baseline)).toBeUndefined();
    expect(recoverV2TurnTerminal(messages(), undefined)).toBeUndefined();
  });

  it('keeps waiting when native status is idle but queue delivery or blocker polling is unresolved', async () => {
    const f = fixture();
    f.provider.currentRun.queue.push({ id: 'queue', delivery: 'queued', messageId: 'msg_queue' });
    let settled = false;
    const completion = f.consume().then((result: unknown) => { settled = true; return result; });
    await vi.advanceTimersByTimeAsync(1000);
    expect(settled).toBe(false);
    f.provider.currentRun.queue.length = 0;
    f.request.mockImplementation(async () => { throw new Error('offline'); });
    await vi.advanceTimersByTimeAsync(1000);
    expect(settled).toBe(false);
    f.controller.abort();
    await expect(completion).resolves.toBe('stopped');
  });

  it('bounds connection establishment and does not announce readiness on timeout', async () => {
    const f = fixture();
    const ready = vi.fn();
    f.provider.serveClient.openEventStream.mockImplementation(() => new Promise(() => {}));
    const completion = f.provider.consumeServeEvents(
      { postMessage: async () => true }, 'run', 'ses_root', { apiVersion: 'v2' }, f.controller.signal, f.state, ready
    );
    await vi.advanceTimersByTimeAsync(10_001);
    await expect(completion).resolves.toMatchObject({ message: expect.stringContaining('消息尚未发送') });
    expect(ready).not.toHaveBeenCalled();
  });

  it('the real Sidebar adapter accepts only a verified current session tree', () => {
    const f = fixture();
    const adapter = f.provider.createRunLifecycleAdapter({ postMessage: async () => true }, 'run');
    expect(adapter.acceptBlockerSession('run', 'ses_root', 'ses_other', f.state)).toBe(false);
    f.state.sessionParents.set('ses_child', 'ses_root');
    expect(adapter.acceptBlockerSession('run', 'ses_root', 'ses_child', f.state)).toBe(true);
    expect(adapter.acceptBlockerSession('old_run', 'ses_root', 'ses_root', f.state)).toBe(false);
  });
});
