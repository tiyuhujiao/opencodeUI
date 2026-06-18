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
exports.ensureServeRunning = ensureServeRunning;
exports.probeHealth = probeHealth;
const node_child_process_1 = require("node:child_process");
const http = __importStar(require("node:http"));
const net = __importStar(require("node:net"));
const opencodeEnv_1 = require("./opencodeEnv");
const HOSTNAME = '127.0.0.1';
const HEALTH_PATH = '/global/health';
const PREFERRED_PORT = 4096;
const HEALTH_CHECK_TIMEOUT_MS = 1000;
const STARTUP_TIMEOUT_MS = 12000;
const POLL_INTERVAL_MS = 250;
let ensurePromise;
let currentPort;
let portStorage;
function configureServePortStorage(storage) {
    portStorage = storage;
}
async function ensureServeRunning() {
    if (ensurePromise) {
        return ensurePromise;
    }
    ensurePromise = ensureServeRunningInternal().finally(() => {
        ensurePromise = undefined;
    });
    return ensurePromise;
}
async function ensureServeRunningInternal() {
    if (currentPort && (await probeHealth(currentPort))) {
        await persistLastPort(currentPort);
        return buildRuntime(currentPort, false);
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
            currentPort = candidatePort;
            await persistLastPort(candidatePort);
            return buildRuntime(candidatePort, false);
        }
    }
    const preferredUsable = await isPortUsable(PREFERRED_PORT);
    let targetPort = preferredUsable ? PREFERRED_PORT : await findFreePort();
    try {
        await startServe(targetPort);
    }
    catch (error) {
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
async function startServe(port) {
    const env = (0, opencodeEnv_1.withOpencodeBinInPath)();
    const command = (0, opencodeEnv_1.resolveOpencodeBinary)(env);
    const child = (0, node_child_process_1.spawn)(command, ['serve', '--hostname', HOSTNAME, '--port', String(port)], {
        shell: (0, opencodeEnv_1.shouldUseShellForOpencode)(command),
        stdio: ['ignore', 'pipe', 'pipe'],
        env,
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
    await waitForSpawnReady(child);
    await waitForHealthAfterSpawn(child, port, stderrBuffer);
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
            const stderrText = stderrBuffer.join('\n');
            throw new Error(stderrText
                ? `opencode serve 启动后退出（code=${String(child.exitCode)}）：${stderrText}`
                : `opencode serve 启动后退出（code=${String(child.exitCode)}）。`);
        }
        await delay(POLL_INTERVAL_MS);
    }
    throw new Error(`opencode serve 启动超时（>${STARTUP_TIMEOUT_MS}ms，端口 ${port}）。`);
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