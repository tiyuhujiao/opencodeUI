import { downloadAndUnzipVSCode, runTests } from '@vscode/test-electron';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

async function main(): Promise<void> {
  delete process.env.ELECTRON_RUN_AS_NODE;

  const currentDir = __dirname;
  const extensionDevelopmentPath = resolve(currentDir, '..', '..');
  const extensionTestsPath = join(currentDir, 'suite', 'index.js');
  const vscodeExecutablePath = process.env.VSCODE_EXECUTABLE_PATH ?? (await downloadAndUnzipVSCode('stable'));

  if (!existsSync(extensionTestsPath)) {
    throw new Error(`未找到编译后的测试入口: ${extensionTestsPath}`);
  }

  await runTests({
    vscodeExecutablePath,
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: ['--disable-workspace-trust', extensionDevelopmentPath],
    extensionTestsEnv: {
      OPENCODE_UI_SMOKE_TEST: '1'
    }
  });
}

main().catch((error) => {
  console.error('扩展测试失败');
  console.error(error);
  process.exit(1);
});
