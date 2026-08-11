import { encodeOpencodeDirectory } from './opencodeDirectory';

export interface OpencodeServeEndpoint {
  baseUrl: string;
}

export interface OpencodeServeRequestOptions {
  method?: string;
  body?: string;
  includeCwd?: boolean;
  cwd?: string;
  signal?: AbortSignal;
}

type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export interface OpencodeServeClientOptions {
  ensureRuntime(): Promise<OpencodeServeEndpoint>;
  getDefaultCwd?(): string | undefined;
  fetch?: FetchImplementation;
}

export class OpencodeServeClient {
  public constructor(private readonly options: OpencodeServeClientOptions) {}

  public async requestJson<T>(
    pathname: string,
    options?: OpencodeServeRequestOptions
  ): Promise<T> {
    const response = await this.request(pathname, options, {
      'Content-Type': 'application/json'
    });
    return (await response.json()) as T;
  }

  public async requestNoContent(
    pathname: string,
    options?: OpencodeServeRequestOptions
  ): Promise<void> {
    await this.request(pathname, options, {
      'Content-Type': 'application/json'
    });
  }

  public async openEventStream(
    endpoint: OpencodeServeEndpoint,
    signal: AbortSignal
  ): Promise<ReadableStream<Uint8Array>> {
    const response = await this.fetch(`${endpoint.baseUrl}/event`, {
      headers: this.buildHeaders({ Accept: 'text/event-stream' }),
      signal
    });
    if (!response.ok || !response.body) {
      throw new Error(`订阅事件流失败（${String(response.status)}）。`);
    }
    return response.body;
  }

  private async request(
    pathname: string,
    options: OpencodeServeRequestOptions | undefined,
    headers: Record<string, string>
  ): Promise<Response> {
    const runtime = await this.options.ensureRuntime();
    const init: RequestInit = {
      headers: this.buildHeaders(headers, options)
    };
    if (options && 'method' in options) {
      init.method = options.method;
    }
    if (options && 'body' in options) {
      init.body = options.body;
    }
    if (options && 'signal' in options) {
      init.signal = options.signal;
    }

    const response = await this.fetch(`${runtime.baseUrl}${pathname}`, init);
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(
        text.trim().length > 0
          ? text.trim()
          : `OpenCode serve 请求失败（${String(response.status)}）。`
      );
    }
    return response;
  }

  private buildHeaders(
    extra: Record<string, string>,
    options?: OpencodeServeRequestOptions
  ): Record<string, string> {
    const headers = { ...extra };
    const cwd = options?.includeCwd === false
      ? undefined
      : options?.cwd ?? this.options.getDefaultCwd?.();
    if (cwd) {
      headers['x-opencode-directory'] = encodeOpencodeDirectory(cwd);
    }
    return headers;
  }

  private fetch(input: string, init: RequestInit): Promise<Response> {
    return (this.options.fetch ?? globalThis.fetch)(input, init);
  }
}
