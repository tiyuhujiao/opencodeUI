import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  sessionListJson: vi.fn(),
  modelsList: vi.fn(),
  modelsVerbose: vi.fn()
}));

vi.mock('vscode', () => ({ workspace: {} }), { virtual: true });

vi.mock('../src/bridge/opencodeCli', () => ({
  agentList: vi.fn(),
  authList: vi.fn(),
  exportSessionToJsonText: vi.fn(),
  modelsList: mocks.modelsList,
  modelsVerbose: mocks.modelsVerbose,
  OpencodeCliError: class OpencodeCliError extends Error {
    public constructor(public readonly code: string, message: string) {
      super(message);
      this.name = 'OpencodeCliError';
    }
  },
  runStream: vi.fn(),
  sessionDelete: vi.fn(),
  sessionListJson: mocks.sessionListJson
}));

vi.mock('../src/bridge/serveManager', () => ({
  ensureServeRunning: vi.fn()
}));

vi.mock('../src/bridge/opencodeEnv', () => ({
  resolveOpencodeBinary: vi.fn(() => 'opencode'),
  withOpencodeBinInPath: vi.fn(() => process.env)
}));

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

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function session(id: string, title: string, updated: string, directory = '/workspace') {
  return {
    id,
    title,
    updated,
    created: updated,
    projectId: 'project',
    directory
  };
}

afterEach(() => {
  mocks.sessionListJson.mockReset();
  mocks.modelsList.mockReset();
  mocks.modelsVerbose.mockReset();
});

