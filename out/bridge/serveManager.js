"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.configureServePortStorage = configureServePortStorage;
exports.disposeServeManager = disposeServeManager;
exports.ensureServeRunning = ensureServeRunning;
exports.restartServeForConfigChange = restartServeForConfigChange;
exports.requestServeJson = requestServeJson;
exports.resolveServeStartupDirectory = resolveServeStartupDirectory;
exports.isServeDirectoryCompatible = isServeDirectoryCompatible;
exports.probeHealth = probeHealth;
const node_child_process_1 = require("node:child_process");
const http = __importStar(require("node:http"));
const net = __importStar(require("node:net"));
const node_os_1 = require("node:os");
const node_path_1 = require("node:path");
const opencodeEnv_1 = require("./opencodeEnv");
const opencodeServeClient_1 = require("./opencodeServeClient");
const HOSTNAME = '127.0.0.1';
const HEALTH_PATH = '/global/health';
const ANSI_ESCAPE_PATTERN = new RegExp('\\x1b\\[[0-?]*[ -/]*[@-~]', 'g');
const PATH_PATH = '/path';
const PREFERRED_PORT = 4096;
const HEALTH_CHECK_TIMEOUT_MS = 1000;
const PATH_CHECK_TIMEOUT_MS = 1000;
const STARTUP_TIMEOUT_MS = 12000;
const POLL_INTERVAL_MS = 250;
let ensurePromise;
let ensurePromiseWorkspaceRoot;
let restartPromise;
let restartPromiseWorkspaceRoot;
let currentPort;
let currentRuntimeDirectory;
let managedPort;
let managedStartDirectory;
let managedChild;
let disposePromise;
let portStorage;
let lastWorkspaceCwd;
const serveClient = new opencodeServeClient_1.OpencodeServeClient({
    ensureRuntime: (cwd) => ensureServeRunning(cwd)
});
function configureServePortStorage(storage) {
    portStorage = storage;
}
function disposeServeManager() {
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
async function ensureServeRunning(cwd) {
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
async function restartServeForConfigChange(cwd) {
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
async function requestServeJson(pathname, cwd) {
    return serveClient.requestJson(pathname, { cwd });
}
async function ensureServeRunningInternal(cwd) {
    if (currentPort && (await probeHealth(currentPort))) {
        const compatibility = await inspectRuntimeCompatibility(currentPort, cwd, currentRuntimeDirectory ?? getManagedStartDirectory(currentPort));
        if (compatibility.compatible) {
            currentRuntimeDirectory = compatibility.directory;
            await persistLastPort(currentPort);
            return buildRuntime(currentPort, isManagedPort(currentPort));
        }
    }
    else if (currentPort) {
        currentPort = undefined;
        currentRuntimeDirectory = undefined;
    }
    const lastPort = readLastPort();
    const candidatePorts = [];
    if (typeof lastPort === 'number' && lastPort !== currentPort) {
        candidatePorts.push(lastPort);
    }
    if (PREFERRED_PORT !== currentPort && !candidatePorts.includes(PREFERRED_PORT)) {
        candidatePorts.push(PREFERRED_PORT);
    }
    for (const candidatePort of candidatePorts) {
        if (await probeHealth(candidatePort)) {
            const compatibility = await inspectRuntimeCompatibility(candidatePort, cwd, getManagedStartDirectory(candidatePort));
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
    let child;
    try {
        child = await startServe(targetPort, startDirectory);
    }
    catch (error) {
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
async function restartServeForConfigChangeInternal(cwd) {
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
function rememberWorkspaceCwd(cwd) {
    if (cwd?.trim()) {
        lastWorkspaceCwd = cwd;
    }
}
function canSharePendingRuntime(cwd, pendingWorkspaceRoot) {
    const requestedWorkspaceRoot = getWindowsDirectoryRootKey(cwd);
    return !requestedWorkspaceRoot || requestedWorkspaceRoot === pendingWorkspaceRoot;
}
function resolveServeStartupDirectory(cwd, platform = process.platform) {
    if (platform === 'win32') {
        return getWindowsDirectoryRoot(cwd, platform) ?? (0, node_os_1.homedir)();
    }
    return (0, node_os_1.homedir)();
}
function isServeDirectoryCompatible(runtimeDirectory, cwd, platform = process.platform) {
    if (platform !== 'win32') {
        return true;
    }
    const workspaceRoot = getWindowsDirectoryRootKey(cwd, platform);
    if (!workspaceRoot) {
        return true;
    }
    return getWindowsDirectoryRootKey(runtimeDirectory, platform) === workspaceRoot;
}
function getWindowsDirectoryRoot(directory, platform = process.platform) {
    if (platform !== 'win32' || !directory?.trim()) {
        return undefined;
    }
    const normalized = node_path_1.win32.normalize(directory.trim());
    if (!node_path_1.win32.isAbsolute(normalized)) {
        return undefined;
    }
    return node_path_1.win32.parse(normalized).root || undefined;
}
function getWindowsDirectoryRootKey(directory, platform = process.platform) {
    return getWindowsDirectoryRoot(directory, platform)?.toLocaleLowerCase('en-US');
}
function getManagedStartDirectory(port) {
    return managedPort === port ? managedStartDirectory : undefined;
}
async function inspectRuntimeCompatibility(port, cwd, knownDirectory) {
    if (!getWindowsDirectoryRootKey(cwd)) {
        return { compatible: true, directory: knownDirectory };
    }
    const directory = knownDirectory ?? await probeServeDirectory(port);
    return {
        compatible: isServeDirectoryCompatible(directory, cwd),
        directory,
    };
}
async function probeServeDirectory(port) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PATH_CHECK_TIMEOUT_MS);
    try {
        const response = await globalThis.fetch(`http://${HOSTNAME}:${String(port)}${PATH_PATH}`, { signal: controller.signal });
        if (!response.ok) {
            return undefined;
        }
        const payload = await response.json();
        if (!isRecord(payload) || typeof payload.directory !== 'string') {
            return undefined;
        }
        return payload.directory;
    }
    catch {
        return undefined;
    }
    finally {
        clearTimeout(timer);
    }
}
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
function readLastPort() {
    try {
        const value = portStorage?.getLastPort();
        return isValidPort(value) ? value : undefined;
    }
    catch (error) {
        console.warn('[opencode-ui] read last serve port failed:', error);
        return undefined;
    }
}
async function persistLastPort(port) {
    if (!isValidPort(port) || !portStorage) {
        return;
    }
    try {
        await portStorage.setLastPort(port);
    }
    catch (error) {
        console.warn('[opencode-ui] persist last serve port failed:', error);
    }
}
function isValidPort(port) {
    return typeof port === 'number' && Number.isInteger(port) && port >= 1 && port <= 65535;
}
function buildRuntime(port, startedByManager) {
    return {
        port,
        baseUrl: `http://${HOSTNAME}:${port}`,
        startedByManager
    };
}
async function startServe(port, cwd) {
    const env = (0, opencodeEnv_1.withOpencodeBinInPath)();
    const command = (0, opencodeEnv_1.resolveOpencodeBinary)(env);
    const child = (0, node_child_process_1.spawn)(command, ['serve', '--hostname', HOSTNAME, '--port', String(port)], {
        shell: (0, opencodeEnv_1.shouldUseShellForOpencode)(command),
        stdio: ['ignore', 'pipe', 'pipe'],
        env,
        cwd,
        windowsHide: (0, opencodeEnv_1.shouldHideOpencodeWindow)()
    });
    const stderrBuffer = [];
    child.stderr?.on('data', (chunk) => {
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
    }
    catch (error) {
        await stopManagedChild(child);
        throw error;
    }
}
function activateManagedRuntime(child, port, startDirectory) {
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
function isManagedPort(port) {
    return managedPort === port && managedChild?.exitCode === null;
}
function stopManagedChild(child) {
    if (child.exitCode !== null) {
        return Promise.resolve();
    }
    if (process.platform === 'win32' && child.pid) {
        return new Promise((resolve) => {
            (0, node_child_process_1.execFile)('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 5000 }, () => resolve());
        });
    }
    try {
        child.kill();
    }
    catch {
        // The process may already be exiting between the exitCode check and kill().
    }
    return Promise.resolve();
}
function waitForSpawnReady(child) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const onError = (error) => {
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
async function waitForHealthAfterSpawn(child, port, stderrBuffer) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < STARTUP_TIMEOUT_MS) {
        if (await probeHealth(port)) {
            return;
        }
        if (child.exitCode !== null) {
            const stderrText = stripAnsi(stderrBuffer.join('\n'));
            throw new Error(stderrText
                ? `opencode serve 启动后退出（code=${String(child.exitCode)}）：${stderrText}`
                : `opencode serve 启动后退出（code=${String(child.exitCode)}）。`);
        }
        await delay(POLL_INTERVAL_MS);
    }
    throw new Error(`opencode serve 启动超时（>${STARTUP_TIMEOUT_MS}ms，端口 ${port}）。`);
}
function stripAnsi(value) {
    return value.replace(ANSI_ESCAPE_PATTERN, '').replace(/\s+/g, ' ').trim();
}
async function probeHealth(port) {
    return new Promise((resolve) => {
        const req = http.request({
            host: HOSTNAME,
            port,
            path: HEALTH_PATH,
            method: 'GET',
            timeout: HEALTH_CHECK_TIMEOUT_MS
        }, (res) => {
            res.resume();
            resolve((res.statusCode ?? 500) >= 200 && (res.statusCode ?? 500) < 300);
        });
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
async function isPortUsable(port) {
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
async function findFreePort() {
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
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
//# sourceMappingURL=serveManager.js.map