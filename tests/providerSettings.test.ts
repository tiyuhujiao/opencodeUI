import * as fs from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { parse } from 'jsonc-parser'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createEmptyProviderModelDraft,
  deleteProviderConfigDraft,
  ProviderConfigConflictError,
  providerConfigToDrafts,
  providerDraftToConfig,
  readProviderConfigDocument,
  resolveProviderConfigTarget,
  saveProviderConfigDraft,
  shouldDeleteStoredProviderCredential
} from '../src/providerSettings'

const tempDirectories: string[] = []

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function createTempDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'opencode-ui-provider-'))
  tempDirectories.push(directory)
  return directory
}

describe('provider settings config service', () => {
  it('extracts complete model fields while masking credentials and sensitive headers', () => {
    const config = {
      provider: {
        CPA8317: {
          id: 'provider-object-id',
          name: 'CPA8317',
          npm: '@ai-sdk/openai',
          options: {
            apiKey: 'do-not-send-to-webview',
            baseURL: 'https://example.test/v1',
            setCacheKey: true,
            headers: {
              Authorization: 'Bearer secret',
              'X-Region': 'east'
            },
            providerSpecific: { enabled: true }
          },
          models: {
            'gpt-5.6-sol': {
              id: 'gpt-5.6-sol-2026-08-01',
              name: 'GPT-5.6-sol(CPA)',
              description: 'Advanced model',
              family: 'gpt-5.6',
              release_date: '2026-08-01',
              status: 'active',
              experimental: true,
              attachment: true,
              reasoning: true,
              temperature: false,
              tool_call: true,
              interleaved: { field: 'reasoning_content' },
              limit: { context: 272000, input: 250000, output: 128000 },
              cost: {
                input: 1,
                output: 2,
                cache_read: 0.1,
                cache_write: 0.2,
                context_over_200k: { input: 3, output: 4, cache_read: 0.3, cache_write: 0.4 }
              },
              modalities: { input: ['text', 'image'], output: ['text'] },
              headers: { 'X-Model-Token': 'model-secret' },
              options: {
                reasoningEffort: 'medium',
                reasoningSummary: 'auto',
                textVerbosity: 'low',
                include: ['reasoning.encrypted_content']
              },
              variants: {
                'high-fast': {
                  reasoningEffort: 'high',
                  reasoningSummary: 'auto',
                  serviceTier: 'priority'
                }
              },
              customModelField: 42
            }
          },
          customProviderField: 'preserve'
        }
      }
    }

    const [draft] = providerConfigToDrafts(config)
    expect(draft).toMatchObject({ configId: 'provider-object-id' })
    expect(draft.credential).toMatchObject({
      mode: 'config',
      value: '',
      hasConfigValue: true,
      hasStoreValue: false
    })
    expect(JSON.stringify(draft)).not.toContain('do-not-send-to-webview')
    expect(draft.headers).toEqual([
      { name: 'Authorization', value: '', hasStoredValue: true },
      { name: 'X-Region', value: 'east', hasStoredValue: false }
    ])
    expect(draft.optionExtrasJson).toContain('providerSpecific')
    expect(draft.providerExtrasJson).toContain('customProviderField')

    const model = draft.models[0]
    expect(model).toMatchObject({
      apiModelId: 'gpt-5.6-sol-2026-08-01',
      description: 'Advanced model',
      family: 'gpt-5.6',
      releaseDate: '2026-08-01',
      status: 'active',
      experimental: true,
      attachment: true,
      reasoning: true,
      temperature: false,
      toolCall: true,
      interleaved: { field: 'reasoning_content' },
      limit: { context: 272000, input: 250000, output: 128000 }
    })
    expect(model.cost.contextOver200k).toEqual({ input: 3, output: 4, cacheRead: 0.3, cacheWrite: 0.4 })
    expect(model.modalities).toEqual({ input: ['text', 'image'], output: ['text'] })
    expect(model.headers).toEqual([{ name: 'X-Model-Token', value: '', hasStoredValue: true }])
    expect(model.optionsJson).toContain('reasoning.encrypted_content')
    expect(model.variantsJson).toContain('serviceTier')
    expect(model.extrasJson).toContain('customModelField')

    const roundTripped = providerDraftToConfig(draft, config.provider.CPA8317)
    expect((roundTripped.options as Record<string, unknown>).apiKey).toBe('do-not-send-to-webview')
    expect(((roundTripped.options as Record<string, unknown>).headers as Record<string, unknown>).Authorization).toBe('Bearer secret')
    expect((((roundTripped.models as Record<string, unknown>)['gpt-5.6-sol'] as Record<string, unknown>).headers as Record<string, unknown>)['X-Model-Token']).toBe('model-secret')
    const roundTrippedModel = (roundTripped.models as Record<string, Record<string, unknown>>)['gpt-5.6-sol']
    expect(roundTrippedModel).toMatchObject({
      id: 'gpt-5.6-sol-2026-08-01',
      name: 'GPT-5.6-sol(CPA)',
      description: 'Advanced model',
      family: 'gpt-5.6',
      release_date: '2026-08-01',
      status: 'active',
      experimental: true,
      attachment: true,
      reasoning: true,
      temperature: false,
      tool_call: true,
      interleaved: { field: 'reasoning_content' },
      limit: { context: 272000, input: 250000, output: 128000 },
      modalities: { input: ['text', 'image'], output: ['text'] }
    })
    expect(roundTrippedModel.options).toEqual({
      reasoningEffort: 'medium',
      reasoningSummary: 'auto',
      textVerbosity: 'low',
      include: ['reasoning.encrypted_content']
    })
    expect(roundTrippedModel.variants).toEqual({
      'high-fast': {
        reasoningEffort: 'high',
        reasoningSummary: 'auto',
        serviceTier: 'priority'
      }
    })
  })

  it('preserves omitted and explicitly empty modality directions', () => {
    const [inputOnly] = providerConfigToDrafts({
      provider: {
        demo: {
          models: {
            'model-a': { modalities: { input: ['text'] } }
          }
        }
      }
    })
    expect(inputOnly.models[0].modalities).toEqual({ input: ['text'], output: null })
    const inputOnlyConfig = providerDraftToConfig(inputOnly)
    expect((inputOnlyConfig.models as Record<string, Record<string, unknown>>)['model-a'].modalities).toEqual({ input: ['text'] })

    inputOnly.models[0].modalities.output = []
    const explicitEmpty = providerDraftToConfig(inputOnly)
    expect((explicitEmpty.models as Record<string, Record<string, unknown>>)['model-a'].modalities).toEqual({
      input: ['text'],
      output: []
    })
  })

  it('rejects partial schema objects and non-positive provider timeouts', () => {
    const [draft] = providerConfigToDrafts({ provider: { demo: { npm: '@ai-sdk/openai-compatible' } } })
    draft.timeout = 0
    expect(() => providerDraftToConfig(draft)).toThrow('大于 0')

    draft.timeout = null
    draft.models = [createEmptyProviderModelDraft('model-a')]
    draft.models[0].limit.context = 128000
    expect(() => providerDraftToConfig(draft)).toThrow('context 和 output')
  })

  it('preserves JSONC comments and unknown fields during precise provider edits', async () => {
    const home = await createTempDirectory()
    const configDirectory = path.join(home, '.config', 'opencode')
    await fs.promises.mkdir(configDirectory, { recursive: true })
    const configPath = path.join(configDirectory, 'opencode.jsonc')
    const raw = `{
  // keep top-level comment
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    // keep provider comment
    "demo": {
      "name": "Before",
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "https://before.test/v1",
        // keep option comment
        "unknownOption": 17
      },
      "models": {
        "model-a": {
          "name": "Model A",
          // keep model comment
          "unknownModel": true
        }
      }
    }
  }
}
`
    await writeFile(configPath, raw, 'utf8')
    const options = { homeDir: home, env: {} }
    const document = await readProviderConfigDocument('global', options)
    const [draft] = providerConfigToDrafts(document.config)
    draft.name = 'After'
    draft.baseURL = 'https://after.test/v1'
    draft.models[0].description = 'Added description'

    const saved = await saveProviderConfigDraft('global', document.revision, draft, options)
    expect(saved.path).toBe(configPath)
    expect(saved.raw).toContain('// keep top-level comment')
    expect(saved.raw).toContain('// keep provider comment')
    expect(saved.raw).toContain('// keep option comment')
    expect(saved.raw).toContain('// keep model comment')
    expect(saved.raw).toContain('"unknownOption": 17')
    expect(saved.raw).toContain('"unknownModel": true')

    const parsed = parse(saved.raw) as Record<string, unknown>
    const provider = ((parsed.provider as Record<string, unknown>).demo as Record<string, unknown>)
    expect(provider.name).toBe('After')
    expect((provider.options as Record<string, unknown>).baseURL).toBe('https://after.test/v1')
    expect((((provider.models as Record<string, unknown>)['model-a']) as Record<string, unknown>).description).toBe('Added description')
  })

  it('rejects stale revisions instead of overwriting an external edit', async () => {
    const home = await createTempDirectory()
    const configDirectory = path.join(home, '.config', 'opencode')
    await fs.promises.mkdir(configDirectory, { recursive: true })
    const configPath = path.join(configDirectory, 'opencode.json')
    await writeFile(configPath, '{"provider":{"demo":{"npm":"@ai-sdk/openai-compatible"}}}\n', 'utf8')
    const options = { homeDir: home, env: {} }
    const document = await readProviderConfigDocument('global', options)
    const [draft] = providerConfigToDrafts(document.config)
    await writeFile(configPath, '{"provider":{"demo":{"npm":"@ai-sdk/openai-compatible","name":"external"}}}\n', 'utf8')

    await expect(saveProviderConfigDraft('global', document.revision, draft, options)).rejects.toBeInstanceOf(
      ProviderConfigConflictError
    )
    expect(await fs.promises.readFile(configPath, 'utf8')).toContain('external')
  })

  it('deletes only the selected provider while preserving surrounding JSONC', async () => {
    const home = await createTempDirectory()
    const configDirectory = path.join(home, '.config', 'opencode')
    await fs.promises.mkdir(configDirectory, { recursive: true })
    const configPath = path.join(configDirectory, 'opencode.jsonc')
    await writeFile(configPath, `{
  // keep root comment
  "provider": {
    "remove-me": { "name": "Remove" },
    // keep remaining provider comment
    "keep-me": { "name": "Keep" }
  }
}
`, 'utf8')
    const options = { homeDir: home, env: {} }
    const document = await readProviderConfigDocument('global', options)

    const saved = await deleteProviderConfigDraft('global', document.revision, 'remove-me', options)
    expect(saved.raw).toContain('// keep root comment')
    expect(saved.raw).toContain('// keep remaining provider comment')
    expect(saved.raw).not.toContain('remove-me')
    expect((((parse(saved.raw) as Record<string, unknown>).provider as Record<string, unknown>)['keep-me'])).toEqual({ name: 'Keep' })
  })

  it('prefers an existing opencode.json and supports an explicit OPENCODE_CONFIG path', async () => {
    const home = await createTempDirectory()
    const directory = path.join(home, '.config', 'opencode')
    await fs.promises.mkdir(directory, { recursive: true })
    await writeFile(path.join(directory, 'opencode.json'), '{}', 'utf8')
    await writeFile(path.join(directory, 'opencode.jsonc'), '{}', 'utf8')
    expect(resolveProviderConfigTarget('global', { homeDir: home, env: {} }).path).toBe(path.join(directory, 'opencode.json'))

    const explicit = path.join(home, 'custom.jsonc')
    const target = resolveProviderConfigTarget('global', { homeDir: home, env: { OPENCODE_CONFIG: explicit } })
    expect(target.path).toBe(explicit)
    expect(target.customConfigPath).toBe(explicit)
  })

  it('requires a new credential-store key when no stored value exists', () => {
    const [draft] = providerConfigToDrafts({
      provider: {
        demo: { npm: '@ai-sdk/openai-compatible' }
      }
    })
    draft.credential.mode = 'store'
    expect(() => providerDraftToConfig(draft)).toThrow('credential store')
  })

  it('does not treat a config credential as an existing credential-store value', () => {
    const existing = {
      npm: '@ai-sdk/openai-compatible',
      options: { apiKey: 'config-secret' }
    }
    const [draft] = providerConfigToDrafts({ provider: { demo: existing } })
    expect(draft.credential).toMatchObject({ mode: 'config', hasConfigValue: true, hasStoreValue: false })

    draft.credential.mode = 'store'
    expect(() => providerDraftToConfig(draft, existing)).toThrow('credential store')

    draft.credential.value = 'new-store-secret'
    expect(providerDraftToConfig(draft, existing)).not.toHaveProperty('options.apiKey')
  })

  it('tracks runtime connectivity and credential-store values independently', () => {
    const [connectedByEnvironment] = providerConfigToDrafts(
      { provider: { demo: { npm: '@ai-sdk/openai-compatible' } } },
      { connectedProviderIds: new Set(['demo']) }
    )
    expect(connectedByEnvironment.credential).toMatchObject({
      mode: 'none',
      connected: true,
      hasStoreValue: false
    })
    connectedByEnvironment.credential.mode = 'store'
    expect(() => providerDraftToConfig(connectedByEnvironment)).toThrow('credential store')

    const [stored] = providerConfigToDrafts(
      { provider: { demo: { npm: '@ai-sdk/openai-compatible' } } },
      { storedCredentialProviderIds: new Set(['demo']) }
    )
    expect(stored.credential).toMatchObject({
      mode: 'store',
      initialMode: 'store',
      connected: false,
      hasStoreValue: true
    })
    expect(() => providerDraftToConfig(stored)).not.toThrow()
  })

  it('deletes a stored credential only after an explicit source change', () => {
    const [configWithBackupStore] = providerConfigToDrafts(
      { provider: { demo: { options: { apiKey: 'config-secret' } } } },
      { storedCredentialProviderIds: new Set(['demo']) }
    )
    expect(configWithBackupStore.credential).toMatchObject({
      mode: 'config',
      initialMode: 'config',
      hasStoreValue: true
    })
    expect(shouldDeleteStoredProviderCredential(configWithBackupStore)).toBe(false)

    const [stored] = providerConfigToDrafts(
      { provider: { demo: {} } },
      { storedCredentialProviderIds: new Set(['demo']) }
    )
    stored.credential.mode = 'none'
    expect(shouldDeleteStoredProviderCredential(stored)).toBe(true)
  })

  it('accepts schema-valid provider IDs and the runtime adapter fallback', () => {
    const [draft] = providerConfigToDrafts({ provider: { '自定义 provider': {} } })
    draft.npm = ''
    expect(providerDraftToConfig(draft)).toEqual({})

    draft.id = '__proto__'
    expect(() => providerDraftToConfig(draft)).toThrow('保留的 JSON 属性名')
  })
})
