import * as vscode from 'vscode';
import { configureServePortStorage, ensureServeRunning } from './bridge/serveManager';
import { initializeDiagnostics, logError, showDiagnostics } from './diagnostics';
import { SidebarProvider } from './webview/SidebarProvider';
import type { HostKind } from './shared/protocol';

const LAST_PORT_KEY_PREFIX = 'opencodeUI.serve.lastPort';

export function activate(context: vscode.ExtensionContext): void {
  initializeDiagnostics(context);

  const hostKind = resolveHostKind(vscode.env.remoteName, process.platform);
  const sidebarProvider = new SidebarProvider(
    context.extensionUri,
    context.workspaceState,
    hostKind,
    vscode.env.remoteName
  );

  const lastPortKey = buildLastPortKey(hostKind, vscode.env.remoteName);
  configureServePortStorage({
    getLastPort: () => context.globalState.get<number>(lastPortKey),
    setLastPort: async (port: number) => {
      await context.globalState.update(lastPortKey, port);
    }
  });

  if (hostKind === 'unsupported') {
    void vscode.window.showWarningMessage('OpenCode UI 当前支持 Windows 本机、Linux 本机、Remote-WSL 和 Remote-SSH Linux 环境。');
  } else {
    void ensureServeRunning().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      logError(`ensureServeRunning failed: ${message}`);
      console.error('[opencode-ui] ensureServeRunning failed:', message);
      void vscode.window.showWarningMessage(`OpenCode serve 启动失败：${message}`);
    });
  }

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('opencodeUI.sidebar', sidebarProvider),
    vscode.commands.registerCommand('opencodeUI.refresh', () => {
      sidebarProvider.refresh();
    }),
    vscode.commands.registerCommand('opencodeUI.openSidebar', async () => {
      await vscode.commands.executeCommand('workbench.view.extension.opencodeUI');
    }),
    vscode.commands.registerCommand('opencodeUI.showDiagnostics', () => {
      showDiagnostics();
    })
  );
}

export function deactivate(): void {
}

export function resolveHostKind(remoteName: string | undefined, platform: NodeJS.Platform = process.platform): HostKind {
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

export function buildLastPortKey(hostKind: HostKind, remoteName: string | undefined): string {
  const scope = `${hostKind}:${remoteName ?? 'local'}`.replace(/[^A-Za-z0-9._:-]+/g, '-');
  return `${LAST_PORT_KEY_PREFIX}.${scope}`;
}
