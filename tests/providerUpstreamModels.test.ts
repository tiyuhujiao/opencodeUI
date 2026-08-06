import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { providerConfigToDrafts } from '../src/providerSettings';
import {
  fetchProviderUpstreamModels,
  normalizeUpstreamModels
} from '../src/providerUpstreamModels';

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((target) => fs.promises.rm(target, { recursive: true, force: true })));
});

describe('provider upstream models', () => {
  it('normalizes OpenAI, Google-style and string model lists', () => {
    expect(normalizeUpstreamModels({
      data: [
        { id: 'gpt-a', owned_by: 'vendor', created: 1_700_000_000, context_window: 128_000 },
        { id: 'gpt-a', name: 'duplicate' },
        'gpt-b'
      ]
    })).toMatchObject([
      { id: 'gpt-a', name: 'gpt-a', ownedBy: 'vendor', contextWindow: 128_000 },
      { id: 'gpt-b', name: 'gpt-b' }
    ]);

    expect(normalizeUpstreamModels({
      models: [{ name: 'models/gemini-test', displayName: 'Gemini Test', inputTokenLimit: 32_000, outputTokenLimit: 8_000 }]
    })).toEqual([
      expect.objectContaining({
        id: 'models/gemini-test',
        name: 'Gemini Test',
        contextWindow: 32_000,
        maxOutputTokens: 8_000
      })
    ]);
  });

  it('uses stored credentials and hidden configured headers only after an explicit fetch call', async () => {
    const home = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'opencode-upstream-'));
    cleanup.push(home);
    const configDir = path.join(home, '.config', 'opencode');
    const authDir = path.join(home, '.local', 'share', 'opencode');
    await fs.promises.mkdir(configDir, { recursive: true });
    await fs.promises.mkdir(authDir, { recursive: true });
    const config = {
      provider: {
        custom: {
          npm: '@ai-sdk/openai-compatible',
          options: {
            baseURL: 'https://example.test/v1',
            headers: { 'x-tenant-token': 'tenant-secret' }
          },
          models: { existing: { name: 'Existing' } }
        }
      }
    };
    await fs.promises.writeFile(path.join(configDir, 'opencode.json'), JSON.stringify(config), 'utf8');
    await fs.promises.writeFile(
      path.join(authDir, 'auth.json'),
      JSON.stringify({ custom: { type: 'api', key: 'stored-secret' } }),
      'utf8'
    );
    const [draft] = providerConfigToDrafts(config, { storedCredentialProviderIds: new Set(['custom']) });
    expect(draft).toBeDefined();

    let requestCount = 0;
    let requestHeaders: Headers | undefined;
    const fetchImpl: typeof fetch = async (_input, init) => {
      requestCount += 1;
      requestHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify({ data: [{ id: 'new-model', name: 'New model' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    };

    expect(requestCount).toBe(0);
    const result = await fetchProviderUpstreamModels('global', draft!, 'https://example.test/v1/models', {
      homeDir: home,
      env: {},
      fetchImpl
    });

    expect(requestCount).toBe(1);
    expect(requestHeaders?.get('authorization')).toBe('Bearer stored-secret');
    expect(requestHeaders?.get('x-tenant-token')).toBe('tenant-secret');
    expect(result).toMatchObject({
      endpoint: 'https://example.test/v1/models',
      models: [{ id: 'new-model', name: 'New model' }]
    });
  });

  it('rejects credential-bearing URLs, redirects and oversized responses', async () => {
    const config = { provider: { custom: { options: {}, models: {} } } };
    const [draft] = providerConfigToDrafts(config);
    await expect(fetchProviderUpstreamModels('global', draft!, 'https://key@example.test/models', {
      fetchImpl: async () => new Response('{}')
    })).rejects.toThrow('without embedded credentials');

    await expect(fetchProviderUpstreamModels('global', draft!, 'https://example.test/models', {
      fetchImpl: async () => new Response('', { status: 302, headers: { location: 'https://other.test/models' } })
    })).rejects.toThrow('redirected');

    await expect(fetchProviderUpstreamModels('global', draft!, 'https://example.test/models', {
      maxResponseBytes: 4,
      fetchImpl: async () => new Response('12345')
    })).rejects.toThrow('exceeds');
  });
});
