"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.SidebarProvider = void 0;
exports.summarizeSessionTitle = summarizeSessionTitle;
exports.buildPromptParts = buildPromptParts;
exports.normalizePromptFilePath = normalizePromptFilePath;
exports.detectImageMimeType = detectImageMimeType;
const vscode = __importStar(require("vscode"));
const node_os_1 = require("node:os");
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const node_url_1 = require("node:url");
const opencodeCli_1 = require("../bridge/opencodeCli");
const serveManager_1 = require("../bridge/serveManager");
const opencodeEnv_1 = require("../bridge/opencodeEnv");
const opencodeCompatibility_1 = require("../bridge/opencodeCompatibility");
const diagnostics_1 = require("../diagnostics");
const parsers_1 = require("../bridge/parsers");
const protocol_1 = require("../shared/protocol");
const SESSION_EXPORT_CACHE_TTL_MS = 8000;
const EMPTY_SESSION_EXPORT_CACHE_TTL_MS = 750;
const MODELS_CACHE_TTL_MS = 15 * 60000;
const TEMPFILE_MAX_BYTES = 10 * 1024 * 1024;
const TEMPFILE_MAX_BASE64_CHARS = Math.ceil(TEMPFILE_MAX_BYTES / 3) * 4 + 4;
const TEMPFILE_TTL_MS = 30 * 60000;
const BLOCKER_POLL_INTERVAL_MS = 1500;
class SidebarProvider {
    constructor(extensionUri, workspaceState, hostKind, remoteName) {
        this.extensionUri = extensionUri;
        this.workspaceState = workspaceState;
        this.hostKind = hostKind;
        this.remoteName = remoteName;
        this.sessionExportCache = new Map();
        this.sessionExportInFlight = new Map();
        this.modelsCache = new Map();
        this.modelsInFlight = new Map();
        this.tempFiles = new Map();
    }
    isSupportedHost() {
        return this.hostKind !== 'unsupported';
    }
    getDefaultCwd() {
        try {
            return vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;
        }
        catch {
            return undefined;
        }
    }
    resolveWorkspaceFilePath(filePath) {
        const trimmed = filePath.trim();
        if (!trimmed) {
            throw new Error('文件路径为空。');
        }
        if (path.isAbsolute(trimmed) || path.win32.isAbsolute(trimmed) || path.posix.isAbsolute(trimmed)) {
            return trimmed;
        }
        const cwd = this.getDefaultCwd();
        if (!cwd) {
            throw new Error('当前没有打开的工作区，无法解析相对文件路径。');
        }
        return path.join(cwd, trimmed);
    }
    resolveWebviewView(webviewView) {
        this.view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')]
        };
        // Register message handler before setting HTML.
        // The webview app sends `webview.ready` immediately on load; if the handler
        // is attached after html assignment, the first message can be lost.
        webviewView.webview.onDidReceiveMessage((message) => {
            this.handleWebviewMessage(webviewView.webview, message);
        });
        const visibilityDisposable = webviewView.onDidChangeVisibility?.(() => {
            if (!webviewView.visible) {
                this.stopCurrentRunForHiddenPermission(webviewView.webview);
            }
        });
        webviewView.onDidDispose(() => {
            visibilityDisposable?.dispose();
            this.stopCurrentRunForHiddenPermission(webviewView.webview);
            this.stopCurrentRun();
            this.cleanupAllTempFiles();
        });
        webviewView.webview.html = this.getHtml(webviewView.webview);
    }
    refresh() {
        if (this.view) {
            this.view.webview.html = this.getHtml(this.view.webview);
        }
    }
    getNonce() {
        return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
    }
    respond(webview, message) {
        void webview.postMessage(message);
    }
    respondError(webview, requestId, error, fallback) {
        const errorMessage = error instanceof Error && error.message.trim().length > 0 ? error.message.trim() : fallback;
        (0, diagnostics_1.logError)(`${requestId}: ${errorMessage}`);
        this.respond(webview, {
            type: 'webview.error',
            requestId,
            ok: false,
            error: errorMessage
        });
    }
    handleWebviewMessage(webview, message) {
        try {
            const requestId = (0, protocol_1.getRequestIdFromUnknown)(message);
            if (!(0, protocol_1.isWebviewRequestMessage)(message)) {
                const type = typeof message === 'object' && message !== null ? message.type : undefined;
                if (requestId && (0, protocol_1.isWhitelistedWebviewRequestType)(type)) {
                    this.respond(webview, {
                        type: 'webview.error',
                        requestId,
                        ok: false,
                        error: 'Invalid message shape'
                    });
                }
                return;
            }
            switch (message.type) {
                case 'webview.ready': {
                    void this.handleWebviewReadyRequest(webview, message.requestId);
                    return;
                }
                case 'sessions.list':
                    void this.handleSessionsListRequest(webview, message.requestId);
                    return;
                case 'session.export':
                    void this.handleSessionExportRequest(webview, message.requestId, message.payload.sessionId);
                    return;
                case 'session.timeline':
                    void this.handleSessionTimelineRequest(webview, message.requestId, message.payload.sessionId);
                    return;
                case 'session.undo':
                    void this.handleSessionUndoRequest(webview, message.requestId, message.payload.sessionId);
                    return;
                case 'session.redo':
                    void this.handleSessionRedoRequest(webview, message.requestId, message.payload.sessionId);
                    return;
                case 'session.delete':
                    void this.handleSessionDeleteRequest(webview, message.requestId, message.payload.sessionId);
                    return;
                case 'permission.reply':
                    void this.handlePermissionReplyRequest(webview, message.requestId, message.payload.permissionId, message.payload.reply, message.payload.message);
                    return;
                case 'question.reply':
                    void this.handleQuestionReplyRequest(webview, message.requestId, message.payload.questionId, message.payload.answers);
                    return;
                case 'question.reject':
                    void this.handleQuestionRejectRequest(webview, message.requestId, message.payload.questionId);
                    return;
                case 'file.open':
                    void this.handleFileOpenRequest(webview, message.requestId, message.payload.path);
                    return;
                case 'tempfile.write':
                    void this.handleTempfileWriteRequest(webview, message.requestId, message.payload.fileName, message.payload.bytesBase64, message.payload.mimeType);
                    return;
                case 'models.list':
                    void this.handleModelsListRequest(webview, message.requestId, message.payload?.forceRefresh === true);
                    return;
                case 'providers.list':
                    void this.handleProvidersListRequest(webview, message.requestId, message.payload?.forceRefresh === true);
                    return;
                case 'models.list.byProvider':
                    void this.handleModelsListByProviderRequest(webview, message.requestId, message.payload.providerId, message.payload.forceRefresh === true);
                    return;
                case 'agents.list':
                    void this.handleAgentsListRequest(webview, message.requestId);
                    return;
                case 'selfcheck.run':
                    void this.handleSelfcheckRunRequest(webview, message.requestId);
                    return;
                case 'run.start':
                    void this.handleRunStartRequest(webview, message.requestId, message.payload);
                    return;
                case 'run.stop':
                    void this.handleRunStopRequest(webview, message.requestId);
                    return;
            }
        }
        catch (error) {
            const requestId = (0, protocol_1.getRequestIdFromUnknown)(message);
            if (!requestId) {
                return;
            }
            this.respondError(webview, requestId, error, '处理消息失败。');
        }
    }
    async handleWebviewReadyRequest(webview, requestId) {
        const lastSelectedModel = this.workspaceState.get(SidebarProvider.WORKSPACE_KEY_LAST_SELECTED_MODEL);
        const lastSelectedAgent = this.workspaceState.get(SidebarProvider.WORKSPACE_KEY_LAST_SELECTED_AGENT);
        const opencode = this.isSupportedHost() ? await this.getOpencodeCompatibility() : undefined;
        if (opencode?.warning) {
            (0, diagnostics_1.logWarn)(opencode.warning);
        }
        else if (opencode?.version) {
            (0, diagnostics_1.logInfo)(`opencode ${opencode.version} detected at ${opencode.binary}`);
        }
        this.respond(webview, {
            type: 'webview.ready.ack',
            requestId,
            ok: true,
            payload: {
                hostKind: this.hostKind,
                isSupportedHost: this.isSupportedHost(),
                remoteName: this.remoteName,
                workspaceFolderPath: this.getDefaultCwd(),
                lastSelectedModel,
                lastSelectedAgent,
                opencode
            }
        });
    }
    async handleSessionsListRequest(webview, requestId) {
        try {
            const parsed = await this.getSessionListForCurrentScopes();
            const sessions = (0, parsers_1.sortSessionsByUpdatedDesc)(parsed).map((session) => ({
                id: session.id,
                title: session.title,
                updated: session.updated
            }));
            this.respond(webview, {
                type: 'sessions.list.response',
                requestId,
                ok: true,
                payload: { sessions }
            });
        }
        catch (error) {
            this.respondError(webview, requestId, error, '获取 sessions 失败。');
        }
    }
    async getSessionListForCurrentScopes() {
        const cwd = this.getDefaultCwd();
        const scopedListTasks = [];
        let firstError;
        if (cwd) {
            scopedListTasks.push((async () => {
                const result = await (0, opencodeCli_1.sessionListJson)({ cwd });
                return (0, parsers_1.parseSessionListJson)(result.stdout);
            })());
        }
        scopedListTasks.push((async () => {
            const result = await (0, opencodeCli_1.sessionListJson)();
            return (0, parsers_1.parseSessionListJson)(result.stdout);
        })());
        const results = await Promise.allSettled(scopedListTasks);
        const scopedLists = [];
        for (const result of results) {
            if (result.status === 'fulfilled') {
                scopedLists.push(result.value);
            }
            else if (!firstError) {
                firstError = result.reason;
            }
        }
        if (scopedLists.length === 0) {
            throw firstError instanceof Error ? firstError : new Error('获取 sessions 失败。');
        }
        return (0, parsers_1.mergeSessionsById)(scopedLists);
    }
    async handleSessionExportRequest(webview, requestId, sessionId) {
        try {
            const [cachedExport, sessionInfo] = await Promise.all([
                this.getSessionExportData(sessionId),
                this.getSessionInfoForRead(sessionId)
            ]);
            const messages = this.getTranscriptFromSessionExport(cachedExport, sessionInfo);
            this.respond(webview, {
                type: 'session.export.response',
                requestId,
                ok: true,
                payload: { messages }
            });
        }
        catch (error) {
            this.respondError(webview, requestId, error, '获取 session export 失败。');
        }
    }
    async handleSessionDeleteRequest(webview, requestId, sessionId) {
        try {
            await (0, opencodeCli_1.sessionDelete)(sessionId, { timeoutMs: 60000 });
            this.invalidateSessionExportCache(sessionId);
            this.respond(webview, {
                type: 'session.delete.response',
                requestId,
                ok: true,
                payload: { deleted: true }
            });
        }
        catch (error) {
            this.respondError(webview, requestId, error, '删除 session 失败。');
        }
    }
    async handleSessionTimelineRequest(webview, requestId, sessionId) {
        try {
            const [cachedExport, sessionInfo] = await Promise.all([
                this.getSessionExportData(sessionId),
                this.getSessionInfoForRead(sessionId)
            ]);
            const items = this.getTimelineItemsFromSessionExport(cachedExport);
            const revertMessageId = typeof sessionInfo.revert?.messageID === 'string' ? sessionInfo.revert.messageID : undefined;
            this.respond(webview, {
                type: 'session.timeline.response',
                requestId,
                ok: true,
                payload: {
                    sessionId,
                    revertMessageId,
                    items
                }
            });
        }
        catch (error) {
            this.respondError(webview, requestId, error, '获取 session timeline 失败。');
        }
    }
    async handleSessionUndoRequest(webview, requestId, sessionId) {
        try {
            const payload = await this.computeUndoPayload(sessionId);
            if (!payload) {
                this.respond(webview, {
                    type: 'session.undo.response',
                    requestId,
                    ok: true,
                    payload: {
                        changed: false,
                        sessionId
                    }
                });
                return;
            }
            const updated = await this.requestServeJson(`/session/${encodeURIComponent(sessionId)}/revert`, {
                method: 'POST',
                body: JSON.stringify({ messageID: payload.messageId })
            });
            this.respond(webview, {
                type: 'session.undo.response',
                requestId,
                ok: true,
                payload: {
                    changed: true,
                    sessionId,
                    revertMessageId: typeof updated.revert?.messageID === 'string' ? updated.revert.messageID : undefined,
                    composerText: payload.composerText
                }
            });
        }
        catch (error) {
            this.respondError(webview, requestId, error, '执行 undo 失败。');
        }
    }
    async handleSessionRedoRequest(webview, requestId, sessionId) {
        try {
            const sessionInfo = await this.getSessionInfoForMutation(sessionId);
            if (!sessionInfo.revert?.messageID) {
                this.respond(webview, {
                    type: 'session.redo.response',
                    requestId,
                    ok: true,
                    payload: {
                        changed: false,
                        sessionId
                    }
                });
                return;
            }
            const [updated, composerText] = await Promise.all([
                this.requestServeJson(`/session/${encodeURIComponent(sessionId)}/unrevert`, {
                    method: 'POST',
                    body: JSON.stringify({})
                }),
                this.computeRedoComposerText(sessionId)
            ]);
            this.respond(webview, {
                type: 'session.redo.response',
                requestId,
                ok: true,
                payload: {
                    changed: true,
                    sessionId,
                    revertMessageId: typeof updated.revert?.messageID === 'string' ? updated.revert.messageID : undefined,
                    composerText
                }
            });
        }
        catch (error) {
            this.respondError(webview, requestId, error, '执行 redo 失败。');
        }
    }
    async handleTempfileWriteRequest(webview, requestId, fileName, bytesBase64, mimeType) {
        try {
            const bytes = decodeTempfileImage(bytesBase64);
            const detectedMime = detectImageMimeType(bytes);
            if (!detectedMime) {
                throw new Error('仅支持 PNG、JPEG、GIF 或 WebP 图片。');
            }
            if (!isCompatibleImageMime(mimeType, detectedMime)) {
                throw new Error(`图片类型不匹配（声明=${mimeType ?? 'unknown'}，实际=${detectedMime}）。`);
            }
            const safeName = sanitizeTempfileName(fileName, detectedMime);
            const dir = fs.mkdtempSync(path.join((0, node_os_1.tmpdir)(), 'opencode-ui-image-'));
            const outPath = path.join(dir, safeName);
            fs.writeFileSync(outPath, bytes, { mode: 0o600 });
            this.trackTempFile(outPath);
            this.respond(webview, {
                type: 'tempfile.write.response',
                requestId,
                ok: true,
                payload: { filePath: outPath }
            });
        }
        catch (error) {
            this.respondError(webview, requestId, error, '写入临时图片失败。');
        }
    }
    async handleFileOpenRequest(webview, requestId, filePath) {
        try {
            const resolvedPath = this.resolveWorkspaceFilePath(filePath);
            const document = await vscode.workspace.openTextDocument(vscode.Uri.file(resolvedPath));
            await vscode.window.showTextDocument(document, { preview: true });
            this.respond(webview, {
                type: 'file.open.response',
                requestId,
                ok: true,
                payload: {
                    path: resolvedPath
                }
            });
        }
        catch (error) {
            this.respondError(webview, requestId, error, '打开文件失败。');
        }
    }
    async handlePermissionReplyRequest(webview, requestId, permissionId, reply, message) {
        try {
            await this.requestServeJson(`/permission/${encodeURIComponent(permissionId)}/reply`, {
                method: 'POST',
                body: JSON.stringify({ reply, message })
            });
            if (this.currentRun?.pendingPermission?.permissionId === permissionId) {
                this.currentRun.pendingPermission = undefined;
            }
            this.respond(webview, {
                type: 'permission.reply.response',
                requestId,
                ok: true,
                payload: {
                    permissionId,
                    reply
                }
            });
        }
        catch (error) {
            this.respondError(webview, requestId, error, '处理权限请求失败。');
        }
    }
    async handleQuestionReplyRequest(webview, requestId, questionId, answers) {
        try {
            await this.requestServeJson(`/question/${encodeURIComponent(questionId)}/reply`, {
                method: 'POST',
                body: JSON.stringify({ answers })
            });
            if (this.currentRun?.pendingQuestion?.questionId === questionId) {
                this.currentRun.pendingQuestion = undefined;
            }
            this.respond(webview, {
                type: 'question.reply.response',
                requestId,
                ok: true,
                payload: { questionId }
            });
        }
        catch (error) {
            this.respondError(webview, requestId, error, '回复问题失败。');
        }
    }
    async handleQuestionRejectRequest(webview, requestId, questionId) {
        try {
            await this.requestServeJson(`/question/${encodeURIComponent(questionId)}/reject`, {
                method: 'POST'
            });
            if (this.currentRun?.pendingQuestion?.questionId === questionId) {
                this.currentRun.pendingQuestion = undefined;
            }
            this.respond(webview, {
                type: 'question.reject.response',
                requestId,
                ok: true,
                payload: { questionId }
            });
        }
        catch (error) {
            this.respondError(webview, requestId, error, '拒绝问题失败。');
        }
    }
    async handleModelsListRequest(webview, requestId, forceRefresh = false) {
        try {
            const models = await this.getModelsPayload(undefined, forceRefresh);
            this.respond(webview, {
                type: 'models.list.response',
                requestId,
                ok: true,
                payload: { models }
            });
        }
        catch (error) {
            this.respondError(webview, requestId, error, '获取 models 失败。');
        }
    }
    async handleProvidersListRequest(webview, requestId, forceRefresh = false) {
        try {
            const cwd = this.getDefaultCwd();
            const [authResult, modelsResult] = await Promise.allSettled([(0, opencodeCli_1.authList)({ cwd }), this.getAllModelsPayload(forceRefresh)]);
            let authProviders = [];
            if (authResult.status === 'fulfilled') {
                try {
                    authProviders = (0, parsers_1.parseAuthList)(authResult.value.stdout);
                }
                catch {
                    authProviders = [];
                }
            }
            const configuredLabels = this.readConfiguredProviderLabels();
            const providerIds = modelsResult.status === 'fulfilled'
                ? uniqueProviderIds(modelsResult.value.map((entry) => entry.providerID))
                : uniqueProviderIds([...authProviders.map((entry) => entry.id), ...configuredLabels.keys()]);
            if (providerIds.length === 0 && modelsResult.status !== 'fulfilled') {
                throw modelsResult.reason;
            }
            const providers = (0, parsers_1.buildProviderSummaries)(authProviders, providerIds, configuredLabels);
            this.respond(webview, {
                type: 'providers.list.response',
                requestId,
                ok: true,
                payload: { providers }
            });
        }
        catch (error) {
            this.respondError(webview, requestId, error, '获取 providers 失败。');
        }
    }
    async handleModelsListByProviderRequest(webview, requestId, providerId, forceRefresh = false) {
        try {
            const models = await this.getModelsPayload(providerId, forceRefresh);
            this.respond(webview, {
                type: 'models.list.response',
                requestId,
                ok: true,
                payload: { models }
            });
        }
        catch (error) {
            this.respondError(webview, requestId, error, `获取 models 失败（provider=${providerId}）。`);
        }
    }
    async handleAgentsListRequest(webview, requestId) {
        try {
            const result = await (0, opencodeCli_1.agentList)({ cwd: this.getDefaultCwd() });
            const entries = (0, parsers_1.parseAgentList)(result.stdout);
            this.respond(webview, {
                type: 'agents.list.response',
                requestId,
                ok: true,
                payload: { agents: entries.map((entry) => ({ name: entry.name, isPrimary: entry.isPrimary })) }
            });
        }
        catch (error) {
            this.respondError(webview, requestId, error, '获取 agents 失败。');
        }
    }
    async handleSelfcheckRunRequest(webview, requestId) {
        const env = (0, opencodeEnv_1.withOpencodeBinInPath)();
        const cwd = this.getDefaultCwd();
        const opencode = await this.getOpencodeCompatibility(env, cwd);
        const opencodeBinary = opencode.binary;
        const sessions = await this.safeCount(async () => {
            const result = await (0, opencodeCli_1.sessionListJson)({ env, cwd });
            const parsed = (0, parsers_1.parseSessionListJson)(result.stdout);
            return parsed.length;
        });
        const models = await this.safeCount(async () => {
            const result = await (0, opencodeCli_1.modelsList)({ env, cwd });
            const parsed = (0, parsers_1.parseModelsList)(result.stdout);
            return parsed.length;
        });
        const agents = await this.safeCount(async () => {
            const result = await (0, opencodeCli_1.agentList)({ env, cwd });
            const parsed = (0, parsers_1.parseAgentList)(result.stdout);
            return parsed.length;
        });
        this.respond(webview, {
            type: 'selfcheck.response',
            requestId,
            ok: true,
            payload: {
                hostKind: this.hostKind,
                isSupportedHost: this.isSupportedHost(),
                remoteName: this.remoteName,
                opencodeBinary,
                opencode,
                sessions,
                models,
                agents
            }
        });
    }
    async getOpencodeCompatibility(env = (0, opencodeEnv_1.withOpencodeBinInPath)(), cwd = this.getDefaultCwd()) {
        const binary = (0, opencodeEnv_1.resolveOpencodeBinary)(env);
        try {
            const result = await (0, opencodeCli_1.opencodeVersion)({ env, cwd, timeoutMs: 5000 });
            const version = (0, opencodeCompatibility_1.parseOpencodeVersionOutput)(result.stdout, result.stderr);
            return (0, opencodeCompatibility_1.buildOpencodeCompatibility)(binary, version);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return (0, opencodeCompatibility_1.buildOpencodeCompatibility)(binary, undefined, `无法检测 opencode 版本：${message}`);
        }
    }
    async safeCount(run) {
        try {
            const count = await run();
            return { ok: true, count };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { ok: false, error: message };
        }
    }
    async handleRunStartRequest(webview, requestId, payload) {
        if (this.currentRun) {
            this.respond(webview, { type: 'webview.error', requestId, ok: false, error: '已有运行中的任务，请先停止。' });
            return;
        }
        if (!this.isSupportedHost()) {
            this.respond(webview, {
                type: 'webview.error',
                requestId,
                ok: false,
                error: '当前扩展宿主暂不支持运行 opencode。请在 Windows 本机、Linux 本机、Remote-WSL 或 Remote-SSH Linux 中使用。'
            });
            return;
        }
        const controller = new AbortController();
        const eventAbort = new AbortController();
        try {
            await Promise.all([
                this.workspaceState.update(SidebarProvider.WORKSPACE_KEY_LAST_SELECTED_MODEL, payload.model),
                this.workspaceState.update(SidebarProvider.WORKSPACE_KEY_LAST_SELECTED_AGENT, payload.agent)
            ]);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            (0, diagnostics_1.logWarn)(`persist selection failed: ${message}`);
            console.warn('[opencode-ui] persist selection failed:', message);
        }
        this.currentRun = { requestId, controller, eventAbort };
        this.respond(webview, { type: 'run.start.response', requestId, ok: true });
        let watchdog;
        try {
            const runtime = await (0, serveManager_1.ensureServeRunning)();
            const sessionId = await this.ensureSessionForPrompt(payload, runtime.baseUrl);
            if (this.currentRun?.requestId !== requestId) {
                return;
            }
            this.invalidateSessionExportCache(sessionId);
            this.currentRun.sessionId = sessionId;
            this.respondRunEvent(webview, requestId, { type: 'session', sessionId });
            const streamState = createServeStreamState();
            const eventTask = this.consumeServeEvents(webview, requestId, sessionId, runtime.baseUrl, eventAbort.signal, streamState);
            const blockerPoll = this.startBlockerPoll(webview, requestId, sessionId, streamState);
            if (this.currentRun?.requestId === requestId) {
                this.currentRun.blockerPoll = blockerPoll;
            }
            await this.requestServeNoContent(`/session/${encodeURIComponent(sessionId)}/prompt_async`, {
                method: 'POST',
                signal: controller.signal,
                body: JSON.stringify({
                    agent: payload.agent,
                    model: splitModel(payload.model),
                    variant: payload.variant || undefined,
                    parts: buildPromptParts(payload.message, payload.files, this.hostKind)
                })
            });
            const startedAt = Date.now();
            watchdog = setTimeout(() => {
                if (!this.currentRun || this.currentRun.requestId !== requestId) {
                    return;
                }
                const seconds = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
                this.respondRunEvent(webview, requestId, {
                    type: 'part',
                    part: {
                        type: 'tool',
                        toolName: 'status',
                        status: 'waiting',
                        raw: {
                            message: `opencode 还没有产出可见事件（${String(seconds)}s）。这通常意味着：provider 首 token 很慢，或当前正在等待工具/权限流转。`
                        }
                    }
                });
            }, 8000);
            const completionResult = await eventTask;
            if (!this.currentRun || this.currentRun.requestId !== requestId) {
                return;
            }
            if (completionResult === 'stopped') {
                this.clearCurrentRunForRequest(requestId);
                this.respondRunEvent(webview, requestId, { type: 'stopped' });
                return;
            }
            if (completionResult instanceof Error) {
                this.clearCurrentRunForRequest(requestId);
                if (completionResult.name === 'AbortError') {
                    this.respondRunEvent(webview, requestId, { type: 'stopped' });
                }
                else {
                    this.respondRunEvent(webview, requestId, { type: 'error', error: completionResult.message || '运行失败。' });
                }
                return;
            }
            this.clearCurrentRunForRequest(requestId);
            this.respondRunEvent(webview, requestId, { type: 'done' });
        }
        catch (error) {
            if (!this.currentRun || this.currentRun.requestId !== requestId) {
                return;
            }
            const isAborted = (error instanceof opencodeCli_1.OpencodeCliError && error.code === 'ABORTED') || (error instanceof Error && error.name === 'AbortError');
            this.clearCurrentRunForRequest(requestId);
            if (isAborted) {
                this.respondRunEvent(webview, requestId, { type: 'stopped' });
            }
            else {
                const errorMessage = error instanceof Error ? error.message : '运行失败。';
                this.respondRunEvent(webview, requestId, { type: 'error', error: errorMessage });
            }
        }
        finally {
            if (watchdog) {
                clearTimeout(watchdog);
                watchdog = undefined;
            }
            this.cleanupTempFiles(payload.files);
            if (this.currentRun && this.currentRun.requestId === requestId) {
                this.clearCurrentRunBlockerPoll(this.currentRun);
                this.currentRun = undefined;
            }
        }
    }
    async handleRunStopRequest(webview, requestId) {
        const run = this.currentRun;
        const hadRun = Boolean(run);
        if (run?.sessionId) {
            await this.abortServeSession(run.sessionId);
        }
        this.stopCurrentRun();
        this.respond(webview, { type: 'run.stop.response', requestId, ok: true, payload: { stopped: hadRun } });
    }
    async abortServeSession(sessionId) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        try {
            await this.requestServeNoContent(`/session/${encodeURIComponent(sessionId)}/abort`, {
                method: 'POST',
                signal: controller.signal
            });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            (0, diagnostics_1.logWarn)(`abort session ${sessionId} failed: ${message}`);
            console.warn('[opencode-ui] abort session failed:', message);
        }
        finally {
            clearTimeout(timer);
        }
    }
    stopCurrentRunForHiddenPermission(webview) {
        const run = this.currentRun;
        const pendingPermission = run?.pendingPermission;
        const pendingQuestion = run?.pendingQuestion;
        if (!run || (!pendingPermission && !pendingQuestion)) {
            return;
        }
        if (run.sessionId) {
            void this.abortServeSession(run.sessionId);
        }
        if (pendingPermission) {
            run.pendingPermission = undefined;
            void this.requestServeJson(`/permission/${encodeURIComponent(pendingPermission.permissionId)}/reply`, {
                method: 'POST',
                body: JSON.stringify({
                    reply: 'reject',
                    message: '侧边栏已隐藏，自动拒绝挂起的权限请求。'
                })
            }).catch((error) => {
                const message = error instanceof Error ? error.message : String(error);
                (0, diagnostics_1.logWarn)(`auto reject hidden permission failed: ${message}`);
                console.warn('[opencode-ui] auto reject hidden permission failed:', message);
            });
        }
        if (pendingQuestion) {
            run.pendingQuestion = undefined;
            void this.requestServeJson(`/question/${encodeURIComponent(pendingQuestion.questionId)}/reject`, {
                method: 'POST'
            }).catch((error) => {
                const message = error instanceof Error ? error.message : String(error);
                (0, diagnostics_1.logWarn)(`auto reject hidden question failed: ${message}`);
                console.warn('[opencode-ui] auto reject hidden question failed:', message);
            });
        }
        this.respondRunEvent(webview, run.requestId, { type: 'stopped' });
        this.clearCurrentRunBlockerPoll(run);
        run.controller.abort();
        run.eventAbort?.abort();
        if (this.currentRun?.requestId === run.requestId) {
            this.currentRun = undefined;
        }
    }
    stopCurrentRun() {
        if (!this.currentRun) {
            return;
        }
        this.clearCurrentRunBlockerPoll(this.currentRun);
        this.currentRun.controller.abort();
        this.currentRun.eventAbort?.abort();
    }
    clearCurrentRunBlockerPoll(run) {
        if (!run.blockerPoll) {
            return;
        }
        clearInterval(run.blockerPoll);
        run.blockerPoll = undefined;
    }
    clearCurrentRunForRequest(requestId) {
        if (!this.currentRun || this.currentRun.requestId !== requestId) {
            return;
        }
        this.clearCurrentRunBlockerPoll(this.currentRun);
        this.currentRun = undefined;
    }
    trackTempFile(filePath) {
        const existing = this.tempFiles.get(filePath);
        if (existing) {
            clearTimeout(existing);
        }
        const timer = setTimeout(() => {
            this.cleanupTempFile(filePath);
        }, TEMPFILE_TTL_MS);
        this.tempFiles.set(filePath, timer);
    }
    cleanupTempFiles(filePaths) {
        for (const filePath of filePaths ?? []) {
            this.cleanupTempFile(filePath);
        }
    }
    cleanupAllTempFiles() {
        for (const filePath of [...this.tempFiles.keys()]) {
            this.cleanupTempFile(filePath);
        }
    }
    cleanupTempFile(filePath) {
        const timer = this.tempFiles.get(filePath);
        if (!timer) {
            return;
        }
        clearTimeout(timer);
        this.tempFiles.delete(filePath);
        try {
            fs.rmSync(path.dirname(filePath), { recursive: true, force: true });
        }
        catch (error) {
            (0, diagnostics_1.logWarn)(`cleanup temp file failed: ${String(error)}`);
            console.warn('[opencode-ui] cleanup temp file failed:', error);
        }
    }
    dispatchRunParsedBatch(webview, requestId, batch) {
        for (const item of batch) {
            if (!item.ok) {
                continue;
            }
            // Capture session id from any event so the UI can attach to newly created sessions.
            const sessionId = this.pickSessionId(item.value);
            if (sessionId && this.currentRun && this.currentRun.requestId === requestId && !this.currentRun.sessionId) {
                this.currentRun.sessionId = sessionId;
                this.respondRunEvent(webview, requestId, { type: 'session', sessionId });
            }
            const event = (0, parsers_1.parseRunEvent)(item.value);
            if (!event) {
                continue;
            }
            switch (event.type) {
                case 'part':
                    this.respondRunEvent(webview, requestId, { type: 'part', part: event.part });
                    break;
                case 'error':
                    this.respondRunEvent(webview, requestId, { type: 'error', error: event.error });
                    break;
            }
        }
    }
    respondRunEvent(webview, requestId, event) {
        this.respond(webview, {
            type: 'run.event',
            requestId,
            ok: true,
            payload: { event }
        });
    }
    async ensureSessionForPrompt(payload, baseUrl) {
        if (payload.sessionId) {
            return payload.sessionId;
        }
        const created = await this.requestServeJson('/session', {
            method: 'POST',
            body: JSON.stringify({
                title: resolveNewSessionTitle(payload)
            })
        });
        return created.id;
    }
    async consumeServeEvents(webview, requestId, sessionId, baseUrl, signal, streamState) {
        try {
            const response = await fetch(`${baseUrl}/event`, {
                headers: this.buildServeHeaders({ Accept: 'text/event-stream' }),
                signal
            });
            if (!response.ok || !response.body) {
                return new Error(`订阅事件流失败（${String(response.status)}）。`);
            }
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    break;
                }
                buffer += decoder.decode(value, { stream: true });
                let boundary = buffer.indexOf('\n\n');
                while (boundary >= 0) {
                    const chunk = buffer.slice(0, boundary);
                    buffer = buffer.slice(boundary + 2);
                    boundary = buffer.indexOf('\n\n');
                    const data = chunk
                        .split('\n')
                        .filter((line) => line.startsWith('data:'))
                        .map((line) => line.slice(5).trim())
                        .join('\n');
                    if (!data) {
                        continue;
                    }
                    let event;
                    try {
                        event = JSON.parse(data);
                    }
                    catch {
                        continue;
                    }
                    const result = this.dispatchServeEvent(webview, requestId, sessionId, event, streamState);
                    if (result.done) {
                        await this.pollServeBlockers(webview, requestId, sessionId, streamState);
                        if (!hasPendingServeBlockers(streamState)) {
                            return 'done';
                        }
                    }
                }
            }
            await this.pollServeBlockers(webview, requestId, sessionId, streamState);
            while (!signal.aborted && hasPendingServeBlockers(streamState)) {
                await delay(BLOCKER_POLL_INTERVAL_MS, signal).catch(() => undefined);
                await this.pollServeBlockers(webview, requestId, sessionId, streamState);
            }
            return signal.aborted ? 'stopped' : 'done';
        }
        catch (error) {
            return error instanceof Error ? error : new Error(String(error));
        }
    }
    startBlockerPoll(webview, requestId, sessionId, streamState) {
        let inFlight = false;
        const poll = async () => {
            if (inFlight || this.currentRun?.requestId !== requestId) {
                return;
            }
            inFlight = true;
            try {
                await this.pollServeBlockers(webview, requestId, sessionId, streamState);
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                (0, diagnostics_1.logWarn)(`poll serve blockers failed: ${message}`);
                console.warn('[opencode-ui] poll serve blockers failed:', message);
            }
            finally {
                inFlight = false;
            }
        };
        void poll();
        const timer = setInterval(() => {
            void poll();
        }, BLOCKER_POLL_INTERVAL_MS);
        timer.unref?.();
        return timer;
    }
    async pollServeBlockers(webview, requestId, sessionId, streamState) {
        if (this.currentRun?.requestId !== requestId) {
            return 0;
        }
        const [permissionsResult, questionsResult, sessionsResult] = await Promise.allSettled([
            this.requestServeJson('/permission'),
            this.requestServeJson('/question'),
            this.requestServeJson('/session')
        ]);
        let surfaced = 0;
        const sessions = sessionsResult.status === 'fulfilled' ? normalizeSessionTree(sessionsResult.value) : [];
        const permissions = permissionsResult.status === 'fulfilled' ? normalizePermissionRequestList(permissionsResult.value) : [];
        const questions = questionsResult.status === 'fulfilled' ? normalizeQuestionRequestList(questionsResult.value) : [];
        this.reconcilePendingPermissions(permissions, streamState);
        this.reconcilePendingQuestions(questions, streamState);
        const permission = pickCurrentRunBlocker(permissions, sessionId, sessions);
        if (permission && this.surfacePendingPermission(webview, requestId, permission, streamState)) {
            surfaced += 1;
        }
        const question = pickCurrentRunBlocker(questions, sessionId, sessions);
        if (question && this.surfacePendingQuestion(webview, requestId, question, streamState)) {
            surfaced += 1;
        }
        return surfaced;
    }
    reconcilePendingPermissions(permissions, streamState) {
        const activeIds = new Set(permissions.map((item) => item.permissionId));
        for (const id of [...streamState.pendingPermissionIds]) {
            if (activeIds.has(id)) {
                continue;
            }
            streamState.pendingPermissionIds.delete(id);
            if (this.currentRun?.pendingPermission?.permissionId === id) {
                this.currentRun.pendingPermission = undefined;
            }
        }
    }
    reconcilePendingQuestions(questions, streamState) {
        const activeIds = new Set(questions.map((item) => item.questionId));
        for (const id of [...streamState.pendingQuestionIds]) {
            if (activeIds.has(id)) {
                continue;
            }
            streamState.pendingQuestionIds.delete(id);
            if (this.currentRun?.pendingQuestion?.questionId === id) {
                this.currentRun.pendingQuestion = undefined;
            }
        }
    }
    surfacePendingPermission(webview, requestId, event, streamState) {
        if (this.currentRun?.requestId === requestId) {
            this.currentRun.pendingPermission = event;
        }
        if (streamState.pendingPermissionIds.has(event.permissionId)) {
            return false;
        }
        streamState.pendingPermissionIds.add(event.permissionId);
        this.respondRunEvent(webview, requestId, event);
        return true;
    }
    surfacePendingQuestion(webview, requestId, event, streamState) {
        if (this.currentRun?.requestId === requestId) {
            this.currentRun.pendingQuestion = event;
        }
        if (streamState.pendingQuestionIds.has(event.questionId)) {
            return false;
        }
        streamState.pendingQuestionIds.add(event.questionId);
        this.respondRunEvent(webview, requestId, event);
        return true;
    }
    dispatchServeEvent(webview, requestId, sessionId, event, streamState) {
        if (typeof event !== 'object' || event === null) {
            return { done: false };
        }
        const record = event;
        const type = typeof record.type === 'string' ? record.type : '';
        const properties = typeof record.properties === 'object' && record.properties !== null ? record.properties : {};
        if (type === 'permission.asked') {
            const permissionEvent = normalizePermissionRequest(properties);
            if (permissionEvent && this.acceptServeBlockerSession(requestId, sessionId, permissionEvent.sessionId)) {
                this.surfacePendingPermission(webview, requestId, permissionEvent, streamState);
            }
            return { done: false };
        }
        if (type === 'question.asked') {
            const questionEvent = normalizeQuestionRequest(properties);
            if (questionEvent && this.acceptServeBlockerSession(requestId, sessionId, questionEvent.sessionId)) {
                this.surfacePendingQuestion(webview, requestId, questionEvent, streamState);
            }
            return { done: false };
        }
        if (type === 'permission.replied') {
            if (this.acceptServeBlockerSession(requestId, sessionId, typeof properties.sessionID === 'string' ? properties.sessionID : undefined) && typeof properties.requestID === 'string') {
                streamState.pendingPermissionIds.delete(properties.requestID);
                if (this.currentRun?.pendingPermission?.permissionId === properties.requestID) {
                    this.currentRun.pendingPermission = undefined;
                }
            }
            return { done: false };
        }
        if (type === 'question.replied' || type === 'question.rejected') {
            if (this.acceptServeBlockerSession(requestId, sessionId, typeof properties.sessionID === 'string' ? properties.sessionID : undefined) && typeof properties.requestID === 'string') {
                streamState.pendingQuestionIds.delete(properties.requestID);
                if (this.currentRun?.pendingQuestion?.questionId === properties.requestID) {
                    this.currentRun.pendingQuestion = undefined;
                }
            }
            return { done: false };
        }
        if (type === 'message.updated') {
            const info = typeof properties.info === 'object' && properties.info !== null ? properties.info : null;
            if (!info || info.sessionID !== sessionId || info.role !== 'assistant') {
                return { done: false };
            }
            const messageId = typeof info.id === 'string' ? info.id : null;
            if (messageId) {
                streamState.assistantMessageIds.add(messageId);
                streamState.lastAssistantMessageId = messageId;
            }
            if (messageId && typeof info.finish === 'string' && !['tool-calls', 'unknown'].includes(info.finish) && !hasPendingServeBlockers(streamState)) {
                return { done: true };
            }
            return { done: false };
        }
        if (type === 'session.error') {
            if (properties.sessionID === sessionId) {
                const message = extractEventErrorMessage(properties.error) ?? '运行失败。';
                this.respondRunEvent(webview, requestId, { type: 'error', error: message });
                return { done: true };
            }
            return { done: false };
        }
        if (type === 'message.part.delta') {
            const deltaPart = toTokenDeltaServePart(properties, sessionId, streamState);
            if (deltaPart) {
                this.respondRunEvent(webview, requestId, { type: 'part', part: deltaPart });
            }
            return { done: false };
        }
        if (type === 'message.part.updated') {
            const part = typeof properties.part === 'object' && properties.part !== null ? properties.part : null;
            if (!part || part.sessionID !== sessionId) {
                return { done: false };
            }
            const partRecord = part;
            const messageId = typeof partRecord.messageID === 'string' ? partRecord.messageID : null;
            if (!isAssistantPartMessage(messageId, streamState)) {
                return { done: false };
            }
            const parsed = (0, parsers_1.parseRunEvent)({ part });
            if (parsed?.type === 'part') {
                const incrementalPart = toIncrementalServePart(partRecord, parsed.part, streamState);
                if (incrementalPart) {
                    this.respondRunEvent(webview, requestId, { type: 'part', part: incrementalPart });
                }
            }
            return { done: false };
        }
        if (type === 'session.status') {
            const status = typeof properties.status === 'object' && properties.status !== null ? properties.status : null;
            if (properties.sessionID === sessionId && status?.type === 'idle' && streamState.lastAssistantMessageId && !hasPendingServeBlockers(streamState)) {
                return { done: true };
            }
        }
        return { done: false };
    }
    acceptServeBlockerSession(requestId, sessionId, blockerSessionId) {
        if (!blockerSessionId) {
            return false;
        }
        return blockerSessionId === sessionId || this.currentRun?.requestId === requestId;
    }
    pickSessionId(value) {
        if (typeof value !== 'object' || value === null) {
            return null;
        }
        const record = value;
        const direct = record.sessionID ?? record.sessionId;
        if (typeof direct === 'string') {
            const trimmed = direct.trim();
            return trimmed.length > 0 ? trimmed : null;
        }
        return null;
    }
    async computeUndoPayload(sessionId) {
        const [cachedExport, sessionInfo] = await Promise.all([
            this.getSessionExportData(sessionId),
            this.getSessionInfoForRead(sessionId)
        ]);
        const targets = collectUserTimelineTargetsFromItems(this.getTimelineItemsFromSessionExport(cachedExport));
        if (targets.length === 0) {
            return null;
        }
        const revertMessageId = sessionInfo.revert?.messageID;
        if (typeof revertMessageId !== 'string' || revertMessageId.trim().length === 0) {
            const last = targets[targets.length - 1];
            return last ? { messageId: last.messageId, composerText: last.text } : null;
        }
        let fallback = null;
        for (const target of targets) {
            if (target.messageId < revertMessageId) {
                fallback = { messageId: target.messageId, composerText: target.text };
                continue;
            }
            break;
        }
        return fallback;
    }
    async computeRedoComposerText(sessionId) {
        const cachedExport = await this.getSessionExportData(sessionId);
        const targets = collectUserTimelineTargetsFromItems(this.getTimelineItemsFromSessionExport(cachedExport));
        const last = targets[targets.length - 1];
        return last?.text;
    }
    async getSessionExportData(sessionId) {
        const cached = this.sessionExportCache.get(sessionId);
        if (cached && this.isSessionExportCacheFresh(cached)) {
            return cached;
        }
        if (cached) {
            this.sessionExportCache.delete(sessionId);
        }
        const inFlight = this.sessionExportInFlight.get(sessionId);
        if (inFlight) {
            return inFlight;
        }
        const task = (async () => {
            const jsonText = await this.exportSessionWithFallback(sessionId);
            const data = (0, parsers_1.parseExportJson)((0, parsers_1.coerceFirstJsonObject)(jsonText));
            const nextEntry = {
                loadedAt: Date.now(),
                data,
                hasAssistantText: hasAssistantTextInExportMessages(data.messages),
                transcriptsByRevertKey: new Map()
            };
            this.sessionExportCache.set(sessionId, nextEntry);
            return nextEntry;
        })();
        this.sessionExportInFlight.set(sessionId, task);
        try {
            return await task;
        }
        finally {
            if (this.sessionExportInFlight.get(sessionId) === task) {
                this.sessionExportInFlight.delete(sessionId);
            }
        }
    }
    getTranscriptFromSessionExport(cachedExport, sessionInfo) {
        const revertKey = `${sessionInfo.revert?.messageID ?? ''}:${sessionInfo.revert?.partID ?? ''}`;
        const cachedTranscript = cachedExport.transcriptsByRevertKey.get(revertKey);
        if (cachedTranscript) {
            return cachedTranscript;
        }
        const visibleMessages = applyRevertToExportMessages(cachedExport.data.messages, sessionInfo.revert ?? undefined);
        const transcript = (0, parsers_1.exportToTranscript)({
            ...cachedExport.data,
            messages: visibleMessages
        });
        cachedExport.transcriptsByRevertKey.set(revertKey, transcript);
        return transcript;
    }
    async exportSessionWithFallback(sessionId) {
        const cwd = this.getDefaultCwd();
        if (cwd) {
            try {
                return await (0, opencodeCli_1.exportSessionToJsonText)(sessionId, {
                    cwd,
                    timeoutMs: 120000
                });
            }
            catch (error) {
                if (!isSessionNotFoundError(error)) {
                    throw error;
                }
            }
        }
        return (0, opencodeCli_1.exportSessionToJsonText)(sessionId, {
            timeoutMs: 120000
        });
    }
    async getSessionInfoForRead(sessionId) {
        try {
            return await this.requestServeJson(`/session/${encodeURIComponent(sessionId)}`);
        }
        catch (error) {
            if (!isSessionNotFoundError(error)) {
                throw error;
            }
        }
        try {
            return await this.requestServeJson(`/session/${encodeURIComponent(sessionId)}`, { includeCwd: false });
        }
        catch (error) {
            if (!isSessionNotFoundError(error)) {
                throw error;
            }
        }
        return {};
    }
    async getSessionInfoForMutation(sessionId) {
        try {
            return await this.requestServeJson(`/session/${encodeURIComponent(sessionId)}`);
        }
        catch (error) {
            if (!isSessionNotFoundError(error)) {
                throw error;
            }
        }
        return this.requestServeJson(`/session/${encodeURIComponent(sessionId)}`, { includeCwd: false });
    }
    getTimelineItemsFromSessionExport(cachedExport) {
        if (!cachedExport.timelineItems) {
            cachedExport.timelineItems = buildTimelineItems(cachedExport.data);
        }
        return cachedExport.timelineItems;
    }
    isSessionExportCacheFresh(cachedExport) {
        const ttlMs = cachedExport.hasAssistantText ? SESSION_EXPORT_CACHE_TTL_MS : EMPTY_SESSION_EXPORT_CACHE_TTL_MS;
        return Date.now() - cachedExport.loadedAt < ttlMs;
    }
    invalidateSessionExportCache(sessionId) {
        if (!sessionId) {
            return;
        }
        this.sessionExportCache.delete(sessionId);
        this.sessionExportInFlight.delete(sessionId);
    }
    async getModelsPayload(providerId, forceRefresh = false) {
        const allModels = await this.getAllModelsPayload(forceRefresh);
        const filtered = providerId ? allModels.filter((entry) => entry.providerID === providerId) : allModels;
        return filtered.map((entry) => {
            const summary = { name: entry.name };
            if (entry.variants && entry.variants.length > 0) {
                summary.variants = entry.variants;
            }
            if (entry.supportsThinking) {
                summary.supportsThinking = true;
            }
            return summary;
        });
    }
    async getAllModelsPayload(forceRefresh = false) {
        const cacheKey = 'all';
        if (forceRefresh) {
            this.modelsCache.delete(cacheKey);
        }
        if (!forceRefresh) {
            const cached = this.modelsCache.get(cacheKey);
            if (cached && Date.now() - cached.loadedAt < MODELS_CACHE_TTL_MS) {
                return cached.models;
            }
        }
        const inFlight = this.modelsInFlight.get(cacheKey);
        if (inFlight) {
            return inFlight;
        }
        const task = (async () => {
            const models = await this.getVerboseModelsPayload().catch(async (error) => {
                const message = error instanceof Error ? error.message : String(error);
                (0, diagnostics_1.logWarn)(`models --verbose failed, falling back to models: ${message}`);
                const result = await (0, opencodeCli_1.modelsList)({ cwd: this.getDefaultCwd() });
                return (0, parsers_1.parseModelsList)(result.stdout).map((entry) => ({
                    name: entry.modelName,
                    providerID: entry.providerID
                }));
            });
            this.modelsCache.set(cacheKey, {
                loadedAt: Date.now(),
                models
            });
            return models;
        })();
        this.modelsInFlight.set(cacheKey, task);
        try {
            return await task;
        }
        finally {
            if (this.modelsInFlight.get(cacheKey) === task) {
                this.modelsInFlight.delete(cacheKey);
            }
        }
    }
    async getVerboseModelsPayload() {
        const result = await (0, opencodeCli_1.modelsVerbose)({ cwd: this.getDefaultCwd() });
        return (0, parsers_1.parseModelsVerbose)(result.stdout).map((entry) => {
            const split = splitModel(entry.modelName);
            return {
                name: entry.modelName,
                providerID: split?.providerID ?? '',
                variants: extractModelVariants(entry.json),
                supportsThinking: hasModelThinkingCapability(entry.json)
            };
        }).filter((entry) => entry.providerID.length > 0);
    }
    async requestServeJson(pathname, init) {
        const runtime = await (0, serveManager_1.ensureServeRunning)();
        const response = await fetch(`${runtime.baseUrl}${pathname}`, {
            method: init?.method ?? 'GET',
            headers: this.buildServeHeaders({ 'Content-Type': 'application/json' }, init?.includeCwd ?? true),
            body: init?.body,
            signal: init?.signal
        });
        if (!response.ok) {
            const text = await response.text().catch(() => '');
            throw new Error(text.trim().length > 0 ? text.trim() : `OpenCode serve 请求失败（${String(response.status)}）。`);
        }
        return (await response.json());
    }
    readConfiguredProviderLabels() {
        try {
            const configPath = resolveOpencodeConfigPath();
            const raw = fs.readFileSync(configPath, 'utf8');
            return (0, parsers_1.extractConfiguredProviderLabels)(JSON.parse(raw));
        }
        catch {
            return new Map();
        }
    }
    async requestServeNoContent(pathname, init) {
        const runtime = await (0, serveManager_1.ensureServeRunning)();
        const response = await fetch(`${runtime.baseUrl}${pathname}`, {
            method: init?.method ?? 'POST',
            headers: this.buildServeHeaders({ 'Content-Type': 'application/json' }, init?.includeCwd ?? true),
            body: init?.body,
            signal: init?.signal
        });
        if (!response.ok) {
            const text = await response.text().catch(() => '');
            throw new Error(text.trim().length > 0 ? text.trim() : `OpenCode serve 请求失败（${String(response.status)}）。`);
        }
    }
    buildServeHeaders(extra, includeCwd = true) {
        const headers = { ...(extra ?? {}) };
        const cwd = includeCwd ? this.getDefaultCwd() : undefined;
        if (cwd) {
            headers['x-opencode-directory'] = cwd;
        }
        return headers;
    }
    getHtml(webview) {
        if (!this.isSupportedHost()) {
            return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>OpenCode UI</title>
</head>
<body>
  <h3>OpenCode UI</h3>
  <p>当前环境暂不支持。请在 Windows 本机或 VS Code Remote-WSL 会话中使用。</p>
</body>
</html>`;
        }
        try {
            const nonce = this.getNonce();
            const mediaDir = vscode.Uri.joinPath(this.extensionUri, 'media');
            const mediaDirPath = mediaDir.fsPath;
            const indexHtmlPath = path.join(mediaDirPath, 'index.html');
            const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');
            const baseUri = webview.asWebviewUri(mediaDir).toString();
            const csp = [
                "default-src 'none'",
                `script-src 'nonce-${nonce}'`,
                `style-src ${webview.cspSource}`,
                `img-src ${webview.cspSource} data: blob:`
            ].join('; ');
            return indexHtml
                .replace(/<head>/i, `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}">\n    <base href="${baseUri}/" />`)
                .replace(/<script\b([^>]*)>/gi, (_match, attrs) => {
                if (/\snonce\s*=/.test(attrs)) {
                    return `<script${attrs}>`;
                }
                return `<script nonce="${nonce}"${attrs}>`;
            })
                .replace(/(src|href)="\/([^\"]+)"/g, (_match, attr, assetPath) => {
                const assetUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', assetPath));
                return `${attr}="${assetUri}"`;
            });
        }
        catch {
            return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>OpenCode UI</title>
</head>
<body>
  <h3>OpenCode UI</h3>
  <p>未找到构建产物，请先执行 npm run build。</p>
</body>
</html>`;
        }
    }
}
exports.SidebarProvider = SidebarProvider;
SidebarProvider.WORKSPACE_KEY_LAST_SELECTED_MODEL = 'opencodeUI.lastSelectedModel';
SidebarProvider.WORKSPACE_KEY_LAST_SELECTED_AGENT = 'opencodeUI.lastSelectedAgent';
function createServeStreamState() {
    return {
        assistantMessageIds: new Set(),
        lastAssistantMessageId: null,
        partTextByKey: new Map(),
        partKindByKey: new Map(),
        deltaSeenPartKeys: new Set(),
        pendingDeltaByKey: new Map(),
        pendingPermissionIds: new Set(),
        pendingQuestionIds: new Set()
    };
}
function normalizeQuestionInfoList(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.flatMap((item) => {
        if (typeof item !== 'object' || item === null) {
            return [];
        }
        const record = item;
        if (typeof record.header !== 'string' || typeof record.question !== 'string' || !Array.isArray(record.options)) {
            return [];
        }
        const options = record.options.flatMap((option) => {
            if (typeof option !== 'object' || option === null) {
                return [];
            }
            const optionRecord = option;
            if (typeof optionRecord.label !== 'string' || typeof optionRecord.description !== 'string') {
                return [];
            }
            return [{
                    label: optionRecord.label,
                    description: optionRecord.description
                }];
        });
        return [{
                header: record.header,
                question: record.question,
                options,
                multiple: typeof record.multiple === 'boolean' ? record.multiple : undefined,
                custom: typeof record.custom === 'boolean' ? record.custom : undefined
            }];
    });
}
function normalizePermissionRequestList(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.flatMap((item) => {
        const event = normalizePermissionRequest(item);
        return event ? [event] : [];
    });
}
function normalizePermissionRequest(value) {
    if (typeof value !== 'object' || value === null) {
        return null;
    }
    const record = value;
    if (typeof record.id !== 'string' || typeof record.sessionID !== 'string') {
        return null;
    }
    return {
        type: 'permission',
        permissionId: record.id,
        sessionId: record.sessionID,
        toolName: typeof record.permission === 'string' ? record.permission : 'tool',
        patterns: Array.isArray(record.patterns) ? record.patterns.filter((item) => typeof item === 'string') : [],
        message: getPermissionRequestMessage(record)
    };
}
function getPermissionRequestMessage(record) {
    if (typeof record.message === 'string') {
        return record.message;
    }
    const metadata = typeof record.metadata === 'object' && record.metadata !== null ? record.metadata : null;
    if (typeof metadata?.description === 'string') {
        return metadata.description;
    }
    if (typeof metadata?.filepath === 'string') {
        return metadata.filepath;
    }
    return undefined;
}
function normalizeQuestionRequestList(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.flatMap((item) => {
        const event = normalizeQuestionRequest(item);
        return event ? [event] : [];
    });
}
function normalizeQuestionRequest(value) {
    if (typeof value !== 'object' || value === null) {
        return null;
    }
    const record = value;
    if (typeof record.id !== 'string' || typeof record.sessionID !== 'string') {
        return null;
    }
    const questions = normalizeQuestionInfoList(record.questions);
    if (questions.length === 0) {
        return null;
    }
    return {
        type: 'question',
        questionId: record.id,
        sessionId: record.sessionID,
        questions
    };
}
function normalizeSessionTree(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.flatMap((item) => {
        if (typeof item !== 'object' || item === null) {
            return [];
        }
        const record = item;
        if (typeof record.id !== 'string') {
            return [];
        }
        return [{
                id: record.id,
                parentId: typeof record.parentID === 'string' ? record.parentID : undefined
            }];
    });
}
function pickCurrentRunBlocker(events, sessionId, sessions) {
    if (events.length === 0) {
        return undefined;
    }
    const sessionIds = getSessionTreeIds(sessionId, sessions);
    return events.find((event) => sessionIds.has(event.sessionId)) ?? events[0];
}
function getSessionTreeIds(sessionId, sessions) {
    const childrenByParent = new Map();
    for (const session of sessions) {
        if (!session.parentId) {
            continue;
        }
        const children = childrenByParent.get(session.parentId);
        if (children) {
            children.push(session.id);
        }
        else {
            childrenByParent.set(session.parentId, [session.id]);
        }
    }
    const result = new Set([sessionId]);
    const queue = [sessionId];
    for (const current of queue) {
        const children = childrenByParent.get(current) ?? [];
        for (const child of children) {
            if (result.has(child)) {
                continue;
            }
            result.add(child);
            queue.push(child);
        }
    }
    return result;
}
function hasPendingServeBlockers(streamState) {
    return streamState.pendingPermissionIds.size > 0 || streamState.pendingQuestionIds.size > 0;
}
function delay(ms, signal) {
    if (signal?.aborted) {
        return Promise.reject(createAbortError());
    }
    return new Promise((resolve, reject) => {
        const cleanup = () => signal?.removeEventListener('abort', abort);
        const timer = setTimeout(() => {
            cleanup();
            resolve();
        }, ms);
        const abort = () => {
            clearTimeout(timer);
            cleanup();
            reject(createAbortError());
        };
        signal?.addEventListener('abort', abort, { once: true });
    });
}
function createAbortError() {
    const error = new Error('Aborted');
    error.name = 'AbortError';
    return error;
}
function toTokenDeltaServePart(properties, sessionId, streamState) {
    if (properties.sessionID !== sessionId || properties.field !== 'text' || typeof properties.delta !== 'string' || properties.delta.length === 0) {
        return null;
    }
    const messageId = typeof properties.messageID === 'string' ? properties.messageID : null;
    const partId = typeof properties.partID === 'string' ? properties.partID : null;
    if (!partId || !isAssistantPartMessage(messageId, streamState)) {
        return null;
    }
    const partKey = getServePartKey({
        messageID: messageId ?? undefined,
        id: partId,
        type: 'text'
    });
    const kind = streamState.partKindByKey.get(partKey);
    if (!kind) {
        const previous = streamState.pendingDeltaByKey.get(partKey) ?? '';
        streamState.pendingDeltaByKey.set(partKey, `${previous}${properties.delta}`);
        return null;
    }
    streamState.deltaSeenPartKeys.add(partKey);
    streamState.partTextByKey.set(partKey, `${streamState.partTextByKey.get(partKey) ?? ''}${properties.delta}`);
    if (kind === 'text') {
        return {
            type: 'text',
            text: properties.delta
        };
    }
    return {
        type: 'reasoning',
        text: properties.delta
    };
}
function isAssistantPartMessage(messageId, streamState) {
    if (!messageId) {
        return streamState.lastAssistantMessageId !== null;
    }
    return streamState.assistantMessageIds.has(messageId) || streamState.lastAssistantMessageId === messageId;
}
function toIncrementalServePart(partRecord, parsedPart, streamState) {
    if (parsedPart.type !== 'text' && parsedPart.type !== 'reasoning') {
        return parsedPart;
    }
    const partKey = getServePartKey(partRecord);
    streamState.partKindByKey.set(partKey, parsedPart.type);
    const pendingDelta = streamState.pendingDeltaByKey.get(partKey);
    if (pendingDelta !== undefined) {
        streamState.pendingDeltaByKey.delete(partKey);
        streamState.deltaSeenPartKeys.add(partKey);
        streamState.partTextByKey.set(partKey, pendingDelta);
        if (pendingDelta.length > 0) {
            if (parsedPart.type === 'text') {
                return {
                    type: 'text',
                    text: pendingDelta
                };
            }
            return {
                type: 'reasoning',
                text: pendingDelta,
                raw: parsedPart.raw
            };
        }
    }
    const previousText = streamState.partTextByKey.get(partKey) ?? '';
    const currentText = parsedPart.text;
    streamState.partTextByKey.set(partKey, currentText);
    if (streamState.deltaSeenPartKeys.has(partKey)) {
        if (currentText.length < previousText.length || !currentText.startsWith(previousText)) {
            streamState.deltaSeenPartKeys.delete(partKey);
        }
        else {
            return null;
        }
    }
    const nextText = currentText.startsWith(previousText)
        ? currentText.slice(previousText.length)
        : currentText;
    if (nextText.length === 0) {
        return null;
    }
    if (parsedPart.type === 'text') {
        return {
            type: 'text',
            text: nextText
        };
    }
    return {
        type: 'reasoning',
        text: nextText,
        raw: parsedPart.raw
    };
}
function getServePartKey(partRecord) {
    const messageId = typeof partRecord.messageID === 'string' ? partRecord.messageID : 'message';
    const partId = typeof partRecord.id === 'string' ? partRecord.id : undefined;
    if (partId) {
        return `${messageId}:${partId}`;
    }
    const type = typeof partRecord.type === 'string' ? partRecord.type : 'part';
    return `${messageId}:${type}`;
}
function summarizeSessionTitle(message) {
    const normalized = normalizeTitleSource(message);
    if (!normalized) {
        return 'New Session';
    }
    const withoutCommand = normalized.replace(/^\/\S+\s+/, '').trim();
    const cleaned = stripTitleNoise(withoutCommand || normalized);
    const sentence = cleaned.split(/[.!?。！？]/u)[0]?.trim() || cleaned;
    const maxLength = hasCjk(sentence) ? 18 : 36;
    const clipped = clipTitle(sentence, maxLength);
    return clipped || 'New Session';
}
function resolveNewSessionTitle(payload) {
    const explicitTitle = typeof payload.title === 'string' ? payload.title.trim() : '';
    if (explicitTitle && explicitTitle !== 'New Session') {
        return explicitTitle;
    }
    return summarizeSessionTitle(payload.message);
}
function normalizeTitleSource(message) {
    return message.replace(/\s+/g, ' ').trim();
}
function stripTitleNoise(message) {
    return message
        .replace(/^(?:请帮我|帮我|请你|请|麻烦你|麻烦|我想让你|我需要你|需要你)\s*/u, '')
        .replace(/^(?:please\s+)?(?:help me\s+(?:to\s+)?)?/iu, '')
        .replace(/^[#>*\-\d.()\[\]\s]+/u, '')
        .trim();
}
function hasCjk(value) {
    return /[\u3400-\u9fff\uf900-\ufaff]/u.test(value);
}
function clipTitle(value, maxLength) {
    const chars = [...value];
    if (chars.length <= maxLength) {
        return value;
    }
    const clipped = chars
        .slice(0, maxLength)
        .join('')
        .replace(/[\s,.;:!?，。；：！？、-]+$/u, '')
        .trim();
    if (hasCjk(clipped)) {
        return clipped.replace(/\s+[A-Za-z0-9_-]+$/u, '').trim();
    }
    return clipped;
}
function applyRevertToExportMessages(messages, revert) {
    const revertMessageId = typeof revert?.messageID === 'string' ? revert.messageID : undefined;
    if (!revertMessageId) {
        return messages;
    }
    const revertPartId = typeof revert?.partID === 'string' ? revert.partID : undefined;
    const next = [];
    for (const message of messages) {
        const info = isRecord(message.info) ? message.info : undefined;
        const messageId = typeof info?.id === 'string' ? info.id : undefined;
        if (!messageId) {
            next.push(message);
            continue;
        }
        if (messageId < revertMessageId) {
            next.push(message);
            continue;
        }
        if (messageId > revertMessageId) {
            break;
        }
        if (!revertPartId) {
            break;
        }
        const keptParts = [];
        for (const part of message.parts) {
            const partRecord = isRecord(part) ? part : undefined;
            const partId = typeof partRecord?.id === 'string' ? partRecord.id : undefined;
            if (partId === revertPartId) {
                break;
            }
            keptParts.push(part);
        }
        next.push({
            info: message.info,
            parts: keptParts
        });
        break;
    }
    return next;
}
function buildTimelineItems(payload) {
    const items = [];
    let pendingUser = null;
    for (const message of payload.messages) {
        const info = isRecord(message.info) ? message.info : undefined;
        const role = typeof info?.role === 'string' ? info.role : undefined;
        const messageId = typeof info?.id === 'string' ? info.id : undefined;
        const created = getCreatedTime(info);
        if (role === 'user' && messageId) {
            pendingUser = {
                messageId,
                created,
                text: extractUserText(message.parts)
            };
            continue;
        }
        if (role === 'assistant' && pendingUser) {
            items.push({
                messageId: pendingUser.messageId,
                created: pendingUser.created,
                text: pendingUser.text,
                assistantText: extractAssistantText(message.parts),
                toolCount: countPartsByType(message.parts, 'tool'),
                reasoningCount: countPartsByType(message.parts, 'reasoning'),
                stepCount: countStepParts(message.parts)
            });
            pendingUser = null;
        }
    }
    if (pendingUser) {
        items.push({
            messageId: pendingUser.messageId,
            created: pendingUser.created,
            text: pendingUser.text,
            assistantText: '',
            toolCount: 0,
            reasoningCount: 0,
            stepCount: 0
        });
    }
    return items;
}
function collectUserTimelineTargets(payload) {
    return buildTimelineItems(payload)
        .filter((item) => item.messageId.trim().length > 0)
        .map((item) => ({
        messageId: item.messageId,
        text: item.text
    }));
}
function collectUserTimelineTargetsFromItems(items) {
    return items
        .filter((item) => item.messageId.trim().length > 0)
        .map((item) => ({
        messageId: item.messageId,
        text: item.text
    }));
}
function hasAssistantTextInExportMessages(messages) {
    for (const message of messages) {
        const info = isRecord(message.info) ? message.info : undefined;
        if (info?.role !== 'assistant') {
            continue;
        }
        if (extractAssistantText(message.parts).length > 0) {
            return true;
        }
    }
    return false;
}
function extractUserText(parts) {
    const chunks = [];
    for (const part of parts) {
        if (!isRecord(part)) {
            continue;
        }
        if (part.type === 'text' && typeof part.text === 'string') {
            const text = part.synthetic === true ? '' : part.text.trim();
            if (text) {
                chunks.push(text);
            }
        }
    }
    return chunks.join('\n\n').trim();
}
function extractAssistantText(parts) {
    const chunks = [];
    for (const part of parts) {
        if (!isRecord(part)) {
            continue;
        }
        if (part.type === 'text' && typeof part.text === 'string') {
            const text = part.text.trim();
            if (text) {
                chunks.push(text);
            }
        }
    }
    return chunks.join('\n\n').trim();
}
function countPartsByType(parts, type) {
    let count = 0;
    for (const part of parts) {
        if (isRecord(part) && part.type === type) {
            count += 1;
        }
    }
    return count;
}
function countStepParts(parts) {
    let count = 0;
    for (const part of parts) {
        if (!isRecord(part)) {
            continue;
        }
        if (part.type === 'step-start' || part.type === 'step-finish') {
            count += 1;
        }
    }
    return count;
}
function getCreatedTime(info) {
    const time = isRecord(info?.time) ? info.time : undefined;
    return typeof time?.created === 'number' ? time.created : 0;
}
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
function splitModel(model) {
    const slash = model.indexOf('/');
    if (slash <= 0 || slash >= model.length - 1) {
        return undefined;
    }
    return {
        providerID: model.slice(0, slash),
        modelID: model.slice(slash + 1)
    };
}
function extractModelVariants(json) {
    if (!isRecord(json)) {
        return undefined;
    }
    const variants = json.variants;
    const names = Array.isArray(variants)
        ? variants.filter((variant) => typeof variant === 'string')
        : isRecord(variants)
            ? Object.keys(variants)
            : [];
    const unique = uniqueTrimmedNames(names);
    return unique.length > 0 ? unique : undefined;
}
function hasModelThinkingCapability(json) {
    if (!isRecord(json) || !isRecord(json.capabilities)) {
        return false;
    }
    return json.capabilities.reasoning === true;
}
function uniqueTrimmedNames(names) {
    const seen = new Set();
    const result = [];
    for (const name of names) {
        const trimmed = name.trim();
        const normalized = trimmed.toLowerCase();
        if (!trimmed || seen.has(normalized)) {
            continue;
        }
        seen.add(normalized);
        result.push(trimmed);
    }
    return result;
}
function uniqueProviderIds(providerIds) {
    const seen = new Set();
    const ordered = [];
    for (const providerID of providerIds) {
        const normalized = providerID.trim();
        if (!normalized || seen.has(normalized)) {
            continue;
        }
        seen.add(normalized);
        ordered.push(normalized);
    }
    return ordered;
}
function resolveOpencodeConfigPath(env = process.env) {
    const configured = env.OPENCODE_CONFIG?.trim();
    if (configured) {
        return configured;
    }
    const xdgConfigHome = env.XDG_CONFIG_HOME?.trim();
    if (xdgConfigHome) {
        return path.join(xdgConfigHome, 'opencode', 'opencode.json');
    }
    return path.join((0, node_os_1.homedir)(), '.config', 'opencode', 'opencode.json');
}
function isSessionNotFoundError(error) {
    if (!(error instanceof Error)) {
        return false;
    }
    const message = error.message.toLowerCase();
    return message.includes('session not found') || message.includes('notfounderror');
}
function buildPromptParts(message, files, hostKind = 'wsl') {
    const parts = [];
    for (const filePath of files ?? []) {
        const absolutePath = normalizePromptFilePath(filePath, hostKind);
        parts.push({
            type: 'file',
            url: buildPromptFileUrl(absolutePath, hostKind),
            filename: getPromptFileName(absolutePath, hostKind),
            mime: inferPromptFileMime(absolutePath)
        });
    }
    parts.push({ type: 'text', text: message });
    return parts;
}
function normalizePromptFilePath(filePath, hostKind = 'wsl') {
    const trimmed = filePath.trim();
    if (!trimmed) {
        throw new Error('文件路径为空。');
    }
    if (hostKind === 'local-windows') {
        return path.win32.resolve(trimmed);
    }
    const wslMatch = /^\\\\wsl(?:\.localhost|\$)\\[^\\]+\\(.+)$/i.exec(trimmed);
    if (hostKind === 'wsl' && wslMatch?.[1]) {
        return `/${wslMatch[1].replace(/\\/g, '/')}`;
    }
    if (isWindowsDrivePath(trimmed) || isWindowsUncPath(trimmed)) {
        throw new Error('当前宿主无法直接读取 Windows 路径，请选择该宿主文件系统内的文件。');
    }
    return path.posix.resolve(trimmed);
}
function buildPromptFileUrl(filePath, hostKind) {
    if (hostKind === 'local-windows') {
        return windowsPathToFileUrl(filePath);
    }
    return posixPathToFileUrl(filePath);
}
function getPromptFileName(filePath, hostKind) {
    return hostKind === 'local-windows' ? path.win32.basename(filePath) : path.posix.basename(filePath);
}
function windowsPathToFileUrl(filePath) {
    const normalized = path.win32.resolve(filePath);
    const uncMatch = /^\\\\([^\\]+)\\([^\\]+)(?:\\(.*))?$/u.exec(normalized);
    if (uncMatch) {
        const [, server, share, rest] = uncMatch;
        const segments = [share, ...(rest ? rest.split(/\\+/u).filter(Boolean) : [])].map(encodeURIComponent);
        return `file://${encodeURIComponent(server)}/${segments.join('/')}`;
    }
    const driveMatch = /^([A-Za-z]):\\?(.*)$/u.exec(normalized);
    if (driveMatch) {
        const [, drive, rest] = driveMatch;
        const segments = rest.split(/\\+/u).filter(Boolean).map(encodeURIComponent);
        return `file:///${drive.toUpperCase()}:/${segments.join('/')}`;
    }
    return (0, node_url_1.pathToFileURL)(normalized).toString();
}
function posixPathToFileUrl(filePath) {
    const normalized = path.posix.resolve(filePath);
    const segments = normalized.split('/').map(encodeURIComponent);
    return `file://${segments.join('/')}`;
}
function isWindowsDrivePath(filePath) {
    return /^[A-Za-z]:[\\/]/u.test(filePath);
}
function isWindowsUncPath(filePath) {
    return /^\\\\/u.test(filePath);
}
function decodeTempfileImage(bytesBase64) {
    const normalized = bytesBase64.replace(/\s+/g, '');
    if (normalized.length === 0) {
        throw new Error('图片内容为空。');
    }
    if (normalized.length > TEMPFILE_MAX_BASE64_CHARS) {
        throw new Error(`图片过大，最大支持 ${String(Math.floor(TEMPFILE_MAX_BYTES / 1024 / 1024))}MB。`);
    }
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized) || normalized.length % 4 === 1) {
        throw new Error('图片内容不是有效的 base64。');
    }
    const bytes = Buffer.from(normalized, 'base64');
    if (bytes.length === 0) {
        throw new Error('图片内容为空。');
    }
    if (bytes.length > TEMPFILE_MAX_BYTES) {
        throw new Error(`图片过大，最大支持 ${String(Math.floor(TEMPFILE_MAX_BYTES / 1024 / 1024))}MB。`);
    }
    return bytes;
}
function detectImageMimeType(bytes) {
    if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
        return 'image/png';
    }
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
        return 'image/jpeg';
    }
    if (bytes.length >= 6 && (bytes.subarray(0, 6).toString('ascii') === 'GIF87a' || bytes.subarray(0, 6).toString('ascii') === 'GIF89a')) {
        return 'image/gif';
    }
    if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') {
        return 'image/webp';
    }
    return null;
}
function isCompatibleImageMime(declaredMime, detectedMime) {
    if (!declaredMime || declaredMime.trim().length === 0) {
        return true;
    }
    const normalized = declaredMime.trim().toLowerCase();
    if (normalized === detectedMime) {
        return true;
    }
    return normalized === 'image/jpg' && detectedMime === 'image/jpeg';
}
function sanitizeTempfileName(fileName, mimeType) {
    const extension = extensionForImageMime(mimeType);
    const rawBaseName = path.basename(fileName || `pasted-image${extension}`);
    const withoutExtension = rawBaseName.replace(/\.[^.]*$/u, '');
    const safeStem = withoutExtension
        .replace(/[^A-Za-z0-9._-]+/g, '-')
        .replace(/^[.-]+/g, '')
        .slice(0, 80) || 'pasted-image';
    return `${safeStem}${extension}`;
}
function extensionForImageMime(mimeType) {
    switch (mimeType) {
        case 'image/png':
            return '.png';
        case 'image/jpeg':
            return '.jpg';
        case 'image/gif':
            return '.gif';
        case 'image/webp':
            return '.webp';
        default:
            return '.bin';
    }
}
function inferPromptFileMime(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
        case '.png':
            return 'image/png';
        case '.jpg':
        case '.jpeg':
            return 'image/jpeg';
        case '.gif':
            return 'image/gif';
        case '.webp':
            return 'image/webp';
        default:
            return 'text/plain';
    }
}
function extractEventErrorMessage(value) {
    if (typeof value === 'string') {
        return stripAnsi(value).trim() || null;
    }
    if (!isRecord(value)) {
        return null;
    }
    const direct = [value.message, value.text, value.name]
        .map((entry) => (typeof entry === 'string' ? stripAnsi(entry).trim() : ''))
        .find((entry) => entry.length > 0);
    if (direct) {
        return direct;
    }
    return extractEventErrorMessage(value.data) ?? extractEventErrorMessage(value.error) ?? null;
}
function stripAnsi(value) {
    return value.replace(new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g'), '');
}
//# sourceMappingURL=SidebarProvider.js.map