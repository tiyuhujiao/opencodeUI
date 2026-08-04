import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({ workspace: {} }), { virtual: true });

import { buildWorkspaceSearchGlobs, SidebarProvider } from '../src/webview/SidebarProvider';

function createProvider() {
  return new SidebarProvider(
    { fsPath: '/ext' } as never,
    { get: () => undefined, update: async () => {} } as never,
    'wsl',
    'wsl'
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe('composer resources', () => {
  it('为大型工作区同时保留基础索引与查询定向 glob', () => {
    expect(buildWorkspaceSearchGlobs('webview-ui\\src')).toEqual([
      '**/*',
      '**/*webview-ui/src*',
      '**/*webview-ui/src*/**/*'
    ]);
    expect(buildWorkspaceSearchGlobs('')).toEqual(['**/*']);
  });

  it('并行读取并规范化 OpenCode command、skill 与 MCP 状态', async () => {
    const provider = createProvider() as unknown as {
      requestServeJson: (pathname: string) => Promise<unknown>;
      handleComposerResourcesListRequest: (
        webview: { postMessage: (message: unknown) => Thenable<boolean> },
        requestId: string
      ) => Promise<void>;
    };
    provider.requestServeJson = vi.fn(async (pathname: string) => {
      if (pathname === '/command') {
        return [{ name: '/review', description: ' Review changes ', source: 'command', hints: ['path'] }];
      }
      if (pathname === '/skill') {
        return [{ name: 'docs', description: ' Read docs ' }];
      }
      return {
        browser: { status: 'connected' },
        legacy: 'disabled'
      };
    });
    const posted: unknown[] = [];

    await provider.handleComposerResourcesListRequest({
      postMessage: async (message: unknown) => {
        posted.push(message);
        return true;
      }
    }, 'resources-1');

    expect(provider.requestServeJson).toHaveBeenCalledTimes(3);
    expect(posted[0]).toEqual({
      type: 'composer.resources.list.response',
      requestId: 'resources-1',
      ok: true,
      payload: {
        commands: [{ name: 'review', description: 'Review changes', source: 'command', hints: ['path'] }],
        skills: [{ name: 'docs', description: 'Read docs' }],
        mcpServers: [
          { name: 'browser', status: 'connected', enabled: true },
          { name: 'legacy', status: 'disabled', enabled: false }
        ]
      }
    });
  });

  it('通过 OpenCode 官方 connect/disconnect endpoint 切换 MCP 并返回最新状态', async () => {
    const provider = createProvider() as unknown as {
      requestServeNoContent: (pathname: string, init: { method?: string }) => Promise<void>;
      requestServeJson: (pathname: string) => Promise<unknown>;
      handleMcpSetEnabledRequest: (
        webview: { postMessage: (message: unknown) => Thenable<boolean> },
        requestId: string,
        name: string,
        enabled: boolean
      ) => Promise<void>;
    };
    provider.requestServeNoContent = vi.fn(async () => {});
    provider.requestServeJson = vi.fn(async () => ({ browser: { status: 'connected' } }));
    const posted: unknown[] = [];

    await provider.handleMcpSetEnabledRequest({
      postMessage: async (message: unknown) => {
        posted.push(message);
        return true;
      }
    }, 'mcp-1', 'browser', true);

    expect(provider.requestServeNoContent).toHaveBeenCalledWith('/mcp/browser/connect', { method: 'POST' });
    expect(posted[0]).toEqual({
      type: 'mcp.setEnabled.response',
      requestId: 'mcp-1',
      ok: true,
      payload: { server: { name: 'browser', status: 'connected', enabled: true } }
    });
  });

  it('POST 后首次仍是旧状态时继续轮询，直到 MCP 真正断开', async () => {
    vi.useFakeTimers();
    const provider = createProvider() as unknown as {
      requestServeNoContent: (pathname: string, init: { method?: string }) => Promise<void>;
      requestServeJson: (pathname: string) => Promise<unknown>;
      handleMcpSetEnabledRequest: (
        webview: { postMessage: (message: unknown) => Thenable<boolean> },
        requestId: string,
        name: string,
        enabled: boolean
      ) => Promise<void>;
    };
    provider.requestServeNoContent = vi.fn(async () => {});
    provider.requestServeJson = vi
      .fn()
      .mockResolvedValueOnce({ browser: { status: 'connected' } })
      .mockResolvedValueOnce({ browser: { status: 'disabled' } });
    const posted: unknown[] = [];

    const request = provider.handleMcpSetEnabledRequest({
      postMessage: async (message: unknown) => {
        posted.push(message);
        return true;
      }
    }, 'mcp-disconnect', 'browser', false);

    await vi.runAllTimersAsync();
    await request;

    expect(provider.requestServeNoContent).toHaveBeenCalledWith('/mcp/browser/disconnect', { method: 'POST' });
    expect(provider.requestServeJson).toHaveBeenCalledTimes(2);
    expect(posted[0]).toMatchObject({
      type: 'mcp.setEnabled.response',
      payload: { server: { name: 'browser', status: 'disabled', enabled: false } }
    });
  });

  it('MCP 状态读取失败时保留其他资源并返回可见错误', async () => {
    const provider = createProvider() as unknown as {
      requestServeJson: (pathname: string) => Promise<unknown>;
      handleComposerResourcesListRequest: (
        webview: { postMessage: (message: unknown) => Thenable<boolean> },
        requestId: string
      ) => Promise<void>;
    };
    provider.requestServeJson = vi.fn(async (pathname: string) => {
      if (pathname === '/mcp') {
        throw new Error('MCP status unavailable');
      }
      return [];
    });
    const posted: unknown[] = [];

    await provider.handleComposerResourcesListRequest({
      postMessage: async (message: unknown) => {
        posted.push(message);
        return true;
      }
    }, 'resources-error');

    expect(posted[0]).toMatchObject({
      type: 'composer.resources.list.response',
      payload: {
        commands: [],
        skills: [],
        mcpServers: [],
        mcpError: 'MCP status unavailable'
      }
    });
  });

  it('切换期间一次状态读取失败不会提前终止轮询', async () => {
    vi.useFakeTimers();
    const provider = createProvider() as unknown as {
      requestServeNoContent: () => Promise<void>;
      requestServeJson: () => Promise<unknown>;
      handleMcpSetEnabledRequest: (
        webview: { postMessage: (message: unknown) => Thenable<boolean> },
        requestId: string,
        name: string,
        enabled: boolean
      ) => Promise<void>;
    };
    provider.requestServeNoContent = vi.fn(async () => {});
    provider.requestServeJson = vi
      .fn()
      .mockRejectedValueOnce(new Error('temporary read failure'))
      .mockResolvedValueOnce({ browser: { status: 'connected' } });
    const posted: unknown[] = [];

    const request = provider.handleMcpSetEnabledRequest({
      postMessage: async (message: unknown) => {
        posted.push(message);
        return true;
      }
    }, 'mcp-retry', 'browser', true);

    await vi.runAllTimersAsync();
    await request;

    expect(provider.requestServeJson).toHaveBeenCalledTimes(2);
    expect(posted[0]).toMatchObject({
      type: 'mcp.setEnabled.response',
      payload: { server: { status: 'connected', enabled: true } }
    });
  });
});
