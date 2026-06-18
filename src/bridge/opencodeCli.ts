import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from 'node:child_process';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { PassThrough } from 'node:stream';
import { createInterface } from 'node:readline';
import { resolveOpencodeBinary, shouldHideOpencodeWindow, shouldUseShellForOpencode, withOpencodeBinInPath } from './opencodeEnv';

// Some commands (notably `run`) can take multiple minutes depending on provider latency
// and tool usage. We keep a conservative default but allow callers to override.
const DEFAULT_TIMEOUT_MS = 2 * 60_000;
const STDERR_SNIPPET_MAX = 400;

type SpawnImpl = typeof spawn;

let spawnImpl: SpawnImpl = spawn;

export type OpencodeCliErrorCode =
  | 'INVALID_ARGS'
  | 'ENOENT'
  | 'EXIT_NON_ZERO'
  | 'TIMEOUT'
  | 'ABORTED';

export class OpencodeCliError extends Error {
  public readonly code: OpencodeCliErrorCode;
  public readonly exitCode?: number;
  public readonly stderrSnippet?: string;
  public readonly cause?: unknown;

  public constructor(
    code: OpencodeCliErrorCode,
    message: string,
    options?: {
      cause?: unknown;
      exitCode?: number;
      stderrSnippet?: string;
    }
  ) {
    super(message);
    this.name = 'OpencodeCliError';
    this.code = code;
    this.exitCode = options?.exitCode;
    this.stderrSnippet = options?.stderrSnippet;
    this.cause = options?.cause;
  }
}

export interface SpawnOpencodeOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface SpawnOpencodeResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface SpawnedOpencode {
  readonly child: ChildProcessWithoutNullStreams;
  readonly completion: Promise<SpawnOpencodeResult>;
  readonly stdoutLines: AsyncIterable<string>;
  readonly stderrLines: AsyncIterable<string>;
}

export function spawnOpencode(args: readonly string[], opts: SpawnOpencodeOptions = {}): SpawnedOpencode {
  assertAllowedArgs(args);

  const spawnOptions: SpawnOptionsWithoutStdio = {
    shell: false,
    stdio: 'pipe',
    cwd: opts.cwd,
    env: withOpencodeBinInPath(opts.env),
    windowsHide: shouldHideOpencodeWindow()
  };

  const command = resolveOpencodeBinary(spawnOptions.env);
  spawnOptions.shell = shouldUseShellForOpencode(command);
  const child = spawnImpl(command, [...args], spawnOptions) as ChildProcessWithoutNullStreams;

  // We never provide interactive input. Keeping stdin open can cause some CLIs to
  // block waiting for input/EOF when run under a non-TTY (like VS Code extension host).
  // Close it immediately to avoid hangs.
  try {
    child.stdin.end();
  } catch {}

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let stdout = '';
  let stderr = '';
  let timer: NodeJS.Timeout | undefined;
  let didTimeout = false;
  let didAbort = false;
  let settled = false;
  const stdoutLineBus = new PassThrough();
  const stderrLineBus = new PassThrough();

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');

  child.stdout.on('data', (chunk: string) => {
    stdout += chunk;
    stdoutLineBus.write(chunk);
  });

  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
    stderrLineBus.write(chunk);
  });

  child.stdout.once('end', () => {
    stdoutLineBus.end();
  });

  child.stderr.once('end', () => {
    stderrLineBus.end();
  });

  const cleanup = (): void => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (opts.signal) {
      opts.signal.removeEventListener('abort', onAbort);
    }
  };

  const onAbort = (): void => {
    if (settled) {
      return;
    }
    didAbort = true;
    child.kill('SIGTERM');
  };

  if (opts.signal) {
    if (opts.signal.aborted) {
      didAbort = true;
      child.kill('SIGTERM');
    } else {
      opts.signal.addEventListener('abort', onAbort, { once: true });
    }
  }

  if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
    timer = setTimeout(() => {
      if (settled) {
        return;
      }
      didTimeout = true;
      child.kill('SIGTERM');
    }, timeoutMs);
  }

  const completion = new Promise<SpawnOpencodeResult>((resolve, reject) => {
    child.once('error', (error: NodeJS.ErrnoException) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();

      if (error.code === 'ENOENT') {
        reject(new OpencodeCliError('ENOENT', '未找到 opencode 可执行文件（ENOENT）。请确认 opencode 已安装且在 PATH 中。', { cause: error }));
        return;
      }

      reject(error);
    });

    child.once('close', (code: number | null) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();

      if (didAbort) {
        reject(new OpencodeCliError('ABORTED', 'opencode 命令已被取消（AbortSignal）。'));
        return;
      }

      if (didTimeout) {
        reject(new OpencodeCliError('TIMEOUT', `opencode 命令执行超时（>${timeoutMs}ms）。`));
        return;
      }

      const normalizedCode = code ?? -1;

      if (normalizedCode !== 0) {
        const snippet = trimSnippet(stderr, STDERR_SNIPPET_MAX);
        reject(
          new OpencodeCliError(
            'EXIT_NON_ZERO',
            snippet
              ? `opencode 命令退出码非 0（code=${String(normalizedCode)}）：${snippet}`
              : `opencode 命令退出码非 0（code=${String(normalizedCode)}）。`,
            {
              exitCode: normalizedCode,
              stderrSnippet: snippet
            }
          )
        );
        return;
      }

      resolve({
        exitCode: normalizedCode,
        stdout,
        stderr
      });
    });
  });

  return {
    child,
    completion,
    stdoutLines: streamLines(stdoutLineBus),
    stderrLines: streamLines(stderrLineBus)
  };
}

