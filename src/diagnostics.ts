import * as vscode from 'vscode';

let outputChannel: vscode.OutputChannel | undefined;

export function initializeDiagnostics(context: vscode.ExtensionContext): void {
  outputChannel = vscode.window.createOutputChannel('OpenCode UI');
  context.subscriptions.push(outputChannel);
}

export function showDiagnostics(): void {
  outputChannel?.show(true);
}

export function logInfo(message: string): void {
  append('info', message);
}

export function logWarn(message: string): void {
  append('warn', message);
}

export function logError(message: string): void {
  append('error', message);
}

function append(level: 'info' | 'warn' | 'error', message: string): void {
  const timestamp = new Date().toISOString();
  outputChannel?.appendLine(`[${timestamp}] [${level}] ${message}`);
}
