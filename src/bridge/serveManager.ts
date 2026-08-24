import { execFile, spawn, type ChildProcess } from 'node:child_process';
import * as http from 'node:http';
import * as net from 'node:net';
import { homedir } from 'node:os';
import { win32 } from 'node:path';
import { resolveOpencodeBinary, shouldHideOpencodeWindow, shouldUseShellForOpencode, withOpencodeBinInPath } from './opencodeEnv';
import { OpencodeServeClient } from './opencodeServeClient';

const HOSTNAME = '127.0.0.1';
const HEALTH_PATH = '/global/health';
const ANSI_ESCAPE_PATTERN = new RegExp('\\x1b\\[[0-?]*[ -/]*[@-~]', 'g');
const PATH_PATH = '/path';
const PREFERRED_PORT = 4096;
const HEALTH_CHECK_TIMEOUT_MS = 1_000;
const PATH_CHECK_TIMEOUT_MS = 1_000;
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
let ensurePromiseWorkspaceRoot: string | undefined;
let restartPromise: Promise<ServeRuntime> | undefined;
let restartPromiseWorkspaceRoot: string | undefined;
let currentPort: number | undefined;
let currentRuntimeDirectory: string | undefined;
let managedPort: number | undefined;
let managedStartDirectory: string | undefined;
let managedChild: ChildProcess | undefined;
let disposePromise: Promise<void> | undefined;
let portStorage: ServePortStorage | undefined;
let lastWorkspaceCwd: string | undefined;
const serveClient = new OpencodeServeClient({
  ensureRuntime: (cwd) => ensureServeRunning(cwd)
});

export function configureServePortStorage(storage: ServePortStorage): void {
  portStorage = storage;
}

export function disposeServeManager(): Promise<void> {
	if (disposePromise) {
		return disposePromise;
	}
	const child = managedChild;
	const port = managedPort;
	managedChild = undefined;
	managedPort = undefined;
	managedStartDirectory = undefined;
	if (currentPort === port) {
		currentPort = undefined;
		currentRuntimeDirectory = undefined;
	}
	const pending = child ? stopManagedChild(child) : Promise.resolve();
	const promise = pending.finally(() => {
		if (disposePromise === promise) {
			disposePromise = undefined;
		}
	});
	disposePromise = promise;
	return promise;
}

export async function ensureServeRunning(cwd?: string): Promise<ServeRuntime> {
	rememberWorkspaceCwd(cwd);
	if (disposePromise) {
		await disposePromise;
	}
	if (restartPromise) {
		if (canSharePendingRuntime(cwd, restartPromiseWorkspaceRoot)) {
			return restartPromise;
		}
		await restartPromise;
		return ensureServeRunning(cwd);
	}
	if (ensurePromise) {
		if (canSharePendingRuntime(cwd, ensurePromiseWorkspaceRoot)) {
			return ensurePromise;
		}
		await ensurePromise;
		return ensureServeRunning(cwd);
	}

	const workspaceRoot = getWindowsDirectoryRootKey(cwd);
	const promise = ensureServeRunningInternal(cwd).finally(() => {
		if (ensurePromise === promise) {
			ensurePromise = undefined;
			ensurePromiseWorkspaceRoot = undefined;
		}
	});
	ensurePromise = promise;
	ensurePromiseWorkspaceRoot = workspaceRoot;

	return ensurePromise;
}

export async function restartServeForConfigChange(cwd?: string): Promise<ServeRuntime> {
	rememberWorkspaceCwd(cwd);
	if (disposePromise) {
		await disposePromise;
	}
	if (restartPromise) {
		return restartPromise;
	}

	const effectiveCwd = cwd ?? lastWorkspaceCwd;
	const workspaceRoot = getWindowsDirectoryRootKey(effectiveCwd);
	const promise = restartServeForConfigChangeInternal(effectiveCwd).finally(() => {
		if (restartPromise === promise) {
			restartPromise = undefined;
			restartPromiseWorkspaceRoot = undefined;
		}
	});
	restartPromise = promise;
	restartPromiseWorkspaceRoot = workspaceRoot;
	return restartPromise;
}

