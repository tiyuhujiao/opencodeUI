import { encodeOpencodeDirectory } from './opencodeDirectory';
import {
  createOpencodeV2AdapterState,
  formatServeErrorBody,
  requestOpencodeV2Json,
  requestOpencodeV2NoContent
} from './opencodeV2Adapter';

export interface OpencodeServeEndpoint {
  baseUrl: string;
  apiVersion?: 'v1' | 'v2';
  password?: string;
  version?: string;
}

export interface OpencodeServeRequestOptions {
  method?: string;
  body?: string;
  includeCwd?: boolean;
  cwd?: string;
  signal?: AbortSignal;
  forceRefresh?: boolean;
}

type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export interface OpencodeServeClientOptions {
  ensureRuntime(cwd?: string): Promise<OpencodeServeEndpoint>;
  getDefaultCwd?(): string | undefined;
  fetch?: FetchImplementation;
}

export class OpencodeServeClient {
  private readonly v2AdapterState = createOpencodeV2AdapterState();

  public constructor(private readonly options: OpencodeServeClientOptions) {}

  public async requestJson<T>(
    pathname: string,
    options?: OpencodeServeRequestOptions
  ): Promise<T> {
    const cwd = this.resolveCwd(options);
    const runtime = await this.options.ensureRuntime(cwd);
    if (runtime.apiVersion === 'v2') {
      return (await requestOpencodeV2Json(
        this.v2AdapterState,
        this.fetch.bind(this),
        runtime,
        pathname,
        options,
        this.options.getDefaultCwd?.()
      )) as T;
    }
    const response = await this.requestWithRuntime(runtime, pathname, options, {
      'Content-Type': 'application/json'
    });
    return (await response.json()) as T;
  }

  public async requestNoContent(
    pathname: string,
    options?: OpencodeServeRequestOptions
  ): Promise<void> {
    const cwd = this.resolveCwd(options);
    const runtime = await this.options.ensureRuntime(cwd);
    if (runtime.apiVersion === 'v2') {
      await requestOpencodeV2NoContent(
        this.v2AdapterState,
        this.fetch.bind(this),
        runtime,
        pathname,
        options,
        this.options.getDefaultCwd?.()
      );
      return;
    }
    await this.requestWithRuntime(runtime, pathname, options, {
      'Content-Type': 'application/json'
    });
  }

  public async openEventStream(
    endpoint: OpencodeServeEndpoint,
    signal: AbortSignal
  ): Promise<ReadableStream<Uint8Array>> {
    const eventPath = endpoint.apiVersion === 'v2' ? '/api/event' : '/event';
    const response = await this.fetch(`${endpoint.baseUrl}${eventPath}`, {
      headers: this.buildHeaders(
        { Accept: 'text/event-stream' },
        this.options.getDefaultCwd?.(),
        endpoint
      ),
      signal
    });
    if (!response.ok || !response.body) {
      if (response.ok) {
        throw new Error('订阅事件流失败：服务器没有返回事件流。');
      }
      const text = await response.text().catch(() => '');
      if (text.trim().length === 0) {
        throw new Error(`订阅事件流失败（${String(response.status)}）。`);
      }
      const detail = formatServeErrorBody(text, response.status);
      const hint = response.status === 401
        ? '服务器要求认证，请确认 OPENCODE_PASSWORD 与服务器一致。'
        : '';
      throw new Error(`订阅事件流失败（${String(response.status)}）：${detail}${hint}`);
    }
    return response.body;
  }

  public async getRuntime(cwd?: string): Promise<OpencodeServeEndpoint> {
    return this.options.ensureRuntime(cwd ?? this.options.getDefaultCwd?.());
  }

  public async isV2(cwd?: string): Promise<boolean> {
    const runtime = await this.getRuntime(cwd);
    return runtime?.apiVersion === 'v2';
  }

  public invalidateProviderCache(): void {
    this.v2AdapterState.providerCache.clear();
  }

  private async requestWithRuntime(
    runtime: OpencodeServeEndpoint,
    pathname: string,
    options: OpencodeServeRequestOptions | undefined,
    headers: Record<string, string>
  ): Promise<Response> {
    const cwd = this.resolveCwd(options);
    const init: RequestInit = {
      headers: this.buildHeaders(headers, cwd, runtime)
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
      throw new Error(formatServeErrorBody(text, response.status));
    }
    return response;
  }

  private buildHeaders(
    extra: Record<string, string>,
    cwd: string | undefined,
    runtime?: OpencodeServeEndpoint
  ): Record<string, string> {
    const headers = { ...extra };
    if (cwd) {
      headers['x-opencode-directory'] = encodeOpencodeDirectory(cwd);
    }
    if (runtime?.password) {
      headers.authorization = `Basic ${Buffer.from(`opencode:${runtime.password}`).toString('base64')}`;
    }
    return headers;
  }

  private resolveCwd(options?: OpencodeServeRequestOptions): string | undefined {
    if (options?.includeCwd === false) {
      return undefined;
    }
    return options?.cwd ?? this.options.getDefaultCwd?.();
  }

  private fetch(
    input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> {
    return (this.options.fetch ?? globalThis.fetch)(input, init);
  }
}
