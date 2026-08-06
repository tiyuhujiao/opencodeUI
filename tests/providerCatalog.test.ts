import { describe, expect, it } from 'vitest'
import {
  mergeConfiguredCatalogEntries,
  normalizeProviderCatalog,
  resolveStoredCredentialProviderIds,
  resolveStoredCredentialTypes
} from '../src/providerCatalog'

describe('provider settings catalog', () => {
  it('normalizes provider/auth payloads and keeps full model metadata for lazy loading', () => {
    const catalog = normalizeProviderCatalog(
      {
        connected: ['openai'],
        all: [
          {
            id: 'openai',
            name: 'OpenAI',
            source: 'custom',
            api: 'https://api.openai.com/v1',
            npm: '@ai-sdk/openai',
            env: ['OPENAI_API_KEY'],
            models: {
              'gpt-test': {
                id: 'gpt-test',
                providerID: 'openai',
                api: {
                  id: 'gpt-test-2026-08-01',
                  url: 'https://api.openai.com/v1',
                  npm: '@ai-sdk/openai'
                },
                name: 'GPT Test',
                description: 'Catalog description',
                capabilities: {
                  reasoning: true,
                  attachment: true,
                  temperature: false,
                  toolcall: true,
                  input: { text: true, image: true, audio: false },
                  output: { text: true, image: false }
                },
                cost: {
                  input: 1.25,
                  output: 10,
                  cache: { read: 0.125, write: 1.5 },
                  experimentalOver200K: {
                    input: 2.5,
                    output: 15,
                    cache: { read: 0.25, write: 2 }
                  }
                },
                limit: { context: 128000, output: 16000 },
                variants: { high: { reasoningEffort: 'high' } }
              }
            }
          }
        ]
      },
      {
        openai: [
          { type: 'api', label: 'API key' },
          {
            type: 'oauth',
            label: 'Sign in',
            prompts: [{
              type: 'select',
              key: 'deployment',
              message: 'Deployment',
              options: [{ label: 'Public', value: 'public', hint: 'Recommended' }]
            }]
          }
        ]
      }
    )

    expect(catalog.entries).toEqual([
      expect.objectContaining({
        id: 'openai',
        label: 'OpenAI',
        builtIn: true,
        connected: true,
        credentialStored: false,
        credentialType: null,
        api: 'https://api.openai.com/v1',
        npm: '@ai-sdk/openai',
        modelCount: 1,
        authMethods: [
          { type: 'api', label: 'API key', prompts: [] },
          {
            type: 'oauth',
            label: 'Sign in',
            prompts: [{
              type: 'select',
              key: 'deployment',
              message: 'Deployment',
              options: [{ label: 'Public', value: 'public', hint: 'Recommended' }]
            }]
          }
        ]
      })
    ])
    expect(catalog.modelsByProvider.get('openai')).toEqual([
      expect.objectContaining({
        id: 'gpt-test',
        apiModelId: 'gpt-test-2026-08-01',
        name: 'GPT Test',
        description: 'Catalog description',
        reasoning: true,
        attachment: true,
        temperature: false,
        toolCall: true,
        limit: { context: 128000, input: null, output: 16000 },
        cost: {
          input: 1.25,
          output: 10,
          cacheRead: 0.125,
          cacheWrite: 1.5,
          contextOver200k: {
            input: 2.5,
            output: 15,
            cacheRead: 0.25,
            cacheWrite: 2
          }
        },
        modalities: { input: ['text', 'image'], output: ['text'] },
        extrasJson: '{}'
      })
    ])
    expect(catalog.modelsByProvider.get('openai')?.[0].variantsJson).toContain('reasoningEffort')
  })

  it('adds configured custom providers that are absent from the upstream catalog', () => {
    const merged = mergeConfiguredCatalogEntries([], [
      {
        id: 'custom',
        name: 'Custom gateway',
        npm: '@ai-sdk/openai-compatible',
        api: '',
        env: ['CUSTOM_API_KEY'],
        credential: { connected: false, hasStoreValue: true }
      }
    ])
    expect(merged).toEqual([
      expect.objectContaining({
        id: 'custom',
        label: 'Custom gateway',
        source: 'config',
        builtIn: false,
        credentialStored: true,
        credentialType: 'api',
        configuredInScope: true
      })
    ])
  })

  it('reconciles auth-list display labels with case-sensitive provider IDs and ignores OAuth', () => {
    const result = resolveStoredCredentialProviderIds(
      [
        { id: 'cpa8317', label: 'CPA8317', type: 'api' },
        { id: 'openai', label: 'OpenAI', type: 'oauth' },
        { id: 'my-gateway', label: 'My Gateway', type: 'api' }
      ],
      [
        { id: 'CPA8317', label: 'CPA8317' },
        { id: 'openai', label: 'OpenAI' },
        { id: 'custom-id', label: 'My Gateway' }
      ]
    )

    expect([...result]).toEqual(['CPA8317', 'custom-id'])

    expect([...resolveStoredCredentialTypes(
      [
        { id: 'cpa8317', label: 'CPA8317', type: 'api' },
        { id: 'openai', label: 'OpenAI', type: 'oauth' }
      ],
      [
        { id: 'CPA8317', label: 'CPA8317' },
        { id: 'openai', label: 'OpenAI' }
      ]
    )]).toEqual([['CPA8317', 'api'], ['openai', 'oauth']])
  })
})
