import { afterEach, describe, expect, it, vi } from 'vitest';
import { delimiter, join, win32 } from 'node:path';
import { homedir } from 'node:os';

const windowsIt = process.platform === 'win32' ? it : it.skip;

vi.mock('node:http', () => ({
  request: vi.fn()
}));

vi.mock('node:net', () => ({
  createServer: vi.fn()
}));

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
  spawn: vi.fn()
}));

type HealthScenario =
  | { type: 'status'; statusCode: number; body?: unknown }
  | { type: 'v2'; version: string }
  | { type: 'error' }
  | { type: 'timeout' };

type MockServerScript =
  | { type: 'error' }
  | { type: 'listening'; addressPort: number; closeError?: Error };

class FakeChildProcess {
  public pid: number | undefined;
  public exitCode: number | null = null;
  public readonly kill = vi.fn(() => true);
  public stderrTextOnSubscribe: string | undefined;
  public readonly stderr = {
    on: vi.fn((event: string, listener: (chunk: Buffer) => void) => {
      if (event === 'data' && this.stderrTextOnSubscribe) {
        listener(Buffer.from(this.stderrTextOnSubscribe, 'utf8'));
      }
    })
  };

  private readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>();

  public on(event: string, listener: (...args: unknown[]) => void): this {
    const list = this.listeners.get(event) ?? [];
    list.push(listener);
    this.listeners.set(event, list);
    return this;
  }

  public once(event: string, listener: (...args: unknown[]) => void): this {
    const wrapped = (...args: unknown[]): void => {
      this.removeListener(event, wrapped);
      listener(...args);
    };

    return this.on(event, wrapped);
  }

  public removeListener(event: string, listener: (...args: unknown[]) => void): this {
    const list = this.listeners.get(event) ?? [];
    this.listeners.set(
      event,
      list.filter((item) => item !== listener)
    );
    return this;
  }

  public emit(event: string, ...args: unknown[]): void {
    const list = [...(this.listeners.get(event) ?? [])];
    for (const listener of list) {
      listener(...args);
    }
  }
}

function configureHealthResponses(
  requestMock: ReturnType<typeof vi.fn>,
  byPort: Record<number, HealthScenario>
): number[] {
  const calledPorts: number[] = [];

  requestMock.mockImplementation((options: { port?: number; path?: string; headers?: Record<string, string> }, callback: (res: {
    statusCode?: number
    resume: () => void
    on: (event: string, listener: (chunk?: Buffer) => void) => void
    destroy: () => void
  }) => void) => {
    const port = Number(options.port);
    calledPorts.push(port);

    const scenario = byPort[port] ?? { type: 'error' };
    const handlers: Record<string, () => void> = {};

    const req = {
      on: vi.fn((event: string, handler: () => void) => {
        handlers[event] = handler;
        return req;
      }),
      destroy: vi.fn(),
      end: vi.fn(() => {
        if (scenario.type === 'error') {
          handlers.error?.();
          return;
        }

        if (scenario.type === 'timeout') {
          handlers.timeout?.();
          return;
        }

        const listeners = new Map<string, (chunk?: Buffer) => void>()
        const isV2Info = scenario.type === 'v2' && options.path === '/api/info';
        const response = {
          statusCode:
            scenario.type === 'v2'
              ? isV2Info
                ? 200
                : 404
              : scenario.statusCode,
          resume: () => {},
          destroy: () => {},
          on: (event: string, listener: (chunk?: Buffer) => void) => {
            listeners.set(event, listener)
            if (event === 'data') {
              listener(Buffer.from(JSON.stringify(
                scenario.type === 'v2'
                  ? { version: scenario.version }
                  : scenario.body ?? { healthy: true, version: '1.18.21' }
              )))
            }
            if (event === 'end') {
              listener()
            }
          }
        }
        callback(response);
      })
    };

    return req;
  });

  return calledPorts;
}

