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
exports.resolveOpencodeBinary = resolveOpencodeBinary;
exports.shouldUseShellForOpencode = shouldUseShellForOpencode;
exports.shouldHideOpencodeWindow = shouldHideOpencodeWindow;
exports.__setExistsSyncImplementationForTests = __setExistsSyncImplementationForTests;
exports.__setPlatformForTests = __setPlatformForTests;
exports.__setExecFileSyncImplementationForTests = __setExecFileSyncImplementationForTests;
exports.withOpencodeBinInPath = withOpencodeBinInPath;
const fs = __importStar(require("node:fs"));
const node_child_process_1 = require("node:child_process");
const node_os_1 = require("node:os");
const node_path_1 = require("node:path");
let existsSyncImpl;
let platformImpl;
let execFileSyncImpl;
function resolveOpencodeBinary(baseEnv) {
    const sourceEnv = baseEnv ?? process.env;
    const overriddenBinary = sourceEnv.OPENCODE_BINARY?.trim();
    if (overriddenBinary) {
        return normalizeResolvedBinary(overriddenBinary, sourceEnv);
    }
    for (const candidatePath of getBundledBinaryCandidates(sourceEnv)) {
        if (resolveExistsSync()(candidatePath)) {
            return normalizeResolvedBinary(candidatePath, sourceEnv);
        }
    }
    const discovered = resolveFromWhere(sourceEnv);
    if (discovered) {
        return normalizeResolvedBinary(discovered, sourceEnv);
    }
    return 'opencode';
}
function shouldUseShellForOpencode(binary) {
    return resolvePlatform() === 'win32' && /\.(cmd|bat)$/i.test(binary);
}
function shouldHideOpencodeWindow() {
    return resolvePlatform() === 'win32';
}
function __setExistsSyncImplementationForTests(nextExistsSync) {
    existsSyncImpl = nextExistsSync;
}
function __setPlatformForTests(nextPlatform) {
    platformImpl = nextPlatform;
}
function __setExecFileSyncImplementationForTests(nextExecFileSync) {
    execFileSyncImpl = nextExecFileSync;
}
function resolveExistsSync() {
    if (existsSyncImpl) {
        return existsSyncImpl;
    }
    return (path) => {
        const candidate = fs.existsSync;
        if (typeof candidate !== 'function') {
            return false;
        }
        return candidate(path);
    };
}
function withOpencodeBinInPath(baseEnv) {
    const sourceEnv = baseEnv ?? process.env;
    const env = { ...sourceEnv };
    const pathKey = resolvePathKey(env);
    const existingPath = env[pathKey] ?? '';
    const pathEntries = existingPath.split(resolvePathDelimiter()).filter((entry) => entry.length > 0);
    const preferredBinDirs = getPreferredBinDirectories(env);
    if (preferredBinDirs.every((entry) => pathEntries.includes(entry))) {
        return env;
    }
    const nextEntries = [...preferredBinDirs.filter((entry) => !pathEntries.includes(entry)), ...pathEntries];
    env[pathKey] = nextEntries.join(resolvePathDelimiter());
    return env;
}
function getBundledBinaryCandidates(env) {
    if (resolvePlatform() === 'win32') {
        const userHome = resolveUserHome(env);
        const appData = getEnvValue(env, 'APPDATA');
        const localAppData = getEnvValue(env, 'LOCALAPPDATA');
        const programData = getEnvValue(env, 'PROGRAMDATA') ?? 'C:\\ProgramData';
        const defaultInstallDir = getDefaultInstallDir(env);
        const homeBinDir = getHomeBinDir(env);
        const installDirOverride = getEnvValue(env, 'OPENCODE_INSTALL_DIR');
        const xdgBinDir = getEnvValue(env, 'XDG_BIN_DIR');
        const pnpmHome = getEnvValue(env, 'PNPM_HOME');
        const voltaHome = getEnvValue(env, 'VOLTA_HOME') ?? (localAppData ? node_path_1.win32.join(localAppData, 'Volta') : undefined);
        return compactUnique([
            installDirOverride ? node_path_1.win32.join(installDirOverride, 'opencode.exe') : undefined,
            installDirOverride ? node_path_1.win32.join(installDirOverride, 'opencode.cmd') : undefined,
            xdgBinDir ? node_path_1.win32.join(xdgBinDir, 'opencode.exe') : undefined,
            xdgBinDir ? node_path_1.win32.join(xdgBinDir, 'opencode.cmd') : undefined,
            node_path_1.win32.join(homeBinDir, 'opencode.exe'),
            node_path_1.win32.join(homeBinDir, 'opencode.cmd'),
            node_path_1.win32.join(defaultInstallDir, 'opencode.exe'),
            node_path_1.win32.join(defaultInstallDir, 'opencode.cmd'),
            node_path_1.win32.join(defaultInstallDir, 'opencode'),
            userHome ? node_path_1.win32.join(userHome, '.local', 'bin', 'opencode.exe') : undefined,
            userHome ? node_path_1.win32.join(userHome, '.local', 'bin', 'opencode.cmd') : undefined,
            userHome ? node_path_1.win32.join(userHome, '.bun', 'bin', 'opencode.exe') : undefined,
            userHome ? node_path_1.win32.join(userHome, '.bun', 'bin', 'opencode.cmd') : undefined,
            appData ? node_path_1.win32.join(appData, 'npm', 'opencode.cmd') : undefined,
            appData ? node_path_1.win32.join(appData, 'npm', 'opencode.exe') : undefined,
            localAppData ? node_path_1.win32.join(localAppData, 'Yarn', 'bin', 'opencode.cmd') : undefined,
            localAppData ? node_path_1.win32.join(localAppData, 'Yarn', 'bin', 'opencode.exe') : undefined,
            pnpmHome ? node_path_1.win32.join(pnpmHome, 'opencode.cmd') : undefined,
            pnpmHome ? node_path_1.win32.join(pnpmHome, 'opencode.exe') : undefined,
            localAppData ? node_path_1.win32.join(localAppData, 'pnpm', 'opencode.cmd') : undefined,
            localAppData ? node_path_1.win32.join(localAppData, 'pnpm', 'opencode.exe') : undefined,
            voltaHome ? node_path_1.win32.join(voltaHome, 'bin', 'opencode.cmd') : undefined,
            voltaHome ? node_path_1.win32.join(voltaHome, 'bin', 'opencode.exe') : undefined,
            voltaHome ? node_path_1.win32.join(voltaHome, 'bin', 'opencode.bat') : undefined,
            userHome ? node_path_1.win32.join(userHome, 'scoop', 'shims', 'opencode.cmd') : undefined,
            userHome ? node_path_1.win32.join(userHome, 'scoop', 'shims', 'opencode.exe') : undefined,
            userHome ? node_path_1.win32.join(userHome, 'scoop', 'apps', 'opencode', 'current', 'opencode.exe') : undefined,
            node_path_1.win32.join(programData, 'chocolatey', 'bin', 'opencode.exe'),
            node_path_1.win32.join(programData, 'chocolatey', 'bin', 'opencode.cmd'),
            node_path_1.win32.join(programData, 'chocolatey', 'lib', 'opencode', 'tools', 'opencode.exe'),
            localAppData ? node_path_1.win32.join(localAppData, 'mise', 'shims', 'opencode.exe') : undefined,
            localAppData ? node_path_1.win32.join(localAppData, 'mise', 'shims', 'opencode.cmd') : undefined
        ]);
    }
    const userHome = resolveUserHome(env);
    const installDirOverride = getEnvValue(env, 'OPENCODE_INSTALL_DIR');
    const xdgBinDir = getEnvValue(env, 'XDG_BIN_DIR');
    const pnpmHome = getEnvValue(env, 'PNPM_HOME');
    const voltaHome = getEnvValue(env, 'VOLTA_HOME') ?? node_path_1.posix.join(userHome, '.volta');
    return compactUnique([
        installDirOverride ? node_path_1.posix.join(installDirOverride, 'opencode') : undefined,
        xdgBinDir ? node_path_1.posix.join(xdgBinDir, 'opencode') : undefined,
        node_path_1.posix.join(getDefaultInstallDir(env), 'opencode'),
        node_path_1.posix.join(getHomeBinDir(env), 'opencode'),
        node_path_1.posix.join(userHome, '.local', 'bin', 'opencode'),
        node_path_1.posix.join(userHome, '.bun', 'bin', 'opencode'),
        pnpmHome ? node_path_1.posix.join(pnpmHome, 'opencode') : undefined,
        node_path_1.posix.join(userHome, '.local', 'share', 'pnpm', 'opencode'),
        voltaHome ? node_path_1.posix.join(voltaHome, 'bin', 'opencode') : undefined,
        node_path_1.posix.join(userHome, '.local', 'share', 'mise', 'shims', 'opencode')
    ]);
}
function getPreferredBinDirectories(env) {
    if (resolvePlatform() !== 'win32') {
        const userHome = resolveUserHome(env);
        const installDirOverride = getEnvValue(env, 'OPENCODE_INSTALL_DIR');
        const xdgBinDir = getEnvValue(env, 'XDG_BIN_DIR');
        const pnpmHome = getEnvValue(env, 'PNPM_HOME');
        const voltaHome = getEnvValue(env, 'VOLTA_HOME') ?? node_path_1.posix.join(userHome, '.volta');
        return compactUnique([
            installDirOverride,
            xdgBinDir,
            getDefaultInstallDir(env),
            getHomeBinDir(env),
            node_path_1.posix.join(userHome, '.local', 'bin'),
            node_path_1.posix.join(userHome, '.bun', 'bin'),
            pnpmHome,
            node_path_1.posix.join(userHome, '.local', 'share', 'pnpm'),
            voltaHome ? node_path_1.posix.join(voltaHome, 'bin') : undefined,
            node_path_1.posix.join(userHome, '.local', 'share', 'mise', 'shims')
        ]);
    }
    const userHome = resolveUserHome(env);
    const appData = getEnvValue(env, 'APPDATA');
    const localAppData = getEnvValue(env, 'LOCALAPPDATA');
    const programData = getEnvValue(env, 'PROGRAMDATA') ?? 'C:\\ProgramData';
    const homeBinDir = getHomeBinDir(env);
    const installDirOverride = getEnvValue(env, 'OPENCODE_INSTALL_DIR');
    const xdgBinDir = getEnvValue(env, 'XDG_BIN_DIR');
    const pnpmHome = getEnvValue(env, 'PNPM_HOME');
    const voltaHome = getEnvValue(env, 'VOLTA_HOME') ?? (localAppData ? node_path_1.win32.join(localAppData, 'Volta') : undefined);
    return compactUnique([
        installDirOverride,
        xdgBinDir,
        homeBinDir,
        getDefaultInstallDir(env),
        userHome ? node_path_1.win32.join(userHome, '.local', 'bin') : undefined,
        userHome ? node_path_1.win32.join(userHome, '.bun', 'bin') : undefined,
        appData ? node_path_1.win32.join(appData, 'npm') : undefined,
        localAppData ? node_path_1.win32.join(localAppData, 'Yarn', 'bin') : undefined,
        pnpmHome,
        localAppData ? node_path_1.win32.join(localAppData, 'pnpm') : undefined,
        voltaHome ? node_path_1.win32.join(voltaHome, 'bin') : undefined,
        userHome ? node_path_1.win32.join(userHome, 'scoop', 'shims') : undefined,
        node_path_1.win32.join(programData, 'chocolatey', 'bin'),
        localAppData ? node_path_1.win32.join(localAppData, 'mise', 'shims') : undefined
    ]);
}
function getHomeBinDir(env) {
    return resolvePlatform() === 'win32' ? node_path_1.win32.join(resolveUserHome(env), 'bin') : node_path_1.posix.join(resolveUserHome(env), 'bin');
}
function getDefaultInstallDir(env) {
    const userHome = resolveUserHome(env);
    return resolvePlatform() === 'win32' ? node_path_1.win32.join(userHome, '.opencode', 'bin') : node_path_1.posix.join(userHome, '.opencode', 'bin');
}
function resolvePathDelimiter() {
    return resolvePlatform() === 'win32' ? node_path_1.win32.delimiter : ':';
}
function resolveUserHome(env) {
    return getEnvValue(env, 'USERPROFILE') ?? getEnvValue(env, 'HOME') ?? (0, node_os_1.homedir)();
}
function getEnvValue(env, key) {
    const direct = env[key]?.trim();
    if (direct) {
        return direct;
    }
    const actualKey = Object.keys(env).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
    const actualValue = actualKey ? env[actualKey]?.trim() : undefined;
    return actualValue && actualValue.length > 0 ? actualValue : undefined;
}
function compactUnique(values) {
    const next = [];
    for (const value of values) {
        if (!value || next.includes(value)) {
            continue;
        }
        next.push(value);
    }
    return next;
}
function resolveFromWhere(env) {
    if (resolvePlatform() !== 'win32') {
        return undefined;
    }
    try {
        const output = resolveExecFileSync()('where.exe', ['opencode'], {
            env: withOpencodeBinInPath(env),
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
            windowsHide: true
        });
        return output
            .split(/\r?\n/)
            .map((line) => line.trim())
            .find((line) => line.length > 0);
    }
    catch {
        return undefined;
    }
}
function normalizeResolvedBinary(binary, env) {
    if (resolvePlatform() !== 'win32') {
        return binary;
    }
    const trimmed = binary.trim();
    if (!trimmed || trimmed === 'opencode') {
        return trimmed || 'opencode';
    }
    const ext = node_path_1.win32.extname(trimmed).toLowerCase();
    if (ext === '.exe' || ext === '.cmd' || ext === '.bat') {
        return trimmed;
    }
    const exactExists = resolveExistsSync()(trimmed);
    if (exactExists) {
        const sibling = resolveWindowsExecutableSibling(trimmed);
        return sibling ?? trimmed;
    }
    return resolveWindowsExecutableSibling(trimmed) ?? trimmed;
}
function resolveWindowsExecutableSibling(binary) {
    for (const ext of ['.exe', '.cmd', '.bat']) {
        const candidate = `${binary}${ext}`;
        if (resolveExistsSync()(candidate)) {
            return candidate;
        }
    }
    return undefined;
}
function resolveExecFileSync() {
    return execFileSyncImpl ?? node_child_process_1.execFileSync;
}
function resolvePlatform() {
    return platformImpl ?? process.platform;
}
function resolvePathKey(env) {
    const existingKey = Object.keys(env).find((key) => key.toLowerCase() === 'path');
    return existingKey ?? 'PATH';
}
//# sourceMappingURL=opencodeEnv.js.map