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
exports.probeServeRuntime = probeServeRuntime;
const node_child_process_1 = require("node:child_process");
const node_crypto_1 = require("node:crypto");
const http = __importStar(require("node:http"));
const net = __importStar(require("node:net"));
const node_os_1 = require("node:os");
const node_path_1 = require("node:path");
const opencodeEnv_1 = require("./opencodeEnv");
const opencodeServeClient_1 = require("./opencodeServeClient");
const HOSTNAME = '127.0.0.1';
const HEALTH_PATH = '/global/health';
const V2_INFO_PATH = '/api/info';
const ANSI_ESCAPE_PATTERN = new RegExp('\\x1b\\[[0-?]*[ -/]*[@-~]', 'g');
const PATH_PATH = '/path';
const V2_LOCATION_PATH = '/api/location';
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
let currentRuntime;
let managedPort;
let managedStartDirectory;
let managedChild;
let disposePromise;
let lifecycleGeneration = 0;
const startingChildren = new Set();
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
    const pendingOperations = [ensurePromise, restartPromise].filter((promise) => promise !== undefined);
    lifecycleGeneration += 1;
    managedChild = undefined;
    managedPort = undefined;
    managedStartDirectory = undefined;
    currentPort = undefined;
    currentRuntimeDirectory = undefined;
    currentRuntime = undefined;
    const children = new Set(startingChildren);
    if (child)
        children.add(child);
    const pending = Promise.allSettled([
        ...Array.from(children, stopManagedChild),
        ...pendingOperations,
    ]).then(() => undefined);
    const promise = pending.finally(async () => {
        if (port) {
            await persistStoredPassword(port, undefined);
        }
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
    const generation = lifecycleGeneration;
    if (restartPromise) {
        if (canSharePendingRuntime(cwd, restartPromiseWorkspaceRoot)) {
            const runtime = await restartPromise;
            assertLifecycle(generation);
            return runtime;
        }
        await restartPromise;
        return ensureServeRunning(cwd);
    }
    if (ensurePromise) {
        if (canSharePendingRuntime(cwd, ensurePromiseWorkspaceRoot)) {
            const runtime = await ensurePromise;
            assertLifecycle(generation);
            return runtime;
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
    const runtime = await promise;
    assertLifecycle(generation);
    return runtime;
}
async function restartServeForConfigChange(cwd) {
    rememberWorkspaceCwd(cwd);
    if (disposePromise) {
        await disposePromise;
    }
    const generation = lifecycleGeneration;
    if (restartPromise) {
        const runtime = await restartPromise;
        assertLifecycle(generation);
        return runtime;
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
    const runtime = await promise;
    assertLifecycle(generation);
    return runtime;
}
async function requestServeJson(pathname, cwd) {
    return serveClient.requestJson(pathname, { cwd });
}
async function ensureServeRunningInternal(cwd) {
    const generation = lifecycleGeneration;
    const cachedPort = currentPort;
    const cachedRuntime = currentRuntime;
    const cachedDirectory = currentRuntimeDirectory;
    if (cachedPort) {
        const password = cachedRuntime?.password ?? (await readStoredPassword(cachedPort));
        assertLifecycle(generation);
        const probed = await probeServeRuntime(cachedPort, password, cachedRuntime?.apiVersion);
        assertLifecycle(generation);
        if (probed) {
            const compatibility = await inspectRuntimeCompatibility(cachedPort, cwd, cachedDirectory ?? getManagedStartDirectory(cachedPort), probed);
            assertLifecycle(generation);
            if (compatibility.compatible) {
                currentRuntimeDirectory = compatibility.directory;
                const runtime = buildRuntime(cachedPort, isManagedPort(cachedPort), probed);
                currentRuntime = runtime;
                await persistLastPort(cachedPort);
                assertLifecycle(generation);
                return runtime;
            }
        }
        else {
            await warnUnauthorizedRuntime(cachedPort);
            assertLifecycle(generation);
            currentPort = undefined;
            currentRuntimeDirectory = undefined;
            currentRuntime = undefined;
        }
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
        const password = readEnvironmentPassword() ?? (await readStoredPassword(candidatePort));
        assertLifecycle(generation);
        const probed = await probeServeRuntime(candidatePort, password);
        assertLifecycle(generation);
        if (probed) {
            const compatibility = await inspectRuntimeCompatibility(candidatePort, cwd, getManagedStartDirectory(candidatePort), probed);
            assertLifecycle(generation);
            if (compatibility.compatible) {
                currentPort = candidatePort;
                currentRuntimeDirectory = compatibility.directory;
                const runtime = buildRuntime(candidatePort, isManagedPort(candidatePort), probed);
                currentRuntime = runtime;
                await persistLastPort(candidatePort);
                assertLifecycle(generation);
                return runtime;
            }
        }
    }
    const preferredUsable = await isPortUsable(PREFERRED_PORT);
    let targetPort = preferredUsable ? PREFERRED_PORT : await findFreePort();
    assertLifecycle(generation);
    const startDirectory = resolveServeStartupDirectory(cwd);
    const previousChild = managedChild;
    const previousPort = managedPort;
    let started;
    try {
        started = await startServe(targetPort, startDirectory, generation);
    }
    catch (error) {
        assertLifecycle(generation);
        if (targetPort !== PREFERRED_PORT) {
            throw error;
        }
        targetPort = await findFreePort();
        assertLifecycle(generation);
        started = await startServe(targetPort, startDirectory, generation);
    }
    assertLifecycle(generation);
    activateManagedRuntime(started.child, targetPort, startDirectory);
    currentPort = targetPort;
    currentRuntimeDirectory = startDirectory;
    const runtime = buildRuntime(targetPort, true, started.runtime);
    currentRuntime = runtime;
    await persistLastPort(targetPort);
    assertLifecycle(generation);
    if (previousChild && previousChild !== started.child) {
        await stopManagedChild(previousChild);
        await forgetStoredPassword(previousPort, targetPort);
    }
    assertLifecycle(generation);
    return runtime;
}
async function restartServeForConfigChangeInternal(cwd) {
    const generation = lifecycleGeneration;
    if (ensurePromise) {
        await ensurePromise;
    }
    assertLifecycle(generation);
    const targetPort = await findFreePort();
    assertLifecycle(generation);
    const previousChild = managedChild;
    const previousPort = managedPort;
    const startDirectory = resolveServeStartupDirectory(cwd);
    const started = await startServe(targetPort, startDirectory, generation);
    assertLifecycle(generation);
    activateManagedRuntime(started.child, targetPort, startDirectory);
    currentPort = targetPort;
    currentRuntimeDirectory = startDirectory;
    const runtime = buildRuntime(targetPort, true, started.runtime);
    currentRuntime = runtime;
    await persistLastPort(targetPort);
    assertLifecycle(generation);
    if (previousChild && previousChild !== started.child) {
        await stopManagedChild(previousChild);
        await forgetStoredPassword(previousPort, targetPort);
    }
    assertLifecycle(generation);
    return runtime;
}
function assertLifecycle(generation) {
    if (generation !== lifecycleGeneration) {
        const error = new Error('OpenCode serve runtime changed during discovery.');
        error.name = 'AbortError';
        throw error;
    }
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
async function inspectRuntimeCompatibility(port, cwd, knownDirectory, runtime) {
    if (runtime.apiVersion === 'v2') {
        return { compatible: true, directory: knownDirectory };
    }
    if (!getWindowsDirectoryRootKey(cwd)) {
        return { compatible: true, directory: knownDirectory };
    }
    const directory = knownDirectory ?? await probeServeDirectory(port, runtime);
    return {
        compatible: isServeDirectoryCompatible(directory, cwd),
        directory,
    };
}
async function probeServeDirectory(port, runtime) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PATH_CHECK_TIMEOUT_MS);
    try {
        const headers = runtime.password
            ? { authorization: buildBasicAuthorization(runtime.password) }
            : undefined;
        const response = await globalThis.fetch(`http://${HOSTNAME}:${String(port)}${runtime.apiVersion === 'v2' ? V2_LOCATION_PATH : PATH_PATH}`, { headers, signal: controller.signal });
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
function buildRuntime(port, startedByManager, runtime) {
    if (!isValidPort(port))
        throw new Error('Invalid OpenCode serve port.');
    return {
        port,
        baseUrl: `http://${HOSTNAME}:${port}`,
        startedByManager,
        apiVersion: runtime.apiVersion,
        version: runtime.version,
        password: runtime.password,
    };
}
async function startServe(port, cwd, generation) {
    const env = (0, opencodeEnv_1.withOpencodeBinInPath)();
    const environmentPassword = readEnvironmentPassword();
    const password = environmentPassword ?? createServePassword();
    const generatedPassword = environmentPassword ? undefined : password;
    env.OPENCODE_PASSWORD = password;
    const command = (0, opencodeEnv_1.resolveOpencodeBinary)(env);
    const child = (0, node_child_process_1.spawn)(command, ['serve', '--hostname', HOSTNAME, '--port', String(port)], {
        shell: (0, opencodeEnv_1.shouldUseShellForOpencode)(command),
        stdio: ['ignore', 'pipe', 'pipe'],
        env,
        cwd,
        windowsHide: (0, opencodeEnv_1.shouldHideOpencodeWindow)()
    });
    startingChildren.add(child);
    child.stdout?.on('data', () => {
        // Drain readiness and diagnostic output so a long-lived V2 server cannot
        // block on a full stdout pipe. The environment password is never logged.
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
        assertLifecycle(generation);
        const runtime = await waitForHealthAfterSpawn(child, port, password, stderrBuffer);
        assertLifecycle(generation);
        if (generatedPassword && runtime.apiVersion === 'v2') {
            await persistStoredPassword(port, generatedPassword);
        }
        assertLifecycle(generation);
        return { child, runtime };
    }
    catch (error) {
        await stopManagedChild(child);
        await persistStoredPassword(port, undefined);
        startingChildren.delete(child);
        throw error;
    }
}
function activateManagedRuntime(child, port, startDirectory) {
    startingChildren.delete(child);
    managedChild = child;
    managedPort = port;
    managedStartDirectory = startDirectory;
    child.once("exit", () => {
        if (managedChild !== child) {
            return;
        }
        lifecycleGeneration += 1;
        managedChild = undefined;
        managedPort = undefined;
        managedStartDirectory = undefined;
        void persistStoredPassword(port, undefined);
        if (currentPort === port) {
            currentPort = undefined;
            currentRuntimeDirectory = undefined;
            currentRuntime = undefined;
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
async function waitForHealthAfterSpawn(child, port, password, stderrBuffer) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < STARTUP_TIMEOUT_MS) {
        const runtime = await probeServeRuntime(port, password);
        if (runtime) {
            return runtime;
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
    const password = readEnvironmentPassword() ?? (await readStoredPassword(port));
    return (await probeServeRuntime(port, password)) !== undefined;
}
async function probeServeRuntime(port, password, preferredVersion) {
    if (preferredVersion !== 'v2') {
        const health = await requestServeProbeJson(port, HEALTH_PATH, password);
        if (health && isRecord(health) && health.healthy === true) {
            return {
                apiVersion: 'v1',
                ...(typeof health.version === 'string' ? { version: health.version } : {})
            };
        }
    }
    const info = await requestServeProbeJson(port, V2_INFO_PATH, password);
    if (info && isRecord(info) && typeof info.version === 'string') {
        return {
            apiVersion: 'v2',
            version: info.version,
            ...(password ? { password } : {})
        };
    }
    if (preferredVersion === 'v2') {
        const health = await requestServeProbeJson(port, HEALTH_PATH, password);
        if (health && isRecord(health) && health.healthy === true) {
            return {
                apiVersion: 'v1',
                ...(typeof health.version === 'string' ? { version: health.version } : {})
            };
        }
    }
    return undefined;
}
function readEnvironmentPassword() {
    const value = process.env.OPENCODE_PASSWORD?.trim() ||
        process.env.OPENCODE_SERVER_PASSWORD?.trim();
    return value || undefined;
}
async function readStoredPassword(port) {
    try {
        const value = await portStorage?.getPassword?.(port);
        const normalized = typeof value === 'string' ? value.trim() : '';
        return normalized || undefined;
    }
    catch {
        return undefined;
    }
}
async function persistStoredPassword(port, password) {
    try {
        await portStorage?.setPassword?.(port, password);
    }
    catch {
        // Password persistence is best effort; the current session still works.
    }
}
async function forgetStoredPassword(port, keepPort) {
    if (port === undefined || port === keepPort) {
        return;
    }
    await persistStoredPassword(port, undefined);
}
function createServePassword() {
    return (0, node_crypto_1.randomBytes)(32).toString('base64url');
}
function buildBasicAuthorization(password) {
    return `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`;
}
function requestServeProbeJson(port, pathname, password) {
    return new Promise((resolve) => {
        let settled = false;
        const settle = (value) => {
            if (settled)
                return;
            settled = true;
            resolve(value);
        };
        const req = http.request({
            host: HOSTNAME,
            port,
            path: pathname,
            method: 'GET',
            timeout: HEALTH_CHECK_TIMEOUT_MS,
            headers: password
                ? { authorization: buildBasicAuthorization(password) }
                : undefined
        }, (res) => {
            if ((res.statusCode ?? 500) < 200 || (res.statusCode ?? 500) >= 300) {
                res.resume();
                settle(undefined);
                return;
            }
            const chunks = [];
            let bytes = 0;
            res.on('data', (chunk) => {
                const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                bytes += buffer.length;
                if (bytes <= 1048576) {
                    chunks.push(buffer);
                }
                else {
                    settle(undefined);
                    res.destroy();
                }
            });
            res.on('end', () => {
                const text = Buffer.concat(chunks).toString('utf8').trim();
                if (!text) {
                    settle(undefined);
                    return;
                }
                try {
                    settle(JSON.parse(text));
                }
                catch {
                    settle(undefined);
                }
            });
        });
        req.on('error', () => settle(undefined));
        req.on('timeout', () => {
            req.destroy();
            settle(undefined);
        });
        req.end();
    });
}
/**
 * A V2 server without a matching password answers 401, which the JSON probe
 * cannot tell apart from "nothing is listening". Report it instead of quietly
 * starting a second instance next to the running one.
 */
function probeServeInfoStatus(port) {
    return new Promise((resolve) => {
        let settled = false;
        const settle = (value) => {
            if (settled)
                return;
            settled = true;
            resolve(value);
        };
        const req = http.request({
            host: HOSTNAME,
            port,
            path: V2_INFO_PATH,
            method: 'GET',
            timeout: HEALTH_CHECK_TIMEOUT_MS
        }, (res) => {
            res.resume();
            settle(res.statusCode);
        });
        req.on('error', () => settle(undefined));
        req.on('timeout', () => {
            req.destroy();
            settle(undefined);
        });
        req.end();
    });
}
async function warnUnauthorizedRuntime(port) {
    const status = await probeServeInfoStatus(port);
    if (status !== 401) {
        return;
    }
    console.warn(`[opencode-ui] OpenCode V2 server on ${HOSTNAME}:${String(port)} requires a password this extension does not have; starting a separate instance instead of reusing it.`);
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