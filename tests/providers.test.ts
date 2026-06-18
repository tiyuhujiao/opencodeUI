import { describe, expect, it } from 'vitest';
import {
  buildProviderSummaries,
  extractConfiguredProviderLabels,
  type AuthProviderEntry
} from '../src/bridge/parsers';

describe('buildProviderSummaries', () => {
  it('只返回 models 中真实存在的 providerID', () => {
    const authProviders: AuthProviderEntry[] = [
      { id: 'openai', label: 'OpenAI' },
      { id: 'my8317', label: 'my8317' },
      { id: 'cpa', label: 'CPA' }
    ];
    const providerIds = ['openai', 'my8317'];

    expect(buildProviderSummaries(authProviders, providerIds)).toEqual([
      { id: 'openai', label: 'OpenAI' },
      { id: 'my8317', label: 'my8317' }
    ]);
  });

  it('优先使用配置文件中的 provider 名称，并按 auth list 顺序展示内置 provider', () => {
    const authProviders: AuthProviderEntry[] = [
      { id: 'openai', label: 'OpenAI' },
      { id: 'github-copilot', label: 'GitHub Copilot' },
      { id: 'google', label: 'Google' }
    ];
    const providerIds = ['opencode', 'github-copilot', 'google', 'openai', 'CPA8317'];
    const configured = extractConfiguredProviderLabels({
      provider: {
        CPA8317: {
          name: 'CPA8317'
        }
      }
    });

    expect(buildProviderSummaries(authProviders, providerIds, configured)).toEqual([
      { id: 'openai', label: 'OpenAI' },
      { id: 'github-copilot', label: 'GitHub Copilot' },
      { id: 'google', label: 'Google' },
      { id: 'opencode', label: 'opencode' },
      { id: 'CPA8317', label: 'CPA8317' }
    ]);
  });
});
