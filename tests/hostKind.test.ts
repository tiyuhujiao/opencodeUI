import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({}), { virtual: true });

import { buildLastPortKey, resolveHostKind } from '../src/extension';

describe('resolveHostKind', () => {
  it('识别本机 Windows、本机 Linux、WSL 和 Remote-SSH Linux', () => {
    expect(resolveHostKind(undefined, 'win32')).toBe('local-windows');
    expect(resolveHostKind(undefined, 'linux')).toBe('local-linux');
    expect(resolveHostKind('wsl', 'linux')).toBe('wsl');
    expect(resolveHostKind('ssh-remote', 'linux')).toBe('remote-ssh-linux');
  });

  it('将其他 Linux 远端归入 remote-linux，其他平台保持 unsupported', () => {
    expect(resolveHostKind('dev-container', 'linux')).toBe('remote-linux');
    expect(resolveHostKind(undefined, 'darwin')).toBe('unsupported');
    expect(resolveHostKind('ssh-remote', 'win32')).toBe('unsupported');
  });

  it('按宿主和 remoteName 隔离 serve 端口缓存键', () => {
    expect(buildLastPortKey('local-linux', undefined)).toBe('opencodeUI.serve.lastPort.local-linux:local');
    expect(buildLastPortKey('remote-ssh-linux', 'ssh-remote')).toBe('opencodeUI.serve.lastPort.remote-ssh-linux:ssh-remote');
    expect(buildLastPortKey('remote-linux', 'dev container')).toBe('opencodeUI.serve.lastPort.remote-linux:dev-container');
  });
});