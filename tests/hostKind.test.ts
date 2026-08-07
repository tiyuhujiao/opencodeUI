import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({}), { virtual: true });

import { buildLastPortKey, resolveHostKind } from '../src/extension';

describe('resolveHostKind', () => {
  it('识别本机 Windows、Linux、macOS、WSL 和 Remote-SSH', () => {
    expect(resolveHostKind(undefined, 'win32')).toBe('local-windows');
    expect(resolveHostKind(undefined, 'linux')).toBe('local-linux');
    expect(resolveHostKind(undefined, 'darwin')).toBe('local-macos');
    expect(resolveHostKind('wsl', 'linux')).toBe('wsl');
    expect(resolveHostKind('ssh-remote', 'linux')).toBe('remote-ssh-linux');
    expect(resolveHostKind('ssh-remote', 'darwin')).toBe('remote-ssh-macos');
  });

  it('将其他 Linux/macOS 远端归入对应远端类型，其他平台保持 unsupported', () => {
    expect(resolveHostKind('dev-container', 'linux')).toBe('remote-linux');
    expect(resolveHostKind('dev-container', 'darwin')).toBe('remote-macos');
    expect(resolveHostKind('ssh-remote', 'win32')).toBe('unsupported');
  });

  it('按宿主和 remoteName 隔离 serve 端口缓存键', () => {
    expect(buildLastPortKey('local-linux', undefined)).toBe('opencodeUI.serve.lastPort.local-linux:local');
    expect(buildLastPortKey('remote-ssh-linux', 'ssh-remote')).toBe('opencodeUI.serve.lastPort.remote-ssh-linux:ssh-remote');
    expect(buildLastPortKey('remote-linux', 'dev container')).toBe('opencodeUI.serve.lastPort.remote-linux:dev-container');
    expect(buildLastPortKey('local-macos', undefined)).toBe('opencodeUI.serve.lastPort.local-macos:local');
  });
});
