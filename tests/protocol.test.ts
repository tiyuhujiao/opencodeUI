import { describe, expect, it } from 'vitest';
import { isExtensionResponseMessage, isWebviewRequestMessage, type HostKind, type TranscriptPart } from '../src/shared/protocol';

describe('webview request protocol guards', () => {
  it('覆盖当前支持的 HostKind 协议值', () => {
    const hostKinds = [
      'local-windows',
      'local-linux',
      'local-macos',
      'wsl',
      'remote-ssh-linux',
      'remote-linux',
      'remote-ssh-macos',
      'remote-macos',
      'unsupported'
    ] satisfies HostKind[];

    expect(hostKinds).toEqual([
      'local-windows',
      'local-linux',
      'local-macos',
      'wsl',
      'remote-ssh-linux',
      'remote-linux',
      'remote-ssh-macos',
      'remote-macos',
      'unsupported'
    ]);
  });

  it('允许模型和 provider 请求携带 forceRefresh', () => {
    expect(isWebviewRequestMessage({
      type: 'models.list',
      requestId: 'models-1',
      payload: { forceRefresh: true }
    })).toBe(true);

    expect(isWebviewRequestMessage({
      type: 'providers.list',
      requestId: 'providers-1',
      payload: { forceRefresh: true }
    })).toBe(true);

    expect(isWebviewRequestMessage({
      type: 'models.list.byProvider',
      requestId: 'models-provider-1',
      payload: { providerId: 'openai', forceRefresh: true }
    })).toBe(true);
  });

  it('允许 composer 资源请求和带原生命令的 run.start', () => {
    expect(isWebviewRequestMessage({
      type: 'composer.resources.list',
      requestId: 'resources-1'
    })).toBe(true);

    expect(isWebviewRequestMessage({
      type: 'run.start',
      requestId: 'run-command-1',
      payload: {
        message: '/review src/app.ts',
        model: 'cpa/gpt-5',
        agent: 'build',
        command: { name: 'review', arguments: 'src/app.ts' }
      }
    })).toBe(true);

    expect(isWebviewRequestMessage({
      type: 'run.start',
      requestId: 'run-command-invalid',
      payload: {
        message: '/review',
        model: 'cpa/gpt-5',
        agent: 'build',
        command: { name: '', arguments: [] }
      }
    })).toBe(false);
  });

  it('允许扩展返回 composer 资源清单', () => {
    expect(isExtensionResponseMessage({
      type: 'composer.resources.list.response',
      requestId: 'resources-1',
      ok: true,
      payload: {
        commands: [],
        skills: [],
        mcpServers: []
      }
    })).toBe(true);
  });

  it('允许文件打开请求携带目标路径', () => {
    expect(isWebviewRequestMessage({
      type: 'file.open',
      requestId: 'file-1',
      payload: { path: 'webview-ui/src/App.tsx' }
    })).toBe(true);

    expect(isWebviewRequestMessage({
      type: 'file.open',
      requestId: 'file-location-1',
      payload: { path: 'webview-ui/src/App.tsx', line: 120, column: 4 }
    })).toBe(true);

    expect(isWebviewRequestMessage({
      type: 'file.open',
      requestId: 'file-location-invalid',
      payload: { path: 'webview-ui/src/App.tsx', line: 0 }
    })).toBe(false);

    expect(isWebviewRequestMessage({
      type: 'file.open',
      requestId: 'file-2',
      payload: { path: '' }
    })).toBe(false);
  });

  it('校验 MCP 开关、工作区搜索和拖拽解析请求', () => {
    expect(isWebviewRequestMessage({
      type: 'mcp.setEnabled',
      requestId: 'mcp-1',
      payload: { name: 'browser', enabled: true }
    })).toBe(true);
    expect(isWebviewRequestMessage({
      type: 'mcp.setEnabled',
      requestId: 'mcp-2',
      payload: { name: '', enabled: true }
    })).toBe(false);
    expect(isWebviewRequestMessage({
      type: 'workspace.resources.search',
      requestId: 'search-1',
      payload: { query: 'App' }
    })).toBe(true);
    expect(isWebviewRequestMessage({
      type: 'workspace.resources.resolve',
      requestId: 'drop-1',
      payload: { values: ['file:///workspace/src/App.tsx'] }
    })).toBe(true);
  });

  it('允许打开与忽略 inline diff review', () => {
    expect(isWebviewRequestMessage({
      type: 'inlineDiff.open',
      requestId: 'inline-open-1',
      payload: { fileId: 'file-1' }
    })).toBe(true);

    expect(isWebviewRequestMessage({
      type: 'inlineDiff.dismiss',
      requestId: 'inline-dismiss-1',
      payload: { fileId: 'file-1' }
    })).toBe(true);

    expect(isWebviewRequestMessage({
      type: 'inlineDiff.open',
      requestId: 'inline-open-2',
      payload: { fileId: '' }
    })).toBe(false);
  });

  it('允许读取子任务 transcript 并校验响应 session', () => {
    expect(isWebviewRequestMessage({
      type: 'subtask.transcript',
      requestId: 'subtask-1',
      payload: { sessionId: 'ses_child' }
    })).toBe(true);

    expect(isWebviewRequestMessage({
      type: 'subtask.transcript',
      requestId: 'subtask-2',
      payload: { sessionId: '' }
    })).toBe(false);

    expect(isExtensionResponseMessage({
      type: 'subtask.transcript.response',
      requestId: 'subtask-1',
      ok: true,
      payload: { sessionId: 'ses_child', messages: [] }
    })).toBe(true);

    expect(isExtensionResponseMessage({
      type: 'subtask.transcript.response',
      requestId: 'subtask-1',
      ok: true,
      payload: { sessionId: '', messages: [] }
    })).toBe(false);
  });

  it('校验定点回退与会话分支请求和响应', () => {
    expect(isWebviewRequestMessage({
      type: 'session.revert',
      requestId: 'revert-1',
      payload: { sessionId: 'ses_parent', messageId: 'msg_user_1' }
    })).toBe(true);
    expect(isWebviewRequestMessage({
      type: 'session.fork',
      requestId: 'fork-1',
      payload: { sessionId: 'ses_parent', messageId: 'msg_assistant_1' }
    })).toBe(true);
    expect(isWebviewRequestMessage({
      type: 'session.revert',
      requestId: 'revert-invalid',
      payload: { sessionId: 'ses_parent', messageId: '' }
    })).toBe(false);

    expect(isExtensionResponseMessage({
      type: 'session.revert.response',
      requestId: 'revert-1',
      ok: true,
      payload: {
        changed: true,
        sessionId: 'ses_parent',
        revertMessageId: 'msg_user_1',
        composerText: 'restore this prompt'
      }
    })).toBe(true);
    expect(isExtensionResponseMessage({
      type: 'session.fork.response',
      requestId: 'fork-1',
      ok: true,
      payload: { sourceSessionId: 'ses_parent', sessionId: 'ses_fork' }
    })).toBe(true);
    expect(isExtensionResponseMessage({
      type: 'session.fork.response',
      requestId: 'fork-invalid',
      ok: true,
      payload: { sourceSessionId: 'ses_parent', sessionId: '' }
    })).toBe(false);
  });

  it('仅打开 Markdown 时允许空文件名，保存到磁盘时仍要求文件名', () => {
    const basePayload = {
      sessionId: 'ses_123',
      filename: '',
      includeThinking: true,
      includeToolDetails: true,
      includeAssistantMetadata: true
    };

    expect(isWebviewRequestMessage({
      type: 'session.export.markdown',
      requestId: 'export-open-1',
      payload: { ...basePayload, openWithoutSaving: true }
    })).toBe(true);

    expect(isWebviewRequestMessage({
      type: 'session.export.markdown',
      requestId: 'export-save-1',
      payload: { ...basePayload, openWithoutSaving: false }
    })).toBe(false);
  });

  it('允许问题回复和拒绝请求', () => {
    expect(isWebviewRequestMessage({
      type: 'question.reply',
      requestId: 'question-1',
      payload: {
        questionId: 'que_123',
        answers: [['README.md'], ['Create new file', 'Use markdown']]
      }
    })).toBe(true);

    expect(isWebviewRequestMessage({
      type: 'question.reply',
      requestId: 'question-2',
      payload: {
        questionId: 'que_123',
        answers: ['README.md']
      }
    })).toBe(false);

    expect(isWebviewRequestMessage({
      type: 'question.reject',
      requestId: 'question-3',
      payload: {
        questionId: 'que_123'
      }
    })).toBe(true);
  });

  it('允许扩展返回文件打开响应', () => {
    expect(isExtensionResponseMessage({
      type: 'file.open.response',
      requestId: 'file-1',
      ok: true,
      payload: { path: 'webview-ui/src/App.tsx' }
    })).toBe(true);
  });

  it('允许扩展推送权威 inline diff 状态并返回 review 操作响应', () => {
    expect(isExtensionResponseMessage({
      type: 'inlineDiff.state',
      requestId: 'inline-state-3',
      ok: true,
      payload: {
        revision: 3,
        files: [{
          fileId: 'file-1',
          path: 'webview-ui/src/App.tsx',
          displayPath: 'webview-ui/src/App.tsx',
          additions: 12,
          deletions: 4,
          hunks: 2,
          status: 'pending'
        }]
      }
    })).toBe(true);

    expect(isExtensionResponseMessage({
      type: 'inlineDiff.open.response',
      requestId: 'inline-open-1',
      ok: true,
      payload: { fileId: 'file-1' }
    })).toBe(true);

    expect(isExtensionResponseMessage({
      type: 'inlineDiff.dismiss.response',
      requestId: 'inline-dismiss-1',
      ok: true,
      payload: { fileId: 'file-1' }
    })).toBe(true);

    expect(isExtensionResponseMessage({
      type: 'inlineDiff.state',
      requestId: 'inline-state-invalid',
      ok: true,
      payload: {
        revision: -1,
        files: []
      }
    })).toBe(false);
  });

  it('允许扩展返回问题处理响应', () => {
    expect(isExtensionResponseMessage({
      type: 'question.reply.response',
      requestId: 'question-1',
      ok: true,
      payload: { questionId: 'que_123' }
    })).toBe(true);

    expect(isExtensionResponseMessage({
      type: 'question.reject.response',
      requestId: 'question-2',
      ok: true,
      payload: { questionId: 'que_123' }
    })).toBe(true);
  });

  it('拒绝错误类型的 forceRefresh 与 tempfile mimeType', () => {
    expect(isWebviewRequestMessage({
      type: 'models.list',
      requestId: 'models-1',
      payload: { forceRefresh: 'yes' }
    })).toBe(false);

    expect(isWebviewRequestMessage({
      type: 'tempfile.write',
      requestId: 'tempfile-1',
      payload: {
        fileName: 'pasted.png',
        bytesBase64: 'iVBORw0KGgo=',
        mimeType: 123
      }
    })).toBe(false);
  });

  it('前端响应守卫与共享 transcript 图片 part 保持同一协议入口', () => {
    expect(isExtensionResponseMessage({
      type: 'webview.ready.ack',
      requestId: 'ready-1',
      ok: true,
      payload: {
        hostKind: 'wsl',
        isSupportedHost: true,
        opencode: {
          binary: 'opencode',
          version: '1.15.10',
          minimumVersion: '1.15.10',
          isCompatible: true
        }
      }
    })).toBe(true);

    const imagePart = {
      type: 'image',
      src: 'data:image/png;base64,abc',
      alt: 'pasted'
    } satisfies TranscriptPart;

    expect(imagePart.type).toBe('image');
  });
});
