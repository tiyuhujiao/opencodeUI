import { describe, expect, it } from 'vitest';
import { isExtensionResponseMessage, isWebviewRequestMessage, type HostKind, type TranscriptPart } from '../src/shared/protocol';

describe('webview request protocol guards', () => {
  it('覆盖当前支持的 HostKind 协议值', () => {
    const hostKinds = [
      'local-windows',
      'local-linux',
      'wsl',
      'remote-ssh-linux',
      'remote-linux',
      'unsupported'
    ] satisfies HostKind[];

    expect(hostKinds).toEqual([
      'local-windows',
      'local-linux',
      'wsl',
      'remote-ssh-linux',
      'remote-linux',
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

  it('允许文件打开请求携带目标路径', () => {
    expect(isWebviewRequestMessage({
      type: 'file.open',
      requestId: 'file-1',
      payload: { path: 'webview-ui/src/App.tsx' }
    })).toBe(true);

    expect(isWebviewRequestMessage({
      type: 'file.open',
      requestId: 'file-2',
      payload: { path: '' }
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
