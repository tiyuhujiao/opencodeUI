import { PassThrough } from 'node:stream';
import { win32 } from 'node:path';
import { homedir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __setExecFileSyncImplementationForTests,
  __setExistsSyncImplementationForTests,
  __setPlatformForTests
} from '../src/bridge/opencodeEnv';
import {
  __setSpawnImplementationForTests,
  OpencodeCliError,
  opencodeVersion,
  runStream,
  spawnOpencode,
  exportSessionToJsonText
} from '../src/bridge/opencodeCli';

type SpawnCall = {
  command: string;
  args: readonly string[];
  options: Record<string, unknown>;
};

class FakeChild {
  public readonly stdout = new PassThrough();
  public readonly stderr = new PassThrough();
  public exitCode: number | null = null;
  public killed = false;

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

  public kill(): boolean {
    this.killed = true;
    this.emit('close', this.exitCode);
    return true;
  }
}

afterEach(() => {
  __setSpawnImplementationForTests(undefined);
  __setExistsSyncImplementationForTests(undefined);
  __setPlatformForTests(undefined);
  __setExecFileSyncImplementationForTests(undefined);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('opencodeCli', () => {
  it('spawnOpencode 在 opts.env PATH 缺失时会补全 ~/.opencode/bin', async () => {
    __setPlatformForTests('linux');
    __setExistsSyncImplementationForTests(() => false);
    const child = new FakeChild();
    const calls: SpawnCall[] = [];

    __setSpawnImplementationForTests(
      ((command: string, args: readonly string[], options: Record<string, unknown>) => {
        calls.push({ command, args, options });
        return child as never;
      }) as never
    );

    const completion = spawnOpencode(['models', '--verbose'], {
      env: {
        HOME: '/home/remote-user',
        PATH: '/usr/local/bin:/usr/bin'
      }
    }).completion;

    child.emit('close', 0);
    await expect(completion).resolves.toMatchObject({ exitCode: 0 });

    const expectedBin = '/home/remote-user/.opencode/bin';
    const calledPath = ((calls[0]?.options.env as NodeJS.ProcessEnv | undefined)?.PATH ?? '').toString();

    expect(calls[0]?.command).toBe('opencode');
    expect(calledPath.split(':')).toContain(expectedBin);
    expect(calledPath).toContain('/usr/local/bin:/usr/bin');
    expect(calledPath.startsWith(`${expectedBin}:`)).toBe(true);
  });

  it('Linux/Remote-SSH PATH 会预置常见用户级安装目录', async () => {
    __setPlatformForTests('linux');
    __setExistsSyncImplementationForTests(() => false);
    const child = new FakeChild();
    const calls: SpawnCall[] = [];

    __setSpawnImplementationForTests(
      ((command: string, args: readonly string[], options: Record<string, unknown>) => {
        calls.push({ command, args, options });
        return child as never;
      }) as never
    );

    const completion = spawnOpencode(['models', '--verbose'], {
      env: {
        HOME: '/home/remote-user',
        OPENCODE_INSTALL_DIR: '/opt/opencode/bin',
        XDG_BIN_DIR: '/xdg/bin',
        PNPM_HOME: '/pnpm-home',
        VOLTA_HOME: '/volta-home',
        PATH: '/usr/local/bin:/usr/bin'
      }
    }).completion;

    child.emit('close', 0);
    await expect(completion).resolves.toMatchObject({ exitCode: 0 });

    const calledPath = ((calls[0]?.options.env as NodeJS.ProcessEnv | undefined)?.PATH ?? '').toString();
    const entries = calledPath.split(':');

    expect(calls[0]?.command).toBe('opencode');
    expect(entries.slice(0, 10)).toEqual([
      '/opt/opencode/bin',
      '/xdg/bin',
      '/home/remote-user/.opencode/bin',
      '/home/remote-user/bin',
      '/home/remote-user/.local/bin',
      '/home/remote-user/.bun/bin',
      '/pnpm-home',
      '/home/remote-user/.local/share/pnpm',
      '/volta-home/bin',
      '/home/remote-user/.local/share/mise/shims'
    ]);
    expect(entries).toContain('/usr/local/bin');
    expect(entries).toContain('/usr/bin');
  });

  it('Linux 可自动发现 mise shim 中的 opencode', async () => {
    __setPlatformForTests('linux');
    __setExistsSyncImplementationForTests((target) => String(target) === '/home/remote-user/.local/share/mise/shims/opencode');
    const child = new FakeChild();
    const calls: SpawnCall[] = [];

    __setSpawnImplementationForTests(
      ((command: string, args: readonly string[], options: Record<string, unknown>) => {
        calls.push({ command, args, options });
        return child as never;
      }) as never
    );

    const completion = spawnOpencode(['agent', 'list'], {
      env: {
        HOME: '/home/remote-user',
        PATH: '/usr/bin'
      }
    }).completion;

    child.emit('close', 0);
    await expect(completion).resolves.toMatchObject({ exitCode: 0 });

    expect(calls[0]?.command).toBe('/home/remote-user/.local/share/mise/shims/opencode');
    expect(calls[0]?.options.shell).toBe(false);
  });

  it('本地 opencode 绝对路径存在时优先使用绝对路径启动', async () => {
    __setPlatformForTests('linux');
    __setExistsSyncImplementationForTests((target) => String(target) === '/home/remote-user/.opencode/bin/opencode');
    const child = new FakeChild();
    const calls: SpawnCall[] = [];

    __setSpawnImplementationForTests(
      ((command: string, args: readonly string[], options: Record<string, unknown>) => {
        calls.push({ command, args, options });
        return child as never;
      }) as never
    );

    const completion = spawnOpencode(['models', '--verbose'], {
      env: {
        HOME: '/home/remote-user'
      }
    }).completion;
    child.emit('close', 0);
    await expect(completion).resolves.toMatchObject({ exitCode: 0 });

    expect(calls[0]?.command).toBe('/home/remote-user/.opencode/bin/opencode');
  });

  it('设置 OPENCODE_BINARY 时优先使用该值', async () => {
    __setPlatformForTests('linux');
    __setExistsSyncImplementationForTests(() => true);
    const child = new FakeChild();
    const calls: SpawnCall[] = [];

    __setSpawnImplementationForTests(
      ((command: string, args: readonly string[], options: Record<string, unknown>) => {
        calls.push({ command, args, options });
        return child as never;
      }) as never
    );

    const completion = spawnOpencode(['agent', 'list'], {
      env: {
        OPENCODE_BINARY: '/tmp/custom-opencode'
      }
    }).completion;
    child.emit('close', 0);
    await expect(completion).resolves.toMatchObject({ exitCode: 0 });

    expect(calls[0]?.command).toBe('/tmp/custom-opencode');
  });

  it('Windows 本机优先使用 ~/bin/opencode.exe', async () => {
    __setPlatformForTests('win32');
    __setExistsSyncImplementationForTests((target) => String(target).endsWith('opencode.exe'));
    const child = new FakeChild();
    const calls: SpawnCall[] = [];

    __setSpawnImplementationForTests(
      ((command: string, args: readonly string[], options: Record<string, unknown>) => {
        calls.push({ command, args, options });
        return child as never;
      }) as never
    );

    const completion = spawnOpencode(['agent', 'list']).completion;
    child.emit('close', 0);
    await expect(completion).resolves.toMatchObject({ exitCode: 0 });

    expect(calls[0]?.command).toBe(win32.join(homedir(), 'bin', 'opencode.exe'));
  });

  it('Windows 本机可自动发现 npm 全局安装的 opencode.cmd', async () => {
    __setPlatformForTests('win32');
    __setExistsSyncImplementationForTests((target) => String(target).endsWith(win32.join('Roaming', 'npm', 'opencode.cmd')));
    const child = new FakeChild();
    const calls: SpawnCall[] = [];

    __setSpawnImplementationForTests(
      ((command: string, args: readonly string[], options: Record<string, unknown>) => {
        calls.push({ command, args, options });
        return child as never;
      }) as never
    );

    const completion = spawnOpencode(['agent', 'list'], {
      env: {
        USERPROFILE: 'C:\\Users\\ww',
        APPDATA: 'C:\\Users\\ww\\AppData\\Roaming',
        LOCALAPPDATA: 'C:\\Users\\ww\\AppData\\Local',
        PROGRAMDATA: 'C:\\ProgramData'
      }
    }).completion;
    child.emit('close', 0);
    await expect(completion).resolves.toMatchObject({ exitCode: 0 });

    expect(calls[0]?.command).toBe('C:\\Users\\ww\\AppData\\Roaming\\npm\\opencode.cmd');
    expect(calls[0]?.options.shell).toBe(true);
    expect(calls[0]?.options.windowsHide).toBe(true);
  });

  it('Windows PATH 会预置 Scoop、Chocolatey、Mise 等常见目录', async () => {
    __setPlatformForTests('win32');
    __setExistsSyncImplementationForTests(() => false);
    const child = new FakeChild();
    const calls: SpawnCall[] = [];

    __setSpawnImplementationForTests(
      ((command: string, args: readonly string[], options: Record<string, unknown>) => {
        calls.push({ command, args, options });
        return child as never;
      }) as never
    );

    const completion = spawnOpencode(['models', '--verbose'], {
      env: {
        USERPROFILE: 'C:\\Users\\ww',
        APPDATA: 'C:\\Users\\ww\\AppData\\Roaming',
        LOCALAPPDATA: 'C:\\Users\\ww\\AppData\\Local',
        PROGRAMDATA: 'C:\\ProgramData',
        PATH: 'C:\\Windows\\System32'
      }
    }).completion;

    child.emit('close', 0);
    await expect(completion).resolves.toMatchObject({ exitCode: 0 });

    const calledPath = ((calls[0]?.options.env as NodeJS.ProcessEnv | undefined)?.PATH ?? '').toString();
    const entries = calledPath.split(win32.delimiter);

    expect(calls[0]?.command).toBe('opencode');
    expect(entries).toContain('C:\\Users\\ww\\.opencode\\bin');
    expect(entries).toContain('C:\\Users\\ww\\AppData\\Roaming\\npm');
    expect(entries).toContain('C:\\Users\\ww\\scoop\\shims');
    expect(entries).toContain('C:\\ProgramData\\chocolatey\\bin');
    expect(entries).toContain('C:\\Users\\ww\\AppData\\Local\\mise\\shims');
    expect(entries).toContain('C:\\Windows\\System32');
  });

  it('Windows 本机可通过 where.exe 回退发现 opencode', async () => {
    __setPlatformForTests('win32');
    __setExistsSyncImplementationForTests(() => false);
    __setExecFileSyncImplementationForTests((() => 'C:\\Tools\\OpenCode\\opencode.exe\r\n') as never);
    const child = new FakeChild();
    const calls: SpawnCall[] = [];

    __setSpawnImplementationForTests(
      ((command: string, args: readonly string[], options: Record<string, unknown>) => {
        calls.push({ command, args, options });
        return child as never;
      }) as never
    );

    const completion = spawnOpencode(['agent', 'list'], {
      env: {
        USERPROFILE: 'C:\\Users\\ww',
        PATH: 'C:\\Windows\\System32'
      }
    }).completion;

    child.emit('close', 0);
    await expect(completion).resolves.toMatchObject({ exitCode: 0 });

    expect(calls[0]?.command).toBe('C:\\Tools\\OpenCode\\opencode.exe');
  });

  it('Windows 本机可自动发现 Volta 安装的 opencode.cmd', async () => {
    __setPlatformForTests('win32');
    __setExistsSyncImplementationForTests((target) => String(target).endsWith('Volta\\bin\\opencode.cmd'));
    const child = new FakeChild();
    const calls: SpawnCall[] = [];

    __setSpawnImplementationForTests(
      ((command: string, args: readonly string[], options: Record<string, unknown>) => {
        calls.push({ command, args, options });
        return child as never;
      }) as never
    );

    const completion = spawnOpencode(['agent', 'list'], {
      env: {
        USERPROFILE: 'C:\\Users\\minxia.li',
        LOCALAPPDATA: 'C:\\Users\\minxia.li\\AppData\\Local'
      }
    }).completion;

    child.emit('close', 0);
    await expect(completion).resolves.toMatchObject({ exitCode: 0 });

    expect(calls[0]?.command).toBe('C:\\Users\\minxia.li\\AppData\\Local\\Volta\\bin\\opencode.cmd');
    expect(calls[0]?.options.shell).toBe(true);
  });

  it('Windows where.exe 返回无扩展名路径时会归一化到同目录 .cmd', async () => {
    __setPlatformForTests('win32');
    __setExistsSyncImplementationForTests((target) => String(target) === 'C:\\Users\\minxia.li\\AppData\\Local\\Volta\\bin\\opencode.cmd');
    __setExecFileSyncImplementationForTests((() => 'C:\\Users\\minxia.li\\AppData\\Local\\Volta\\bin\\opencode\r\n') as never);
    const child = new FakeChild();
    const calls: SpawnCall[] = [];

    __setSpawnImplementationForTests(
      ((command: string, args: readonly string[], options: Record<string, unknown>) => {
        calls.push({ command, args, options });
        return child as never;
      }) as never
    );

    const completion = spawnOpencode(['agent', 'list'], {
      env: {
        USERPROFILE: 'C:\\Users\\minxia.li',
        LOCALAPPDATA: 'C:\\Users\\minxia.li\\AppData\\Local',
        PATH: 'C:\\Windows\\System32'
      }
    }).completion;

    child.emit('close', 0);
    await expect(completion).resolves.toMatchObject({ exitCode: 0 });

    expect(calls[0]?.command).toBe('C:\\Users\\minxia.li\\AppData\\Local\\Volta\\bin\\opencode.cmd');
    expect(calls[0]?.options.shell).toBe(true);
  });

  it('Windows PATH 会补充 bun、pnpm、Yarn 与 HOME/bin 目录', async () => {
    __setPlatformForTests('win32');
    __setExistsSyncImplementationForTests(() => false);
    const child = new FakeChild();
    const calls: SpawnCall[] = [];

    __setSpawnImplementationForTests(
      ((command: string, args: readonly string[], options: Record<string, unknown>) => {
        calls.push({ command, args, options });
        return child as never;
      }) as never
    );

    const completion = spawnOpencode(['models', '--verbose'], {
      env: {
        USERPROFILE: 'C:\\Users\\ww',
        APPDATA: 'C:\\Users\\ww\\AppData\\Roaming',
        LOCALAPPDATA: 'C:\\Users\\ww\\AppData\\Local',
        PNPM_HOME: 'D:\\pnpm-home',
        XDG_BIN_DIR: 'D:\\xdg-bin',
        OPENCODE_INSTALL_DIR: 'D:\\custom-opencode',
        PROGRAMDATA: 'C:\\ProgramData',
        PATH: 'C:\\Windows\\System32'
      }
    }).completion;

    child.emit('close', 0);
    await expect(completion).resolves.toMatchObject({ exitCode: 0 });

    const calledPath = ((calls[0]?.options.env as NodeJS.ProcessEnv | undefined)?.PATH ?? '').toString();
    const entries = calledPath.split(win32.delimiter);

    expect(entries).toContain('D:\\custom-opencode');
    expect(entries).toContain('D:\\xdg-bin');
    expect(entries).toContain('C:\\Users\\ww\\bin');
    expect(entries).toContain('C:\\Users\\ww\\.bun\\bin');
    expect(entries).toContain('C:\\Users\\ww\\AppData\\Local\\Yarn\\bin');
    expect(entries).toContain('D:\\pnpm-home');
  });

  it('timeout 会触发 kill 并返回 TIMEOUT 错误', async () => {
    __setPlatformForTests('linux');
    __setExistsSyncImplementationForTests(() => false);
    vi.useFakeTimers();
    const child = new FakeChild();

    __setSpawnImplementationForTests(
      ((command: string, args: readonly string[], options: Record<string, unknown>) => {
        expect(command).toBe('opencode');
        expect(args).toEqual(['models', '--verbose']);
        expect(options.shell).toBe(false);
        return child as never;
      }) as never
    );

    const completion = spawnOpencode(['models', '--verbose'], { timeoutMs: 10 }).completion;
    const rejected = expect(completion).rejects.toMatchObject({ code: 'TIMEOUT' });
    await vi.advanceTimersByTimeAsync(11);

    await rejected;
    expect(child.killed).toBe(true);
  });

  it('AbortSignal 会触发 kill 并返回 ABORTED 错误', async () => {
    __setExistsSyncImplementationForTests(() => false);
    const child = new FakeChild();
    const controller = new AbortController();

    __setSpawnImplementationForTests((() => child as never) as never);

    const completion = spawnOpencode(['agent', 'list'], { signal: controller.signal }).completion;
    controller.abort();

    await expect(completion).rejects.toMatchObject({ code: 'ABORTED' });
    expect(child.killed).toBe(true);
  });

  it('ENOENT 错误映射为友好错误', async () => {
    __setExistsSyncImplementationForTests(() => false);
    const child = new FakeChild();

    __setSpawnImplementationForTests((() => child as never) as never);

    const completion = spawnOpencode(['session', 'list', '--format', 'json']).completion;
    const error = new Error('spawn failed') as NodeJS.ErrnoException;
    error.code = 'ENOENT';
    child.emit('error', error);

    await expect(completion).rejects.toMatchObject({
      code: 'ENOENT'
    });
  });

  it('非零退出码错误包含 stderr 片段', async () => {
    __setExistsSyncImplementationForTests(() => false);
    const child = new FakeChild();

    __setSpawnImplementationForTests((() => child as never) as never);

    const completion = spawnOpencode(['export', 'session-1']).completion;
    child.stderr.write('fatal: bad state\n');
    child.exitCode = 3;
    child.emit('close', 3);

    await expect(completion).rejects.toMatchObject({
      code: 'EXIT_NON_ZERO',
      exitCode: 3,
      stderrSnippet: 'fatal: bad state'
    });
  });

  it('allowlist 会拒绝未知子命令模式', () => {
    __setExistsSyncImplementationForTests(() => false);
    expect(() => spawnOpencode(['session', 'list'])).toThrowError(OpencodeCliError);
    expect(() => spawnOpencode(['session', 'list'])).toThrow(/不允许的 opencode 子命令参数/);
  });

  it('allowlist 允许 session delete <id>', async () => {
    __setExistsSyncImplementationForTests(() => false);
    const child = new FakeChild();
    __setSpawnImplementationForTests((() => child as never) as never);

    const completion = spawnOpencode(['session', 'delete', 'ses_123']).completion;
    child.emit('close', 0);
    await expect(completion).resolves.toMatchObject({ exitCode: 0 });
  });

  it('allowlist 允许 models', async () => {
    __setExistsSyncImplementationForTests(() => false);
    const child = new FakeChild();
    __setSpawnImplementationForTests((() => child as never) as never);

    const completion = spawnOpencode(['models']).completion;
    child.emit('close', 0);
    await expect(completion).resolves.toMatchObject({ exitCode: 0 });
  });

  it('allowlist 允许 opencode --version', async () => {
    __setExistsSyncImplementationForTests(() => false);
    const child = new FakeChild();
    __setSpawnImplementationForTests((() => child as never) as never);

    const completion = opencodeVersion();
    child.stdout.write('opencode 1.15.10\n');
    child.emit('close', 0);

    await expect(completion).resolves.toMatchObject({
      exitCode: 0,
      stdout: 'opencode 1.15.10\n'
    });
  });

  it('runStream 输出按行迭代（不做 JSON 解析）', async () => {
    __setPlatformForTests('linux');
    __setExistsSyncImplementationForTests(() => false);
    const child = new FakeChild();
    const calls: SpawnCall[] = [];

    __setSpawnImplementationForTests(
      ((command: string, args: readonly string[], options: Record<string, unknown>) => {
        calls.push({ command, args, options });
        return child as never;
      }) as never
    );

    const run = runStream('hello', {
      model: 'gpt',
      agent: 'build',
      sessionId: 'session-1'
    });
    child.stdout.write('{"type":"delta"}\n');
    child.stdout.write('{"type":"done"}\n');
    child.stdout.end();
    child.emit('close', 0);

    const lines: string[] = [];
    for await (const line of run.stdoutLines) {
      lines.push(line);
    }

    await expect(run.completion).resolves.toMatchObject({ exitCode: 0 });
    expect(lines).toEqual(['{"type":"delta"}', '{"type":"done"}']);
    expect(calls[0]?.command).toBe('opencode');
    expect(calls[0]?.args).toEqual([
      'run',
      'hello',
      '--format',
      'json',
      '--model',
      'gpt',
      '--agent',
      'build',
      '--log-level',
      'ERROR',
      '--session',
      'session-1'
    ]);
    expect(calls[0]?.options.shell).toBe(false);
  });

  it('runStream 支持 thinking 与 variant 参数', async () => {
    __setExistsSyncImplementationForTests(() => false);
    const child = new FakeChild();
    const calls: SpawnCall[] = [];

    __setSpawnImplementationForTests(
      ((command: string, args: readonly string[], options: Record<string, unknown>) => {
        calls.push({ command, args, options });
        return child as never;
      }) as never
    );

    const run = runStream('hello', {
      model: 'gpt',
      agent: 'build',
      title: 'New Session',
      thinking: true,
      variant: 'high'
    });
    child.stdout.write('{"type":"delta"}\n');
    child.stdout.end();
    child.emit('close', 0);

    // Drain to ensure spawn wiring ok.
    for await (const _line of run.stdoutLines) {
      break;
    }

    await expect(run.completion).resolves.toMatchObject({ exitCode: 0 });
    expect(calls[0]?.args).toEqual([
      'run',
      'hello',
      '--format',
      'json',
      '--model',
      'gpt',
      '--agent',
      'build',
      '--log-level',
      'ERROR',
      '--thinking',
      '--variant',
      'high',
      '--title',
      'New Session'
    ]);
  });

  it('exportSessionToJsonText 将 stdout 写入文件并读取回来（避免 pipe 截断）', async () => {
    __setExistsSyncImplementationForTests(() => true);
    const child = new FakeChild();
    const calls: SpawnCall[] = [];

    __setSpawnImplementationForTests(
      ((command: string, args: readonly string[], options: Record<string, unknown>) => {
        calls.push({ command, args, options });
        const stdio = options.stdio as unknown[] | undefined;
        const fd = typeof stdio?.[1] === 'number' ? (stdio?.[1] as number) : undefined;
        if (typeof fd === 'number') {
          // write valid JSON to the provided fd
          const text = JSON.stringify({ info: {}, messages: [] });
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const fs = require('node:fs') as typeof import('node:fs');
          fs.writeSync(fd, text, undefined, 'utf8');
        }
        return child as never;
      }) as never
    );

    const completion = exportSessionToJsonText('session-1');
    child.emit('close', 0);
    await expect(completion).resolves.toContain('"messages"');

    expect(calls[0]?.args.slice(0, 2)).toEqual(['export', 'session-1']);
    expect((calls[0]?.options.stdio as unknown[] | undefined)?.[0]).toBe('ignore');
    expect(typeof (calls[0]?.options.stdio as unknown[] | undefined)?.[1]).toBe('number');
  });
});
