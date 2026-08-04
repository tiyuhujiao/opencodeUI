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
exports.run = run;
const assert = __importStar(require("node:assert"));
const vscode = __importStar(require("vscode"));
const inlineDiff_1 = require("../../inlineDiff");
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
async function run() {
    const extension = vscode.extensions.getExtension('tiyuhujiao.opencode-ui-vscode');
    assert.ok(extension, '应能找到扩展 tiyuhujiao.opencode-ui-vscode');
    await extension?.activate();
    assert.ok(extension?.isActive, '扩展应能成功激活');
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
async function verifyNativeInlineDiff() {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(workspaceFolder, 'inline diff smoke test 需要已打开的测试工作区');
    const fileName = `.opencode-inline-diff-smoke-${String(Date.now())}.txt`;
    const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, fileName);
    const baselineText = 'alpha\nremoved line\nomega\n';
    const currentText = 'alpha\nadded line\nomega\n';
    const promptText = 'replace the middle line';
    const startedAt = Date.now();
    await vscode.workspace.fs.writeFile(fileUri, new TextEncoder().encode(currentText));
    const controller = (0, inlineDiff_1.createInlineDiffController)({
        virtualDocumentScheme: 'opencode-inline-diff-smoke',
        commandPrefix: 'opencodeUI.smoke.inlineDiff',
        requestServeJson: async (pathname) => {
            if (pathname.includes('/message')) {
                return [{
                        info: { role: 'user', id: 'msg-smoke', time: { created: startedAt } },
                        parts: [{ type: 'text', text: promptText }]
                    }];
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
                    }];
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
        assert.deepEqual({ additions: snapshot.files[0]?.additions, deletions: snapshot.files[0]?.deletions, status: snapshot.files[0]?.status }, { additions: 1, deletions: 1, status: 'pending' }, '替换应同时保留一条绿色新增和一条红色删除');
        const tabInput = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
        assert.ok(tabInput instanceof vscode.TabInputTextDiff, 'run 完成后应自动打开 VS Code 原生 Diff Editor');
        assert.equal(tabInput.original.scheme, 'opencode-inline-diff-smoke', 'Diff 左侧应使用重建的虚拟 baseline');
        assert.equal(tabInput.modified.toString(), fileUri.toString(), 'Diff 右侧应指向真实源文件');
        const originalDocument = await vscode.workspace.openTextDocument(tabInput.original);
        const modifiedDocument = await vscode.workspace.openTextDocument(tabInput.modified);
        assert.equal(originalDocument.getText(), baselineText, 'Diff 左侧应显示被删除的原始内容');
        assert.equal(modifiedDocument.getText(), currentText, 'Diff 右侧应显示新增后的当前内容');
    }
    finally {
        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        controller.dispose();
        await vscode.workspace.fs.delete(fileUri, { useTrash: false });
    }
}
//# sourceMappingURL=index.js.map