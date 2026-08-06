import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('Codex-like composer experience', () => {
  it('让长命令菜单跟随键盘选择滚动且不截断资源数量', () => {
    const source = readFileSync(join(root, 'webview-ui/src/App.tsx'), 'utf8');
    const provider = readFileSync(join(root, 'src/webview/SidebarProvider.ts'), 'utf8');

    expect(source).toContain("selected?.scrollIntoView({ block: 'nearest' })");
    expect(source).toContain('ref={commandMenuRef}');
    expect(source).not.toContain('.slice(0, 12)');
    expect(source).toContain('nativeCommand: command.name');
    expect(provider).toContain('`/session/${encodeURIComponent(sessionId)}/command`');
    expect(provider).toContain('command: payload.command.name');
  });

  it('显示真实 12px context 圆环和 Codex 风格悬浮用量信息', () => {
    const source = readFileSync(join(root, 'webview-ui/src/App.tsx'), 'utf8');
    const styles = readFileSync(join(root, 'webview-ui/src/styles.css'), 'utf8');

    expect(source).toContain('width="12" height="12" viewBox="0 0 12 12"');
    expect(source).toContain("<span>{t('Context window')}:</span>");
    expect(source).toContain("t('{used} / {total} tokens used'");
    expect(styles).toContain('.context-usage__tooltip');
  });

  it('把权限请求放在 composer 上方并提供清晰的三种操作与键盘焦点', () => {
    const source = readFileSync(join(root, 'webview-ui/src/App.tsx'), 'utf8');
    const permissionIndex = source.indexOf("className=\"permission-banner\"");
    const composerIndex = source.indexOf("className={`composer-stack");

    expect(permissionIndex).toBeGreaterThan(-1);
    expect(permissionIndex).toBeLessThan(composerIndex);
    expect(source).toContain('permissionAllowButtonRef.current?.focus()');
    expect(source).toContain("requestPermissionReply(pendingPermission.permissionId, 'reject')");
    expect(source).toContain('Always allow');
    expect(source).toContain('Allow once');
  });
});