export async function sessionListJson(opts?: SpawnOpencodeOptions): Promise<SpawnOpencodeResult> {
  return spawnOpencode(['session', 'list', '--format', 'json'], opts).completion;
}

export async function sessionDelete(sessionId: string, opts?: SpawnOpencodeOptions): Promise<SpawnOpencodeResult> {
  return spawnOpencode(['session', 'delete', sessionId], opts).completion;
}

export async function exportSession(id: string, opts?: SpawnOpencodeOptions): Promise<SpawnOpencodeResult> {
  return spawnOpencode(['export', id], opts).completion;
}

export async function authList(opts?: SpawnOpencodeOptions): Promise<SpawnOpencodeResult> {
  return spawnOpencode(['auth', 'list'], opts).completion;
}

export async function opencodeVersion(opts?: SpawnOpencodeOptions): Promise<SpawnOpencodeResult> {
  return spawnOpencode(['--version'], opts).completion;
}

// `opencode export` can produce very large JSON outputs.
// In some environments, piping stdout back into the extension host may result in truncated output.
// To make export reliable, we write stdout to a temp file and read it back.
export async function exportSessionToJsonText(id: string, opts: SpawnOpencodeOptions = {}): Promise<string> {
  assertAllowedArgs(['export', id]);

  const env = withOpencodeBinInPath(opts.env);
  const command = resolveOpencodeBinary(env);
  const cwd = opts.cwd;

  const tempDir = fs.mkdtempSync(path.join(tmpdir(), 'opencode-ui-export-'));
  const outPath = path.join(tempDir, 'export.json');
  const fd = fs.openSync(outPath, 'w');

  let timer: NodeJS.Timeout | undefined;
  let didTimeout = false;
  let didAbort = false;
  let settled = false;

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const child = spawnImpl(command, ['export', id], {
    shell: shouldUseShellForOpencode(command),
    stdio: ['ignore', fd, 'pipe'],
    cwd,
    env,
    windowsHide: shouldHideOpencodeWindow()
  }) as unknown as ChildProcessWithoutNullStreams;

  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });

  const cleanup = (): void => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (opts.signal) {
      opts.signal.removeEventListener('abort', onAbort);
    }
    try {
      fs.closeSync(fd);
    } catch {}
  };

  const onAbort = (): void => {
    if (settled) {
      return;
    }
    didAbort = true;
    child.kill('SIGTERM');
  };

  if (opts.signal) {
    if (opts.signal.aborted) {
      didAbort = true;
      child.kill('SIGTERM');
    } else {
      opts.signal.addEventListener('abort', onAbort, { once: true });
    }
  }

  if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
    timer = setTimeout(() => {
      if (settled) {
        return;
      }
      didTimeout = true;
      child.kill('SIGTERM');
    }, timeoutMs);
  }

  const completion = new Promise<string>((resolve, reject) => {
    child.once('error', (error: NodeJS.ErrnoException) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();

      if (error.code === 'ENOENT') {
        reject(new OpencodeCliError('ENOENT', '未找到 opencode 可执行文件（ENOENT）。请确认 opencode 已安装且在 PATH 中。', { cause: error }));
        return;
      }

      reject(error);
    });

    child.once('close', (code: number | null) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();

      if (didAbort) {
        reject(new OpencodeCliError('ABORTED', 'opencode 命令已被取消（AbortSignal）。'));
        return;
      }

      if (didTimeout) {
        reject(new OpencodeCliError('TIMEOUT', `opencode 命令执行超时（>${timeoutMs}ms）。`));
        return;
      }

      const normalizedCode = code ?? -1;
      if (normalizedCode !== 0) {
        const snippet = trimSnippet(stderr, STDERR_SNIPPET_MAX);
        reject(
          new OpencodeCliError(
            'EXIT_NON_ZERO',
            snippet ? `opencode 命令退出码非 0（code=${String(normalizedCode)}）：${snippet}` : `opencode 命令退出码非 0（code=${String(normalizedCode)}）。`,
            { exitCode: normalizedCode, stderrSnippet: snippet }
          )
        );
        return;
      }

      try {
        const jsonText = fs.readFileSync(outPath, 'utf8');
        resolve(jsonText);
      } catch (error) {
        reject(error);
      } finally {
        try {
          fs.rmSync(tempDir, { recursive: true, force: true });
        } catch {}
      }
    });
  });

  return completion;
}

export async function modelsVerbose(opts?: SpawnOpencodeOptions): Promise<SpawnOpencodeResult> {
  return spawnOpencode(['models', '--verbose'], opts).completion;
}