function configureNetServers(createServerMock: ReturnType<typeof vi.fn>, scripts: MockServerScript[]): void {
  const queue = [...scripts];

  createServerMock.mockImplementation(() => {
    const script = queue.shift();
    if (!script) {
      throw new Error('缺少 net.createServer 脚本');
    }

    const handlers: Record<string, (...args: unknown[]) => void> = {};

    return {
      once: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        handlers[event] = handler;
      }),
      listen: vi.fn(() => {
        if (script.type === 'error') {
          handlers.error?.(new Error('EADDRINUSE'));
          return;
        }

        handlers.listening?.();
      }),
      address: vi.fn(() => {
        if (script.type === 'error') {
          return null;
        }

        return { port: script.addressPort };
      }),
      close: vi.fn((callback?: (error?: Error) => void) => {
        callback?.(script.type === 'listening' ? script.closeError : undefined);
      })
    };
  });
}

async function setup(lastPort: number | undefined) {
  vi.resetModules();

  const httpMod = await import('node:http');
  const netMod = await import('node:net');
  const childProcessMod = await import('node:child_process');

  const requestMock = vi.mocked(httpMod.request);
  const createServerMock = vi.mocked(netMod.createServer);
  const spawnMock = vi.mocked(childProcessMod.spawn);
  const execFileMock = vi.mocked(childProcessMod.execFile);
  const opencodeEnv = await import('../src/bridge/opencodeEnv');

  requestMock.mockReset();
  createServerMock.mockReset();
  spawnMock.mockReset();
  execFileMock.mockReset();

  const setLastPort = vi.fn(async () => {});
  const storedPasswords = new Map<number, string>();
  const setPassword = vi.fn(
    async (port: number, password: string | undefined) => {
      if (password) {
        storedPasswords.set(port, password);
      } else {
        storedPasswords.delete(port);
      }
    },
  );

  const serveManager = await import('../src/bridge/serveManager');
  serveManager.configureServePortStorage({
    getLastPort: () => lastPort,
    setLastPort,
    getPassword: (port: number) => storedPasswords.get(port),
    setPassword
  });

  return {
    serveManager,
    requestMock,
    createServerMock,
    spawnMock,
    execFileMock,
    opencodeEnv,
    setLastPort,
    setPassword,
    storedPasswords
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete process.env.OPENCODE_PASSWORD;
  delete process.env.OPENCODE_SERVER_PASSWORD;
});

