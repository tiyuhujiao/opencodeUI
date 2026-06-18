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
exports.activate = activate;
exports.deactivate = deactivate;
exports.resolveHostKind = resolveHostKind;
exports.buildLastPortKey = buildLastPortKey;
const vscode = __importStar(require("vscode"));
const serveManager_1 = require("./bridge/serveManager");
const diagnostics_1 = require("./diagnostics");
const SidebarProvider_1 = require("./webview/SidebarProvider");
const LAST_PORT_KEY_PREFIX = 'opencodeUI.serve.lastPort';
function activate(context) {
    (0, diagnostics_1.initializeDiagnostics)(context);
    const hostKind = resolveHostKind(vscode.env.remoteName, process.platform);
    const sidebarProvider = new SidebarProvider_1.SidebarProvider(context.extensionUri, context.workspaceState, hostKind, vscode.env.remoteName);
    const lastPortKey = buildLastPortKey(hostKind, vscode.env.remoteName);
    (0, serveManager_1.configureServePortStorage)({
        getLastPort: () => context.globalState.get(lastPortKey),
        setLastPort: async (port) => {
            await context.globalState.update(lastPortKey, port);
        }
    });
    if (hostKind === 'unsupported') {
        void vscode.window.showWarningMessage('OpenCode UI 当前支持 Windows 本机、Linux 本机、Remote-WSL 和 Remote-SSH Linux 环境。');
    }
    else {
        void (0, serveManager_1.ensureServeRunning)().catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            (0, diagnostics_1.logError)(`ensureServeRunning failed: ${message}`);
            console.error('[opencode-ui] ensureServeRunning failed:', message);
            void vscode.window.showWarningMessage(`OpenCode serve 启动失败：${message}`);
        });
    }
    context.subscriptions.push(vscode.window.registerWebviewViewProvider('opencodeUI.sidebar', sidebarProvider), vscode.commands.registerCommand('opencodeUI.refresh', () => {
        sidebarProvider.refresh();
    }), vscode.commands.registerCommand('opencodeUI.openSidebar', async () => {
        await vscode.commands.executeCommand('workbench.view.extension.opencodeUI');
    }), vscode.commands.registerCommand('opencodeUI.showDiagnostics', () => {
        (0, diagnostics_1.showDiagnostics)();
    }));
}
function deactivate() {
}
function resolveHostKind(remoteName, platform = process.platform) {
    if (remoteName === 'wsl' && platform === 'linux') {
        return 'wsl';
    }
    if (!remoteName && platform === 'win32') {
        return 'local-windows';
    }
    if (!remoteName && platform === 'linux') {
        return 'local-linux';
    }
    if (remoteName === 'ssh-remote' && platform === 'linux') {
        return 'remote-ssh-linux';
    }
    if (remoteName && platform === 'linux') {
        return 'remote-linux';
    }
    return 'unsupported';
}
function buildLastPortKey(hostKind, remoteName) {
    const scope = `${hostKind}:${remoteName ?? 'local'}`.replace(/[^A-Za-z0-9._:-]+/g, '-');
    return `${LAST_PORT_KEY_PREFIX}.${scope}`;
}
//# sourceMappingURL=extension.js.map