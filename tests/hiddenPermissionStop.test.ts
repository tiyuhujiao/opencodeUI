import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('SidebarProvider hidden run lifecycle', () => {
  it('隐藏或销毁侧边栏不再拒绝 blocker、终止任务或清理运行中附件', () => {
    const source = readFileSync(join(process.cwd(), 'src/webview/SidebarProvider.ts'), 'utf8');
    const resolveView = source.slice(
      source.indexOf('public resolveWebviewView'),
      source.indexOf('public refresh()')
    );

    expect(source).not.toContain('stopCurrentRunForHiddenPermission');
    expect(source).toContain('const HIDDEN_WEBVIEW_RETENTION_MS = 2 * 60_000;');
    expect(resolveView).toContain('this.scheduleHiddenViewExpiry(webviewView)');
    expect(resolveView).toContain('this.postRunSnapshot(webviewView.webview)');
    expect(resolveView).not.toContain('this.stopCurrentRun()');
    expect(resolveView).not.toContain('this.cleanupAllTempFiles()');
    expect(resolveView).not.toContain('/permission/');
    expect(resolveView).not.toContain('/question/');
  });

  it('隐藏满两分钟后释放页面，空闲时停止自启 serve，返回后重新挂载扫描', () => {
    const source = readFileSync(join(process.cwd(), 'src/webview/SidebarProvider.ts'), 'utf8');
    const expiryStart = source.indexOf('private scheduleHiddenViewExpiry');
    const expiryEnd = source.indexOf('private cancelHiddenViewExpiry', expiryStart);
    const expiry = source.slice(expiryStart, expiryEnd);

    expect(expiry).toContain('webviewView.webview.html = "";');
    expect(expiry).toContain('this.clearHiddenViewCaches();');
    expect(expiry).toMatch(/if \(!this\.currentRun\) \{\s*disposeServeManager\(\);/s);
    expect(source).toContain('webviewView.webview.html = this.getHtml(webviewView.webview);');
  });

  it('注册 WebviewView 时保留隐藏上下文', () => {
    const source = readFileSync(join(process.cwd(), 'src/extension.ts'), 'utf8');

    expect(source).toMatch(
      /registerWebviewViewProvider\('opencodeUI\.sidebar', sidebarProvider, \{\s*webviewOptions: \{\s*retainContextWhenHidden: true/s
    );
  });
});
