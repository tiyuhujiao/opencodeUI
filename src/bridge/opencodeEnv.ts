import * as fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { posix, win32 } from 'node:path';

let existsSyncImpl: ((path: fs.PathLike) => boolean) | undefined;
let platformImpl: NodeJS.Platform | undefined;
let execFileSyncImpl: typeof execFileSync | undefined;

export function resolveOpencodeBinary(baseEnv?: NodeJS.ProcessEnv): string {
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

export function shouldUseShellForOpencode(binary: string): boolean {
  return resolvePlatform() === 'win32' && /\.(cmd|bat)$/i.test(binary);
}

export function shouldHideOpencodeWindow(): boolean {
  return resolvePlatform() === 'win32';
}

export function __setExistsSyncImplementationForTests(nextExistsSync: ((path: fs.PathLike) => boolean) | undefined): void {
  existsSyncImpl = nextExistsSync;
}

export function __setPlatformForTests(nextPlatform: NodeJS.Platform | undefined): void {
  platformImpl = nextPlatform;
}

export function __setExecFileSyncImplementationForTests(nextExecFileSync: typeof execFileSync | undefined): void {
  execFileSyncImpl = nextExecFileSync;
}

function resolveExistsSync(): (path: fs.PathLike) => boolean {
  if (existsSyncImpl) {
    return existsSyncImpl;
  }

  return (path: fs.PathLike): boolean => {
    const candidate = (fs as { existsSync?: (target: fs.PathLike) => boolean }).existsSync;
    if (typeof candidate !== 'function') {
      return false;
    }
    return candidate(path);
  };
}

export function withOpencodeBinInPath(baseEnv?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const sourceEnv = baseEnv ?? process.env;
  const env: NodeJS.ProcessEnv = { ...sourceEnv };
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

function getBundledBinaryCandidates(env: NodeJS.ProcessEnv): string[] {
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
    const voltaHome = getEnvValue(env, 'VOLTA_HOME') ?? (localAppData ? win32.join(localAppData, 'Volta') : undefined);

    return compactUnique([
      installDirOverride ? win32.join(installDirOverride, 'opencode.exe') : undefined,
      installDirOverride ? win32.join(installDirOverride, 'opencode.cmd') : undefined,
      xdgBinDir ? win32.join(xdgBinDir, 'opencode.exe') : undefined,
      xdgBinDir ? win32.join(xdgBinDir, 'opencode.cmd') : undefined,
      win32.join(homeBinDir, 'opencode.exe'),
      win32.join(homeBinDir, 'opencode.cmd'),
      win32.join(defaultInstallDir, 'opencode.exe'),
      win32.join(defaultInstallDir, 'opencode.cmd'),
      win32.join(defaultInstallDir, 'opencode'),
      userHome ? win32.join(userHome, '.local', 'bin', 'opencode.exe') : undefined,
      userHome ? win32.join(userHome, '.local', 'bin', 'opencode.cmd') : undefined,
      userHome ? win32.join(userHome, '.bun', 'bin', 'opencode.exe') : undefined,
      userHome ? win32.join(userHome, '.bun', 'bin', 'opencode.cmd') : undefined,
      appData ? win32.join(appData, 'npm', 'opencode.cmd') : undefined,
      appData ? win32.join(appData, 'npm', 'opencode.exe') : undefined,
      localAppData ? win32.join(localAppData, 'Yarn', 'bin', 'opencode.cmd') : undefined,
      localAppData ? win32.join(localAppData, 'Yarn', 'bin', 'opencode.exe') : undefined,
      pnpmHome ? win32.join(pnpmHome, 'opencode.cmd') : undefined,
      pnpmHome ? win32.join(pnpmHome, 'opencode.exe') : undefined,
      localAppData ? win32.join(localAppData, 'pnpm', 'opencode.cmd') : undefined,
      localAppData ? win32.join(localAppData, 'pnpm', 'opencode.exe') : undefined,
      voltaHome ? win32.join(voltaHome, 'bin', 'opencode.cmd') : undefined,
      voltaHome ? win32.join(voltaHome, 'bin', 'opencode.exe') : undefined,
      voltaHome ? win32.join(voltaHome, 'bin', 'opencode.bat') : undefined,
      userHome ? win32.join(userHome, 'scoop', 'shims', 'opencode.cmd') : undefined,
      userHome ? win32.join(userHome, 'scoop', 'shims', 'opencode.exe') : undefined,
      userHome ? win32.join(userHome, 'scoop', 'apps', 'opencode', 'current', 'opencode.exe') : undefined,
      win32.join(programData, 'chocolatey', 'bin', 'opencode.exe'),
      win32.join(programData, 'chocolatey', 'bin', 'opencode.cmd'),
      win32.join(programData, 'chocolatey', 'lib', 'opencode', 'tools', 'opencode.exe'),
      localAppData ? win32.join(localAppData, 'mise', 'shims', 'opencode.exe') : undefined,
      localAppData ? win32.join(localAppData, 'mise', 'shims', 'opencode.cmd') : undefined
    ]);
  }

  const userHome = resolveUserHome(env);
  const installDirOverride = getEnvValue(env, 'OPENCODE_INSTALL_DIR');
  const xdgBinDir = getEnvValue(env, 'XDG_BIN_DIR');
  const pnpmHome = getEnvValue(env, 'PNPM_HOME');
  const voltaHome = getEnvValue(env, 'VOLTA_HOME') ?? posix.join(userHome, '.volta');

  return compactUnique([
    installDirOverride ? posix.join(installDirOverride, 'opencode') : undefined,
    xdgBinDir ? posix.join(xdgBinDir, 'opencode') : undefined,
    posix.join(getDefaultInstallDir(env), 'opencode'),
    posix.join(getHomeBinDir(env), 'opencode'),
    posix.join(userHome, '.local', 'bin', 'opencode'),
    posix.join(userHome, '.bun', 'bin', 'opencode'),
    pnpmHome ? posix.join(pnpmHome, 'opencode') : undefined,
    posix.join(userHome, '.local', 'share', 'pnpm', 'opencode'),
    voltaHome ? posix.join(voltaHome, 'bin', 'opencode') : undefined,
    posix.join(userHome, '.local', 'share', 'mise', 'shims', 'opencode')
  ]);
}

function getPreferredBinDirectories(env: NodeJS.ProcessEnv): string[] {
  if (resolvePlatform() !== 'win32') {
    const userHome = resolveUserHome(env);
    const installDirOverride = getEnvValue(env, 'OPENCODE_INSTALL_DIR');
    const xdgBinDir = getEnvValue(env, 'XDG_BIN_DIR');
    const pnpmHome = getEnvValue(env, 'PNPM_HOME');
    const voltaHome = getEnvValue(env, 'VOLTA_HOME') ?? posix.join(userHome, '.volta');

    return compactUnique([
      installDirOverride,
      xdgBinDir,
      getDefaultInstallDir(env),
      getHomeBinDir(env),
      posix.join(userHome, '.local', 'bin'),
      posix.join(userHome, '.bun', 'bin'),
      pnpmHome,
      posix.join(userHome, '.local', 'share', 'pnpm'),
      voltaHome ? posix.join(voltaHome, 'bin') : undefined,
      posix.join(userHome, '.local', 'share', 'mise', 'shims')
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
  const voltaHome = getEnvValue(env, 'VOLTA_HOME') ?? (localAppData ? win32.join(localAppData, 'Volta') : undefined);

  return compactUnique([
    installDirOverride,
    xdgBinDir,
    homeBinDir,
    getDefaultInstallDir(env),
    userHome ? win32.join(userHome, '.local', 'bin') : undefined,
    userHome ? win32.join(userHome, '.bun', 'bin') : undefined,
    appData ? win32.join(appData, 'npm') : undefined,
    localAppData ? win32.join(localAppData, 'Yarn', 'bin') : undefined,
    pnpmHome,
    localAppData ? win32.join(localAppData, 'pnpm') : undefined,
    voltaHome ? win32.join(voltaHome, 'bin') : undefined,
    userHome ? win32.join(userHome, 'scoop', 'shims') : undefined,
    win32.join(programData, 'chocolatey', 'bin'),
    localAppData ? win32.join(localAppData, 'mise', 'shims') : undefined
  ]);
}

function getHomeBinDir(env: NodeJS.ProcessEnv): string {
  return resolvePlatform() === 'win32' ? win32.join(resolveUserHome(env), 'bin') : posix.join(resolveUserHome(env), 'bin');
}

function getDefaultInstallDir(env: NodeJS.ProcessEnv): string {
  const userHome = resolveUserHome(env);
  return resolvePlatform() === 'win32' ? win32.join(userHome, '.opencode', 'bin') : posix.join(userHome, '.opencode', 'bin');
}

function resolvePathDelimiter(): string {
  return resolvePlatform() === 'win32' ? win32.delimiter : ':';
}

function resolveUserHome(env: NodeJS.ProcessEnv): string {
  return getEnvValue(env, 'USERPROFILE') ?? getEnvValue(env, 'HOME') ?? homedir();
}

function getEnvValue(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const direct = env[key]?.trim();
  if (direct) {
    return direct;
  }

  const actualKey = Object.keys(env).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
  const actualValue = actualKey ? env[actualKey]?.trim() : undefined;
  return actualValue && actualValue.length > 0 ? actualValue : undefined;
}

function compactUnique(values: Array<string | undefined>): string[] {
  const next: string[] = [];
  for (const value of values) {
    if (!value || next.includes(value)) {
      continue;
    }
    next.push(value);
  }
  return next;
}

function resolveFromWhere(env: NodeJS.ProcessEnv): string | undefined {
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
  } catch {
    return undefined;
  }
}

function normalizeResolvedBinary(binary: string, env: NodeJS.ProcessEnv): string {
  if (resolvePlatform() !== 'win32') {
    return binary;
  }

  const trimmed = binary.trim();
  if (!trimmed || trimmed === 'opencode') {
    return trimmed || 'opencode';
  }

  const ext = win32.extname(trimmed).toLowerCase();
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

function resolveWindowsExecutableSibling(binary: string): string | undefined {
  for (const ext of ['.exe', '.cmd', '.bat']) {
    const candidate = `${binary}${ext}`;
    if (resolveExistsSync()(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function resolveExecFileSync(): typeof execFileSync {
  return execFileSyncImpl ?? execFileSync;
}

function resolvePlatform(): NodeJS.Platform {
  return platformImpl ?? process.platform;
}

function resolvePathKey(env: NodeJS.ProcessEnv): string {
  const existingKey = Object.keys(env).find((key) => key.toLowerCase() === 'path');
  return existingKey ?? 'PATH';
}