export async function requestServeJson<T>(pathname: string, cwd?: string): Promise<T> {
  return serveClient.requestJson<T>(pathname, { cwd });
}

async function ensureServeRunningInternal(cwd?: string): Promise<ServeRuntime> {
	if (currentPort && (await probeHealth(currentPort))) {
		const compatibility = await inspectRuntimeCompatibility(
			currentPort,
			cwd,
			currentRuntimeDirectory ?? getManagedStartDirectory(currentPort),
		);
		if (compatibility.compatible) {
			currentRuntimeDirectory = compatibility.directory;
			await persistLastPort(currentPort);
			return buildRuntime(currentPort, isManagedPort(currentPort));
		}
	} else if (currentPort) {
		currentPort = undefined;
		currentRuntimeDirectory = undefined;
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
			const compatibility = await inspectRuntimeCompatibility(
				candidatePort,
				cwd,
				getManagedStartDirectory(candidatePort),
			);
			if (compatibility.compatible) {
				currentPort = candidatePort;
				currentRuntimeDirectory = compatibility.directory;
				await persistLastPort(candidatePort);
				return buildRuntime(candidatePort, isManagedPort(candidatePort));
			}
		}
	}

  const preferredUsable = await isPortUsable(PREFERRED_PORT);
  let targetPort = preferredUsable ? PREFERRED_PORT : await findFreePort();
	const startDirectory = resolveServeStartupDirectory(cwd);
	const previousChild = managedChild;
	let child: ChildProcess;

  try {
		child = await startServe(targetPort, startDirectory);
	} catch (error) {
		if (targetPort !== PREFERRED_PORT) {
			throw error;
		}

		targetPort = await findFreePort();
		child = await startServe(targetPort, startDirectory);
	}

	activateManagedRuntime(child, targetPort, startDirectory);
  currentPort = targetPort;
	currentRuntimeDirectory = startDirectory;
  await persistLastPort(targetPort);
	if (previousChild && previousChild !== child) {
		await stopManagedChild(previousChild);
	}
	return buildRuntime(targetPort, true);
}

async function restartServeForConfigChangeInternal(cwd?: string): Promise<ServeRuntime> {
	if (ensurePromise) {
		await ensurePromise;
	}

	const targetPort = await findFreePort();
	const previousChild = managedChild;
	const startDirectory = resolveServeStartupDirectory(cwd);
	const child = await startServe(targetPort, startDirectory);
	activateManagedRuntime(child, targetPort, startDirectory);
	currentPort = targetPort;
	currentRuntimeDirectory = startDirectory;
	await persistLastPort(targetPort);

	if (previousChild && previousChild !== child) {
		await stopManagedChild(previousChild);
	}

	return buildRuntime(targetPort, true);
}

function rememberWorkspaceCwd(cwd: string | undefined): void {
	if (cwd?.trim()) {
		lastWorkspaceCwd = cwd;
	}
}

function canSharePendingRuntime(
	cwd: string | undefined,
	pendingWorkspaceRoot: string | undefined,
): boolean {
	const requestedWorkspaceRoot = getWindowsDirectoryRootKey(cwd);
	return !requestedWorkspaceRoot || requestedWorkspaceRoot === pendingWorkspaceRoot;
}

export function resolveServeStartupDirectory(
	cwd: string | undefined,
	platform: NodeJS.Platform = process.platform,
): string {
	if (platform === 'win32') {
		return getWindowsDirectoryRoot(cwd, platform) ?? homedir();
	}
	return homedir();
}

export function isServeDirectoryCompatible(
	runtimeDirectory: string | undefined,
	cwd: string | undefined,
	platform: NodeJS.Platform = process.platform,
): boolean {
	if (platform !== 'win32') {
		return true;
	}

	const workspaceRoot = getWindowsDirectoryRootKey(cwd, platform);
	if (!workspaceRoot) {
		return true;
	}
	return getWindowsDirectoryRootKey(runtimeDirectory, platform) === workspaceRoot;
}

