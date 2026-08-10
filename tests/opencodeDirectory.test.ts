import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeOpencodeDirectory } from '../src/bridge/opencodeDirectory';
import { createServeStreamState } from '../src/webview/runLifecycle';

const mocks = vi.hoisted(() => ({
  ensureServeRunning: vi.fn()
}));

vi.mock('vscode', () => ({ workspace: {} }), { virtual: true });

vi.mock('../src/bridge/serveManager', () => ({
  ensureServeRunning: mocks.ensureServeRunning,
  restartServeForConfigChange: vi.fn()
}));

import { SidebarProvider } from '../src/webview/SidebarProvider';

function createProvider() {
  return new SidebarProvider(
    { fsPath: '/ext' } as never,
    {
      get: () => undefined,
      update: async () => {}
    } as never,
    'local-windows'
  );
}

afterEach(() => {
  mocks.ensureServeRunning.mockReset();
  vi.unstubAllGlobals();
});

describe('OpenCode workspace directory header', () => {
  it('round-trips Unicode Windows paths through a ByteString-safe header', () => {
    const directory = 'E:\\百分数与分数';
    const encoded = encodeOpencodeDirectory(directory);

    expect(encoded).toBe('E%3A%5C%E7%99%BE%E5%88%86%E6%95%B0%E4%B8%8E%E5%88%86%E6%95%B0');
    expect(() => new Headers({ 'x-opencode-directory': encoded })).not.toThrow();
    expect(decodeURIComponent(encoded)).toBe(directory);
  });

  it('encodes every path once so reserved characters remain unambiguous', () => {
    const directory = 'E:\\100% complete\\#data';
    const encoded = encodeOpencodeDirectory(directory);

    expect(encoded).toBe('E%3A%5C100%25%20complete%5C%23data');
    expect(decodeURIComponent(encoded)).toBe(directory);
  });

  it('uses the encoded workspace header for Sidebar JSON, no-content, and SSE requests', async () => {
    const cwd = 'E:\\百分数与分数';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(
        `data: ${JSON.stringify({
          type: 'session.error',
          properties: {
            sessionID: 'session-1',
            error: { message: 'stop test stream' }
          }
        })}\n\n`,
        { status: 200 }
      ));
    mocks.ensureServeRunning.mockResolvedValue({ baseUrl: 'http://127.0.0.1:4096' });
    vi.stubGlobal('fetch', fetchMock);

    const provider = createProvider() as unknown as {
      getDefaultCwd: () => string | undefined;
      requestServeJson: <T>(pathname: string) => Promise<T>;
      requestServeNoContent: (pathname: string) => Promise<void>;
      consumeServeEvents: (
        webview: unknown,
        requestId: string,
        sessionId: string,
        baseUrl: string,
        signal: AbortSignal,
        streamState: ReturnType<typeof createServeStreamState>
      ) => Promise<'done' | 'stopped' | Error>;
      dispose: () => void;
    };
    provider.getDefaultCwd = () => cwd;

    try {
      await expect(provider.requestServeJson('/session')).resolves.toEqual({ ok: true });
      await expect(provider.requestServeNoContent('/session/s1')).resolves.toBeUndefined();
      await expect(
        provider.consumeServeEvents(
          { postMessage: vi.fn() },
          'request-1',
          'session-1',
          'http://127.0.0.1:4096',
          new AbortController().signal,
          createServeStreamState()
        )
      ).resolves.toBeInstanceOf(Error);
    } finally {
      provider.dispose();
    }

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const headers = fetchMock.mock.calls.map(([, init]) => (init as RequestInit).headers as Record<string, string>);
    expect(headers.map((entry) => entry['x-opencode-directory'])).toEqual([
      encodeURIComponent(cwd),
      encodeURIComponent(cwd),
      encodeURIComponent(cwd)
    ]);
    expect(headers[0]['Content-Type']).toBe('application/json');
    expect(headers[1]['Content-Type']).toBe('application/json');
    expect(headers[2].Accept).toBe('text/event-stream');
  });
});
