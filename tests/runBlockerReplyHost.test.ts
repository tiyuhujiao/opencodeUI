import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({ workspace: {} }), { virtual: true });
vi.mock('../src/bridge/serveManager', () => ({ ensureServeRunning: vi.fn(), restartServeForConfigChange: vi.fn() }));
import { SidebarProvider } from '../src/webview/SidebarProvider';
import { createServeStreamState, dispatchV2ServeEvent, pollServeBlockers } from '../src/webview/runLifecycle';

function form(id: string) {
  return { id, sessionID: 'ses_root', title: id, fields: [{ key: 'answer', type: 'string', required: true }] };
}

function fixture() {
  const provider = new SidebarProvider({ fsPath: '/ext' } as never, { get: () => undefined, update: async () => {} } as never, 'local-windows') as any;
  const posted: any[] = [];
  const webview = { postMessage: async (message: unknown) => { posted.push(message); return true; } };
  const state = createServeStreamState();
  provider.currentRun = {
    requestId: 'run', revision: 0, controller: new AbortController(), startedAt: 1,
    promptText: 'prompt', placeholderTitle: 'prompt', startedNewSession: false, sessionId: 'ses_root',
    recoveryTranscript: [{ role: 'user', parts: [] }], recoveryAssistantIndex: -1,
    queue: [], initialPromptSubmitted: true, streamState: state
  };
  provider.runEventWebview = webview;
  provider.isV2Runtime = async () => true;
  provider.scheduleQueuedPromptDelivery = vi.fn();
  provider.requestServeJson = vi.fn(async () => true);
  const adapter = provider.createRunLifecycleAdapter(webview, 'run');
  const dispatch = (type: string, data: unknown) => dispatchV2ServeEvent(adapter, 'run', 'ses_root', { type, data }, state);
  return { provider, posted, webview, state, adapter, dispatch };
}

describe('host blocker reply reconciliation', () => {
  it('advances native forms immediately after reply and rejects a pre-reply polling snapshot without SSE', async () => {
    const f = fixture();
    f.dispatch('form.created', { form: form('frm_1') });
    f.dispatch('form.created', { form: form('frm_2') });
    let resolve!: (value: unknown) => void;
    const snapshot = new Promise((next) => { resolve = next; });
    f.provider.requestServeJson.mockImplementation(async (pathname: string) => {
      if (pathname === '/question') return snapshot;
      if (pathname === '/permission' || pathname === '/session') return [];
      return true;
    });
    const poll = pollServeBlockers(f.adapter, 'run', 'ses_root', f.state);
    await f.provider.handleQuestionReplyRequest(f.webview, 'reply', 'frm_1', { answer: 'typed' });
    expect(f.provider.currentRun.pendingQuestion.questionId).toBe('frm_2');
    expect(f.state.pendingQuestionIds.has('frm_1')).toBe(false);
    resolve([form('frm_1'), form('frm_2')].map((native) => ({ form: native })));
    await poll;
    expect([...f.state.pendingQuestionIds]).toEqual(['frm_2']);
    expect(f.provider.currentRun.pendingQuestion.questionId).toBe('frm_2');
    f.provider.dispose();
  });

  it('clears permissions and rejected forms locally and publishes the cleared snapshot', async () => {
    const f = fixture();
    f.dispatch('permission.asked', { id: 'per_1', sessionID: 'ses_root', action: 'bash', resources: ['npm test'] });
    await f.provider.handlePermissionReplyRequest(f.webview, 'p', 'per_1', 'once');
    expect(f.state.pendingPermissionIds.size).toBe(0);
    expect(f.provider.currentRun.pendingPermission).toBeUndefined();
    f.dispatch('form.created', { form: form('frm_1') });
    await f.provider.handleQuestionRejectRequest(f.webview, 'q', 'frm_1');
    expect(f.state.pendingQuestionIds.size).toBe(0);
    expect(f.posted.filter((message) => message.type === 'run.snapshot').at(-1).payload.activeRun.pendingQuestion).toBeUndefined();
    f.provider.dispose();
  });

  it('never sends replies for IDs outside the current visible run', async () => {
    const f = fixture();
    await f.provider.handlePermissionReplyRequest(f.webview, 'p', 'per_other', 'always');
    await f.provider.handleQuestionReplyRequest(f.webview, 'q', 'frm_other', {});
    await f.provider.handleQuestionRejectRequest(f.webview, 'r', 'frm_other');
    expect(f.provider.requestServeJson).not.toHaveBeenCalled();
    expect(f.posted.filter((message) => message.type === 'webview.error')).toHaveLength(3);
    f.provider.dispose();
  });
});
