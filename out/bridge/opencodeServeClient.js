"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpencodeServeClient = void 0;
const opencodeDirectory_1 = require("./opencodeDirectory");
const opencodeV2Adapter_1 = require("./opencodeV2Adapter");
class OpencodeServeClient {
    constructor(options) {
        this.options = options;
        this.v2AdapterState = (0, opencodeV2Adapter_1.createOpencodeV2AdapterState)();
    }
    async requestJson(pathname, options) {
        const cwd = this.resolveCwd(options);
        const runtime = await this.options.ensureRuntime(cwd);
        if (runtime.apiVersion === 'v2') {
            return (await (0, opencodeV2Adapter_1.requestOpencodeV2Json)(this.v2AdapterState, this.fetch.bind(this), runtime, pathname, options, this.options.getDefaultCwd?.()));
        }
        const response = await this.requestWithRuntime(runtime, pathname, options, {
            'Content-Type': 'application/json'
        });
        return (await response.json());
    }
    async requestNoContent(pathname, options) {
        const cwd = this.resolveCwd(options);
        const runtime = await this.options.ensureRuntime(cwd);
        if (runtime.apiVersion === 'v2') {
            await (0, opencodeV2Adapter_1.requestOpencodeV2NoContent)(this.v2AdapterState, this.fetch.bind(this), runtime, pathname, options, this.options.getDefaultCwd?.());
            return;
        }
        await this.requestWithRuntime(runtime, pathname, options, {
            'Content-Type': 'application/json'
        });
    }
    async openEventStream(endpoint, signal) {
        const eventPath = endpoint.apiVersion === 'v2' ? '/api/event' : '/event';
        const response = await this.fetch(`${endpoint.baseUrl}${eventPath}`, {
            headers: this.buildHeaders({ Accept: 'text/event-stream' }, this.options.getDefaultCwd?.(), endpoint),
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
            const detail = (0, opencodeV2Adapter_1.formatServeErrorBody)(text, response.status);
            const hint = response.status === 401
                ? '服务器要求认证，请确认 OPENCODE_PASSWORD 与服务器一致。'
                : '';
            throw new Error(`订阅事件流失败（${String(response.status)}）：${detail}${hint}`);
        }
        return response.body;
    }
    async getRuntime(cwd) {
        return this.options.ensureRuntime(cwd ?? this.options.getDefaultCwd?.());
    }
    async isV2(cwd) {
        const runtime = await this.getRuntime(cwd);
        return runtime?.apiVersion === 'v2';
    }
    invalidateProviderCache() {
        this.v2AdapterState.providerCache.clear();
    }
    async requestWithRuntime(runtime, pathname, options, headers) {
        const cwd = this.resolveCwd(options);
        const init = {
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
            throw new Error((0, opencodeV2Adapter_1.formatServeErrorBody)(text, response.status));
        }
        return response;
    }
    buildHeaders(extra, cwd, runtime) {
        const headers = { ...extra };
        if (cwd) {
            headers['x-opencode-directory'] = (0, opencodeDirectory_1.encodeOpencodeDirectory)(cwd);
        }
        if (runtime?.password) {
            headers.authorization = `Basic ${Buffer.from(`opencode:${runtime.password}`).toString('base64')}`;
        }
        return headers;
    }
    resolveCwd(options) {
        if (options?.includeCwd === false) {
            return undefined;
        }
        return options?.cwd ?? this.options.getDefaultCwd?.();
    }
    fetch(input, init) {
        return (this.options.fetch ?? globalThis.fetch)(input, init);
    }
}
exports.OpencodeServeClient = OpencodeServeClient;
//# sourceMappingURL=opencodeServeClient.js.map