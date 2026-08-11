import { downloadAndUnzipVSCode, runTests } from '@vscode/test-electron';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

async function removeWorkspace(workspacePath: string): Promise<void> {
  // Electron can briefly retain a Windows file-watcher handle after the test host exits.
  await delay(1_000);
  try {
    await rm(workspacePath, {
      recursive: true,
      force: true,
      maxRetries: 12,
      retryDelay: 500
    });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (process.platform === 'win32' && (code === 'EBUSY' || code === 'EPERM')) {
      console.warn(`Windows 仍占用烟测临时工作区，跳过本轮清理: ${workspacePath}`);
      return;
    }
    throw error;
  }
}

async function main(): Promise<void> {
  delete process.env.ELECTRON_RUN_AS_NODE;

  const currentDir = __dirname;
  const extensionDevelopmentPath = resolve(currentDir, '..', '..');
  const extensionTestsPath = join(currentDir, 'suite', 'index.js');
  const vscodeExecutablePath = process.env.VSCODE_EXECUTABLE_PATH ?? (await downloadAndUnzipVSCode('stable'));

  if (!existsSync(extensionTestsPath)) {
    throw new Error(`未找到编译后的测试入口: ${extensionTestsPath}`);
  }

  const workspacePath = await mkdtemp(join(tmpdir(), 'opencode-ui-smoke-\u4e2d\u6587-workspace-'));
  try {
    await runTests({
      vscodeExecutablePath,
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: ['--disable-workspace-trust', workspacePath],
      extensionTestsEnv: {
        OPENCODE_UI_SMOKE_TEST: '1'
      }
    });
  } finally {
    await removeWorkspace(workspacePath);
  }
}

main().catch((error) => {
  console.error('扩展测试失败');
  console.error(error);
  process.exit(1);
});
