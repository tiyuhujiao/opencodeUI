import { describe, expect, it, vi } from 'vitest';
import { OpencodeServeClient } from '../src/bridge/opencodeServeClient';

describe('OpencodeServeClient', () => {
  it('encodes cwd and preserves JSON request options', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ files: 2 }), { status: 200 })
    );
    const client = new OpencodeServeClient({
      ensureRuntime: async () => ({ baseUrl: 'http://127.0.0.1:5111' }),
      getDefaultCwd: () => 'E:\\百分数与分数',
      fetch: fetchMock
    });
    const controller = new AbortController();

    await expect(
      client.requestJson<{ files: number }>('/session/s1/diff', {
        method: 'POST',
        body: '{"messageID":"m1"}',
        signal: controller.signal
      })
    ).resolves.toEqual({ files: 2 });

    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:5111/session/s1/diff', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-opencode-directory': encodeURIComponent('E:\\百分数与分数')
      },
      body: '{"messageID":"m1"}',
      signal: controller.signal
    });
  });

  it('resolves the current runtime for every JSON and no-content request', async () => {
    const ensureRuntime = vi
      .fn()
      .mockResolvedValueOnce({ baseUrl: 'http://127.0.0.1:4096' })
      .mockResolvedValueOnce({ baseUrl: 'http://127.0.0.1:5222' });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = new OpencodeServeClient({ ensureRuntime, fetch: fetchMock });

    await client.requestJson('/global/health');
    await client.requestNoContent('/session/s1/abort', { method: 'POST' });

    expect(ensureRuntime).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'http://127.0.0.1:4096/global/health',
      'http://127.0.0.1:5222/session/s1/abort'
    ]);
  });

  it('can omit cwd for global requests', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ healthy: true }), { status: 200 })
    );
    const client = new OpencodeServeClient({
      ensureRuntime: async () => ({ baseUrl: 'http://127.0.0.1:4096' }),
      getDefaultCwd: () => 'E:\\workspace',
      fetch: fetchMock
    });

    await client.requestJson('/global/health', { includeCwd: false });

    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:4096/global/health', {
      headers: { 'Content-Type': 'application/json' }
    });
  });

  it('uses response text and the status fallback for request errors', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('  provider failed  ', { status: 400 }))
      .mockResolvedValueOnce(new Response('', { status: 503 }));
    const client = new OpencodeServeClient({
      ensureRuntime: async () => ({ baseUrl: 'http://127.0.0.1:4096' }),
      fetch: fetchMock
    });

    await expect(client.requestJson('/provider')).rejects.toThrow('provider failed');
    await expect(client.requestNoContent('/session/s1')).rejects.toThrow(
      'OpenCode serve 请求失败（503）。'
    );
  });

  it('opens SSE against the captured endpoint without resolving a new runtime', async () => {
    const ensureRuntime = vi.fn();
    const fetchMock = vi.fn(async () =>
      new Response('data: {"type":"server.connected"}\n\n', { status: 200 })
    );
    const client = new OpencodeServeClient({
      ensureRuntime,
      getDefaultCwd: () => 'E:\\workspace',
      fetch: fetchMock
    });
    const controller = new AbortController();

    await expect(
      client.openEventStream({ baseUrl: 'http://127.0.0.1:4777' }, controller.signal)
    ).resolves.toBeInstanceOf(ReadableStream);

    expect(ensureRuntime).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:4777/event', {
      headers: {
        Accept: 'text/event-stream',
        'x-opencode-directory': encodeURIComponent('E:\\workspace')
      },
      signal: controller.signal
    });
  });

  it('keeps the existing SSE status error', async () => {
    const client = new OpencodeServeClient({
      ensureRuntime: async () => ({ baseUrl: 'http://127.0.0.1:4096' }),
      fetch: async () => new Response(null, { status: 502 })
    });

    await expect(
      client.openEventStream(
        { baseUrl: 'http://127.0.0.1:4096' },
        new AbortController().signal
      )
    ).rejects.toThrow('订阅事件流失败（502）。');
  });
});
