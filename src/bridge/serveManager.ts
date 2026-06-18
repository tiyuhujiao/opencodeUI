import { spawn, type ChildProcess } from 'node:child_process';
import * as http from 'node:http';
import * as net from 'node:net';
import { resolveOpencodeBinary, shouldHideOpencodeWindow, shouldUseShellForOpencode, withOpencodeBinInPath } from './opencodeEnv';

const HOSTNAME = '127.0.0.1';
const HEALTH_PATH = '/global/health';
const PREFERRED_PORT = 4096;
const HEALTH_CHECK_TIMEOUT_MS = 1_000;
const STARTUP_TIMEOUT_MS = 12_000;
const POLL_INTERVAL_MS = 250;

export interface ServeRuntime {
  port: number;
  baseUrl: string;
  startedByManager: boolean;
}

export interface ServePortStorage {
  getLastPort(): number | undefined;
  setLastPort(port: number): Thenable<void> | Promise<void> | void;
}

let ensurePromise: Promise<ServeRuntime> | undefined;
let currentPort: number | undefined;
let portStorage: ServePortStorage | undefined;

export function configureServePortStorage(storage: ServePortStorage): void {
  portStorage = storage;
}

export async function ensureServeRunning(): Promise<ServeRuntime> {
  if (ensurePromise) {
    return ensurePromise;
  }

  ensurePromise = ensureServeRunningInternal().finally(() => {
    ensurePromise = undefined;
  });

  return ensurePromise;
}

async function ensureServeRunningInternal(): Promise<ServeRuntime> {
  if (currentPort && (await probeHealth(currentPort))) {
    await persistLastPort(currentPort);
    return buildRuntime(currentPort, false);
  }

  const lastPort = readLastPort();
  const candidatePorts: number[] = [];

  if (typeof lastPort === 'number' && lastPort !== currentPort) {
    candidatePorts.push(lastPort);
  }

  if (PREFERRED_PORT !== currentPort && !candidatePorts.includes(PREFERRED_PORT)) {
    candidatePorts.push(PREFERRED_PORT);
  }

  for (const candidatePort of candidatePorts) {
    if (await probeHealth(candidatePort)) {
      currentPort = candidatePort;
      await persistLastPort(candidatePort);
      return buildRuntime(candidatePort, false);
    }
  }

  const preferredUsable = await isPortUsable(PREFERRED_PORT);
  let targetPort = preferredUsable ? PREFERRED_PORT : await findFreePort();

  try {
    await startServe(targetPort);
  } catch (error) {
    if (targetPort !== PREFERRED_PORT) {
      throw error;
    }

    targetPort = await findFreePort();
    await startServe(targetPort);
  }

  currentPort = targetPort;
  await persistLastPort(targetPort);
  return buildRuntime(targetPort, true);
}

function readLastPort(): number | undefined {
  try {
    const value = portStorage?.getLastPort();
    return isValidPort(value) ? value : undefined;
  } catch (error) {
    console.warn('[opencode-ui] read last serve port failed:', error);
    return undefined;
  }
}

async function persistLastPort(port: number): Promise<void> {
  if (!isValidPort(port) || !portStorage) {
    return;
  }

  try {
    await portStorage.setLastPort(port);
  } catch (error) {
    console.warn('[opencode-ui] persist last serve port failed:', error);
  }
}

function isValidPort(port: number | undefined): port is number {
  return typeof port === 'number' && Number.isInteger(port) && port >= 1 && port <= 65_535;
}

function buildRuntime(port: number, startedByManager: boolean): ServeRuntime {
  return {
    port,
    baseUrl: `http://${HOSTNAME}:${port}`,
    startedByManager
  };
}

async function startServe(port: number): Promise<void> {
  const env = withOpencodeBinInPath();
  const command = resolveOpencodeBinary(env);
  const child = spawn(
    command,
    ['serve', '--hostname', HOSTNAME, '--port', String(port)],
    {
      shell: shouldUseShellForOpencode(command),
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
      windowsHide: shouldHideOpencodeWindow()
    }
  );

  const stderrBuffer: string[] = [];
  child.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8').trim();
    if (text.length > 0) {
      stderrBuffer.push(text);
      if (stderrBuffer.length > 20) {
        stderrBuffer.shift();
      }
    }
  });

  await waitForSpawnReady(child);
  await waitForHealthAfterSpawn(child, port, stderrBuffer);
}

function waitForSpawnReady(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const onError = (error: NodeJS.ErrnoException): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      child.removeListener('error', onError);

      if (error.code === 'ENOENT') {
        reject(new Error('未找到 opencode 可执行文件（ENOENT）。请确认 opencode 已安装且在 PATH 中。'));
        return;
      }

      reject(error);
    };

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      child.removeListener('error', onError);
      resolve();
    }, 300);

    child.once('error', onError);
  });
}

async function waitForHealthAfterSpawn(
  child: ChildProcess,
  port: number,
  stderrBuffer: string[]
): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < STARTUP_TIMEOUT_MS) {
    if (await probeHealth(port)) {
      return;
    }

    if (child.exitCode !== null) {
      const stderrText = stderrBuffer.join('\n');
      throw new Error(
        stderrText
          ? `opencode serve 启动后退出（code=${String(child.exitCode)}）：${stderrText}`
          : `opencode serve 启动后退出（code=${String(child.exitCode)}）。`
      );
    }

    await delay(POLL_INTERVAL_MS);
  }

  throw new Error(`opencode serve 启动超时（>${STARTUP_TIMEOUT_MS}ms，端口 ${port}）。`);
}

export async function probeHealth(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: HOSTNAME,
        port,
        path: HEALTH_PATH,
        method: 'GET',
        timeout: HEALTH_CHECK_TIMEOUT_MS
      },
      (res) => {
        res.resume();
        resolve((res.statusCode ?? 500) >= 200 && (res.statusCode ?? 500) < 300);
      }
    );

    req.on('error', () => {
      resolve(false);
    });

    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });

    req.end();
  });
}

async function isPortUsable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once('error', () => {
      resolve(false);
    });

    server.once('listening', () => {
      server.close(() => {
        resolve(true);
      });
    });

    server.listen(port, HOSTNAME);
  });
}

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.once('error', (error) => {
      reject(error);
    });

    server.once('listening', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => {
          reject(new Error('无法分配可用端口。'));
        });
        return;
      }

      const selectedPort = address.port;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(selectedPort);
      });
    });

    server.listen(0, HOSTNAME);
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