function getWindowsDirectoryRoot(
	directory: string | undefined,
	platform: NodeJS.Platform = process.platform,
): string | undefined {
	if (platform !== 'win32' || !directory?.trim()) {
		return undefined;
	}

	const normalized = win32.normalize(directory.trim());
	if (!win32.isAbsolute(normalized)) {
		return undefined;
	}
	return win32.parse(normalized).root || undefined;
}

function getWindowsDirectoryRootKey(
	directory: string | undefined,
	platform: NodeJS.Platform = process.platform,
): string | undefined {
	return getWindowsDirectoryRoot(directory, platform)?.toLocaleLowerCase('en-US');
}

function getManagedStartDirectory(port: number): string | undefined {
	return managedPort === port ? managedStartDirectory : undefined;
}

async function inspectRuntimeCompatibility(
	port: number,
	cwd: string | undefined,
	knownDirectory: string | undefined,
): Promise<{ compatible: boolean; directory: string | undefined }> {
	if (!getWindowsDirectoryRootKey(cwd)) {
		return { compatible: true, directory: knownDirectory };
	}

	const directory = knownDirectory ?? await probeServeDirectory(port);
	return {
		compatible: isServeDirectoryCompatible(directory, cwd),
		directory,
	};
}

async function probeServeDirectory(port: number): Promise<string | undefined> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), PATH_CHECK_TIMEOUT_MS);
	try {
		const response = await globalThis.fetch(
			`http://${HOSTNAME}:${String(port)}${PATH_PATH}`,
			{ signal: controller.signal },
		);
		if (!response.ok) {
			return undefined;
		}
		const payload = await response.json() as unknown;
		if (!isRecord(payload) || typeof payload.directory !== 'string') {
			return undefined;
		}
		return payload.directory;
	} catch {
		return undefined;
	} finally {
		clearTimeout(timer);
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
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

async function startServe(port: number, cwd: string): Promise<ChildProcess> {
  const env = withOpencodeBinInPath();
  const command = resolveOpencodeBinary(env);
  const child = spawn(
    command,
    ['serve', '--hostname', HOSTNAME, '--port', String(port)],
    {
      shell: shouldUseShellForOpencode(command),
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
      cwd,
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

	try {
		await waitForSpawnReady(child);
		await waitForHealthAfterSpawn(child, port, stderrBuffer);
		return child;
	} catch (error) {
		await stopManagedChild(child);
		throw error;
	}
}

function activateManagedRuntime(child: ChildProcess, port: number, startDirectory: string): void {
	managedChild = child;
	managedPort = port;
	managedStartDirectory = startDirectory;
	child.once("exit", () => {
		if (managedChild !== child) {
			return;
		}
		managedChild = undefined;
		managedPort = undefined;
		managedStartDirectory = undefined;
		if (currentPort === port) {
			currentPort = undefined;
			currentRuntimeDirectory = undefined;
		}
	});
}

function isManagedPort(port: number): boolean {
	return managedPort === port && managedChild?.exitCode === null;
}

function stopManagedChild(child: ChildProcess): Promise<void> {
	if (child.exitCode !== null) {
		return Promise.resolve();
	}
	if (process.platform === 'win32' && child.pid) {
		return new Promise((resolve) => {
			execFile(
				'taskkill.exe',
				['/pid', String(child.pid), '/T', '/F'],
				{ windowsHide: true, timeout: 5_000 },
				() => resolve(),
			);
		});
	}
	try {
		child.kill();
	} catch {
		// The process may already be exiting between the exitCode check and kill().
	}
	return Promise.resolve();
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
      const stderrText = stripAnsi(stderrBuffer.join('\n'));
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

function stripAnsi(value: string): string {
  return value.replace(ANSI_ESCAPE_PATTERN, '').replace(/\s+/g, ' ').trim();
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
