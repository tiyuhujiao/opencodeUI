import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { realpathSync } from 'node:fs';
import * as path from 'node:path';
import { encodeOpencodeDirectory } from '../../bridge/opencodeDirectory';
import { ensureServeRunning, requestServeJson } from '../../bridge/serveManager';
import { resolveHostKind } from '../../extension';
import { createInlineDiffController } from '../../inlineDiff';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension('tiyuhujiao.opencode-ui-vscode');
  assert.ok(extension, '应能找到扩展 tiyuhujiao.opencode-ui-vscode');

  await extension?.activate();
  assert.ok(extension?.isActive, '扩展应能成功激活');

  await verifyServeWorkspaceDirectory();

  if (process.platform === 'darwin') {
    assert.equal(resolveHostKind(undefined, 'darwin'), 'local-macos', 'macOS 扩展宿主应被识别为受支持的本机环境');
    const runtime = await ensureServeRunning();
    assert.ok(runtime.port > 0, 'macOS 扩展宿主应能启动并连接 opencode serve');
    assert.match(runtime.baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/, 'macOS serve 应仅监听本机回环地址');
  }

  await assert.doesNotReject(async () => {
    await vscode.commands.executeCommand('opencodeUI.openSidebar');
    await delay(300);
    await vscode.commands.executeCommand('opencodeUI.refresh');
    await delay(100);
  }, 'smoke test 应可执行 openSidebar 与 refresh 命令且不抛错');

  const commands = await vscode.commands.getCommands(true);
  for (const command of [
    'opencodeUI.inlineDiff.acceptHunk',
    'opencodeUI.inlineDiff.rejectHunk',
    'opencodeUI.inlineDiff.acceptFile',
    'opencodeUI.inlineDiff.rejectFile',
    'opencodeUI.inlineDiff.viewDiff'
  ]) {
    assert.ok(commands.includes(command), `应注册命令 ${command}`);
  }

  await verifyNativeInlineDiff();
}

async function verifyServeWorkspaceDirectory(): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(workspaceFolder, '工作目录 smoke test 需要已打开的测试工作区');
  const cwd = workspaceFolder.uri.fsPath;
  assert.match(cwd, /\u4e2d\u6587/u, '扩展宿主必须在仓库外的中文路径中验证');

  const pathResponse = await requestServeJson<{ directory?: string }>('/path', cwd);
  assert.equal(normalizeDirectory(pathResponse.directory), normalizeDirectory(cwd), '/path 应解析为当前 VS Code 工作区');

  const runtime = await ensureServeRunning();
  const headers = {
    'Content-Type': 'application/json',
    'x-opencode-directory': encodeOpencodeDirectory(cwd)
  };
  let sessionId: string | undefined;
  try {
    const response = await fetch(`${runtime.baseUrl}/session`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ title: 'OpenCode UI workspace smoke test' })
    });
    assert.equal(response.ok, true, `创建 workspace smoke session 失败（${String(response.status)}）`);
    const session = (await response.json()) as { id?: string; directory?: string };
    sessionId = session.id;
    assert.ok(sessionId, 'OpenCode 应返回 workspace smoke session ID');
    assert.equal(normalizeDirectory(session.directory), normalizeDirectory(cwd), '新 session 应绑定当前 VS Code 工作区');
  } finally {
    if (sessionId) {
      await fetch(`${runtime.baseUrl}/session/${encodeURIComponent(sessionId)}`, {
        method: 'DELETE',
        headers
      });
    }
  }
}

function normalizeDirectory(directory: string | undefined): string | undefined {
  if (!directory) {
    return undefined;
  }
  let canonical = directory;
  try {
    canonical = realpathSync.native(directory);
  } catch {
    // Keep the reported path when the directory is no longer available.
  }
  const normalized = path.normalize(canonical);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

async function verifyNativeInlineDiff(): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(workspaceFolder, 'inline diff smoke test 需要已打开的测试工作区');

  const fileName = `.opencode-inline-diff-smoke-${String(Date.now())}.txt`;
  const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, fileName);
  const baselineText = 'alpha\nremoved line\nomega\n';
  const currentText = 'alpha\nadded line\nomega\n';
  const promptText = 'replace the middle line';
  const startedAt = Date.now();
  await vscode.workspace.fs.writeFile(fileUri, new TextEncoder().encode(currentText));

  const controller = createInlineDiffController({
    virtualDocumentScheme: 'opencode-inline-diff-smoke',
    commandPrefix: 'opencodeUI.smoke.inlineDiff',
    requestServeJson: async <T>(pathname: string): Promise<T> => {
      if (pathname.includes('/message')) {
        return [{
          info: { role: 'user', id: 'msg-smoke', time: { created: startedAt } },
          parts: [{ type: 'text', text: promptText }]
        }] as T;
      }
      if (pathname.includes('/diff')) {
        return [{
          file: fileName,
          patch: [
            `Index: ${fileName}`,
            '===================================================================',
            `--- ${fileName}`,
            `+++ ${fileName}`,
            '@@ -1,3 +1,3 @@',
            ' alpha',
            '-removed line',
            '+added line',
            ' omega',
            ''
          ].join('\n')
        }] as T;
      }
      throw new Error(`Unexpected inline diff smoke request: ${pathname}`);
    }
  });

  try {
    const run = controller.beginRun({
      runId: 'run-inline-diff-smoke',
      sessionId: 'session-inline-diff-smoke',
      cwd: workspaceFolder.uri.fsPath,
      startedAt,
      promptText
    });
    await run.finish('done');

    const snapshot = controller.getSnapshot();
    assert.equal(snapshot.activeRun, false, 'inline diff run 完成后不应仍处于 active 状态');
    assert.equal(snapshot.files.length, 1, '权威 patch 应生成一个可审阅文件');
    assert.deepEqual(
      { additions: snapshot.files[0]?.additions, deletions: snapshot.files[0]?.deletions, status: snapshot.files[0]?.status },
      { additions: 1, deletions: 1, status: 'pending' },
      '替换应同时保留一条绿色新增和一条红色删除'
    );

    const tabInput = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    assert.ok(tabInput instanceof vscode.TabInputTextDiff, 'run 完成后应自动打开 VS Code 原生 Diff Editor');
    assert.equal(tabInput.original.scheme, 'opencode-inline-diff-smoke', 'Diff 左侧应使用重建的虚拟 baseline');
    assert.equal(tabInput.modified.toString(), fileUri.toString(), 'Diff 右侧应指向真实源文件');

    const originalDocument = await vscode.workspace.openTextDocument(tabInput.original);
    const modifiedDocument = await vscode.workspace.openTextDocument(tabInput.modified);
    assert.equal(originalDocument.getText(), baselineText, 'Diff 左侧应显示被删除的原始内容');
    assert.equal(modifiedDocument.getText(), currentText, 'Diff 右侧应显示新增后的当前内容');
  } finally {
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    controller.dispose();
    await vscode.workspace.fs.delete(fileUri, { useTrash: false });
  }
}