describe('ensureServeRunning 端口策略', () => {
  it('serve JSON 请求复用已发现端口并编码 workspace cwd', async () => {
    const { serveManager, requestMock } = await setup(5111);
    configureHealthResponses(requestMock, {
      5111: { type: 'status', statusCode: 200 }
    });
    const fetchMock = vi.fn(async (input: string | URL | Request) =>
      new Response(
        JSON.stringify(String(input).endsWith('/path') ? { directory: 'E:\\' } : { files: 2 }),
        { status: 200 }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    const cwd = 'E:\\百分数与分数';
    await expect(serveManager.requestServeJson('/session/s1/diff?messageID=m1', cwd)).resolves.toEqual({
      files: 2
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:5111/session/s1/diff?messageID=m1',
      {
        headers: {
          'Content-Type': 'application/json',
          'x-opencode-directory': encodeURIComponent(cwd)
        }
      }
    );
  });

  it('优先复用 lastPort，并在健康时持久化', async () => {
    const { serveManager, requestMock, spawnMock, setLastPort } = await setup(5111);
    const calledPorts = configureHealthResponses(requestMock, {
      5111: { type: 'status', statusCode: 200 }
    });

    const runtime = await serveManager.ensureServeRunning();

    expect(runtime).toMatchObject({
      port: 5111,
      baseUrl: 'http://127.0.0.1:5111',
      startedByManager: false
    });
    expect(calledPorts).toEqual([5111]);
    expect(setLastPort).toHaveBeenCalledWith(5111);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('识别 V2 健康端点，并携带 OPENCODE_PASSWORD 完成 Basic Auth 探测', async () => {
    const { serveManager, requestMock, spawnMock } = await setup(5111);
    process.env.OPENCODE_PASSWORD = 'secret';
    const calledPaths: string[] = [];
    requestMock.mockImplementation((options: { path?: string; headers?: Record<string, string> }, callback: (res: {
      statusCode?: number
      resume: () => void
      on: (event: string, listener: (chunk?: Buffer) => void) => void
      destroy: () => void
    }) => void) => {
      calledPaths.push(options.path ?? '');
      const isInfo = options.path === '/api/info';
      expect(options.headers?.authorization).toBe(
        `Basic ${Buffer.from('opencode:secret').toString('base64')}`,
      );
      const response = {
        statusCode: isInfo ? 200 : 404,
        resume: () => {},
        destroy: () => {},
        on: (event: string, listener: (chunk?: Buffer) => void) => {
          if (isInfo && event === 'data') {
            listener(Buffer.from(JSON.stringify({ version: '2.1.2' })));
          }
          if (isInfo && event === 'end') {
            listener();
          }
        },
      };
      callback(response);
      return {
        on: vi.fn(),
        destroy: vi.fn(),
        end: vi.fn(),
      };
    });

    await expect(serveManager.ensureServeRunning('/workspace')).resolves.toMatchObject({
      port: 5111,
      apiVersion: 'v2',
      version: '2.1.2',
      password: 'secret',
      startedByManager: false,
    });
    expect(calledPaths).toEqual(['/global/health', '/api/info']);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('复用候选 V2 runtime 时使用持久化密码', async () => {
    const { serveManager, requestMock, spawnMock, storedPasswords } = await setup(5111);
    storedPasswords.set(5111, 'stored-secret');
    const calledPaths: string[] = [];
    requestMock.mockImplementation((options: { path?: string; headers?: Record<string, string> }, callback: (res: {
      statusCode?: number
      resume: () => void
      on: (event: string, listener: (chunk?: Buffer) => void) => void
      destroy: () => void
    }) => void) => {
      calledPaths.push(options.path ?? '');
      const isInfo = options.path === '/api/info';
      expect(options.headers?.authorization).toBe(
        `Basic ${Buffer.from('opencode:stored-secret').toString('base64')}`,
      );
      const response = {
        statusCode: isInfo ? 200 : 404,
        resume: () => {},
        destroy: () => {},
        on: (event: string, listener: (chunk?: Buffer) => void) => {
          if (isInfo && event === 'data') {
            listener(Buffer.from(JSON.stringify({ version: '2.1.4' })));
          }
          if (isInfo && event === 'end') {
            listener();
          }
        },
      };
      callback(response);
      return {
        on: vi.fn(),
        destroy: vi.fn(),
        end: vi.fn(),
      };
    });

    await expect(serveManager.ensureServeRunning('/workspace')).resolves.toMatchObject({
      port: 5111,
      apiVersion: 'v2',
      version: '2.1.4',
      password: 'stored-secret',
      startedByManager: false,
    });
    expect(calledPaths).toEqual(['/global/health', '/api/info']);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('启动受管 V2 服务后持久化生成密码', async () => {
    vi.useFakeTimers();
    const { serveManager, requestMock, createServerMock, spawnMock, setPassword } =
      await setup(undefined);
    configureHealthResponses(requestMock, {
      4096: { type: 'error' },
      5522: { type: 'v2', version: '2.1.4' }
    });
    configureNetServers(createServerMock, [
      { type: 'error' },
      { type: 'listening', addressPort: 5522 }
    ]);
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child as never);

    const runtimePromise = serveManager.ensureServeRunning();
    await vi.advanceTimersByTimeAsync(350);
    const runtime = await runtimePromise;

    const env = spawnMock.mock.calls[0]?.[2]?.env as NodeJS.ProcessEnv;
    expect(runtime).toMatchObject({
      port: 5522,
      apiVersion: 'v2',
      startedByManager: true
    });
    expect(env.OPENCODE_PASSWORD).toBeTruthy();
    expect(runtime.password).toBe(env.OPENCODE_PASSWORD);
    expect(setPassword).toHaveBeenCalledWith(5522, env.OPENCODE_PASSWORD);
  });

  it('已知 V2 runtime 时优先只探测 /api/info', async () => {
    const { serveManager, requestMock } = await setup(undefined);
    const calledPaths: string[] = [];
    requestMock.mockImplementation((options: { path?: string }, callback: (res: {
      statusCode?: number
      resume: () => void
      on: (event: string, listener: (chunk?: Buffer) => void) => void
      destroy: () => void
    }) => void) => {
      calledPaths.push(options.path ?? '');
      const response = {
        statusCode: options.path === '/api/info' ? 200 : 404,
        resume: () => {},
        destroy: () => {},
        on: (event: string, listener: (chunk?: Buffer) => void) => {
          if (options.path === '/api/info' && event === 'data') {
            listener(Buffer.from(JSON.stringify({ version: '2.1.4' })));
          }
          if (options.path === '/api/info' && event === 'end') {
            listener();
          }
        },
      };
      callback(response);
      return {
        on: vi.fn(),
        destroy: vi.fn(),
        end: vi.fn(),
      };
    });

    await expect(
      serveManager.probeServeRuntime(5111, 'secret', 'v2'),
    ).resolves.toMatchObject({
      apiVersion: 'v2',
      version: '2.1.4',
      password: 'secret'
    });
    expect(calledPaths).toEqual(['/api/info']);
  });

  it('Windows 路径根目录比较兼容斜杠与盘符大小写', async () => {
    const { serveManager } = await setup(undefined);

    expect(serveManager.resolveServeStartupDirectory('E:/devin-byok', 'win32')).toBe('E:\\');
    expect(serveManager.isServeDirectoryCompatible('e:\\tools', 'E:/devin-byok', 'win32')).toBe(true);
    expect(serveManager.isServeDirectoryCompatible('C:\\Users\\Administrator', 'E:\\devin-byok', 'win32')).toBe(false);
    expect(serveManager.isServeDirectoryCompatible(undefined, 'E:\\devin-byok', 'win32')).toBe(false);
    expect(serveManager.isServeDirectoryCompatible('/home/user', '/workspace', 'linux')).toBe(true);
  });

  windowsIt('复用同盘符的外部 runtime', async () => {
    const { serveManager, requestMock, spawnMock } = await setup(5111);
    configureHealthResponses(requestMock, {
      5111: { type: 'status', statusCode: 200 }
    });
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ directory: 'E:\\other-workspace' }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(serveManager.ensureServeRunning('E:\\devin-byok')).resolves.toMatchObject({
      port: 5111,
      startedByManager: false
    });

    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:5111/path', expect.objectContaining({
      signal: expect.any(AbortSignal)
    }));
    expect(spawnMock).not.toHaveBeenCalled();
  });

  windowsIt('跨盘外部 runtime 不复用，并从 workspace 盘符根目录启动', async () => {
    vi.useFakeTimers();
    const { serveManager, requestMock, createServerMock, spawnMock } = await setup(4096);
    const calledPorts = configureHealthResponses(requestMock, {
      4096: { type: 'status', statusCode: 200 },
      5522: { type: 'status', statusCode: 200 }
    });
    configureNetServers(createServerMock, [
      { type: 'error' },
      { type: 'listening', addressPort: 5522 }
    ]);
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ directory: 'C:\\Users\\Administrator' }), { status: 200 })
    ));
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child as never);

    const runtimePromise = serveManager.ensureServeRunning('E:\\devin-byok');
    await vi.advanceTimersByTimeAsync(350);
    await expect(runtimePromise).resolves.toMatchObject({
      port: 5522,
      startedByManager: true
    });

    expect(calledPorts).toEqual([4096, 5522]);
    expect(spawnMock).toHaveBeenCalledWith(
      expect.any(String),
      ['serve', '--hostname', '127.0.0.1', '--port', '5522'],
      expect.objectContaining({ cwd: 'E:\\' })
    );
  });

  windowsIt('切换到另一盘符时回收旧的 managed runtime', async () => {
    vi.useFakeTimers();
    const { serveManager, requestMock, createServerMock, spawnMock, execFileMock } = await setup(undefined);
    configureHealthResponses(requestMock, {
      4096: { type: 'error' },
      5522: { type: 'status', statusCode: 200 },
      6633: { type: 'status', statusCode: 200 }
    });
    configureNetServers(createServerMock, [
      { type: 'error' },
      { type: 'listening', addressPort: 5522 },
      { type: 'error' },
      { type: 'listening', addressPort: 6633 }
    ]);
    const firstChild = new FakeChildProcess();
    firstChild.pid = 4201;
    const secondChild = new FakeChildProcess();
    secondChild.pid = 4202;
    spawnMock
      .mockReturnValueOnce(firstChild as never)
      .mockReturnValueOnce(secondChild as never);
    execFileMock.mockImplementation(((_file, _args, _options, callback) => {
      callback(null, '', '');
      return firstChild as never;
    }) as never);

    const firstRuntime = serveManager.ensureServeRunning('E:\\devin-byok');
    await vi.advanceTimersByTimeAsync(350);
    await expect(firstRuntime).resolves.toMatchObject({ port: 5522 });

    const secondRuntime = serveManager.ensureServeRunning('F:\\another-workspace');
    await vi.advanceTimersByTimeAsync(350);
    await expect(secondRuntime).resolves.toMatchObject({ port: 6633 });

    expect(spawnMock.mock.calls.map((call) => (call[2] as { cwd?: string }).cwd)).toEqual(['E:\\', 'F:\\']);
    expect(execFileMock).toHaveBeenCalledWith(
      'taskkill.exe',
      ['/pid', '4201', '/T', '/F'],
      { windowsHide: true, timeout: 5_000 },
      expect.any(Function)
    );
  });

  it('lastPort 不健康时回退到 4096（若其健康）', async () => {
    const { serveManager, requestMock, spawnMock, setLastPort } = await setup(5111);
    const calledPorts = configureHealthResponses(requestMock, {
      5111: { type: 'error' },
      4096: { type: 'status', statusCode: 200 }
    });

    const runtime = await serveManager.ensureServeRunning();

    expect(runtime).toMatchObject({
      port: 4096,
      baseUrl: 'http://127.0.0.1:4096',
      startedByManager: false
    });
    expect([...new Set(calledPorts)]).toEqual([5111, 4096]);
    expect(setLastPort).toHaveBeenCalledWith(4096);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('provider 配置变化后启动全新 runtime，并让后续请求避开旧配置缓存', async () => {
    vi.useFakeTimers();
    const { serveManager, requestMock, createServerMock, spawnMock, setLastPort } = await setup(5111);
    const calledPorts = configureHealthResponses(requestMock, {
      5111: { type: 'status', statusCode: 200 },
      5522: { type: 'status', statusCode: 200 }
    });
    configureNetServers(createServerMock, [{ type: 'listening', addressPort: 5522 }]);

    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child as never);

    await expect(serveManager.ensureServeRunning()).resolves.toMatchObject({
      port: 5111,
      startedByManager: false
    });

    const restart = serveManager.restartServeForConfigChange();
    await vi.advanceTimersByTimeAsync(350);
    await expect(restart).resolves.toMatchObject({
      port: 5522,
      baseUrl: 'http://127.0.0.1:5522',
      startedByManager: true
    });

    await expect(serveManager.ensureServeRunning()).resolves.toMatchObject({
      port: 5522,
      startedByManager: true
    });
    expect(calledPorts).toEqual([5111, 5522, 5522]);
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(setLastPort).toHaveBeenLastCalledWith(5522);
  });

  it('lastPort/4096 都不可用时使用 free port 启动并持久化', async () => {
    vi.useFakeTimers();
    const { serveManager, requestMock, createServerMock, spawnMock, opencodeEnv, setLastPort } = await setup(5111);
    opencodeEnv.__setExistsSyncImplementationForTests(() => false);
    opencodeEnv.__setExecFileSyncImplementationForTests((() => {
      throw new Error('where lookup disabled');
    }) as never);
    const calledPorts = configureHealthResponses(requestMock, {
      5111: { type: 'error' },
      4096: { type: 'error' },
      5522: { type: 'status', statusCode: 200 }
    });

    configureNetServers(createServerMock, [
      { type: 'error' },
      { type: 'listening', addressPort: 5522 }
    ]);

    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child as never);

    const runtimePromise = serveManager.ensureServeRunning();
    await vi.advanceTimersByTimeAsync(350);
    const runtime = await runtimePromise;

    expect(runtime).toMatchObject({
      port: 5522,
      baseUrl: 'http://127.0.0.1:5522',
      startedByManager: true
    });
    expect([...new Set(calledPorts)]).toEqual([5111, 4096, 5522]);
    expect(spawnMock).toHaveBeenCalledWith(
      'opencode',
      ['serve', '--hostname', '127.0.0.1', '--port', '5522'],
      expect.objectContaining({ shell: false, cwd: homedir() })
    );
    expect(setLastPort).toHaveBeenCalledWith(5522);
  });

  it('扩展停用时只终止由 manager 启动的 serve', async () => {
    vi.useFakeTimers();
    const { serveManager, requestMock, createServerMock, spawnMock, execFileMock, opencodeEnv } = await setup(undefined);
    opencodeEnv.__setExistsSyncImplementationForTests(() => false);
    opencodeEnv.__setExecFileSyncImplementationForTests((() => {
      throw new Error('where lookup disabled');
    }) as never);
    configureHealthResponses(requestMock, {
      4096: { type: 'error' },
      5522: { type: 'status', statusCode: 200 }
    });
    configureNetServers(createServerMock, [
      { type: 'error' },
      { type: 'listening', addressPort: 5522 }
    ]);

    const child = new FakeChildProcess();
    child.pid = 4242;
    spawnMock.mockReturnValue(child as never);

    const runtimePromise = serveManager.ensureServeRunning();
    await vi.advanceTimersByTimeAsync(350);
    await runtimePromise;

    execFileMock.mockImplementation(((_file, _args, _options, callback) => {
      callback(null, '', '');
      return child as never;
    }) as never);

    await serveManager.disposeServeManager();
    await serveManager.disposeServeManager();

    if (process.platform === 'win32') {
      expect(execFileMock).toHaveBeenCalledWith(
        'taskkill.exe',
        ['/pid', '4242', '/T', '/F'],
        { windowsHide: true, timeout: 5_000 },
        expect.any(Function)
      );
      expect(child.kill).not.toHaveBeenCalled();
    } else {
      expect(execFileMock).not.toHaveBeenCalled();
      expect(child.kill).toHaveBeenCalledTimes(1);
    }
  });

  it('健康检查失败时不持久化端口', async () => {
    vi.useFakeTimers();
    const { serveManager, requestMock, createServerMock, spawnMock, opencodeEnv, setLastPort } = await setup(5111);
    opencodeEnv.__setExistsSyncImplementationForTests(() => false);
    opencodeEnv.__setExecFileSyncImplementationForTests((() => {
      throw new Error('where lookup disabled');
    }) as never);
    configureHealthResponses(requestMock, {
      5111: { type: 'error' },
      4096: { type: 'error' },
      5522: { type: 'error' }
    });

    configureNetServers(createServerMock, [
      { type: 'error' },
      { type: 'listening', addressPort: 5522 }
    ]);

    const child = new FakeChildProcess();
    child.exitCode = 7;
    child.stderrTextOnSubscribe = '\u001b[91m\u001b[1mError:\u001b[0m Unexpected error database is locked';
    spawnMock.mockReturnValue(child as never);

    const runtimePromise = serveManager.ensureServeRunning();
    const rejected = runtimePromise.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(350);

    const error = await rejected;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('Error: Unexpected error database is locked');
    expect((error as Error).message).not.toContain('\u001b');
    expect(setLastPort).not.toHaveBeenCalled();
  });

  it('startServe spawn 会携带补全后的 PATH', async () => {
    vi.useFakeTimers();
    const { serveManager, requestMock, createServerMock, spawnMock, opencodeEnv } = await setup(undefined);
    opencodeEnv.__setExistsSyncImplementationForTests(() => false);
    opencodeEnv.__setExecFileSyncImplementationForTests((() => {
      throw new Error('where lookup disabled');
    }) as never);
    configureHealthResponses(requestMock, {
      4096: { type: 'error' },
      5522: { type: 'status', statusCode: 200 }
    });

    configureNetServers(createServerMock, [
      { type: 'error' },
      { type: 'listening', addressPort: 5522 }
    ]);

    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child as never);

    const runtimePromise = serveManager.ensureServeRunning();
    await vi.advanceTimersByTimeAsync(350);
    await runtimePromise;

    const expectedBin = join(homedir(), '.opencode', 'bin');
    const options = spawnMock.mock.calls[0]?.[2] as { env?: NodeJS.ProcessEnv } | undefined;
    const pathValue = (options?.env?.PATH ?? '').toString();

    expect(pathValue.split(delimiter)).toContain(expectedBin);
  });

  it('本地 opencode 绝对路径存在时 startServe 使用绝对路径启动', async () => {
    vi.useFakeTimers();
    const { serveManager, requestMock, createServerMock, spawnMock, opencodeEnv } = await setup(undefined);
    const expectedBinary =
      process.platform === 'win32' ? win32.join(homedir(), 'bin', 'opencode.exe') : join(homedir(), '.opencode', 'bin', 'opencode');
    opencodeEnv.__setExistsSyncImplementationForTests((target) => String(target) === expectedBinary);
    configureHealthResponses(requestMock, {
      4096: { type: 'error' },
      5522: { type: 'status', statusCode: 200 }
    });

    configureNetServers(createServerMock, [
      { type: 'error' },
      { type: 'listening', addressPort: 5522 }
    ]);

    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child as never);

    const runtimePromise = serveManager.ensureServeRunning();
    await vi.advanceTimersByTimeAsync(350);
    await runtimePromise;

    expect(spawnMock.mock.calls[0]?.[0]).toBe(expectedBinary);
  });

  it('切换 runtime 后清除旧端口的持久化密码', async () => {
    vi.useFakeTimers();
    const {
      serveManager,
      requestMock,
      createServerMock,
      spawnMock,
      execFileMock,
      setPassword,
      storedPasswords
    } = await setup(undefined);
    configureHealthResponses(requestMock, {
      4096: { type: 'error' },
      5522: { type: 'v2', version: '2.1.4' },
      6633: { type: 'v2', version: '2.1.4' }
    });
    configureNetServers(createServerMock, [
      { type: 'error' },
      { type: 'listening', addressPort: 5522 },
      { type: 'listening', addressPort: 6633 }
    ]);
    const firstChild = new FakeChildProcess();
    firstChild.pid = 4201;
    const secondChild = new FakeChildProcess();
    secondChild.pid = 4202;
    spawnMock
      .mockReturnValueOnce(firstChild as never)
      .mockReturnValueOnce(secondChild as never);
    execFileMock.mockImplementation(((_file, _args, _options, callback) => {
      callback(null, '', '');
      return firstChild as never;
    }) as never);

    const firstRuntime = serveManager.ensureServeRunning();
    await vi.advanceTimersByTimeAsync(350);
    await expect(firstRuntime).resolves.toMatchObject({
      port: 5522,
      apiVersion: 'v2'
    });
    expect(storedPasswords.get(5522)).toBeTruthy();

    const restart = serveManager.restartServeForConfigChange();
    await vi.advanceTimersByTimeAsync(350);
    await expect(restart).resolves.toMatchObject({
      port: 6633,
      apiVersion: 'v2'
    });

    expect(setPassword).toHaveBeenCalledWith(5522, undefined);
    expect(storedPasswords.has(5522)).toBe(false);
    expect(storedPasswords.get(6633)).toBeTruthy();
  });
});
