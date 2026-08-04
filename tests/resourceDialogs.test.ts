import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('management resource dialogs', () => {
  it('把管理命令路由到弹窗而不是 runStatus 临时条', () => {
    const source = readFileSync(join(root, 'webview-ui/src/App.tsx'), 'utf8');
    expect(source).toContain("setResourceDialogKind('mcp')");
    expect(source).toContain("setResourceDialogKind('skills')");
    expect(source).toContain("setResourceDialogKind('agents')");
    expect(source).toContain("setResourceDialogKind('thinking')");
    expect(source).not.toContain("setRunStatus('Usage: /agent build|plan')");
    expect(source).not.toContain('setRunStatus(thinkingUsage)');
    expect(source).not.toContain('setRunStatus(summary ? `MCP:');
  });

  it('MCP 弹窗使用 switch 并由真实协议驱动状态', () => {
    const source = readFileSync(join(root, 'webview-ui/src/components/dialog/ResourceDialog.tsx'), 'utf8');
    const provider = readFileSync(join(root, 'src/webview/SidebarProvider.ts'), 'utf8');
    const styles = readFileSync(join(root, 'webview-ui/src/styles.css'), 'utf8');
    expect(source).toContain('role="switch"');
    expect(source).toContain('aria-checked={visualEnabled}');
    expect(source).toContain('pendingMcpTargets: Map<string, boolean>');
    expect(source).toContain("? 'Connecting...'");
    expect(source).toContain("'Disconnecting...'");
    expect(source).toContain('className="resource-dialog__statusSpinner"');
    expect(source).toContain('aria-busy={props.refreshing}');
    expect(provider).toContain('`/mcp/${encodedName}/${enabled ? "connect" : "disconnect"}`');
    expect(provider).toContain('waitForMcpServerTransition(name, enabled)');
    expect(styles).toContain('transform: translate(-50%, -50%);');
    expect(styles).toContain('.resource-dialog__status.is-connected');
    expect(styles).toContain('.resource-dialog__status.is-error');
    expect(styles).toContain('.resource-dialog__refresh.is-loading svg');
  });
});
