import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createOpencodeV2AdapterState, disposeOpencodeV2Adapter, requestOpencodeV2Json,
  type OpencodeV2Endpoint
} from '../src/bridge/opencodeV2Adapter';
import type { OpencodeServeRequestOptions } from '../src/bridge/opencodeServeClient';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

function json(data: unknown) {
  return new Response(JSON.stringify({ data }), { headers: { 'Content-Type': 'application/json' } });
}

function fixture() {
  const state = createOpencodeV2AdapterState();
  const endpoint: OpencodeV2Endpoint = { baseUrl: 'http://localhost:4096', password: 'test' };
  const calls: Array<{ url: URL; method: string; signal?: AbortSignal | null; cwd?: string; body?: unknown }> = [];
  const statuses = new Map<string, string>();
  const time = { created: Date.now(), expires: Date.now() + 30 * 60_000 };
  let sequence = 0;
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    calls.push({ url, method, signal: init?.signal, cwd: (init?.headers as Record<string, string>)?.['x-opencode-directory'],
      ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
    if (url.pathname === '/api/provider') return json([{ id: 'p', integrationID: 'native', activation: 'auto' }]);
    if (url.pathname === '/api/model') return json([]);
    if (url.pathname === '/api/integration') return json([{ id: 'native', methods: [
      { type: 'oauth', id: 'auto', label: 'Auto' }, { type: 'oauth', id: 'code', label: 'Code' }
    ], connections: [] }]);
    if (url.pathname === '/api/integration/native/connect/oauth') {
      const attemptID = `con_${++sequence}`;
      statuses.set(attemptID, 'pending');
      return json({ attemptID, url: 'https://example.test/auth', instructions: '',
        mode: (JSON.parse(String(init?.body)).methodID === 'code' ? 'code' : 'auto'), time });
    }
    if (method === 'DELETE' || url.pathname.endsWith('/complete')) return new Response(null, { status: 204 });
    return json({ status: statuses.get(url.pathname.split('/').at(-1)!), time });
  });
  const call = (action: string, body: unknown, options: OpencodeServeRequestOptions = {}, target = endpoint) => requestOpencodeV2Json(
    state, fetcher, target, `/provider/p/oauth/${action}`,
    { method: 'POST', body: JSON.stringify(body), cwd: '/workspace', ...options }, '/default'
  );
  return { state, endpoint, fetcher, calls, statuses, time, call };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-26T08:00:00Z')); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('native OAuth lifecycle', () => {
  it('keeps exact attempts independent when an older callback completes after a newer authorization', async () => {
    const f = fixture();
    await f.call('authorize', { method: 0 });
    const old = f.call('callback', { method: 0, attemptID: 'con_1' });
    await vi.advanceTimersByTimeAsync(0);
    await f.call('authorize', { method: 0 });
    await expect(f.call('callback', { method: 0 })).rejects.toThrow('ambiguous');
    f.statuses.set('con_1', 'complete');
    await vi.advanceTimersByTimeAsync(500);
    await expect(old).resolves.toBe(true);
    expect([...f.state.oauthAttempts.values()].map((attempt) => attempt.attemptID)).toEqual(['con_2']);
    await f.call('cancel', { method: 0, attemptID: 'con_1' });
    expect(f.state.oauthAttempts.size).toBe(1);
    await f.call('cancel', { method: 0, attemptID: 'con_2' });
  });

  it('uses the original endpoint and directory for callback and cancellation', async () => {
    const f = fixture();
    await f.call('authorize', { method: 0 }, { cwd: '/one' });
    const otherEndpoint = { baseUrl: 'http://localhost:5096', password: 'other' };
    await f.call('authorize', { method: 0 }, { cwd: '/two' }, otherEndpoint);
    await expect(f.call('callback', { method: 0, attemptID: 'con_1' }, { cwd: '/two' }, otherEndpoint)).rejects.toThrow('not found');
    f.statuses.set('con_1', 'complete');
    await f.call('callback', { method: 0, attemptID: 'con_1' }, { cwd: '/one' });
    await f.call('cancel', { method: 0, attemptID: 'con_2' }, { cwd: '/two' }, otherEndpoint);
    const cleanup = f.calls.find((call) => call.method === 'DELETE');
    expect(cleanup?.url.origin).toBe(otherEndpoint.baseUrl);
    expect(cleanup?.cwd).toBe(encodeURIComponent('/two'));
  });

  it('lets code-mode verification wait beyond two minutes until native expiry or completion', async () => {
    const f = fixture();
    await expect(f.call('authorize', { method: 1 })).resolves.toMatchObject({ attemptID: 'con_1', method: 'code', time: f.time });
    let finished = false;
    const callback = f.call('callback', { method: 1, attemptID: 'con_1', code: 'native-code' }).then((result) => { finished = true; return result; });
    await vi.advanceTimersByTimeAsync(121_000);
    expect(finished).toBe(false);
    expect(f.calls.find((call) => call.url.pathname.endsWith('/complete'))?.body).toEqual({ code: 'native-code' });
    expect(f.calls.some((call) => call.method === 'DELETE')).toBe(false);
    f.statuses.set('con_1', 'complete');
    await vi.advanceTimersByTimeAsync(500);
    await expect(callback).resolves.toBe(true);
  });

  it('cancels during a polling delay with a fresh cleanup signal', async () => {
    const f = fixture();
    const controller = new AbortController();
    await f.call('authorize', { method: 0 }, { signal: controller.signal });
    const callback = f.call('callback', { method: 0, attemptID: 'con_1' }, { signal: controller.signal });
    const rejected = expect(callback).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await rejected;
    const cleanup = f.calls.find((call) => call.method === 'DELETE');
    expect(cleanup?.signal).not.toBe(controller.signal);
    expect(cleanup?.signal?.aborted).toBe(false);
    expect(f.state.oauthAttempts.size).toBe(0);
  });

  it('rejects a late callback response after abort and deletes only its native ID', async () => {
    const f = fixture();
    const controller = new AbortController();
    await f.call('authorize', { method: 0 });
    const late = deferred<Response>();
    const original = f.fetcher.getMockImplementation()!;
    f.fetcher.mockImplementation(async (input, init) => {
      if ((init?.method ?? 'GET') === 'GET' && String(input).endsWith('/con_1')) return late.promise;
      return original(input, init);
    });
    const callback = f.call('callback', { method: 0, attemptID: 'con_1' }, { signal: controller.signal });
    const rejected = expect(callback).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(0);
    await f.call('authorize', { method: 0 });
    controller.abort();
    late.resolve(json({ status: 'complete', time: f.time }));
    await rejected;
    expect(f.calls.filter((call) => call.method === 'DELETE').map((call) => call.url.pathname)).toEqual(['/api/integration/native/connect/oauth/con_1']);
    expect([...f.state.oauthAttempts.values()].map((attempt) => attempt.attemptID)).toEqual(['con_2']);
    await f.call('cancel', { method: 0, attemptID: 'con_2' });
  });

  it('receives and cleans up a native attempt admitted after the dialog was closed', async () => {
    const f = fixture();
    const controller = new AbortController();
    const admission = deferred<Response>();
    const original = f.fetcher.getMockImplementation()!;
    let admissionSignal: AbortSignal | null | undefined;
    f.fetcher.mockImplementation(async (input, init) => {
      if (String(input).endsWith('/connect/oauth')) { admissionSignal = init?.signal; return admission.promise; }
      return original(input, init);
    });
    const authorize = f.call('authorize', { method: 0 }, { signal: controller.signal });
    const rejected = expect(authorize).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    expect(admissionSignal?.aborted).toBe(false);
    admission.resolve(json({ attemptID: 'con_late', url: 'https://example.test', instructions: '', mode: 'auto', time: f.time }));
    await rejected;
    expect(f.calls.filter((call) => call.method === 'DELETE').map((call) => call.url.pathname)).toEqual(['/api/integration/native/connect/oauth/con_late']);
    expect(f.state.oauthAttempts.size).toBe(0);
  });

  it('follows native expiry and cleans known IDs when an admission response is malformed', async () => {
    const f = fixture();
    f.time.expires = Date.now() + 1000;
    await f.call('authorize', { method: 0 });
    const callback = f.call('callback', { method: 0, attemptID: 'con_1' });
    const rejected = expect(callback).rejects.toThrow('expired');
    await vi.advanceTimersByTimeAsync(1000);
    await rejected;
    expect(f.state.oauthAttempts.size).toBe(0);
    const original = f.fetcher.getMockImplementation()!;
    f.fetcher.mockImplementation(async (input, init) => String(input).endsWith('/connect/oauth')
      ? json({ attemptID: 'con_bad', mode: 'auto', url: 'https://example.test' }) : original(input, init));
    await expect(f.call('authorize', { method: 0 })).rejects.toThrow('timing');
    expect(f.calls.filter((call) => call.method === 'DELETE').map((call) => call.url.pathname)).toContain('/api/integration/native/connect/oauth/con_bad');
  });

  it('disposes all attempts and prevents further admissions', async () => {
    const f = fixture();
    await f.call('authorize', { method: 0 });
    await f.call('authorize', { method: 1 });
    await disposeOpencodeV2Adapter(f.state, f.fetcher);
    expect(f.state.oauthAttempts.size).toBe(0);
    expect(f.calls.filter((call) => call.method === 'DELETE')).toHaveLength(2);
    await expect(f.call('authorize', { method: 0 })).rejects.toMatchObject({ name: 'AbortError' });
  });
});
