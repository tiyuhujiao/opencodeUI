import { describe, expect, it, vi } from 'vitest';

vi.mock('node:fs', () => ({
  readFileSync: vi.fn()
}));

vi.mock('vscode', () => {
  const createUri = (fsPath: string) => ({
    fsPath,
    toString: () => fsPath
  });

  return {
    Uri: {
      joinPath: (base: { fsPath: string }, ...parts: string[]) => {
        const suffix = parts.join('/');
        return createUri(`${base.fsPath}/${suffix}`.replace(/\/+/g, '/'));
      }
    }
  };
}, { virtual: true });

type FakeWebview = {
  options?: {
    enableScripts?: boolean;
    localResourceRoots?: Array<{ fsPath: string }>;
  };
  html: string;
  cspSource: string;
  asWebviewUri: (uri: { fsPath: string }) => { toString: () => string };
  onDidReceiveMessage: (handler: (message: unknown) => void) => void;
  postMessage: (message: unknown) => Thenable<boolean>;
};

function createProvider() {
  const extensionUri = { fsPath: '/ext' } as never;
  const workspaceState = {
    get: () => undefined,
    update: async () => {}
  } as never;

  return { extensionUri, workspaceState };
}

describe('SidebarProvider CSP/nonce', () => {
  it('注入 CSP meta 与 nonce，且 localResourceRoots 仅 media', async () => {
    vi.resetModules();
    vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
    vi.spyOn(Math, 'random').mockReturnValue(0.123456789);

    const fsMod = await import('node:fs');
    vi.mocked(fsMod.readFileSync).mockReturnValue(`<!doctype html>
<html>
<head></head>
<body>
  <script src="/assets/main.js"></script>
  <script nonce="keep" src="/assets/kept.js"></script>
  <link rel="stylesheet" href="/assets/main.css" />
</body>
</html>`);

    const { SidebarProvider } = await import('../src/webview/SidebarProvider');
    const { extensionUri, workspaceState } = createProvider();

    const provider = new SidebarProvider(extensionUri, workspaceState, 'wsl', 'wsl');

    const webview: FakeWebview = {
      html: '',
      cspSource: 'vscode-webview-source',
      asWebviewUri: (uri) => ({ toString: () => `webview:${uri.fsPath}` }),
      onDidReceiveMessage: () => {},
      postMessage: async () => true
    };

    const webviewView = {
      webview,
      onDidDispose: () => {}
    } as never;

    provider.resolveWebviewView(webviewView);

    expect(webview.options?.localResourceRoots?.map((item) => item.fsPath)).toEqual(['/ext/media']);
    expect(webview.html).toContain('Content-Security-Policy');
    expect(webview.html).toContain("default-src 'none'");
    expect(webview.html).toContain("script-src 'nonce-");
    expect(webview.html).toContain('style-src vscode-webview-source');
    expect(webview.html).not.toContain('unsafe-inline');

    const nonceMatches = webview.html.match(/script nonce="([^"]+)"/g) ?? [];
    expect(nonceMatches.length).toBeGreaterThan(0);
    expect(webview.html).toContain('script nonce="keep"');
    expect(webview.html).toContain('src="webview:/ext/media/assets/main.js"');
    expect(webview.html).toContain('href="webview:/ext/media/assets/main.css"');
  });
});
