import { describe, expect, it, vi } from 'vitest';
import {
  createOpencodeV2AdapterState,
  formatServeErrorBody,
  requestOpencodeV2Json
} from '../src/bridge/opencodeV2Adapter';

const endpoint = {
  baseUrl: 'http://127.0.0.1:4096',
  password: 'secret'
};

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function call(
  fetchMock: ReturnType<typeof vi.fn>,
  pathname: string,
  options: {
    method?: string;
    body?: string;
    includeCwd?: boolean;
    cwd?: string;
  } = {}
) {
  return requestOpencodeV2Json(
    createOpencodeV2AdapterState(),
    fetchMock as never,
    endpoint,
    pathname,
    {
      method: options.method ?? 'GET',
      body: options.body,
      includeCwd: options.includeCwd ?? true,
      cwd: options.cwd ?? '/workspace'
    },
    options.cwd ?? '/workspace'
  );
}

describe('OpenCode V2 adapter', () => {
  it('binds a new session to the request directory through the V2 payload', async () => {
    const fetched: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        fetched.push({ url: String(input), init });
        return json({
          data: {
            id: 'ses_created',
            projectID: 'project',
            title: 'Created',
            time: { created: 1_000, updated: 1_000 },
            location: { directory: '/workspace' }
          }
        });
      }
    );

    const result = await call(fetchMock, '/session', {
      method: 'POST',
      body: JSON.stringify({ title: 'Created' })
    });

    expect(result).toMatchObject({
      id: 'ses_created',
      directory: '/workspace'
    });
    expect(fetched).toHaveLength(1);
    expect(new URL(fetched[0]!.url).pathname).toBe('/api/session');
    expect(JSON.parse(String(fetched[0]!.init?.body))).toEqual({
      title: 'Created',
      location: { directory: '/workspace' }
    });
  });

  it('adds Basic auth, filters sessions by directory, and follows pagination cursors', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      expect(url.searchParams.get('directory')).toBe('/workspace');
      expect(url.searchParams.get('archived')).toBe('false');
      if (url.searchParams.get('cursor') === 'older') {
        return json({
          data: [
            {
              id: 'ses_older',
              projectID: 'project',
              title: 'Older',
              time: { created: 1_000, updated: 2_000 },
              location: { directory: '/workspace' }
            }
          ],
          cursor: {}
        });
      }
      expect(url.searchParams.get('order')).toBe('desc');
      return json({
        data: [
          {
            id: 'ses_newer',
            projectID: 'project',
            title: 'Newer',
            time: { created: 3_000, updated: 4_000 },
            location: { directory: '/workspace' }
          }
        ],
        cursor: { next: 'older' }
      });
    });

    const result = await call(fetchMock, '/session');

    expect(result).toEqual([
      expect.objectContaining({
        id: 'ses_newer',
        projectId: 'project',
        directory: '/workspace',
        updated: new Date(4_000).toISOString()
      }),
      expect.objectContaining({ id: 'ses_older' })
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(firstInit.headers).toMatchObject({
      authorization: `Basic ${Buffer.from('opencode:secret').toString('base64')}`,
      'x-opencode-directory': encodeURIComponent('/workspace')
    });
  });

  it('normalizes V2 transcript messages into the existing info/parts contract', async () => {
    const fetchMock = vi.fn(async () =>
      json({
        data: [
          {
            id: 'msg_assistant',
            type: 'assistant',
            agent: 'build',
            model: { providerID: 'openai', id: 'gpt-5' },
            finish: 'stop',
            cost: 0,
            tokens: {
              input: 4,
              output: 2,
              reasoning: 1,
              cache: { read: 3, write: 0 }
            },
            time: { created: 11, streamed: 12, completed: 13 },
            content: [
              { type: 'reasoning', text: 'Think first' },
              { type: 'text', text: 'Done' },
              {
                type: 'tool',
                id: 'tool_1',
                name: 'read',
                state: {
                  status: 'completed',
                  input: { filePath: '/workspace/a.ts' },
                  content: [{ type: 'text', text: 'file body' }]
                },
                time: { created: 12, completed: 13 }
              }
            ]
          },
          {
            id: 'msg_user',
            type: 'user',
            text: 'Inspect this file',
            files: [{ uri: 'file:///workspace/a.ts', name: 'a.ts' }],
            time: { created: 10 }
          }
        ],
        cursor: {}
      })
    );

    const result = await call(fetchMock, '/session/ses_1/message');

    expect(result).toEqual([
      {
        info: expect.objectContaining({
          id: 'msg_user',
          sessionID: 'ses_1',
          role: 'user'
        }),
        parts: expect.arrayContaining([
          expect.objectContaining({ type: 'file', filename: 'a.ts' }),
          expect.objectContaining({ type: 'text', text: 'Inspect this file' })
        ])
      },
      {
        info: expect.objectContaining({
          id: 'msg_assistant',
          parentID: 'msg_user',
          role: 'assistant',
          providerID: 'openai',
          modelID: 'gpt-5',
          time: expect.objectContaining({ completed: 13 })
        }),
        parts: expect.arrayContaining([
          expect.objectContaining({ type: 'reasoning', text: 'Think first' }),
          expect.objectContaining({ type: 'text', text: 'Done' }),
          expect.objectContaining({
            type: 'tool',
            tool: 'read',
            state: expect.objectContaining({
              status: 'completed',
              output: 'file body'
            })
          })
        ])
      }
    ]);
  });

  it('switches agent and model before admitting prompt input', async () => {
    const requests: Array<{ path: string; body?: string }> = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      requests.push({
        path: url.pathname,
        ...(typeof init?.body === 'string' ? { body: init.body } : {})
      });
      if (url.pathname.endsWith('/agent') || url.pathname.endsWith('/model')) {
        return new Response(null, { status: 204 });
      }
      return json({
        data: {
          id: 'msg_queued',
          sessionID: 'ses_1',
          type: 'user'
        }
      });
    });

    await call(fetchMock, '/session/ses_1/prompt_async', {
      method: 'POST',
      body: JSON.stringify({
        messageID: 'msg_queued',
        agent: 'plan',
        model: { providerID: 'openai', modelID: 'gpt-5' },
        variant: 'high',
        parts: [
          { type: 'text', text: 'Continue' },
          {
            type: 'file',
            url: 'file:///workspace/a.ts',
            filename: 'a.ts',
            mime: 'text/plain'
          }
        ]
      })
    });

    expect(requests.map((request) => request.path)).toEqual([
      '/api/session/ses_1/agent',
      '/api/session/ses_1/model',
      '/api/session/ses_1/prompt'
    ]);
    expect(JSON.parse(requests[2]?.body ?? '{}')).toEqual({
      id: 'msg_queued',
      text: 'Continue',
      files: [
        {
          uri: 'file:///workspace/a.ts',
          name: 'a.ts',
          description: 'text/plain'
        }
      ],
      delivery: 'queue'
    });
  });

  it('maps session-scoped permission and question replies', async () => {
    const requests: Array<{ path: string; method: string; body?: string }> = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      requests.push({
        path: url.pathname + url.search,
        method: init?.method ?? 'GET',
        ...(typeof init?.body === 'string' ? { body: init.body } : {})
      });
      if (url.pathname.endsWith('/form/frm_1')) {
        return json({
          data: {
            id: 'frm_1',
            sessionID: 'ses_1',
            fields: [
              { key: 'authorization', type: 'external' },
              { key: 'q0', type: 'string' },
              { key: 'enabled', type: 'boolean' },
              { key: 'q1', type: 'multiselect' }
            ]
          }
        });
      }
      return new Response(null, { status: 204 });
    });

    await call(fetchMock, '/permission/per_1/reply?sessionID=ses_1', {
      method: 'POST',
      body: JSON.stringify({ reply: 'once' })
    });
    await call(fetchMock, '/question/frm_1/reply?sessionID=ses_1', {
      method: 'POST',
      body: JSON.stringify({ answers: [['Yes'], ['A', 'B']] })
    });

    expect(requests).toEqual([
      {
        path: '/api/session/ses_1/permission/per_1/reply',
        method: 'POST',
        body: JSON.stringify({ decision: 'once' })
      },
      {
        path: '/api/session/ses_1/form/frm_1',
        method: 'GET'
      },
      {
        path: '/api/session/ses_1/form/frm_1/reply',
        method: 'POST',
        body: JSON.stringify({ answer: { q0: 'Yes', q1: ['A', 'B'] } })
      }
    ]);
  });

  it('finds question forms through their nested metadata', async () => {
    const fetchMock = vi.fn(async () =>
      json({
        data: [
          {
            id: 'frm_question',
            sessionID: 'ses_1',
            title: 'Questions',
            metadata: { kind: 'question' },
            fields: [
              {
                key: 'q0',
                type: 'string',
                title: 'Choose',
                description: 'Which option?',
                options: [{ value: 'one', label: 'One' }]
              }
            ]
          },
          {
            id: 'frm_other',
            sessionID: 'ses_1',
            title: 'Other',
            metadata: { kind: 'other' },
            fields: []
          }
        ]
      })
    );

    await expect(call(fetchMock, '/question')).resolves.toEqual([
      expect.objectContaining({
        id: 'frm_question',
        sessionID: 'ses_1',
        questions: [
          expect.objectContaining({
            header: 'Choose',
            question: 'Which option?'
          })
        ]
      })
    ]);
  });

  it('answers only active conditional form fields', async () => {
    const requests: Array<{ path: string; body?: string }> = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      requests.push({
        path,
        ...(typeof init?.body === 'string' ? { body: init.body } : {})
      });
      if (path.endsWith('/form/frm_conditional')) {
        return json({
          data: {
            id: 'frm_conditional',
            sessionID: 'ses_1',
            fields: [
              { key: 'mode', type: 'string' },
              {
                key: 'detail',
                type: 'string',
                when: [{ key: 'mode', op: 'eq', value: 'advanced' }]
              },
              {
                key: 'note',
                type: 'string',
                when: [{ key: 'mode', op: 'neq', value: 'advanced' }]
              }
            ]
          }
        });
      }
      return new Response(null, { status: 204 });
    });

    await call(fetchMock, '/question/frm_conditional/reply?sessionID=ses_1', {
      method: 'POST',
      body: JSON.stringify({ answers: [['simple'], ['lost detail'], ['visible note']] })
    });

    expect(JSON.parse(requests[1]!.body!)).toEqual({
      answer: {
        mode: 'simple',
        note: 'visible note'
      }
    });
  });

  it('maps V2 MCP controls and location reload to their native endpoints', async () => {
    const requests: Array<{ path: string; method: string }> = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({
        path: new URL(String(input)).pathname,
        method: init?.method ?? 'GET'
      });
      return new Response(null, { status: 204 });
    });

    await call(fetchMock, '/mcp/playwright/connect', { method: 'POST' });
    await call(fetchMock, '/mcp/playwright/disconnect', { method: 'POST' });
    await call(fetchMock, '/config/reload', { method: 'POST' });

    expect(requests).toEqual([
      {
        path: '/api/experimental/mcp/playwright/connect',
        method: 'POST'
      },
      {
        path: '/api/experimental/mcp/playwright/disconnect',
        method: 'POST'
      },
      {
        path: '/api/location/reload',
        method: 'POST'
      }
    ]);
  });

  it('normalizes provider models without forwarding provider secrets', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/provider') {
        return json({
          location: { directory: '/workspace' },
          data: [
            {
              id: 'openai',
              name: 'OpenAI',
              activation: 'enabled',
              package: '@opencode/ai/openai',
              settings: { apiKey: 'must-not-leak' }
            }
          ]
        });
      }
      if (path === '/api/model') {
        return json({
          location: { directory: '/workspace' },
          data: [
            {
              id: 'gpt-5',
              providerID: 'openai',
              name: 'GPT-5',
              capabilities: {
                tools: true,
                input: ['text', 'image'],
                output: ['text']
              },
              variants: [{ id: 'high', settings: { reasoningEffort: 'high' } }],
              time: { released: 1 },
              cost: [{ input: 1, output: 2, cache: { read: 0.1, write: 0.2 } }],
              status: 'active',
              limit: { context: 100_000, output: 10_000 }
            }
          ]
        });
      }
      if (path === '/api/integration') {
        return json({
          location: { directory: '/workspace' },
          data: [
            {
              id: 'openai',
              name: 'OpenAI',
              methods: [{ type: 'key' }],
              connections: [{ type: 'credential', method: 'key' }]
            }
          ]
        });
      }
      throw new Error(`Unexpected path ${path}`);
    });

    const result = await call(fetchMock, '/provider');
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain('must-not-leak');
    expect(result).toMatchObject({
      all: [
        {
          id: 'openai',
          name: 'OpenAI',
          models: {
            'gpt-5': expect.objectContaining({
              variants: {
                high: { reasoningEffort: 'high' }
              }
            })
          }
        }
      ]
    });
  });

  it('normalizes V2 agents and drops hidden agents', async () => {
    const fetchMock = vi.fn(async () =>
      json({
        data: [
          {
            id: 'build',
            name: 'Build',
            mode: 'primary',
            description: 'The default agent.'
          },
          {
            id: 'general',
            name: 'General',
            mode: 'subagent'
          },
          {
            id: 'hidden',
            name: 'Hidden',
            mode: 'primary',
            hidden: true
          }
        ]
      })
    );

    await expect(call(fetchMock, '/agent')).resolves.toEqual([
      {
        id: 'build',
        name: 'build',
        displayName: 'Build',
        isPrimary: true,
        description: 'The default agent.'
      },
      {
        id: 'general',
        name: 'general',
        displayName: 'General',
        isPrimary: false,
        description: ''
      }
    ]);
  });

  it('distinguishes built-in and custom providers and scopes auth methods', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/provider') {
        return json({
          data: [
            {
              id: 'openai',
              name: 'OpenAI',
              activation: 'enabled',
              integrationID: 'openai',
              package: '@opencode/ai/providers/openai',
              settings: { baseURL: 'https://api.openai.com/v1' }
            },
            {
              id: 'my-custom',
              name: 'My Custom',
              activation: 'enabled',
              package: '@ai-sdk/openai-compatible',
              settings: { baseURL: 'https://custom.test/v1' }
            }
          ]
        });
      }
      if (path === '/api/model') return json({ data: [] });
      if (path === '/api/integration') {
        return json({
          data: [
            { id: 'openai', methods: [{ type: 'key' }], connections: [] },
            { id: 'my-custom', methods: [{ type: 'key' }], connections: [] }
          ]
        });
      }
      throw new Error(`Unexpected path ${path}`);
    });

    const providers = (await call(fetchMock, '/provider')) as {
      all: Array<Record<string, unknown>>;
    };
    expect(providers.all).toEqual([
      expect.objectContaining({
        id: 'openai',
        source: 'builtin',
        api: 'https://api.openai.com/v1'
      }),
      expect.objectContaining({
        id: 'my-custom',
        source: 'config',
        api: 'https://custom.test/v1'
      })
    ]);

    const auth = (await call(fetchMock, '/provider/auth')) as Record<
      string,
      unknown
    >;
    expect(Object.keys(auth)).toEqual(['openai']);
  });

  it('keeps the provider location when includeCwd is false', async () => {
    const requests: Array<{
      path: string;
      headers?: Record<string, string>;
    }> = [];
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const path = new URL(String(input)).pathname;
        requests.push({
          path,
          headers: init?.headers as Record<string, string> | undefined
        });
        if (path === '/api/provider') {
          return json({ data: [{ id: 'my-custom', name: 'My Custom' }] });
        }
        if (path === '/api/model') return json({ data: [] });
        if (path === '/api/integration') return json({ data: [] });
        throw new Error(`Unexpected path ${path}`);
      }
    );

    await call(fetchMock, '/provider/auth', { includeCwd: false });

    expect(requests).toHaveLength(3);
    for (const request of requests) {
      expect(request.headers?.['x-opencode-directory']).toBe(
        encodeURIComponent('/workspace')
      );
    }
  });

  it('does not treat time.streamed as a completion time', async () => {
    const fetchMock = vi.fn(async () =>
      json({
        data: [
          {
            id: 'msg_assistant',
            type: 'assistant',
            content: [{ type: 'text', text: 'Hello' }],
            time: { created: 2, streamed: 3 }
          },
          {
            id: 'msg_user',
            type: 'user',
            text: 'Hi',
            time: { created: 1 }
          }
        ],
        cursor: {}
      })
    );

    const result = (await call(
      fetchMock,
      '/session/ses_1/message'
    )) as Array<{ info: { time: Record<string, unknown> } }>;
    expect(result[1]?.info.time.completed).toBeUndefined();
    expect(result[1]?.info.time.streamed).toBe(3);
  });

  it('skips hidden question fields and defaults custom input to enabled', async () => {
    const fetchMock = vi.fn(async () =>
      json({
        data: [
          {
            id: 'frm_question',
            sessionID: 'ses_1',
            metadata: { kind: 'question' },
            fields: [
              {
                key: 'q0',
                type: 'string',
                title: 'Choose',
                description: 'Which option?',
                options: [{ value: 'one', label: 'One' }]
              },
              {
                key: 'hidden',
                type: 'string',
                title: 'Hidden',
                description: 'Internal',
                hidden: true
              },
              {
                key: 'q1',
                type: 'multiselect',
                title: 'Multi',
                description: 'Pick several',
                custom: false
              }
            ]
          }
        ]
      })
    );

    const result = (await call(fetchMock, '/question')) as Array<{
      questions: unknown[];
    }>;
    expect(result[0]?.questions).toEqual([
      {
        header: 'Choose',
        question: 'Which option?',
        options: [{ label: 'One', description: 'One' }],
        multiple: false,
        custom: true
      },
      {
        header: 'Multi',
        question: 'Pick several',
        options: [],
        multiple: true,
        custom: false
      }
    ]);
  });

  it('polls auto OAuth until the attempt completes', async () => {
    vi.useFakeTimers();
    try {
      const state = createOpencodeV2AdapterState();
      let statusCalls = 0;
      const fetchMock = vi.fn(async (input: string | URL | Request) => {
        const path = new URL(String(input)).pathname;
        if (path === '/api/provider') {
          return json({
            data: [
              {
                id: 'openai',
                integrationID: 'openai',
                activation: 'auto',
                package: '@opencode/ai/providers/openai'
              }
            ]
          });
        }
        if (path === '/api/model') return json({ data: [] });
        if (path === '/api/integration') {
          return json({
            data: [
              {
                id: 'openai',
                methods: [{ type: 'oauth', id: 'm1', label: 'Sign in' }],
                connections: []
              }
            ]
          });
        }
        if (path === '/api/integration/openai/connect/oauth') {
          return json({
            data: { attemptID: 'con_1', url: 'https://auth.test', mode: 'auto' }
          });
        }
        if (path === '/api/integration/openai/connect/oauth/con_1') {
          statusCalls += 1;
          return json({
            data: { status: statusCalls < 3 ? 'pending' : 'complete' }
          });
        }
        throw new Error(`Unexpected path ${path}`);
      });
      const options = {
        method: 'POST',
        body: JSON.stringify({ method: 0 }),
        includeCwd: true,
        cwd: '/workspace'
      };

      await expect(
        requestOpencodeV2Json(
          state,
          fetchMock as never,
          endpoint,
          '/provider/openai/oauth/authorize',
          options,
          '/workspace'
        )
      ).resolves.toMatchObject({
        url: 'https://auth.test',
        method: 'auto'
      });

      const callback = requestOpencodeV2Json(
        state,
        fetchMock as never,
        endpoint,
        '/provider/openai/oauth/callback',
        options,
        '/workspace'
      );
      await vi.advanceTimersByTimeAsync(2_000);
      await expect(callback).resolves.toBe(true);
      expect(statusCalls).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('honors forceRefresh for provider snapshots', async () => {
    const state = createOpencodeV2AdapterState();
    let providerCalls = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/provider') {
        providerCalls += 1;
        return json({ data: [{ id: 'openai', name: 'OpenAI' }] });
      }
      if (path === '/api/model') return json({ data: [] });
      if (path === '/api/integration') return json({ data: [] });
      throw new Error(`Unexpected path ${path}`);
    });
    const callProvider = (forceRefresh: boolean) =>
      requestOpencodeV2Json(
        state,
        fetchMock as never,
        endpoint,
        '/provider',
        { method: 'GET', includeCwd: true, cwd: '/workspace', forceRefresh },
        '/workspace'
      );

    await callProvider(false);
    await callProvider(false);
    expect(providerCalls).toBe(1);
    await callProvider(true);
    expect(providerCalls).toBe(2);
  });

  it('retries a provider list that is still settling', async () => {
    vi.useFakeTimers();
    try {
      const state = createOpencodeV2AdapterState();
      let providerCalls = 0;
      const fetchMock = vi.fn(async (input: string | URL | Request) => {
        const path = new URL(String(input)).pathname;
        if (path === '/api/provider') {
          providerCalls += 1;
          return json({
            data: providerCalls >= 2 ? [{ id: 'openai', name: 'OpenAI' }] : []
          });
        }
        if (path === '/api/model') return json({ data: [] });
        if (path === '/api/integration') return json({ data: [] });
        throw new Error(`Unexpected path ${path}`);
      });

      const promise = requestOpencodeV2Json(
        state,
        fetchMock as never,
        endpoint,
        '/provider',
        { method: 'GET', includeCwd: true, cwd: '/workspace' },
        '/workspace'
      );
      await vi.advanceTimersByTimeAsync(1_000);
      const result = (await promise) as { all: unknown[] };
      expect(result.all).toHaveLength(1);
      expect(providerCalls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('surfaces non-question interactive forms and cancels the ones it cannot answer', async () => {
    const requested: Array<{ path: string; method: string; search: string }> = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      requested.push({
        path: url.pathname,
        method: init?.method ?? 'GET',
        search: url.search
      });
      if (url.pathname === '/api/form') {
        return json({
          data: [
            {
              id: 'frm_websearch',
              sessionID: 'ses_1',
              title: 'Web Search',
              metadata: { kind: 'websearch.provider' },
              fields: [
                {
                  key: 'choice',
                  type: 'string',
                  description: 'Allow OpenCode to search the web?',
                  required: true,
                  custom: false,
                  options: [
                    { value: 'allow', label: 'Allow search' },
                    { value: 'disable', label: 'Disable web search' }
                  ]
                }
              ]
            },
            {
              id: 'frm_external',
              sessionID: 'ses_1',
              title: 'Authorize',
              metadata: { kind: 'mcp-elicitation' },
              fields: [{ key: 'url', type: 'external', url: 'https://example.com' }]
            }
          ]
        });
      }
      return new Response(null, { status: 204 });
    });

    const result = (await call(fetchMock, '/question')) as Array<{
      id: string;
      metadata: { kind: string };
      questions: Array<{ header: string; options: Array<{ label: string }> }>;
    }>;

    expect(result).toEqual([
      expect.objectContaining({
        id: 'frm_websearch',
        metadata: expect.objectContaining({ kind: 'websearch.provider' }),
        questions: [
          expect.objectContaining({
            header: 'choice',
            options: [
              { label: 'Allow search', description: 'Allow search' },
              { label: 'Disable web search', description: 'Disable web search' }
            ]
          })
        ]
      })
    ]);
    expect(requested).toContainEqual(
      expect.objectContaining({
        path: '/api/session/ses_1/form/frm_external',
        method: 'DELETE'
      })
    );
  });

  it('submits option values instead of their rendered labels', async () => {
    const bodies: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/session/ses_1/form/frm_web') {
        return json({
          data: {
            id: 'frm_web',
            sessionID: 'ses_1',
            fields: [
              {
                key: 'choice',
                type: 'string',
                options: [
                  { value: 'allow', label: 'Allow search' },
                  { value: 'disable', label: 'Disable web search' }
                ]
              }
            ]
          }
        });
      }
      if (typeof init?.body === 'string') {
        bodies.push(init.body);
      }
      return new Response(null, { status: 204 });
    });

    await call(fetchMock, '/question/frm_web/reply?sessionID=ses_1', {
      method: 'POST',
      body: JSON.stringify({ answers: [['Disable web search']] })
    });

    expect(JSON.parse(bodies[0]!)).toEqual({ answer: { choice: 'disable' } });
  });

  it('turns V2 JSON error bodies into readable messages', () => {
    expect(
      formatServeErrorBody(
        JSON.stringify({ _tag: 'UnauthorizedError', message: 'Authentication required' }),
        401
      )
    ).toBe('Authentication required');
    expect(
      formatServeErrorBody(
        JSON.stringify({ _tag: 'InvalidRequestError', message: 'Invalid location', field: 'location' }),
        400
      )
    ).toBe('Invalid location（location）');
    expect(formatServeErrorBody('plain failure', 500)).toBe('plain failure');
    expect(formatServeErrorBody('   ', 502)).toBe('OpenCode serve 请求失败（502）。');
  });
});
