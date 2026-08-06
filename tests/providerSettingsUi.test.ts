import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  addEditableJsonEntry,
  createEmptyProviderDraft,
  createEmptyProviderModelDraft,
  getModelThinkingAvailability,
  getOrderedThinkingVariantEntries,
  linesToList,
  nextEditableJsonKey,
  parseEditableJsonObject,
  removeEditableJsonEntry,
  renameEditableJsonEntry,
  renameThinkingLevelEntry,
  setEditableJsonProperty,
  setNestedEditableJsonProperty,
  supportsOpenAiServiceTier,
  providerDraftFromCatalog
} from '../webview-ui/src/providerSettings';

const root = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'webview-ui', 'src', 'App.tsx'), 'utf8');
const pageSource = fs.readFileSync(path.join(root, 'webview-ui', 'src', 'components', 'provider', 'ProviderSettingsPage.tsx'), 'utf8');
const connectSource = fs.readFileSync(path.join(root, 'webview-ui', 'src', 'components', 'provider', 'ProviderConnectDialog.tsx'), 'utf8');
const pageCss = fs.readFileSync(path.join(root, 'webview-ui', 'src', 'components', 'provider', 'providerSettings.css'), 'utf8');

describe('provider settings webview', () => {
  it('从顶部工具栏进入独立设置页并在保存后刷新模型目录', () => {
    expect(appSource).toContain("aria-label={t('Provider settings')}");
    expect(appSource).toContain('<ProviderSettingsPage');
    expect(appSource).toContain('requestProviders({ forceRefresh: true })');
    expect(appSource).toContain('requestModels({ forceRefresh: true })');
  });

  it('覆盖 OpenCode provider 与模型高级参数', () => {
    for (const field of [
      'Enterprise URL',
      'Provider object ID',
      'Header timeout',
      'Chunk timeout',
      'Set cache key',
      'Whitelist',
      'Blacklist',
      'Experimental',
      'Interleaved',
      'Upstream API model ID',
      'Context over 200k',
      'Model adapter override',
      'Variants',
      'Reasoning effort',
      'Reasoning summary',
      'Text verbosity',
      'Service tier',
      'Prompt cache key',
      'Include response fields',
      'Variant availability',
      'Raw variants JSON',
      'Additional model fields'
    ]) {
      expect(pageSource).toContain(field);
    }
    expect(pageSource).toContain('@ai-sdk/openai-compatible');
    expect(pageSource).toContain('@ai-sdk/openai');
    expect(pageSource).toContain('@ai-sdk/anthropic');
  });

  it('提供红绿连接状态和窄侧栏列表/详情布局', () => {
    expect(pageCss).toMatch(/\.provider-settings__status-dot\.is-connected[\s\S]*#22a55b/);
    expect(pageCss).toMatch(/\.provider-settings__status-dot\.is-disconnected[\s\S]*#d84b45/);
    expect(pageCss).toContain('@media (max-width: 560px)');
    expect(pageCss).toContain('.provider-settings__body.is-mobile-list .provider-settings__detail');
  });

  it('生成内置与自定义 provider 草稿并保留完整模型初值', () => {
    const builtIn = providerDraftFromCatalog({
      id: 'openai',
      label: 'OpenAI',
      source: 'api',
      api: '',
      npm: '@ai-sdk/openai',
      builtIn: true,
      connected: true,
      credentialStored: true,
      credentialType: 'api',
      configuredInScope: false,
      env: ['OPENAI_API_KEY'],
      modelCount: 10,
      authMethods: []
    });
    expect(builtIn).toMatchObject({
      id: 'openai',
      custom: false,
      npm: '@ai-sdk/openai',
      credential: { mode: 'store', hasStoreValue: true, connected: true }
    });
    expect(createEmptyProviderDraft()).toMatchObject({ custom: true, npm: '@ai-sdk/openai-compatible' });
    expect(createEmptyProviderModelDraft('model')).toMatchObject({
      id: 'model',
      apiModelId: '',
      experimental: null,
      modalities: { input: null, output: null },
      cost: { contextOver200k: { input: null, output: null } }
    });
    expect(linesToList(' A\n\nB ')).toEqual(['A', 'B']);
  });

  it('内置供应商使用连接弹窗，自定义供应商默认使用快速配置', () => {
    expect(pageSource).toContain('catalog?.builtIn');
    expect(pageSource).toContain('<ProviderConnectDialog');
    expect(pageSource).toContain('<QuickSetupEditor');
    expect(pageSource).toContain('Manage models');
    expect(pageSource).toContain('Advanced configuration');
    expect(connectSource).toContain('Continue in browser');
    expect(connectSource).toContain('provider-connect__device-code');
    expect(connectSource).toContain('The key is stored by OpenCode');
    expect(pageCss).toMatch(/\.provider-connect\s*\{[\s\S]*overflow:\s*hidden/);
    expect(pageCss).toMatch(/\.provider-connect__body\s*\{[\s\S]*overflow-y:\s*auto/);
  });

  it('keeps unknown request and variant options while editing guided fields', () => {
    const options = '{"reasoningEffort":"low","adapterOnly":{"enabled":true}}';
    const updatedOptions = setEditableJsonProperty(options, 'reasoningSummary', 'auto');
    expect(parseEditableJsonObject(updatedOptions ?? '')).toEqual({
      reasoningEffort: 'low',
      adapterOnly: { enabled: true },
      reasoningSummary: 'auto'
    });

    const variants = '{"low":{"reasoningEffort":"low","adapterOnly":7}}';
    const withTier = setNestedEditableJsonProperty(variants, 'low', 'serviceTier', 'priority');
    expect(parseEditableJsonObject(withTier ?? '')).toEqual({
      low: { reasoningEffort: 'low', adapterOnly: 7, serviceTier: 'priority' }
    });
    const renamed = renameEditableJsonEntry(withTier ?? '', 'low', 'low-fast');
    expect(nextEditableJsonKey(renamed ?? '', 'low-fast')).toBe('low-fast-2');
    const duplicated = addEditableJsonEntry(renamed ?? '', 'high', { reasoningEffort: 'high' });
    const removed = removeEditableJsonEntry(duplicated ?? '', 'low-fast');
    expect(parseEditableJsonObject(removed ?? '')).toEqual({ high: { reasoningEffort: 'high' } });
  });

  it('keeps the quick thinking level name and reasoning effort aligned', () => {
    const source = JSON.stringify({
      medium: { reasoningEffort: 'medium', adapterOnly: { keep: true } },
      custom: { thinkingBudget: 8192 }
    });
    const low = renameThinkingLevelEntry(source, 'medium', 'low');
    expect(parseEditableJsonObject(low ?? '')).toEqual({
      low: { reasoningEffort: 'low', adapterOnly: { keep: true } },
      custom: { thinkingBudget: 8192 }
    });

    const lowFast = renameThinkingLevelEntry(low ?? '', 'low', 'low-fast');
    expect(parseEditableJsonObject(lowFast ?? '')).toMatchObject({
      'low-fast': { reasoningEffort: 'low', adapterOnly: { keep: true } }
    });

    const custom = renameThinkingLevelEntry(lowFast ?? '', 'custom', 'high');
    expect(parseEditableJsonObject(custom ?? '')?.high).toEqual({ thinkingBudget: 8192 });
  });

  it('only offers OpenAI service tiers to matching GPT and o-series models', () => {
    const gpt = createEmptyProviderModelDraft('gpt-5.6-sol');
    expect(supportsOpenAiServiceTier(gpt, '@ai-sdk/openai')).toBe(true);
    expect(supportsOpenAiServiceTier(gpt, '@ai-sdk/openai-compatible')).toBe(false);

    const claude = createEmptyProviderModelDraft('claude-opus-5');
    expect(supportsOpenAiServiceTier(claude, '@ai-sdk/openai')).toBe(false);

    const oSeries = createEmptyProviderModelDraft('openai/o3-pro');
    oSeries.npm = '@ai-sdk/openai';
    expect(supportsOpenAiServiceTier(oSeries, '@ai-sdk/anthropic')).toBe(true);
  });

  it('derives thinking availability from request variants instead of only capability metadata', () => {
    const model = createEmptyProviderModelDraft('gpt-5.6-sol');
    model.variantsJson = JSON.stringify({
      high: { reasoningEffort: 'high', adapterOnly: { keep: true } },
      low: { reasoningEffort: 'low' },
      disabled: { reasoningEffort: 'max', disabled: true },
      priority: { serviceTier: 'priority' }
    });

    expect(getModelThinkingAvailability(model)).toEqual({
      available: true,
      source: 'variants',
      activeLevelCount: 2,
      metadata: null,
      metadataConflict: false
    });

    model.reasoning = false;
    expect(getModelThinkingAvailability(model)).toMatchObject({
      available: true,
      source: 'variants',
      metadataConflict: true
    });

    expect(getOrderedThinkingVariantEntries(model.variantsJson)?.map(([id]) => id)).toEqual([
      'low',
      'high',
      'disabled',
      'priority'
    ]);
  });

  it('offers repeatable quick model configuration without presenting reasoning metadata as a support checkbox', () => {
    for (const field of [
      'Models',
      'Add model',
      'Context window',
      'Max output tokens',
      'Input price / 1M',
      'Output price / 1M',
      'Thinking levels',
      'Reasoning effort',
      'Service tier',
      'Provider headers',
      'Reasoning capability metadata'
    ]) {
      expect(pageSource).toContain(field);
    }
    expect(pageSource).toContain('draft.models.map');
    expect(pageSource).toContain('getModelThinkingAvailability(model)');
    expect(pageSource).not.toContain('<span>Supports reasoning</span>');
    expect(pageSource).not.toContain('<span>Supports tools</span>');
    expect(pageSource).not.toContain('provider-settings__quick-level-effort');
    expect(pageSource).toContain('renameThinkingLevelEntry(source, id, idDraft)');
    expect(pageSource).toContain('showServiceTier={supportsOpenAiServiceTier(model, providerNpm)}');
  });

  it('fetches upstream models immediately from the quick setup model toolbar', () => {
    expect(pageSource).toContain('className="provider-settings__quick-model-actions"');
    expect(pageSource).toContain("t('Fetch models')");
    expect(pageSource).toContain('const fetchUpstreamModels = () => {');
    expect(pageSource).toContain('setUpstreamOpen(true)');
    expect(pageSource).toContain('onRequestUpstream(defaultUpstreamModelsEndpoint(draft.baseURL))');
    expect(pageSource.match(/onRequestUpstream\(/g)).toHaveLength(1);
    expect(pageSource).toContain('<UpstreamModelPicker');
    expect(pageSource).toContain("t('Fetching upstream models...')");
    expect(pageSource).not.toContain('provider-settings__upstream-request');
    expect(pageSource).not.toContain('No request is sent until you click Fetch.');
  });
});
