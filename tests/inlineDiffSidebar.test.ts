import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({ workspace: {} }), { virtual: true });

import { SidebarProvider } from '../src/webview/SidebarProvider';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function createInlineDiff() {
  const snapshot = {
    revision: 4,
    activeRun: false,
    files: [
      {
        fileId: 'file-1',
        uri: 'file:///workspace/src/app.ts',
        path: '/workspace/src/app.ts',
        displayPath: 'src/app.ts',
        revision: 2,
        status: 'pending' as const,
        hunkCount: 3,
        additions: 5,
        deletions: 2
      }
    ]
  };
  return {
    snapshot,
    controller: {
      onDidChange: () => ({ dispose: () => undefined }),
      beginRun: () => ({ observe: () => undefined, finish: async () => undefined }),
      open: async () => ({ ok: true as const, snapshot }),
      resolve: async () => ({ ok: true as const, snapshot }),
      dismiss: vi.fn(),
      invalidateAll: vi.fn(),
      getSnapshot: () => snapshot,
      dispose: () => undefined
    }
  };
}

function createProvider(inlineDiff: ReturnType<typeof createInlineDiff>['controller']) {
  return new SidebarProvider(
    { fsPath: '/ext' } as never,
    { get: () => undefined, update: async () => undefined } as never,
    'wsl',
    'wsl',
    inlineDiff as never
  );
}

describe('SidebarProvider Inline Diff seam', () => {
  it('accepts OpenCode patch responses and opens a native VS Code diff', () => {
    const controller = readFileSync(join(process.cwd(), 'src/inlineDiff/controller.ts'), 'utf8');
    const adapter = readFileSync(join(process.cwd(), 'src/inlineDiff/editorAdapter.ts'), 'utf8');

    expect(controller).toContain("typeof item.patch === 'string'");
    expect(controller).toContain('reverseUnifiedPatch(actual.snapshot.text, item.patchText');
    expect(controller).toContain('await this.editor.openNativeDiff(firstPending.fileId)');
    expect(controller).toContain('const opened = await this.editor.openNativeDiff(fileId)');
    expect(adapter).toContain("'vscode.diff'");
  });

  it('把 controller hunkCount 映射为 Webview 协议 hunks', () => {
    const inlineDiff = createInlineDiff();
    const provider = createProvider(inlineDiff.controller) as unknown as {
      postInlineDiffState: (snapshot: typeof inlineDiff.snapshot, webview: { postMessage: (message: unknown) => Thenable<boolean> }) => void;
    };
    const posted: unknown[] = [];

    provider.postInlineDiffState(inlineDiff.snapshot, {
      postMessage: async (message) => {
        posted.push(message);
        return true;
      }
    });

    expect(posted).toEqual([
      expect.objectContaining({
        type: 'inlineDiff.state',
        payload: {
          revision: 4,
          files: [
            expect.objectContaining({
              fileId: 'file-1',
              hunks: 3,
              additions: 5,
              deletions: 2
            })
          ]
        }
      })
    ]);
    expect(JSON.stringify(posted)).not.toContain('hunkCount');
  });

  it('在现有 run lifecycle emit seam 先观察事件再转发 Webview', () => {
    const inlineDiff = createInlineDiff();
    const provider = createProvider(inlineDiff.controller) as unknown as {
      currentRun?: {
        requestId: string;
        controller: AbortController;
        inlineDiffRun: { observe: (event: unknown) => void };
      };
      createRunLifecycleAdapter: (
        webview: { postMessage: (message: unknown) => Thenable<boolean> },
        requestId: string
      ) => { emit: (event: unknown) => void };
    };
    const calls: string[] = [];
    provider.currentRun = {
      requestId: 'run-1',
      controller: new AbortController(),
      inlineDiffRun: { observe: () => calls.push('observe') }
    };
    const lifecycle = provider.createRunLifecycleAdapter(
      {
        postMessage: async () => {
          calls.push('post');
          return true;
        }
      },
      'run-1'
    );

    lifecycle.emit({ type: 'done' });

    expect(calls).toEqual(['observe', 'post']);
  });
});
