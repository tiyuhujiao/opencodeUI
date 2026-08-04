import { relative, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  workspaceRoot: process.cwd(),
  workspaceFolder: {
    name: 'opencodeUI',
    uri: { fsPath: process.cwd() }
  },
  findFiles: vi.fn(),
  showQuickPick: vi.fn()
}));

const workspaceRoot = mocks.workspaceRoot;

vi.mock('vscode', () => ({
  workspace: {
    workspaceFolders: [mocks.workspaceFolder],
    findFiles: mocks.findFiles,
    getWorkspaceFolder: () => mocks.workspaceFolder,
    asRelativePath: (uri: { fsPath: string }) => relative(workspaceRoot, uri.fsPath).replace(/\\/g, '/')
  },
  window: {
    showQuickPick: mocks.showQuickPick
  }
}), { virtual: true });

import { SidebarProvider } from '../src/webview/SidebarProvider';

function createProvider() {
  return new SidebarProvider(
    { fsPath: '/ext' } as never,
    { get: () => undefined, update: async () => {} } as never,
    'local-windows'
  ) as unknown as {
    resolveWorkspaceFileReference: (filePath: string) => Promise<string>;
  };
}

afterEach(() => {
  mocks.findFiles.mockReset();
  mocks.showQuickPick.mockReset();
});

describe('bare workspace file resolution', () => {
  it('裸文件名唯一匹配时直接解析到 src/extension.ts', async () => {
    const extensionPath = join(workspaceRoot, 'src', 'extension.ts');
    mocks.findFiles.mockResolvedValue([{ fsPath: extensionPath }]);

    await expect(createProvider().resolveWorkspaceFileReference('extension.ts')).resolves.toBe(extensionPath);
    expect(mocks.findFiles).toHaveBeenCalledWith('**/extension.ts', undefined, 21);
    expect(mocks.showQuickPick).not.toHaveBeenCalled();
  });

  it('存在多个同名文件时通过 Quick Pick 使用用户选择的路径', async () => {
    const sourcePath = join(workspaceRoot, 'src', 'extension.ts');
    const fixturePath = join(workspaceRoot, 'tests', 'fixtures', 'extension.ts');
    mocks.findFiles.mockResolvedValue([{ fsPath: sourcePath }, { fsPath: fixturePath }]);
    mocks.showQuickPick.mockImplementation(async (items: Array<{ uri: { fsPath: string } }>) => items[1]);

    await expect(createProvider().resolveWorkspaceFileReference('extension.ts')).resolves.toBe(fixturePath);
    expect(mocks.showQuickPick).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ label: 'src/extension.ts' }),
        expect.objectContaining({ label: 'tests/fixtures/extension.ts' })
      ]),
      expect.objectContaining({ title: '打开 extension.ts' })
    );
  });
});
