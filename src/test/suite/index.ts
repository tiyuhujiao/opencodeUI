import * as assert from 'node:assert';
import * as vscode from 'vscode';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension('local.opencode-ui');
  assert.ok(extension, '应能找到扩展 local.opencode-ui');

  await extension?.activate();
  assert.ok(extension?.isActive, '扩展应能成功激活');

  await assert.doesNotReject(async () => {
    await vscode.commands.executeCommand('opencodeUI.openSidebar');
    await delay(300);
    await vscode.commands.executeCommand('opencodeUI.refresh');
    await delay(100);
  }, 'smoke test 应可执行 openSidebar 与 refresh 命令且不抛错');
}
