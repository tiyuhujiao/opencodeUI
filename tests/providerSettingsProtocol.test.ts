import { describe, expect, it } from 'vitest';
import { isExtensionResponseMessage, isWebviewRequestMessage } from '../src/shared/protocol';
import { createEmptyProviderDraft, createEmptyProviderModelDraft } from '../webview-ui/src/providerSettings';

describe('provider settings protocol guards', () => {
  it('接受完整 provider/model 保存草稿', () => {
    const draft = createEmptyProviderDraft();
    draft.id = 'custom-openai';
    draft.models = [createEmptyProviderModelDraft('gpt-custom')];
    draft.models[0].description = 'Custom model';
    draft.models[0].experimental = false;
    draft.models[0].interleaved = { field: 'reasoning_content' };
    draft.models[0].cost.contextOver200k.input = 2;
    draft.headers = [{ name: 'Authorization', value: '', hasStoredValue: true }];

    expect(isWebviewRequestMessage({
      type: 'provider.settings.save',
      requestId: 'provider-save-1',
      payload: { scope: 'global', revision: 'abc', draft }
    })).toBe(true);
  });

  it('严格拒绝错误 scope、缺失敏感值标记和错误 interleaved 对象', () => {
    expect(isWebviewRequestMessage({
      type: 'provider.settings.get',
      requestId: 'provider-get-bad',
      payload: { scope: 'folder' }
    })).toBe(false);

    const missingHeaderState = createEmptyProviderDraft();
    missingHeaderState.id = 'custom';
    missingHeaderState.headers = [{ name: 'Authorization', value: '' } as never];
    expect(isWebviewRequestMessage({
      type: 'provider.settings.save',
      requestId: 'provider-save-bad-header',
      payload: { scope: 'workspace', revision: 'abc', draft: missingHeaderState }
    })).toBe(false);

    const invalidInterleaved = createEmptyProviderDraft();
    invalidInterleaved.id = 'custom';
    invalidInterleaved.models = [createEmptyProviderModelDraft('model')];
    invalidInterleaved.models[0].interleaved = { field: 3 } as never;
    expect(isWebviewRequestMessage({
      type: 'provider.settings.save',
      requestId: 'provider-save-bad-model',
      payload: { scope: 'workspace', revision: 'abc', draft: invalidInterleaved }
    })).toBe(false);
  });

  it('校验 catalog snapshot 与完整模型响应', () => {
    const model = createEmptyProviderModelDraft('gpt-test');
    const draft = createEmptyProviderDraft();
    draft.id = 'custom';
    const snapshot = {
      scope: 'global',
      path: 'C:/Users/test/.config/opencode/opencode.json',
      exists: true,
      revision: 'abc',
      workspaceAvailable: true,
      catalog: [{
        id: 'custom',
        label: 'Custom',
        source: 'config',
        api: '',
        npm: '@ai-sdk/openai-compatible',
        builtIn: false,
        connected: true,
        credentialStored: true,
        credentialType: 'api',
        configuredInScope: true,
        env: [],
        modelCount: 1,
        authMethods: [{ type: 'api', label: 'API key', prompts: [] }]
      }],
      configured: [draft]
    };

    expect(isExtensionResponseMessage({
      type: 'provider.settings.get.response',
      requestId: 'provider-get-1',
      ok: true,
      payload: snapshot
    })).toBe(true);
    expect(isExtensionResponseMessage({
      type: 'provider.settings.models.response',
      requestId: 'provider-models-1',
      ok: true,
      payload: { providerId: 'custom', models: [model] }
    })).toBe(true);
  });

  it('校验 API key、OAuth authorize/callback 与外部链接消息', () => {
    expect(isWebviewRequestMessage({
      type: 'provider.auth.api',
      requestId: 'auth-api-1',
      payload: { providerId: 'cloudflare-workers-ai', key: 'secret', metadata: { accountId: 'account' } }
    })).toBe(true);
    expect(isWebviewRequestMessage({
      type: 'provider.auth.oauth.authorize',
      requestId: 'auth-oauth-1',
      payload: { providerId: 'openai', method: 0, inputs: {} }
    })).toBe(true);
    expect(isWebviewRequestMessage({
      type: 'provider.auth.oauth.callback',
      requestId: 'auth-callback-1',
      payload: { providerId: 'openai', method: 0, code: 'code' }
    })).toBe(true);
    expect(isExtensionResponseMessage({
      type: 'provider.auth.oauth.authorize.response',
      requestId: 'auth-oauth-1',
      ok: true,
      payload: {
        providerId: 'openai',
        method: 0,
        authorization: { url: 'https://auth.openai.com', method: 'auto', instructions: 'Enter code: ABCD' }
      }
    })).toBe(true);
    expect(isWebviewRequestMessage({
      type: 'provider.auth.api',
      requestId: 'auth-api-bad',
      payload: { providerId: 'openai', key: '', metadata: {} }
    })).toBe(false);
  });
});
