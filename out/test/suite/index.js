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
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
async function run() {
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
//# sourceMappingURL=index.js.map