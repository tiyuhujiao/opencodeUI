"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpencodeServeClient = void 0;
const opencodeDirectory_1 = require("./opencodeDirectory");
class OpencodeServeClient {
    constructor(options) {
        this.options = options;
    }
    async requestJson(pathname, options) {
        const response = await this.request(pathname, options, {
            'Content-Type': 'application/json'
        });
        return (await response.json());
    }
    async requestNoContent(pathname, options) {
        await this.request(pathname, options, {
            'Content-Type': 'application/json'
        });
    }
    async openEventStream(endpoint, signal) {
        const response = await this.fetch(`${endpoint.baseUrl}/event`, {
            headers: this.buildHeaders({ Accept: 'text/event-stream' }),
            signal
        });
        if (!response.ok || !response.body) {
            throw new Error(`订阅事件流失败（${String(response.status)}）。`);
        }
        return response.body;
    }
    async request(pathname, options, headers) {
        const runtime = await this.options.ensureRuntime();
        const init = {
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
            throw new Error(text.trim().length > 0
                ? text.trim()
                : `OpenCode serve 请求失败（${String(response.status)}）。`);
        }
        return response;
    }
    buildHeaders(extra, options) {
        const headers = { ...extra };
        const cwd = options?.includeCwd === false
            ? undefined
            : options?.cwd ?? this.options.getDefaultCwd?.();
        if (cwd) {
            headers['x-opencode-directory'] = (0, opencodeDirectory_1.encodeOpencodeDirectory)(cwd);
        }
        return headers;
    }
    fetch(input, init) {
        return (this.options.fetch ?? globalThis.fetch)(input, init);
    }
}
exports.OpencodeServeClient = OpencodeServeClient;
//# sourceMappingURL=opencodeServeClient.js.map