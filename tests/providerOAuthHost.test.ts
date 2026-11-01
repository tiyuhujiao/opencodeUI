import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ ensure: vi.fn(), open: vi.fn() }));
vi.mock('vscode', () => ({ workspace: {}, env: { openExternal: mocks.open }, Uri: { parse: (url: string) => url } }), { virtual: true });
vi.mock('../src/bridge/serveManager', () => ({ ensureServeRunning: mocks.ensure, restartServeForConfigChange: vi.fn() }));
import { SidebarProvider } from '../src/webview/SidebarProvider';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

function fixture() {
  const provider = new SidebarProvider({ fsPath: '/ext' } as never, { get: () => undefined, update: async () => {} } as never, 'local-windows') as any;
  const posted: any[] = [];
  const webview = { postMessage: async (message: unknown) => { posted.push(message); return true; } };
  provider.getDefaultCwd = () => '/original';
  const runtime = { baseUrl: 'http://localhost:4096', apiVersion: 'v2', password: 'test' };
  mocks.ensure.mockResolvedValue(runtime);
  let sequence = 0;
  provider.requestServeJson = vi.fn(async (pathname: string) => pathname.endsWith('/authorize')
    ? { url: 'https://example.test', method: 'code', instructions: '', attemptID: `con_${++sequence}`, time: { created: 1, expires: 2 } } : true);
  provider.invalidateProviderCaches = vi.fn();
  return { provider, posted, webview, runtime };
}

beforeEach(() => { mocks.open.mockResolvedValue(true); });
afterEach(() => { vi.restoreAllMocks(); mocks.ensure.mockReset(); mocks.open.mockReset(); });

describe('provider OAuth host flows', () => {
  it('captures endpoint, directory and native identity through callback', async () => {
    const f = fixture();
    await f.provider.handleProviderAuthOAuthAuthorizeRequest(f.webview, 'auth', 'p', 0, {}, 'flow');
    f.provider.getDefaultCwd = () => '/different';
    mocks.ensure.mockResolvedValue({ baseUrl: 'http://localhost:5096', apiVersion: 'v2' });
    await f.provider.handleProviderAuthOAuthCallbackRequest(f.webview, 'callback', 'p', 0, 'native-code', 'flow', 'con_1');
    const options = f.provider.requestServeJson.mock.calls.find((call: any[]) => call[0].endsWith('/callback'))?.[1];
    expect(options).toMatchObject({ cwd: '/original', endpoint: f.runtime });
    expect(JSON.parse(options.body)).toEqual({ method: 0, code: 'native-code', attemptID: 'con_1' });
    expect(f.posted.at(-1)).toMatchObject({ type: 'provider.auth.oauth.callback.response', payload: { providerId: 'p', flowId: 'flow', attemptID: 'con_1' } });
    f.provider.dispose();
  });

  it('does not open a browser or emit authorization after closing during admission', async () => {
    const f = fixture();
    const late = deferred<unknown>();
    f.provider.requestServeJson.mockImplementation(async (pathname: string) => pathname.endsWith('/authorize') ? late.promise : true);
    const authorize = f.provider.handleProviderAuthOAuthAuthorizeRequest(f.webview, 'auth', 'p', 0, {}, 'flow');
    await vi.waitFor(() => expect(f.provider.requestServeJson).toHaveBeenCalled());
    const signal = f.provider.requestServeJson.mock.calls[0][1].signal;
    await f.provider.handleProviderAuthOAuthCancelRequest(f.webview, 'cancel', 'p', 0, 'flow');
    expect(signal.aborted).toBe(true);
    late.resolve({ url: 'https://example.test', method: 'code', instructions: '', attemptID: 'con_late' });
    await authorize;
    expect(mocks.open).not.toHaveBeenCalled();
    expect(f.posted.some((message) => message.type === 'provider.auth.oauth.authorize.response')).toBe(false);
    expect(f.provider.requestServeJson).toHaveBeenCalledWith('/provider/p/oauth/cancel', expect.objectContaining({
      body: JSON.stringify({ method: 0, attemptID: 'con_late' }), endpoint: f.runtime, cwd: '/original'
    }));
    f.provider.dispose();
  });

  it('rejects mismatched cancellation and preserves a newer flow after an old callback finishes', async () => {
    const f = fixture();
    await f.provider.handleProviderAuthOAuthAuthorizeRequest(f.webview, 'a1', 'p', 0, {}, 'old');
    const late = deferred<boolean>();
    const original = f.provider.requestServeJson.getMockImplementation();
    f.provider.requestServeJson.mockImplementation(async (pathname: string, options: unknown) => pathname.endsWith('/callback') ? late.promise : original(pathname, options));
    const callback = f.provider.handleProviderAuthOAuthCallbackRequest(f.webview, 'c1', 'p', 0, undefined, 'old', 'con_1');
    await f.provider.handleProviderAuthOAuthCancelRequest(f.webview, 'cancel', 'p', 0, 'old', 'con_1');
    await f.provider.handleProviderAuthOAuthAuthorizeRequest(f.webview, 'a2', 'p', 0, {}, 'new');
    await f.provider.handleProviderAuthOAuthCancelRequest(f.webview, 'bad', 'p', 0, 'new', 'con_1');
    expect(f.provider.providerOAuthFlows.has('new')).toBe(true);
    expect(f.posted.at(-1)).toMatchObject({ type: 'webview.error', requestId: 'bad' });
    late.resolve(true);
    await callback;
    expect(f.provider.providerOAuthFlows.has('new')).toBe(true);
    expect(f.posted.some((message) => message.type === 'provider.auth.oauth.callback.response')).toBe(false);
    expect(f.provider.invalidateProviderCaches).not.toHaveBeenCalled();
    f.provider.dispose();
  });

  it('aborts all pending flows on disposal and suppresses late success', async () => {
    const f = fixture();
    await f.provider.handleProviderAuthOAuthAuthorizeRequest(f.webview, 'auth', 'p', 0, {}, 'flow');
    const late = deferred<boolean>();
    f.provider.requestServeJson.mockImplementation(async () => late.promise);
    const callback = f.provider.handleProviderAuthOAuthCallbackRequest(f.webview, 'c', 'p', 0, undefined, 'flow', 'con_1');
    const signal = f.provider.requestServeJson.mock.calls.at(-1)[1].signal;
    f.provider.dispose();
    expect(signal.aborted).toBe(true);
    late.resolve(true);
    await callback;
    expect(f.posted.some((message) => message.type === 'provider.auth.oauth.callback.response')).toBe(false);
    expect(f.provider.providerOAuthFlows.size).toBe(0);
  });
});
