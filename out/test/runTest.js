"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_electron_1 = require("@vscode/test-electron");
const node_fs_1 = require("node:fs");
const promises_1 = require("node:fs/promises");
const node_os_1 = require("node:os");
const node_path_1 = require("node:path");
async function main() {
    delete process.env.ELECTRON_RUN_AS_NODE;
    const currentDir = __dirname;
    const extensionDevelopmentPath = (0, node_path_1.resolve)(currentDir, '..', '..');
    const extensionTestsPath = (0, node_path_1.join)(currentDir, 'suite', 'index.js');
    const vscodeExecutablePath = process.env.VSCODE_EXECUTABLE_PATH ?? (await (0, test_electron_1.downloadAndUnzipVSCode)('stable'));
    if (!(0, node_fs_1.existsSync)(extensionTestsPath)) {
        throw new Error(`未找到编译后的测试入口: ${extensionTestsPath}`);
    }
    const workspacePath = await (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), 'opencode-ui-smoke-\u4e2d\u6587-workspace-'));
    try {
        await (0, test_electron_1.runTests)({
            vscodeExecutablePath,
            extensionDevelopmentPath,
            extensionTestsPath,
            launchArgs: ['--disable-workspace-trust', workspacePath],
            extensionTestsEnv: {
                OPENCODE_UI_SMOKE_TEST: '1'
            }
        });
    }
    finally {
        await (0, promises_1.rm)(workspacePath, {
            recursive: true,
            force: true,
            maxRetries: 10,
            retryDelay: 200
        });
    }
}
main().catch((error) => {
    console.error('扩展测试失败');
    console.error(error);
    process.exit(1);
});
//# sourceMappingURL=runTest.js.map