describe('refresh performance guards', () => {
  it('前端启动时预热模型，并把新会话列表刷新放到后台', () => {
    const source = readFileSync(join(process.cwd(), 'webview-ui/src/App.tsx'), 'utf8');

    expect(source).toContain('requestModels()');
    expect(source).toContain('requestSessions({ background: true })');
    expect(source).toContain('hasBlockingSessionListRequests');
  });

  it('session 列表同时拉取 workspace 与全局作用域，并排除其他 global 非 Git 目录', async () => {
    const workspaceList = createDeferred<{ stdout: string }>();
    const globalList = createDeferred<{ stdout: string }>();
    mocks.sessionListJson.mockImplementation((opts?: { cwd?: string }) => (opts?.cwd ? workspaceList.promise : globalList.promise));

    const provider = createProvider() as unknown as {
      getDefaultCwd: () => string | undefined;
      getSessionListForCurrentScopes: () => Promise<unknown[]>;
      isV2Runtime: () => Promise<boolean>;
    };
    provider.getDefaultCwd = () => '/workspace';
    provider.isV2Runtime = async () => false;

    const result = provider.getSessionListForCurrentScopes();
    await Promise.resolve();

    expect(mocks.sessionListJson).toHaveBeenCalledTimes(2);
    expect(mocks.sessionListJson).toHaveBeenNthCalledWith(1, { cwd: '/workspace' });
    expect(mocks.sessionListJson).toHaveBeenNthCalledWith(2);

    workspaceList.resolve({ stdout: JSON.stringify([session('workspace-session', 'Workspace', '2026-05-28T10:00:00.000Z')]) });
    globalList.resolve({
      stdout: JSON.stringify([
        session('global-session', 'Global', '2026-05-28T09:00:00.000Z'),
        session('other-directory', 'Other', '2026-05-28T11:00:00.000Z', '/another-workspace')
      ])
    });

    await expect(result).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'workspace-session' }),
      expect.objectContaining({ id: 'global-session' })
    ]));
    await expect(result).resolves.toHaveLength(2);
  });

  it('历史搜索最多并发读取六个会话，并在取消后停止调度剩余会话', async () => {
    const gate = createDeferred<void>();
    let active = 0;
    let maxActive = 0;
    const searchSessionMessages = vi.fn(async (item: ReturnType<typeof session>) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await gate.promise;
      active -= 1;
      return [{
        sessionId: item.id,
        title: item.title,
        updated: item.updated,
        messageIndex: 0,
        role: 'assistant' as const,
        occurrence: 0,
        snippet: 'needle'
      }];
    });
    const provider = createProvider() as unknown as {
      searchSessionMessages: typeof searchSessionMessages;
      loadSessionSearchHits: (
        sessions: ReturnType<typeof session>[],
        query: string,
        signal: AbortSignal
      ) => Promise<Array<{ sessionId: string }>>;
    };
    provider.searchSessionMessages = searchSessionMessages;
    const controller = new AbortController();
    const sessions = Array.from({ length: 10 }, (_, index) => (
      session(`session-${String(index)}`, `Session ${String(index)}`, `2026-08-24T12:${String(index).padStart(2, '0')}:00.000Z`)
    ));

    const result = provider.loadSessionSearchHits(sessions, 'needle', controller.signal);
    await vi.waitFor(() => expect(searchSessionMessages).toHaveBeenCalledTimes(6));
    expect(maxActive).toBe(6);

    controller.abort();
    gate.resolve();
    await expect(result).resolves.toEqual([]);
    expect(searchSessionMessages).toHaveBeenCalledTimes(6);
  });

  it('历史搜索直接复用 serve 消息接口，并按 session 更新时间缓存正文', async () => {
    const provider = createProvider() as unknown as {
      requestServeJson: (pathname: string, init?: { signal?: AbortSignal }) => Promise<unknown>;
      getSessionSearchMessages: (
        item: ReturnType<typeof session>,
        signal: AbortSignal
      ) => Promise<{ transcript: Array<{ role: string; parts: unknown[] }> }>;
    };
    provider.requestServeJson = vi.fn(async (pathname: string) => {
      expect(pathname).toMatch(/\/message$/);
      return [{
        info: { id: 'assistant-1', role: 'assistant' },
        parts: [{ type: 'text', text: 'needle in the response' }]
      }];
    });
    const firstSession = session('session-1', 'Session 1', '2026-08-24T12:00:00.000Z');

    const first = await provider.getSessionSearchMessages(firstSession, new AbortController().signal);
    const second = await provider.getSessionSearchMessages(firstSession, new AbortController().signal);

    expect(first.transcript[0]?.parts[0]).toMatchObject({ type: 'text', text: 'needle in the response' });
    expect(second).toBe(first);
    expect(provider.requestServeJson).toHaveBeenCalledTimes(1);

    await provider.getSessionSearchMessages(
      { ...firstSession, updated: '2026-08-24T12:01:00.000Z' },
      new AbortController().signal
    );
    expect(provider.requestServeJson).toHaveBeenCalledTimes(2);
  });

  it('并发模型强制刷新复用同一个 opencode models --verbose 请求并透传 variants', async () => {
    const modelsVerbose = createDeferred<{ stdout: string }>();
    mocks.modelsVerbose.mockReturnValue(modelsVerbose.promise);

    const provider = createProvider() as unknown as {
      getAllModelsPayload: (forceRefresh?: boolean) => Promise<Array<{ name: string; providerID: string; variants?: string[]; supportsThinking?: boolean }>>;
      isV2Runtime: () => Promise<boolean>;
    };
    provider.isV2Runtime = async () => false;

    const first = provider.getAllModelsPayload(true);
    const second = provider.getAllModelsPayload(true);
    await Promise.resolve();

    expect(mocks.modelsVerbose).toHaveBeenCalledTimes(1);
    expect(mocks.modelsList).not.toHaveBeenCalled();

    modelsVerbose.resolve({
      stdout: `openai/gpt-5.4
{
  "capabilities": {
    "reasoning": true
  },
  "variants": {
    "none": {},
    "low": {},
    "high": {}
  }
}

anthropic/claude-sonnet-4.5
{
  "capabilities": {
    "reasoning": false
  },
  "variants": {}
}
`
    });

    await expect(Promise.all([first, second])).resolves.toEqual([
      [
        { name: 'openai/gpt-5.4', providerID: 'openai', variants: ['none', 'low', 'high'], supportsThinking: true },
        { name: 'anthropic/claude-sonnet-4.5', providerID: 'anthropic', variants: undefined, supportsThinking: false }
      ],
      [
        { name: 'openai/gpt-5.4', providerID: 'openai', variants: ['none', 'low', 'high'], supportsThinking: true },
        { name: 'anthropic/claude-sonnet-4.5', providerID: 'anthropic', variants: undefined, supportsThinking: false }
      ]
    ]);
  });

  it('models --verbose 失败时回退到轻量 models 列表', async () => {
    mocks.modelsVerbose.mockRejectedValue(new Error('bad verbose output'));
    mocks.modelsList.mockResolvedValue({ stdout: 'openai/gpt-4.1\nanthropic/claude-sonnet-4.5' });

    const provider = createProvider() as unknown as {
      getAllModelsPayload: (forceRefresh?: boolean) => Promise<Array<{ name: string; providerID: string }>>;
      isV2Runtime: () => Promise<boolean>;
    };
    provider.isV2Runtime = async () => false;

    await expect(provider.getAllModelsPayload(true)).resolves.toEqual([
      { name: 'openai/gpt-4.1', providerID: 'openai' },
      { name: 'anthropic/claude-sonnet-4.5', providerID: 'anthropic' }
    ]);
    expect(mocks.modelsVerbose).toHaveBeenCalledTimes(1);
    expect(mocks.modelsList).toHaveBeenCalledTimes(1);
  });
});
