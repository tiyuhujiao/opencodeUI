import { afterEach, describe, expect, it, vi } from 'vitest';

const serveManagerMocks = vi.hoisted(() => ({
  disposeServeManager: vi.fn()
}));

vi.mock('../src/bridge/serveManager', () => ({
  disposeServeManager: serveManagerMocks.disposeServeManager,
  ensureServeRunning: vi.fn(),
  restartServeForConfigChange: vi.fn()
}));

vi.mock('vscode', () => ({
  Uri: {
    joinPath: (base: { fsPath: string }, ...segments: string[]) => ({
      fsPath: [base.fsPath, ...segments].join('/'),
      toString: () => [base.fsPath, ...segments].join('/')
    })
  },
  workspace: {}
}), { virtual: true });

import { SidebarProvider } from '../src/webview/SidebarProvider';

type FakeView = {
  visible: boolean;
  webview: {
    html: string;
    options?: unknown;
    cspSource: string;
    asWebviewUri: (uri: { fsPath: string }) => { toString: () => string };
    onDidReceiveMessage: (listener: (message: unknown) => void) => void;
    postMessage: (message: unknown) => Thenable<boolean>;
  };
  onDidChangeVisibility: (listener: () => void) => { dispose: () => void };
  onDidDispose: (listener: () => void) => void;
};

function createView() {
  let visibilityListener: (() => void) | undefined;
  let disposeListener: (() => void) | undefined;
  const view: FakeView = {
    visible: true,
    webview: {
      html: '',
      cspSource: 'test-webview',
      asWebviewUri: (uri) => ({ toString: () => uri.fsPath }),
      onDidReceiveMessage: () => undefined,
      postMessage: async () => true
    },
    onDidChangeVisibility: (listener) => {
      visibilityListener = listener;
      return { dispose: () => undefined };
    },
    onDidDispose: (listener) => {
      disposeListener = listener;
    }
  };

  return {
    view,
    emitVisibility: () => visibilityListener?.(),
    emitDispose: () => disposeListener?.()
  };
}

function createProvider(): SidebarProvider {
  return new SidebarProvider(
    { fsPath: 'E:/extension' } as never,
    { get: () => undefined, update: async () => undefined } as never,
    'local-windows'
  );
}

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('hidden Webview retention window', () => {
  it('保留短切换页面，并在隐藏满两分钟后释放、返回时重新挂载', async () => {
    vi.useFakeTimers();
    const provider = createProvider();
    const { view, emitVisibility, emitDispose } = createView();
    provider.resolveWebviewView(view as never);
    const initialHtml = view.webview.html;

    view.visible = false;
    emitVisibility();
    await vi.advanceTimersByTimeAsync(119_999);

    expect(view.webview.html).toBe(initialHtml);
    expect(serveManagerMocks.disposeServeManager).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);

    expect(view.webview.html).toBe('');
    expect(serveManagerMocks.disposeServeManager).toHaveBeenCalledTimes(1);

    view.visible = true;
    emitVisibility();

    expect(view.webview.html).toContain('<!DOCTYPE html>');

    emitDispose();
    provider.dispose();
  });

  it('两分钟到点时任务仍在运行则只释放页面，不终止后台', async () => {
    vi.useFakeTimers();
    const provider = createProvider() as SidebarProvider & { currentRun?: unknown };
    const { view, emitVisibility, emitDispose } = createView();
    provider.resolveWebviewView(view as never);
    provider.currentRun = {
      requestId: 'run-1',
      revision: 0,
      controller: new AbortController(),
      startedAt: 1,
      promptText: 'keep running',
      placeholderTitle: 'keep running',
      startedNewSession: false,
      recoveryTranscript: [],
      recoveryAssistantIndex: 0
    };

    view.visible = false;
    emitVisibility();
    await vi.advanceTimersByTimeAsync(120_000);

    expect(view.webview.html).toBe('');
    expect(serveManagerMocks.disposeServeManager).not.toHaveBeenCalled();

    emitDispose();
    provider.dispose();
  });
});