export async function modelsList(opts?: SpawnOpencodeOptions): Promise<SpawnOpencodeResult> {
  return spawnOpencode(['models'], opts).completion;
}

export async function modelsVerboseForProvider(providerId: string, opts?: SpawnOpencodeOptions): Promise<SpawnOpencodeResult> {
  return spawnOpencode(['models', providerId, '--verbose'], opts).completion;
}

export async function agentList(opts?: SpawnOpencodeOptions): Promise<SpawnOpencodeResult> {
  return spawnOpencode(['agent', 'list'], opts).completion;
}

export function runStream(
  message: string,
  options: {
    model: string;
    agent: string;
    sessionId?: string;
    title?: string;
    thinking?: boolean;
    variant?: string;
    files?: string[];
  },
  opts?: SpawnOpencodeOptions
): SpawnedOpencode {
  const args: string[] = ['run', message, '--format', 'json', '--model', options.model, '--agent', options.agent, '--log-level', 'ERROR'];

  if (options.thinking) {
    args.push('--thinking');
  }

  if (typeof options.variant === 'string' && options.variant.trim().length > 0) {
    args.push('--variant', options.variant.trim());
  }

  if (options.sessionId && options.sessionId.trim().length > 0) {
    args.push('--session', options.sessionId);
  } else if (options.title && options.title.trim().length > 0) {
    args.push('--title', options.title);
  }

  if (Array.isArray(options.files) && options.files.length > 0) {
    for (const file of options.files) {
      if (typeof file === 'string' && file.trim().length > 0) {
        args.push('--file', file.trim());
      }
    }
  }

  return spawnOpencode(args, opts);
}

export function __setSpawnImplementationForTests(nextSpawn: SpawnImpl | undefined): void {
  spawnImpl = nextSpawn ?? spawn;
}

function streamLines(stream: NodeJS.ReadableStream): AsyncIterable<string> {
  return {
    async *[Symbol.asyncIterator](): AsyncIterator<string> {
      const rl = createInterface({
        input: stream,
        crlfDelay: Number.POSITIVE_INFINITY
      });

      try {
        for await (const line of rl) {
          yield line;
        }
      } finally {
        rl.close();
      }
    }
  };
}

function trimSnippet(input: string, maxLength: number): string {
  const normalized = input.trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}…`;
}

function assertAllowedArgs(args: readonly string[]): void {
  if (isAllowedArgs(args)) {
    return;
  }

  throw new OpencodeCliError(
    'INVALID_ARGS',
    `不允许的 opencode 子命令参数：${JSON.stringify(args)}。仅允许 --version / session list --format json / export <id> / models --verbose / agent list / run <message> --format json ...`
  );
}

function isAllowedArgs(args: readonly string[]): boolean {
  if (args.length === 4 && args[0] === 'session' && args[1] === 'list' && args[2] === '--format' && args[3] === 'json') {
    return true;
  }

  if (args.length === 3 && args[0] === 'session' && args[1] === 'delete' && args[2].trim().length > 0) {
    return true;
  }

  if (args.length === 2 && args[0] === 'export' && args[1].trim().length > 0) {
    return true;
  }

  if (args.length === 2 && args[0] === 'models' && args[1] === '--verbose') {
    return true;
  }

  if (args.length === 1 && args[0] === 'models') {
    return true;
  }

  if (args.length === 3 && args[0] === 'models' && args[1].trim().length > 0 && args[2] === '--verbose') {
    return true;
  }

  if (args.length === 2 && args[0] === 'auth' && args[1] === 'list') {
    return true;
  }

  if (args.length === 1 && args[0] === '--version') {
    return true;
  }

  if (args.length === 2 && args[0] === 'agent' && args[1] === 'list') {
    return true;
  }

  if (args.length >= 4 && args[0] === 'run' && args[1].trim().length > 0 && args[2] === '--format' && args[3] === 'json') {
    const tail = args.slice(4);

    if (tail.length === 0) {
      return true;
    }

    // run flags are mostly pairs (flag + value), except boolean switches like --thinking.
    const allowedPairFlags = new Set(['--model', '--agent', '--session', '--title', '--log-level', '--variant', '--file']);
    const seenFlags = new Set<string>();

    // `--thinking` is a boolean flag with no value; remove it before validating pairs.
    let sawThinking = false;
    const filteredTail: string[] = [];
    for (let i = 0; i < tail.length; i += 1) {
      const token = tail[i] ?? '';
      if (token === '--thinking') {
        if (sawThinking) {
          return false;
        }
        sawThinking = true;
        continue;
      }
      filteredTail.push(token);
    }

    if (filteredTail.length % 2 !== 0) {
      return false;
    }

    for (let index = 0; index < filteredTail.length; index += 2) {
      const flag = filteredTail[index] ?? '';
      const value = filteredTail[index + 1] ?? '';

      if (!allowedPairFlags.has(flag) || seenFlags.has(flag)) {
        return false;
      }

      if (value.trim().length === 0) {
        return false;
      }

      seenFlags.add(flag);
    }

    return true;
  }

  return false;
}
