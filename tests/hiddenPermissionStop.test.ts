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

describe('SidebarProvider hidden permission handling', () => {
  it('侧边栏隐藏时自动拒绝挂起权限并停止当前 run', () => {
    const provider = createProvider() as unknown as {
      currentRun?: {
        requestId: string;
        controller: { abort: () => void };
        eventAbort?: { abort: () => void };
        pendingPermission?: {
          type: 'permission';
          permissionId: string;
          sessionId: string;
          toolName: string;
          patterns: string[];
        };
      };
      requestServeJson: (pathname: string, init: { method?: string; body?: string }) => Promise<boolean>;
      stopCurrentRunForHiddenPermission: (webview: { postMessage: (message: unknown) => Thenable<boolean> }) => void;
    };
    const controllerAbort = vi.fn();
    const eventAbort = vi.fn();
    const posted: unknown[] = [];
    const webview = {
      postMessage: async (message: unknown) => {
        posted.push(message);
        return true;
      }
    };
    provider.requestServeJson = vi.fn(async () => true);
    provider.currentRun = {
      requestId: 'run-1',
      controller: { abort: controllerAbort },
      eventAbort: { abort: eventAbort },
      pendingPermission: {
        type: 'permission',
        permissionId: 'permission-1',
        sessionId: 'session-1',
        toolName: 'write',
        patterns: ['/tmp/file']
      }
    };

    provider.stopCurrentRunForHiddenPermission(webview);

    expect(provider.requestServeJson).toHaveBeenCalledWith(
      '/permission/permission-1/reply',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"reply":"reject"')
      })
    );
    expect(posted[0]).toMatchObject({
      type: 'run.event',
      requestId: 'run-1',
      ok: true,
      payload: {
        event: {
          type: 'stopped'
        }
      }
    });
    expect(controllerAbort).toHaveBeenCalledOnce();
    expect(eventAbort).toHaveBeenCalledOnce();
    expect(provider.currentRun).toBeUndefined();
  });
});
