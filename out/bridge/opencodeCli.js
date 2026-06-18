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
exports.OpencodeCliError = void 0;
exports.spawnOpencode = spawnOpencode;
exports.sessionListJson = sessionListJson;
exports.sessionDelete = sessionDelete;
exports.exportSession = exportSession;
exports.authList = authList;
exports.opencodeVersion = opencodeVersion;
exports.exportSessionToJsonText = exportSessionToJsonText;
exports.modelsVerbose = modelsVerbose;
exports.modelsList = modelsList;
exports.modelsVerboseForProvider = modelsVerboseForProvider;
exports.agentList = agentList;
exports.runStream = runStream;
exports.__setSpawnImplementationForTests = __setSpawnImplementationForTests;
const node_child_process_1 = require("node:child_process");
const fs = __importStar(require("node:fs"));
const node_os_1 = require("node:os");
const path = __importStar(require("node:path"));
const node_stream_1 = require("node:stream");
const node_readline_1 = require("node:readline");
const opencodeEnv_1 = require("./opencodeEnv");
// Some commands (notably `run`) can take multiple minutes depending on provider latency
// and tool usage. We keep a conservative default but allow callers to override.
const DEFAULT_TIMEOUT_MS = 2 * 60000;
const STDERR_SNIPPET_MAX = 400;
let spawnImpl = node_child_process_1.spawn;
class OpencodeCliError extends Error {
    constructor(code, message, options) {
        super(message);
        this.name = 'OpencodeCliError';
        this.code = code;
        this.exitCode = options?.exitCode;
        this.stderrSnippet = options?.stderrSnippet;
        this.cause = options?.cause;
    }
}
exports.OpencodeCliError = OpencodeCliError;
function spawnOpencode(args, opts = {}) {
    assertAllowedArgs(args);
    const spawnOptions = {
        shell: false,
        stdio: 'pipe',
        cwd: opts.cwd,
        env: (0, opencodeEnv_1.withOpencodeBinInPath)(opts.env),
        windowsHide: (0, opencodeEnv_1.shouldHideOpencodeWindow)()
    };
    const command = (0, opencodeEnv_1.resolveOpencodeBinary)(spawnOptions.env);
    spawnOptions.shell = (0, opencodeEnv_1.shouldUseShellForOpencode)(command);
    const child = spawnImpl(command, [...args], spawnOptions);
    // We never provide interactive input. Keeping stdin open can cause some CLIs to
    // block waiting for input/EOF when run under a non-TTY (like VS Code extension host).
    // Close it immediately to avoid hangs.
    try {
        child.stdin.end();
    }
    catch { }
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    let stdout = '';
    let stderr = '';
    let timer;
    let didTimeout = false;
    let didAbort = false;
    let settled = false;
    const stdoutLineBus = new node_stream_1.PassThrough();
    const stderrLineBus = new node_stream_1.PassThrough();
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
        stdout += chunk;
        stdoutLineBus.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
        stderr += chunk;
        stderrLineBus.write(chunk);
    });
    child.stdout.once('end', () => {
        stdoutLineBus.end();
    });
    child.stderr.once('end', () => {
        stderrLineBus.end();
    });
    const cleanup = () => {
        if (timer) {
            clearTimeout(timer);
            timer = undefined;
        }
        if (opts.signal) {
            opts.signal.removeEventListener('abort', onAbort);
        }
    };
    const onAbort = () => {
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
        }
        else {
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
    const completion = new Promise((resolve, reject) => {
        child.once('error', (error) => {
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
        child.once('close', (code) => {
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
                reject(new OpencodeCliError('EXIT_NON_ZERO', snippet
                    ? `opencode 命令退出码非 0（code=${String(normalizedCode)}）：${snippet}`
                    : `opencode 命令退出码非 0（code=${String(normalizedCode)}）。`, {
                    exitCode: normalizedCode,
                    stderrSnippet: snippet
                }));
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
async function sessionListJson(opts) {
    return spawnOpencode(['session', 'list', '--format', 'json'], opts).completion;
}
async function sessionDelete(sessionId, opts) {
    return spawnOpencode(['session', 'delete', sessionId], opts).completion;
}
async function exportSession(id, opts) {
    return spawnOpencode(['export', id], opts).completion;
}
async function authList(opts) {
    return spawnOpencode(['auth', 'list'], opts).completion;
}
async function opencodeVersion(opts) {
    return spawnOpencode(['--version'], opts).completion;
}
// `opencode export` can produce very large JSON outputs.
// In some environments, piping stdout back into the extension host may result in truncated output.
// To make export reliable, we write stdout to a temp file and read it back.
async function exportSessionToJsonText(id, opts = {}) {
    assertAllowedArgs(['export', id]);
    const env = (0, opencodeEnv_1.withOpencodeBinInPath)(opts.env);
    const command = (0, opencodeEnv_1.resolveOpencodeBinary)(env);
    const cwd = opts.cwd;
    const tempDir = fs.mkdtempSync(path.join((0, node_os_1.tmpdir)(), 'opencode-ui-export-'));
    const outPath = path.join(tempDir, 'export.json');
    const fd = fs.openSync(outPath, 'w');
    let timer;
    let didTimeout = false;
    let didAbort = false;
    let settled = false;
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const child = spawnImpl(command, ['export', id], {
        shell: (0, opencodeEnv_1.shouldUseShellForOpencode)(command),
        stdio: ['ignore', fd, 'pipe'],
        cwd,
        env,
        windowsHide: (0, opencodeEnv_1.shouldHideOpencodeWindow)()
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
        stderr += chunk;
    });
    const cleanup = () => {
        if (timer) {
            clearTimeout(timer);
            timer = undefined;
        }
        if (opts.signal) {
            opts.signal.removeEventListener('abort', onAbort);
        }
        try {
            fs.closeSync(fd);
        }
        catch { }
    };
    const onAbort = () => {
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
        }
        else {
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
    const completion = new Promise((resolve, reject) => {
        child.once('error', (error) => {
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
        child.once('close', (code) => {
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
                reject(new OpencodeCliError('EXIT_NON_ZERO', snippet ? `opencode 命令退出码非 0（code=${String(normalizedCode)}）：${snippet}` : `opencode 命令退出码非 0（code=${String(normalizedCode)}）。`, { exitCode: normalizedCode, stderrSnippet: snippet }));
                return;
            }
            try {
                const jsonText = fs.readFileSync(outPath, 'utf8');
                resolve(jsonText);
            }
            catch (error) {
                reject(error);
            }
            finally {
                try {
                    fs.rmSync(tempDir, { recursive: true, force: true });
                }
                catch { }
            }
        });
    });
    return completion;
}
async function modelsVerbose(opts) {
    return spawnOpencode(['models', '--verbose'], opts).completion;
}
async function modelsList(opts) {
    return spawnOpencode(['models'], opts).completion;
}
async function modelsVerboseForProvider(providerId, opts) {
    return spawnOpencode(['models', providerId, '--verbose'], opts).completion;
}
async function agentList(opts) {
    return spawnOpencode(['agent', 'list'], opts).completion;
}
function runStream(message, options, opts) {
    const args = ['run', message, '--format', 'json', '--model', options.model, '--agent', options.agent, '--log-level', 'ERROR'];
    if (options.thinking) {
        args.push('--thinking');
    }
    if (typeof options.variant === 'string' && options.variant.trim().length > 0) {
        args.push('--variant', options.variant.trim());
    }
    if (options.sessionId && options.sessionId.trim().length > 0) {
        args.push('--session', options.sessionId);
    }
    else if (options.title && options.title.trim().length > 0) {
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
function __setSpawnImplementationForTests(nextSpawn) {
    spawnImpl = nextSpawn ?? node_child_process_1.spawn;
}
function streamLines(stream) {
    return {
        async *[Symbol.asyncIterator]() {
            const rl = (0, node_readline_1.createInterface)({
                input: stream,
                crlfDelay: Number.POSITIVE_INFINITY
            });
            try {
                for await (const line of rl) {
                    yield line;
                }
            }
            finally {
                rl.close();
            }
        }
    };
}
function trimSnippet(input, maxLength) {
    const normalized = input.trim();
    if (normalized.length <= maxLength) {
        return normalized;
    }
    return `${normalized.slice(0, maxLength)}…`;
}
function assertAllowedArgs(args) {
    if (isAllowedArgs(args)) {
        return;
    }
    throw new OpencodeCliError('INVALID_ARGS', `不允许的 opencode 子命令参数：${JSON.stringify(args)}。仅允许 --version / session list --format json / export <id> / models --verbose / agent list / run <message> --format json ...`);
}
function isAllowedArgs(args) {
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
        const seenFlags = new Set();
        // `--thinking` is a boolean flag with no value; remove it before validating pairs.
        let sawThinking = false;
        const filteredTail = [];
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
//# sourceMappingURL=opencodeCli.js.map