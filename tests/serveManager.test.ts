import { afterEach, describe, expect, it, vi } from 'vitest';
import { delimiter, join, win32 } from 'node:path';
import { homedir } from 'node:os';

vi.mock('node:http', () => ({
  request: vi.fn()
}));

vi.mock('node:net', () => ({
  createServer: vi.fn()
}));

vi.mock('node:child_process', () => ({
  spawn: vi.fn()
}));

type HealthScenario =
  | { type: 'status'; statusCode: number }
  | { type: 'error' }
  | { type: 'timeout' };

type MockServerScript =
  | { type: 'error' }
  | { type: 'listening'; addressPort: number; closeError?: Error };

class FakeChildProcess {
  public exitCode: number | null = null;
  public readonly stderr = {
    on: vi.fn()
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

  requestMock.mockImplementation((options: { port?: number }, callback: (res: { statusCode?: number; resume: () => void }) => void) => {
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

        callback({
          statusCode: scenario.statusCode,
          resume: () => {}
        });
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
  const opencodeEnv = await import('../src/bridge/opencodeEnv');

  requestMock.mockReset();
  createServerMock.mockReset();
  spawnMock.mockReset();

  const setLastPort = vi.fn(async () => {});

  const serveManager = await import('../src/bridge/serveManager');
  serveManager.configureServePortStorage({
    getLastPort: () => lastPort,
    setLastPort
  });

  return {
    serveManager,
    requestMock,
    createServerMock,
    spawnMock,
    opencodeEnv,
    setLastPort
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('ensureServeRunning 端口策略', () => {
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
    expect(calledPorts).toEqual([5111, 4096]);
    expect(setLastPort).toHaveBeenCalledWith(4096);
    expect(spawnMock).not.toHaveBeenCalled();
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
    expect(calledPorts).toEqual([5111, 4096, 5522]);
    expect(spawnMock).toHaveBeenCalledWith('opencode', ['serve', '--hostname', '127.0.0.1', '--port', '5522'], expect.objectContaining({ shell: false }));
    expect(setLastPort).toHaveBeenCalledWith(5522);
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
    spawnMock.mockReturnValue(child as never);

    const runtimePromise = serveManager.ensureServeRunning();
    const rejected = expect(runtimePromise).rejects.toThrow(/启动后退出/);
    await vi.advanceTimersByTimeAsync(350);

    await rejected;
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
});
