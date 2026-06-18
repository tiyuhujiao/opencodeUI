import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({ workspace: {} }), { virtual: true });

import { SidebarProvider } from '../src/webview/SidebarProvider';

function createProvider() {
  return new SidebarProvider(
    { fsPath: '/ext' } as never,
    {
      get: () => undefined,
      update: async () => {}
    } as never,
    'wsl',
    'wsl'
  );
}

describe('SidebarProvider run stop', () => {
  it('aborts the active serve session before stopping the local run', async () => {
    const provider = createProvider() as unknown as {
      currentRun?: {
        requestId: string;
        sessionId?: string;
        controller: { abort: () => void };
        eventAbort?: { abort: () => void };
      };
      requestServeNoContent: (pathname: string, init: { method?: string; signal?: AbortSignal }) => Promise<void>;
      handleRunStopRequest: (webview: { postMessage: (message: unknown) => Thenable<boolean> }, requestId: string) => Promise<void>;
    };
    const controllerAbort = vi.fn();
    const eventAbort = vi.fn();
    const posted: unknown[] = [];
    provider.requestServeNoContent = vi.fn(async () => {});
    provider.currentRun = {
      requestId: 'run-1',
      sessionId: 'session-1',
      controller: { abort: controllerAbort },
      eventAbort: { abort: eventAbort }
    };

    await provider.handleRunStopRequest(
      {
        postMessage: async (message: unknown) => {
          posted.push(message);
          return true;
        }
      },
      'stop-1'
    );

    expect(provider.requestServeNoContent).toHaveBeenCalledWith(
      '/session/session-1/abort',
      expect.objectContaining({
        method: 'POST',
        signal: expect.any(AbortSignal)
      })
    );
    expect(controllerAbort).toHaveBeenCalledOnce();
    expect(eventAbort).toHaveBeenCalledOnce();
    expect(posted[0]).toMatchObject({
      type: 'run.stop.response',
      requestId: 'stop-1',
      ok: true,
      payload: {
        stopped: true
      }
    });
  });

  it('clears backend run state before notifying the webview about terminal events', () => {
    const source = readFileSync(join(process.cwd(), 'src/webview/SidebarProvider.ts'), 'utf8');

    expect(source).toContain("this.clearCurrentRunForRequest(requestId);\n        this.respondRunEvent(webview, requestId, { type: 'stopped' });");
    expect(source).toContain("this.clearCurrentRunForRequest(requestId);\n      this.respondRunEvent(webview, requestId, { type: 'done' });");
  });
});
