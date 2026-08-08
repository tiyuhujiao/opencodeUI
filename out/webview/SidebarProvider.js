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
exports.buildWorkspaceSearchGlobs = buildWorkspaceSearchGlobs;
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
const runLifecycle_1 = require("./runLifecycle");
const sessionMarkdown_1 = require("../sessionMarkdown");
const providerSettings_1 = require("../providerSettings");
const providerUpstreamModels_1 = require("../providerUpstreamModels");
const providerCatalog_1 = require("../providerCatalog");
const SESSION_EXPORT_CACHE_TTL_MS = 8000;
const EMPTY_SESSION_EXPORT_CACHE_TTL_MS = 750;
const MODELS_CACHE_TTL_MS = 15 * 60000;
const PROVIDER_SETTINGS_CATALOG_TTL_MS = 5 * 60000;
const TEMPFILE_MAX_BYTES = 10 * 1024 * 1024;
const TEMPFILE_MAX_BASE64_CHARS = Math.ceil(TEMPFILE_MAX_BYTES / 3) * 4 + 4;
const TEMPFILE_TTL_MS = 30 * 60000;
const MCP_TRANSITION_POLL_DELAYS_MS = [0, 250, 500, 750, 1000, 1500, 2000, 2500, 3000];
class SidebarProvider {
    constructor(extensionUri, workspaceState, hostKind, remoteName, inlineDiff) {
        this.extensionUri = extensionUri;
        this.workspaceState = workspaceState;
        this.hostKind = hostKind;
        this.remoteName = remoteName;
        this.sessionExportCache = new Map();
        this.sessionExportInFlight = new Map();
        this.modelsCache = new Map();
        this.modelsInFlight = new Map();
        this.tempFiles = new Map();
        this.inlineDiff = inlineDiff ?? createInactiveInlineDiffController();
        this.inlineDiffStateSubscription = this.inlineDiff.onDidChange((snapshot) => this.postInlineDiffState(snapshot));
    }
    dispose() {
        this.inlineDiffStateSubscription.dispose();
        this.inlineDiff.dispose();
        this.cleanupAllTempFiles();
    }
    isSupportedHost() {
        return this.hostKind !== "unsupported";
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
            throw new Error("文件路径为空。");
        }
        const folders = vscode.workspace.workspaceFolders ?? [];
        if (folders.length === 0) {
            throw new Error("当前没有打开的工作区，无法解析相对文件路径。");
        }
        const isAbsolute = path.isAbsolute(trimmed) ||
            path.win32.isAbsolute(trimmed) ||
            path.posix.isAbsolute(trimmed);
        const candidates = isAbsolute
            ? [trimmed]
            : folders.flatMap((folder) => {
                const relative = this.stripWorkspaceFolderPrefix(trimmed, folder);
                return [path.resolve(folder.uri.fsPath, relative)];
            });
        const resolved = candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
        if (!resolved || !this.isWorkspacePath(resolved)) {
            throw new Error("只能打开当前 VS Code 工作区内的文件。");
        }
        return resolved;
    }
    async resolveWorkspaceFileReference(filePath) {
        const directPath = this.resolveWorkspaceFilePath(filePath);
        if (fs.existsSync(directPath)) {
            return directPath;
        }
        const trimmed = filePath.trim();
        if (!isBareWorkspaceFilename(trimmed)) {
            return directPath;
        }
        const matches = await vscode.workspace.findFiles(`**/${escapeGlobSegment(trimmed)}`, undefined, 21);
        const workspaceMatches = matches.filter((uri) => vscode.workspace.getWorkspaceFolder(uri));
        if (workspaceMatches.length === 0) {
            throw new Error(`工作区中找不到文件：${trimmed}`);
        }
        if (workspaceMatches.length === 1) {
            return workspaceMatches[0].fsPath;
        }
        const selected = await vscode.window.showQuickPick(workspaceMatches.map((uri) => ({
            label: vscode.workspace.asRelativePath(uri, false),
            description: vscode.workspace.getWorkspaceFolder(uri)?.name,
            uri,
        })), {
            title: `打开 ${trimmed}`,
            placeHolder: "工作区中有多个同名文件，请选择要打开的路径",
        });
        if (!selected) {
            throw new Error(`未选择要打开的文件：${trimmed}`);
        }
        return selected.uri.fsPath;
    }
    stripWorkspaceFolderPrefix(value, folder) {
        const normalized = value.replace(/\\/g, "/");
        const prefix = `${folder.name}/`;
        return normalized.startsWith(prefix) ? normalized.slice(prefix.length) : value;
    }
    isWorkspacePath(filePath) {
        const candidate = path.resolve(filePath);
        return (vscode.workspace.workspaceFolders ?? []).some((folder) => {
            const root = path.resolve(folder.uri.fsPath);
            const relative = path.relative(root, candidate);
            return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
        });
    }
    resolveWebviewView(webviewView) {
        this.view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
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
        const errorMessage = error instanceof Error && error.message.trim().length > 0
            ? error.message.trim()
            : fallback;
        (0, diagnostics_1.logError)(`${requestId}: ${errorMessage}`);
        this.respond(webview, {
            type: "webview.error",
            requestId,
            ok: false,
            error: errorMessage,
        });
    }
    handleWebviewMessage(webview, message) {
        try {
            const requestId = (0, protocol_1.getRequestIdFromUnknown)(message);
            if (!(0, protocol_1.isWebviewRequestMessage)(message)) {
                const type = typeof message === "object" && message !== null
                    ? message.type
                    : undefined;
                if (requestId && (0, protocol_1.isWhitelistedWebviewRequestType)(type)) {
                    this.respond(webview, {
                        type: "webview.error",
                        requestId,
                        ok: false,
                        error: "Invalid message shape",
                    });
                }
                return;
            }
            switch (message.type) {
                case "webview.ready": {
                    void this.handleWebviewReadyRequest(webview, message.requestId);
                    return;
                }
                case "sessions.list":
                    void this.handleSessionsListRequest(webview, message.requestId);
                    return;
                case "session.export":
                    void this.handleSessionExportRequest(webview, message.requestId, message.payload.sessionId);
                    return;
                case "session.export.markdown":
                    void this.handleSessionMarkdownExportRequest(webview, message.requestId, message.payload);
                    return;
                case "subtask.transcript":
                    void this.handleSubtaskTranscriptRequest(webview, message.requestId, message.payload.sessionId);
                    return;
                case "session.timeline":
                    void this.handleSessionTimelineRequest(webview, message.requestId, message.payload.sessionId);
                    return;
                case "session.undo":
                    void this.handleSessionUndoRequest(webview, message.requestId, message.payload.sessionId);
                    return;
                case "session.revert":
                    void this.handleSessionRevertRequest(webview, message.requestId, message.payload.sessionId, message.payload.messageId);
                    return;
                case "session.redo":
                    void this.handleSessionRedoRequest(webview, message.requestId, message.payload.sessionId);
                    return;
                case "session.fork":
                    void this.handleSessionForkRequest(webview, message.requestId, message.payload.sessionId, message.payload.messageId);
                    return;
                case "session.delete":
                    void this.handleSessionDeleteRequest(webview, message.requestId, message.payload.sessionId);
                    return;
                case "permission.reply":
                    void this.handlePermissionReplyRequest(webview, message.requestId, message.payload.permissionId, message.payload.reply, message.payload.message);
                    return;
                case "question.reply":
                    void this.handleQuestionReplyRequest(webview, message.requestId, message.payload.questionId, message.payload.answers);
                    return;
                case "question.reject":
                    void this.handleQuestionRejectRequest(webview, message.requestId, message.payload.questionId);
                    return;
                case "file.open":
                    void this.handleFileOpenRequest(webview, message.requestId, message.payload.path, message.payload.line, message.payload.column);
                    return;
                case "inlineDiff.open":
                    void this.handleInlineDiffOpenRequest(webview, message.requestId, message.payload.fileId);
                    return;
                case "inlineDiff.dismiss":
                    this.handleInlineDiffDismissRequest(webview, message.requestId, message.payload.fileId);
                    return;
                case "tempfile.write":
                    void this.handleTempfileWriteRequest(webview, message.requestId, message.payload.fileName, message.payload.bytesBase64, message.payload.mimeType);
                    return;
                case "models.list":
                    void this.handleModelsListRequest(webview, message.requestId, message.payload?.forceRefresh === true);
                    return;
                case "providers.list":
                    void this.handleProvidersListRequest(webview, message.requestId, message.payload?.forceRefresh === true);
                    return;
                case "models.list.byProvider":
                    void this.handleModelsListByProviderRequest(webview, message.requestId, message.payload.providerId, message.payload.forceRefresh === true);
                    return;
                case "provider.settings.get":
                    void this.handleProviderSettingsGetRequest(webview, message.requestId, message.payload.scope, message.payload.forceRefresh === true);
                    return;
                case "provider.settings.models":
                    void this.handleProviderSettingsModelsRequest(webview, message.requestId, message.payload.providerId, message.payload.forceRefresh === true);
                    return;
                case "provider.settings.upstreamModels":
                    void this.handleProviderSettingsUpstreamModelsRequest(webview, message.requestId, message.payload.scope, message.payload.draft, message.payload.endpoint);
                    return;
                case "provider.settings.save":
                    void this.handleProviderSettingsSaveRequest(webview, message.requestId, message.payload.scope, message.payload.revision, message.payload.draft);
                    return;
                case "provider.settings.delete":
                    void this.handleProviderSettingsDeleteRequest(webview, message.requestId, message.payload.scope, message.payload.revision, message.payload.providerId);
                    return;
                case "provider.settings.openConfig":
                    void this.handleProviderSettingsOpenConfigRequest(webview, message.requestId, message.payload.scope);
                    return;
                case "provider.auth.api":
                    void this.handleProviderAuthApiRequest(webview, message.requestId, message.payload.providerId, message.payload.key, message.payload.metadata);
                    return;
                case "provider.auth.oauth.authorize":
                    void this.handleProviderAuthOAuthAuthorizeRequest(webview, message.requestId, message.payload.providerId, message.payload.method, message.payload.inputs);
                    return;
                case "provider.auth.oauth.callback":
                    void this.handleProviderAuthOAuthCallbackRequest(webview, message.requestId, message.payload.providerId, message.payload.method, message.payload.code);
                    return;
                case "provider.auth.disconnect":
                    void this.handleProviderAuthDisconnectRequest(webview, message.requestId, message.payload.providerId);
                    return;
                case "provider.auth.openExternal":
                    void this.handleProviderAuthOpenExternalRequest(webview, message.requestId, message.payload.url);
                    return;
                case "agents.list":
                    void this.handleAgentsListRequest(webview, message.requestId);
                    return;
                case "composer.resources.list":
                    void this.handleComposerResourcesListRequest(webview, message.requestId);
                    return;
                case "mcp.setEnabled":
                    void this.handleMcpSetEnabledRequest(webview, message.requestId, message.payload.name, message.payload.enabled);
                    return;
                case "workspace.resources.search":
                    void this.handleWorkspaceResourcesSearchRequest(webview, message.requestId, message.payload.query);
                    return;
                case "workspace.resources.resolve":
                    void this.handleWorkspaceResourcesResolveRequest(webview, message.requestId, message.payload.values);
                    return;
                case "selfcheck.run":
                    void this.handleSelfcheckRunRequest(webview, message.requestId);
                    return;
                case "run.start":
                    void this.handleRunStartRequest(webview, message.requestId, message.payload);
                    return;
                case "run.stop":
                    void this.handleRunStopRequest(webview, message.requestId);
                    return;
            }
        }
        catch (error) {
            const requestId = (0, protocol_1.getRequestIdFromUnknown)(message);
            if (!requestId) {
                return;
            }
            this.respondError(webview, requestId, error, "处理消息失败。");
        }
    }
    async handleWebviewReadyRequest(webview, requestId) {
        const lastSelectedModel = this.workspaceState.get(SidebarProvider.WORKSPACE_KEY_LAST_SELECTED_MODEL);
        const lastSelectedAgent = this.workspaceState.get(SidebarProvider.WORKSPACE_KEY_LAST_SELECTED_AGENT);
        const opencode = this.isSupportedHost()
            ? await this.getOpencodeCompatibility()
            : undefined;
        if (opencode?.warning) {
            (0, diagnostics_1.logWarn)(opencode.warning);
        }
        else if (opencode?.version) {
            (0, diagnostics_1.logInfo)(`opencode ${opencode.version} detected at ${opencode.binary}`);
        }
        this.respond(webview, {
            type: "webview.ready.ack",
            requestId,
            ok: true,
            payload: {
                hostKind: this.hostKind,
                isSupportedHost: this.isSupportedHost(),
                remoteName: this.remoteName,
                workspaceFolderPath: this.getDefaultCwd(),
                lastSelectedModel,
                lastSelectedAgent,
                opencode,
            },
        });
        this.postInlineDiffState(this.inlineDiff.getSnapshot(), webview);
    }
    async handleSessionsListRequest(webview, requestId) {
        try {
            const parsed = await this.getSessionListForCurrentScopes();
            const sessions = (0, parsers_1.sortSessionsByUpdatedDesc)(parsed).map((session) => ({
                id: session.id,
                title: session.title,
                updated: session.updated,
            }));
            this.respond(webview, {
                type: "sessions.list.response",
                requestId,
                ok: true,
                payload: { sessions },
            });
        }
        catch (error) {
            this.respondError(webview, requestId, error, "获取 sessions 失败。");
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
            if (result.status === "fulfilled") {
                scopedLists.push(result.value);
            }
            else if (!firstError) {
                firstError = result.reason;
            }
        }
        if (scopedLists.length === 0) {
            throw firstError instanceof Error
                ? firstError
                : new Error("获取 sessions 失败。");
        }
        return (0, parsers_1.mergeSessionsById)(scopedLists);
    }
    async handleSessionExportRequest(webview, requestId, sessionId) {
        try {
            const [cachedExport, sessionInfo] = await Promise.all([
                this.getSessionExportData(sessionId),
                this.getSessionInfoForRead(sessionId),
            ]);
            const messages = this.getTranscriptFromSessionExport(cachedExport, sessionInfo);
            this.respond(webview, {
                type: "session.export.response",
                requestId,
                ok: true,
                payload: { messages },
            });
        }
        catch (error) {
            this.respondError(webview, requestId, error, "获取 session export 失败。");
        }
    }
    async handleSessionMarkdownExportRequest(webview, requestId, payload) {
        try {
            const [cachedExport, sessionInfo, providerCatalog] = await Promise.all([
                this.getSessionExportData(payload.sessionId),
                this.getSessionInfoForRead(payload.sessionId),
                this.getProviderSettingsCatalog(false).catch(() => undefined),
            ]);
            const modelNames = providerCatalog
                ? new Map([...providerCatalog.modelsByProvider].flatMap(([providerId, models]) => models.map((model) => [`${providerId}/${model.id}`, model.name])))
                : undefined;
            const markdown = (0, sessionMarkdown_1.formatSessionMarkdown)({
                sessionId: payload.sessionId,
                sessionInfo,
                exportPayload: cachedExport.data,
                modelNames,
                options: {
                    includeThinking: payload.includeThinking,
                    includeToolDetails: payload.includeToolDetails,
                    includeAssistantMetadata: payload.includeAssistantMetadata,
                },
            });
            let document;
            let filePath;
            if (payload.openWithoutSaving) {
                document = await vscode.workspace.openTextDocument({
                    language: "markdown",
                    content: markdown,
                });
            }
            else {
                const workspaceRoot = this.getDefaultCwd();
                if (!workspaceRoot) {
                    throw new Error("当前没有打开工作区，无法保存导出文件。可选择仅打开而不保存。");
                }
                filePath = (0, sessionMarkdown_1.resolveSessionExportPath)(workspaceRoot, payload.filename);
                await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
                await fs.promises.writeFile(filePath, markdown, "utf8");
                document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
            }
            await vscode.window.showTextDocument(document, {
                preview: false,
                preserveFocus: false,
            });
            this.respond(webview, {
                type: "session.export.markdown.response",
                requestId,
                ok: true,
                payload: {
                    opened: true,
                    ...(filePath ? { filePath } : {}),
                },
            });
        }
        catch (error) {
            this.respondError(webview, requestId, error, "导出 session Markdown 失败。");
        }
    }
    async handleSubtaskTranscriptRequest(webview, requestId, sessionId) {
        try {
            const rawMessages = await this.requestServeJson(`/session/${encodeURIComponent(sessionId)}/message`);
            const messages = (0, parsers_1.liveMessagesToTranscript)(rawMessages);
            this.respond(webview, {
                type: "subtask.transcript.response",
                requestId,
                ok: true,
                payload: { sessionId, messages },
            });
        }
        catch (error) {
            this.respondError(webview, requestId, error, "Unable to load subtask transcript.");
        }
    }
    async handleSessionDeleteRequest(webview, requestId, sessionId) {
        try {
            await (0, opencodeCli_1.sessionDelete)(sessionId, { timeoutMs: 60000 });
            this.invalidateSessionExportCache(sessionId);
            this.respond(webview, {
                type: "session.delete.response",
                requestId,
                ok: true,
                payload: { deleted: true },
            });
        }
        catch (error) {
            this.respondError(webview, requestId, error, "删除 session 失败。");
        }
    }
    async handleSessionTimelineRequest(webview, requestId, sessionId) {
        try {
            const [cachedExport, sessionInfo] = await Promise.all([
                this.getSessionExportData(sessionId),
                this.getSessionInfoForRead(sessionId),
            ]);
            const items = this.getTimelineItemsFromSessionExport(cachedExport);
            const revertMessageId = typeof sessionInfo.revert?.messageID === "string"
                ? sessionInfo.revert.messageID
                : undefined;
            this.respond(webview, {
                type: "session.timeline.response",
                requestId,
                ok: true,
                payload: {
                    sessionId,
                    revertMessageId,
                    items,
                },
            });
        }
        catch (error) {
            this.respondError(webview, requestId, error, "获取 session timeline 失败。");
        }
    }
    async handleSessionUndoRequest(webview, requestId, sessionId) {
        try {
            const payload = await this.computeUndoPayload(sessionId);
            if (!payload) {
                this.respond(webview, {
                    type: "session.undo.response",
                    requestId,
                    ok: true,
                    payload: {
                        changed: false,
                        sessionId,
                    },
                });
                return;
            }
            const updated = await this.requestServeJson(`/session/${encodeURIComponent(sessionId)}/revert`, {
                method: "POST",
                body: JSON.stringify({ messageID: payload.messageId }),
            });
            this.inlineDiff.invalidateAll("Session history changed; the previous inline diff is no longer current.");
            this.respond(webview, {
                type: "session.undo.response",
                requestId,
                ok: true,
                payload: {
                    changed: true,
                    sessionId,
                    revertMessageId: typeof updated.revert?.messageID === "string"
                        ? updated.revert.messageID
                        : undefined,
                    composerText: payload.composerText,
                },
            });
        }
        catch (error) {
            this.respondError(webview, requestId, error, "执行 undo 失败。");
        }
    }
    async handleSessionRevertRequest(webview, requestId, sessionId, messageId) {
        try {
            const [payload, sessionInfo] = await Promise.all([
                this.computeRevertPayload(sessionId, messageId),
                this.getSessionInfoForRead(sessionId),
            ]);
            if (sessionInfo.revert?.messageID === payload.messageId) {
                this.respond(webview, {
                    type: "session.revert.response",
                    requestId,
                    ok: true,
                    payload: {
                        changed: false,
                        sessionId,
                        revertMessageId: payload.messageId,
                        composerText: payload.composerText,
                    },
                });
                return;
            }
            const updated = await this.requestServeJson(`/session/${encodeURIComponent(sessionId)}/revert`, {
                method: "POST",
                body: JSON.stringify({ messageID: payload.messageId }),
            });
            this.inlineDiff.invalidateAll("Session history changed; the previous inline diff is no longer current.");
            this.respond(webview, {
                type: "session.revert.response",
                requestId,
                ok: true,
                payload: {
                    changed: true,
                    sessionId,
                    revertMessageId: typeof updated.revert?.messageID === "string"
                        ? updated.revert.messageID
                        : payload.messageId,
                    composerText: payload.composerText,
                },
            });
        }
        catch (error) {
            this.respondError(webview, requestId, error, "回退到所选消息失败。");
        }
    }
    async handleSessionRedoRequest(webview, requestId, sessionId) {
        try {
            const sessionInfo = await this.getSessionInfoForMutation(sessionId);
            if (!sessionInfo.revert?.messageID) {
                this.respond(webview, {
                    type: "session.redo.response",
                    requestId,
                    ok: true,
                    payload: {
                        changed: false,
                        sessionId,
                    },
                });
                return;
            }
            const [updated, composerText] = await Promise.all([
                this.requestServeJson(`/session/${encodeURIComponent(sessionId)}/unrevert`, {
                    method: "POST",
                    body: JSON.stringify({}),
                }),
                this.computeRedoComposerText(sessionId),
            ]);
            this.inlineDiff.invalidateAll("Session history changed; the previous inline diff is no longer current.");
            this.respond(webview, {
                type: "session.redo.response",
                requestId,
                ok: true,
                payload: {
                    changed: true,
                    sessionId,
                    revertMessageId: typeof updated.revert?.messageID === "string"
                        ? updated.revert.messageID
                        : undefined,
                    composerText,
                },
            });
        }
        catch (error) {
            this.respondError(webview, requestId, error, "执行 redo 失败。");
        }
    }
    async handleSessionForkRequest(webview, requestId, sessionId, messageId) {
        try {
            const boundaryMessageId = await this.computeForkBoundaryMessageId(sessionId, messageId);
            const forked = await this.requestServeJson(`/session/${encodeURIComponent(sessionId)}/fork`, {
                method: "POST",
                ...(boundaryMessageId
                    ? { body: JSON.stringify({ messageID: boundaryMessageId }) }
                    : {}),
            });
            if (typeof forked.id !== "string" || forked.id.trim().length === 0) {
                throw new Error("OpenCode did not return the forked session ID.");
            }
            this.invalidateSessionExportCache(forked.id);
            this.respond(webview, {
                type: "session.fork.response",
                requestId,
                ok: true,
                payload: {
                    sourceSessionId: sessionId,
                    sessionId: forked.id,
                },
            });
        }
        catch (error) {
            this.respondError(webview, requestId, error, "从所选消息创建分支会话失败。");
        }
    }
    async handleTempfileWriteRequest(webview, requestId, fileName, bytesBase64, mimeType) {
        try {
            const bytes = decodeTempfileImage(bytesBase64);
            const detectedMime = detectImageMimeType(bytes);
            if (!detectedMime) {
                throw new Error("仅支持 PNG、JPEG、GIF 或 WebP 图片。");
            }
            if (!isCompatibleImageMime(mimeType, detectedMime)) {
                throw new Error(`图片类型不匹配（声明=${mimeType ?? "unknown"}，实际=${detectedMime}）。`);
            }
            const safeName = sanitizeTempfileName(fileName, detectedMime);
            const dir = fs.mkdtempSync(path.join((0, node_os_1.tmpdir)(), "opencode-ui-image-"));
            const outPath = path.join(dir, safeName);
            fs.writeFileSync(outPath, bytes, { mode: 0o600 });
            this.trackTempFile(outPath);
            this.respond(webview, {
                type: "tempfile.write.response",
                requestId,
                ok: true,
                payload: { filePath: outPath },
            });
        }
        catch (error) {
            this.respondError(webview, requestId, error, "写入临时图片失败。");
        }
    }
    async handleFileOpenRequest(webview, requestId, filePath, line, column) {
        try {
            const resolvedPath = await this.resolveWorkspaceFileReference(filePath);
            const document = await vscode.workspace.openTextDocument(vscode.Uri.file(resolvedPath));
            const editor = await vscode.window.showTextDocument(document, { preview: true });
            if (line) {
                const lineIndex = Math.min(Math.max(0, line - 1), Math.max(0, document.lineCount - 1));
                const lineLength = document.lineAt(lineIndex).text.length;
                const columnIndex = Math.min(Math.max(0, (column ?? 1) - 1), lineLength);
                const position = new vscode.Position(lineIndex, columnIndex);
                editor.selection = new vscode.Selection(position, position);
                editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
            }
            this.respond(webview, {
                type: "file.open.response",
                requestId,
                ok: true,
                payload: {
                    path: resolvedPath,
                    line,
                    column,
                },
            });
        }
        catch (error) {
            this.respondError(webview, requestId, error, "打开文件失败。");
        }
    }
    async handleInlineDiffOpenRequest(webview, requestId, fileId) {
        try {
            const result = await this.inlineDiff.open(fileId);
            if (!result.ok) {
                throw new Error(result.message);
            }
            this.respond(webview, {
                type: "inlineDiff.open.response",
                requestId,
                ok: true,
                payload: { fileId },
            });
        }
        catch (error) {
            this.respondError(webview, requestId, error, "打开 Inline Diff 失败。");
        }
    }
    handleInlineDiffDismissRequest(webview, requestId, fileId) {
        this.inlineDiff.dismiss(fileId);
        this.respond(webview, {
            type: "inlineDiff.dismiss.response",
            requestId,
            ok: true,
            payload: { fileId },
        });
    }
    postInlineDiffState(snapshot, webview = this.view?.webview) {
        if (!webview) {
            return;
        }
        this.respond(webview, {
            type: "inlineDiff.state",
            requestId: `inline-diff-state-${String(snapshot.revision)}`,
            ok: true,
            payload: {
                revision: snapshot.revision,
                files: snapshot.files.map((file) => ({
                    fileId: file.fileId,
                    path: file.path,
                    displayPath: file.displayPath,
                    additions: file.additions,
                    deletions: file.deletions,
                    hunks: file.hunkCount,
                    status: file.status,
                    reason: file.reason,
                })),
            },
        });
    }
    async handlePermissionReplyRequest(webview, requestId, permissionId, reply, message) {
        try {
            await this.requestServeJson(`/permission/${encodeURIComponent(permissionId)}/reply`, {
                method: "POST",
                body: JSON.stringify({ reply, message }),
            });
            if (this.currentRun?.pendingPermission?.permissionId === permissionId) {
                this.currentRun.pendingPermission = undefined;
            }
            this.respond(webview, {
                type: "permission.reply.response",
                requestId,
                ok: true,
                payload: {
                    permissionId,
                    reply,
                },
            });
        }
        catch (error) {
            this.respondError(webview, requestId, error, "处理权限请求失败。");
        }
    }
    async handleQuestionReplyRequest(webview, requestId, questionId, answers) {
        try {
            await this.requestServeJson(`/question/${encodeURIComponent(questionId)}/reply`, {
                method: "POST",
                body: JSON.stringify({ answers }),
            });
            if (this.currentRun?.pendingQuestion?.questionId === questionId) {
                this.currentRun.pendingQuestion = undefined;
            }
            this.respond(webview, {
                type: "question.reply.response",
                requestId,
                ok: true,
                payload: { questionId },
            });
        }
        catch (error) {
            this.respondError(webview, requestId, error, "回复问题失败。");
        }
    }
    async handleQuestionRejectRequest(webview, requestId, questionId) {
        try {
            await this.requestServeJson(`/question/${encodeURIComponent(questionId)}/reject`, {
                method: "POST",
            });
            if (this.currentRun?.pendingQuestion?.questionId === questionId) {
                this.currentRun.pendingQuestion = undefined;
            }
            this.respond(webview, {
                type: "question.reject.response",
                requestId,
                ok: true,
                payload: { questionId },
            });
        }
        catch (error) {
            this.respondError(webview, requestId, error, "拒绝问题失败。");
        }
    }
    async handleModelsListRequest(webview, requestId, forceRefresh = false) {
        try {
            const models = await this.getModelsPayload(undefined, forceRefresh);
            this.respond(webview, {
                type: "models.list.response",
                requestId,
                ok: true,
                payload: { models },
            });
        }
        catch (error) {
            this.respondError(webview, requestId, error, "获取 models 失败。");
        }
    }
    async handleProvidersListRequest(webview, requestId, forceRefresh = false) {
        try {
            const cwd = this.getDefaultCwd();
            const [authResult, modelsResult] = await Promise.allSettled([
                (0, opencodeCli_1.authList)({ cwd }),
                this.getAllModelsPayload(forceRefresh),
            ]);
            let authProviders = [];
            if (authResult.status === "fulfilled") {
                try {
                    authProviders = (0, parsers_1.parseAuthList)(authResult.value.stdout);
                }
                catch {
                    authProviders = [];
                }
            }
            const configuredLabels = this.readConfiguredProviderLabels();
            const providerIds = modelsResult.status === "fulfilled"
                ? uniqueProviderIds(modelsResult.value.map((entry) => entry.providerID))
                : uniqueProviderIds([
                    ...authProviders.map((entry) => entry.id),
                    ...configuredLabels.keys(),
                ]);
            if (providerIds.length === 0 && modelsResult.status !== "fulfilled") {
                throw modelsResult.reason;
            }
            const providers = (0, parsers_1.buildProviderSummaries)(authProviders, providerIds, configuredLabels);
            this.respond(webview, {
                type: "providers.list.response",
                requestId,
                ok: true,
                payload: { providers },
            });
        }
        catch (error) {
            this.respondError(webview, requestId, error, "获取 providers 失败。");
        }
    }
    async handleModelsListByProviderRequest(webview, requestId, providerId, forceRefresh = false) {
        try {
            const models = await this.getModelsPayload(providerId, forceRefresh);
            this.respond(webview, {
                type: "models.list.response",
                requestId,
                ok: true,
                payload: { models },
            });
        }
        catch (error) {
            this.respondError(webview, requestId, error, `获取 models 失败（provider=${providerId}）。`);
        }
    }
    async handleProviderSettingsGetRequest(webview, requestId, scope, forceRefresh) {
        try {
            const snapshot = await this.buildProviderSettingsSnapshot(scope, forceRefresh);
            this.respond(webview, {
                type: "provider.settings.get.response",
                requestId,
                ok: true,
                payload: snapshot,
            });
        }
        catch (error) {
            this.respondError(webview, requestId, error, "读取 provider 配置失败。");
        }
    }
    async handleProviderSettingsModelsRequest(webview, requestId, providerId, forceRefresh) {
        try {
            const catalog = await this.getProviderSettingsCatalog(forceRefresh);
            this.respond(webview, {
                type: "provider.settings.models.response",
                requestId,
                ok: true,
                payload: {
                    providerId,
                    models: catalog.modelsByProvider.get(providerId) ?? [],
                },
            });
        }
        catch (error) {
            this.respondError(webview, requestId, error, "读取 provider 模型目录失败。");
        }
    }
    async handleProviderSettingsUpstreamModelsRequest(webview, requestId, scope, draft, endpoint) {
        try {
            const result = await (0, providerUpstreamModels_1.fetchProviderUpstreamModels)(scope, draft, endpoint, {
                ...this.getProviderSettingsPathContext(),
            });
            this.respond(webview, {
                type: "provider.settings.upstreamModels.response",
                requestId,
                ok: true,
                payload: {
                    providerId: draft.id,
                    endpoint: result.endpoint,
                    models: result.models,
                },
            });
        }
        catch (error) {
            this.respondError(webview, requestId, error, "拉取上游模型失败。");
        }
    }
    async handleProviderSettingsSaveRequest(webview, requestId, scope, revision, draft) {
        try {
            await (0, providerSettings_1.saveProviderConfigDraft)(scope, revision, draft, this.getProviderSettingsPathContext());
            try {
                await this.syncProviderCredential(draft);
            }
            catch (error) {
                const detail = error instanceof Error ? error.message : String(error);
                throw new Error(`配置文件已保存，但 credential 更新失败：${detail}`);
            }
            try {
                await (0, serveManager_1.restartServeForConfigChange)();
            }
            catch (error) {
                const detail = error instanceof Error ? error.message : String(error);
                throw new Error(`配置文件已保存，但 OpenCode 重新载入配置失败：${detail}`);
            }
            this.invalidateProviderCaches();
            const snapshot = await this.buildProviderSettingsSnapshot(scope, true);
            this.respond(webview, {
                type: "provider.settings.save.response",
                requestId,
                ok: true,
                payload: snapshot,
            });
        }
        catch (error) {
            this.respondError(webview, requestId, error, "保存 provider 配置失败。");
        }
    }
    async handleProviderSettingsDeleteRequest(webview, requestId, scope, revision, providerId) {
        try {
            await (0, providerSettings_1.deleteProviderConfigDraft)(scope, revision, providerId, this.getProviderSettingsPathContext());
            await (0, serveManager_1.restartServeForConfigChange)();
            this.invalidateProviderCaches();
            const snapshot = await this.buildProviderSettingsSnapshot(scope, true);
            this.respond(webview, {
                type: "provider.settings.delete.response",
                requestId,
                ok: true,
                payload: snapshot,
            });
        }
        catch (error) {
            this.respondError(webview, requestId, error, "删除 provider 配置失败。");
        }
    }
    async handleProviderSettingsOpenConfigRequest(webview, requestId, scope) {
        try {
            const document = await (0, providerSettings_1.ensureProviderConfigFile)(scope, this.getProviderSettingsPathContext());
            const textDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(document.path));
            await vscode.window.showTextDocument(textDocument, {
                preview: false,
                preserveFocus: false,
            });
            this.respond(webview, {
                type: "provider.settings.openConfig.response",
                requestId,
                ok: true,
                payload: { scope, path: document.path },
            });
        }
        catch (error) {
            this.respondError(webview, requestId, error, "打开 provider 配置失败。");
        }
    }
    async handleProviderAuthApiRequest(webview, requestId, providerId, key, metadata) {
        try {
            const body = {
                type: "api",
                key,
                ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
            };
            await this.requestServeNoContent(`/auth/${encodeURIComponent(providerId)}`, {
                method: "PUT",
                body: JSON.stringify(body),
                includeCwd: false,
            });
            this.invalidateProviderCaches();
            this.respond(webview, {
                type: "provider.auth.api.response",
                requestId,
                ok: true,
                payload: { providerId },
            });
        }
        catch (error) {
            this.respondError(webview, requestId, error, "保存 Provider API key 失败。");
        }
    }
    async handleProviderAuthOAuthAuthorizeRequest(webview, requestId, providerId, method, inputs) {
        try {
            const authorization = await this.requestServeJson(`/provider/${encodeURIComponent(providerId)}/oauth/authorize`, {
                method: "POST",
                body: JSON.stringify({ method, inputs }),
            });
            if (!authorization) {
                throw new Error("OpenCode 未返回 OAuth 授权信息。");
            }
            await this.openProviderAuthUrl(authorization.url);
            this.respond(webview, {
                type: "provider.auth.oauth.authorize.response",
                requestId,
                ok: true,
                payload: { providerId, method, authorization },
            });
        }
        catch (error) {
            this.respondError(webview, requestId, error, "启动 Provider OAuth 登录失败。");
        }
    }
    async handleProviderAuthOAuthCallbackRequest(webview, requestId, providerId, method, code) {
        try {
            await this.requestServeJson(`/provider/${encodeURIComponent(providerId)}/oauth/callback`, {
                method: "POST",
                body: JSON.stringify({ method, ...(code ? { code } : {}) }),
            });
            this.invalidateProviderCaches();
            this.respond(webview, {
                type: "provider.auth.oauth.callback.response",
                requestId,
                ok: true,
                payload: { providerId },
            });
        }
        catch (error) {
            this.respondError(webview, requestId, error, "完成 Provider OAuth 登录失败。");
        }
    }
    async handleProviderAuthDisconnectRequest(webview, requestId, providerId) {
        try {
            await this.requestServeNoContent(`/auth/${encodeURIComponent(providerId)}`, {
                method: "DELETE",
                includeCwd: false,
            });
            this.invalidateProviderCaches();
            this.respond(webview, {
                type: "provider.auth.disconnect.response",
                requestId,
                ok: true,
                payload: { providerId },
            });
        }
        catch (error) {
            this.respondError(webview, requestId, error, "移除 Provider 登录凭据失败。");
        }
    }
    async handleProviderAuthOpenExternalRequest(webview, requestId, url) {
        try {
            await this.openProviderAuthUrl(url);
            this.respond(webview, {
                type: "provider.auth.openExternal.response",
                requestId,
                ok: true,
                payload: { url },
            });
        }
        catch (error) {
            this.respondError(webview, requestId, error, "打开 Provider 授权链接失败。");
        }
    }
    async openProviderAuthUrl(value) {
        let url;
        try {
            url = new URL(value);
        }
        catch {
            throw new Error("OpenCode 返回了无效的授权链接。");
        }
        if (url.protocol !== "https:" && url.protocol !== "http:") {
            throw new Error("只允许打开 HTTP 或 HTTPS 授权链接。");
        }
        const opened = await vscode.env.openExternal(vscode.Uri.parse(url.toString(), true));
        if (!opened) {
            throw new Error("系统未能打开默认浏览器。");
        }
    }
    getProviderSettingsPathContext() {
        return { workspaceFolder: this.getDefaultCwd() };
    }
    async buildProviderSettingsSnapshot(scope, forceRefresh) {
        const [document, catalog, storedCredentials] = await Promise.all([
            (0, providerSettings_1.readProviderConfigDocument)(scope, this.getProviderSettingsPathContext()),
            this.getProviderSettingsCatalog(forceRefresh),
            this.loadStoredProviderCredentials(),
        ]);
        const providerIdentities = new Map(catalog.entries.map((entry) => [entry.id, { id: entry.id, label: entry.label }]));
        const configuredProviders = isRecord(document.config.provider)
            ? document.config.provider
            : {};
        for (const [id, value] of Object.entries(configuredProviders)) {
            const provider = isRecord(value) ? value : undefined;
            providerIdentities.set(id, {
                id,
                label: typeof provider?.name === "string" && provider.name.trim() ? provider.name : id,
            });
        }
        const storedCredentialProviderIds = (0, providerCatalog_1.resolveStoredCredentialProviderIds)(storedCredentials, [...providerIdentities.values()]);
        const storedCredentialTypes = (0, providerCatalog_1.resolveStoredCredentialTypes)(storedCredentials, [...providerIdentities.values()]);
        const configured = (0, providerSettings_1.providerConfigToDrafts)(document.config, {
            connectedProviderIds: catalog.connectedProviderIds,
            storedCredentialProviderIds,
            knownProviderIds: catalog.builtInProviderIds,
        });
        const catalogEntries = catalog.entries.map((entry) => ({
            ...entry,
            credentialStored: storedCredentialProviderIds.has(entry.id),
            credentialType: storedCredentialTypes.get(entry.id) ?? null,
        }));
        return {
            scope,
            path: document.path,
            exists: document.exists,
            revision: document.revision,
            workspaceAvailable: document.workspaceAvailable,
            customConfigPath: document.customConfigPath,
            catalog: (0, providerCatalog_1.mergeConfiguredCatalogEntries)(catalogEntries, configured),
            configured,
        };
    }
    async loadStoredProviderCredentials() {
        try {
            const result = await (0, opencodeCli_1.authList)({ cwd: this.getDefaultCwd(), timeoutMs: 10000 });
            return (0, parsers_1.parseAuthList)(result.stdout);
        }
        catch {
            return [];
        }
    }
    async getProviderSettingsCatalog(forceRefresh) {
        if (forceRefresh) {
            this.providerSettingsCatalogCache = undefined;
        }
        const cached = this.providerSettingsCatalogCache;
        if (!forceRefresh
            && cached
            && Date.now() - cached.loadedAt < PROVIDER_SETTINGS_CATALOG_TTL_MS) {
            return cached.catalog;
        }
        if (this.providerSettingsCatalogInFlight) {
            return this.providerSettingsCatalogInFlight;
        }
        const task = this.loadProviderSettingsCatalog();
        this.providerSettingsCatalogInFlight = task;
        try {
            const catalog = await task;
            this.providerSettingsCatalogCache = { loadedAt: Date.now(), catalog };
            return catalog;
        }
        finally {
            if (this.providerSettingsCatalogInFlight === task) {
                this.providerSettingsCatalogInFlight = undefined;
            }
        }
    }
    async loadProviderSettingsCatalog() {
        try {
            const [providerPayload, authResult] = await Promise.all([
                this.requestServeJson("/provider"),
                this.requestServeJson("/provider/auth", { includeCwd: false }).catch((error) => {
                    const message = error instanceof Error ? error.message : String(error);
                    (0, diagnostics_1.logWarn)(`provider auth methods unavailable: ${message}`);
                    return {};
                }),
            ]);
            return (0, providerCatalog_1.normalizeProviderCatalog)(providerPayload, authResult);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            (0, diagnostics_1.logWarn)(`provider endpoint unavailable, falling back to CLI catalog: ${message}`);
            return this.loadFallbackProviderSettingsCatalog();
        }
    }
    async loadFallbackProviderSettingsCatalog() {
        const [models, authResult] = await Promise.all([
            this.getAllModelsPayload(false),
            (0, opencodeCli_1.authList)({ cwd: this.getDefaultCwd() }).catch(() => undefined),
        ]);
        const providers = new Map();
        for (const entry of models) {
            const parsed = splitModel(entry.name);
            const providerId = entry.providerID || parsed?.providerID;
            const modelId = parsed?.modelID;
            if (!providerId || !modelId) {
                continue;
            }
            const provider = providers.get(providerId) ?? {
                id: providerId,
                name: providerId,
                source: "cli",
                models: {},
            };
            const providerModels = provider.models;
            providerModels[modelId] = {
                name: modelId,
                reasoning: entry.supportsThinking === true,
                variants: entry.variants
                    ? Object.fromEntries(entry.variants.map((variant) => [variant, {}]))
                    : undefined,
            };
            providers.set(providerId, provider);
        }
        const authProviders = authResult ? (0, parsers_1.parseAuthList)(authResult.stdout) : [];
        const authPayload = Object.fromEntries(authProviders.map((provider) => [
            provider.id,
            [{ type: "api", label: "Configured credential" }],
        ]));
        return (0, providerCatalog_1.normalizeProviderCatalog)({
            all: [...providers.values()],
            connected: authProviders.map((provider) => provider.id),
        }, authPayload);
    }
    async syncProviderCredential(draft) {
        const pathname = `/auth/${encodeURIComponent(draft.id)}`;
        if (draft.credential.mode === "store" && draft.credential.value) {
            await this.requestServeNoContent(pathname, {
                method: "PUT",
                body: JSON.stringify({ type: "api", key: draft.credential.value }),
                includeCwd: false,
            });
            return;
        }
        if ((0, providerSettings_1.shouldDeleteStoredProviderCredential)(draft)) {
            await this.requestServeNoContent(pathname, {
                method: "DELETE",
                includeCwd: false,
            });
        }
    }
    invalidateProviderCaches() {
        this.providerSettingsCatalogCache = undefined;
        this.modelsCache.clear();
    }
    async handleAgentsListRequest(webview, requestId) {
        try {
            const result = await (0, opencodeCli_1.agentList)({ cwd: this.getDefaultCwd() });
            const entries = (0, parsers_1.parseAgentList)(result.stdout);
            this.respond(webview, {
                type: "agents.list.response",
                requestId,
                ok: true,
                payload: {
                    agents: entries.map((entry) => ({
                        name: entry.name,
                        isPrimary: entry.isPrimary,
                    })),
                },
            });
        }
        catch (error) {
            this.respondError(webview, requestId, error, "获取 agents 失败。");
        }
    }
    async handleComposerResourcesListRequest(webview, requestId) {
        const [commandsResult, skillsResult, mcpResult] = await Promise.allSettled([
            this.requestServeJson("/command"),
            this.requestServeJson("/skill"),
            this.requestServeJson("/mcp"),
        ]);
        this.respond(webview, {
            type: "composer.resources.list.response",
            requestId,
            ok: true,
            payload: {
                commands: commandsResult.status === "fulfilled"
                    ? normalizeComposerCommands(commandsResult.value)
                    : [],
                skills: skillsResult.status === "fulfilled"
                    ? normalizeComposerSkills(skillsResult.value)
                    : [],
                mcpServers: mcpResult.status === "fulfilled"
                    ? normalizeComposerMcpServers(mcpResult.value)
                    : [],
                ...(mcpResult.status === "rejected"
                    ? {
                        mcpError: mcpResult.reason instanceof Error && mcpResult.reason.message.trim()
                            ? mcpResult.reason.message.trim()
                            : "获取 MCP server 状态失败。",
                    }
                    : {}),
            },
        });
    }
    async handleMcpSetEnabledRequest(webview, requestId, name, enabled) {
        try {
            const encodedName = encodeURIComponent(name.trim());
            await this.requestServeNoContent(`/mcp/${encodedName}/${enabled ? "connect" : "disconnect"}`, { method: "POST" });
            const server = await this.waitForMcpServerTransition(name, enabled);
            this.respond(webview, {
                type: "mcp.setEnabled.response",
                requestId,
                ok: true,
                payload: { server },
            });
        }
        catch (error) {
            this.respondError(webview, requestId, error, "切换 MCP server 失败。");
        }
    }
    async waitForMcpServerTransition(name, enabled) {
        let lastServer;
        let lastReadError;
        for (const waitMs of MCP_TRANSITION_POLL_DELAYS_MS) {
            if (waitMs > 0) {
                await (0, runLifecycle_1.delay)(waitMs);
            }
            let status;
            try {
                status = await this.requestServeJson("/mcp");
                lastReadError = undefined;
            }
            catch (error) {
                lastReadError = error instanceof Error ? error.message : String(error);
                continue;
            }
            const server = normalizeComposerMcpServers(status).find((entry) => entry.name === name);
            if (!server) {
                continue;
            }
            lastServer = server;
            const normalizedStatus = server.status.trim().toLowerCase();
            if (server.error || ["error", "failed"].includes(normalizedStatus)) {
                throw new Error(server.error || `MCP server ${name} 状态为 ${server.status}。`);
            }
            if (server.enabled === enabled) {
                return server;
            }
        }
        const target = enabled ? "连接" : "断开";
        const detail = lastReadError
            ? `，最后一次状态读取失败：${lastReadError}`
            : lastServer
                ? `，当前状态为 ${lastServer.status}`
                : "";
        throw new Error(`MCP server ${name} 未能在等待时间内${target}${detail}。`);
    }
    async handleWorkspaceResourcesSearchRequest(webview, requestId, query) {
        try {
            const resources = await this.searchWorkspaceResources(query);
            this.respond(webview, {
                type: "workspace.resources.search.response",
                requestId,
                ok: true,
                payload: { query, resources },
            });
        }
        catch (error) {
            this.respondError(webview, requestId, error, "搜索工作区文件失败。");
        }
    }
    async handleWorkspaceResourcesResolveRequest(webview, requestId, values) {
        try {
            const resolved = await Promise.all(values.flatMap((value) => value
                .split(/\r?\n/)
                .map((entry) => entry.trim())
                .filter((entry) => entry.length > 0 && !entry.startsWith("#"))
                .map((entry) => this.resolveDroppedWorkspaceResource(entry))));
            const resources = uniqueWorkspaceResources(resolved.filter((entry) => Boolean(entry)));
            this.respond(webview, {
                type: "workspace.resources.resolve.response",
                requestId,
                ok: true,
                payload: { resources },
            });
        }
        catch (error) {
            this.respondError(webview, requestId, error, "解析拖入的工作区资源失败。");
        }
    }
    async searchWorkspaceResources(query) {
        const folders = vscode.workspace.workspaceFolders ?? [];
        if (folders.length === 0) {
            return [];
        }
        const searchGlobs = buildWorkspaceSearchGlobs(query);
        const fileGroups = await Promise.all(searchGlobs.map((glob, index) => vscode.workspace.findFiles(glob, undefined, index === 0 ? 1600 : 1000)));
        const files = [
            ...new Map(fileGroups.flat().map((uri) => [uri.toString(), uri])).values(),
        ];
        const candidates = new Map();
        for (const file of files) {
            const summary = this.toWorkspaceResource(file, "file");
            if (!summary) {
                continue;
            }
            candidates.set(`file:${summary.absolutePath}`, summary);
            const folder = vscode.workspace.getWorkspaceFolder(file);
            if (!folder) {
                continue;
            }
            let parentPath = path.posix.dirname(file.path);
            while (parentPath.length >= folder.uri.path.length && parentPath !== folder.uri.path) {
                const parent = file.with({ path: parentPath });
                const parentSummary = this.toWorkspaceResource(parent, "folder");
                if (parentSummary) {
                    candidates.set(`folder:${parentSummary.absolutePath}`, parentSummary);
                }
                const next = path.posix.dirname(parentPath);
                if (next === parentPath) {
                    break;
                }
                parentPath = next;
            }
        }
        return [...candidates.values()]
            .map((resource) => ({ resource, score: scoreWorkspaceResource(resource, query) }))
            .filter((entry) => entry.score < Number.POSITIVE_INFINITY)
            .sort((left, right) => left.score - right.score || left.resource.path.localeCompare(right.resource.path))
            .slice(0, 60)
            .map((entry) => entry.resource);
    }
    async resolveDroppedWorkspaceResource(value) {
        const unquoted = value.replace(/^['"]|['"]$/g, "");
        let uri;
        try {
            const parsed = vscode.Uri.parse(unquoted, true);
            if (parsed.scheme && parsed.scheme !== "untitled") {
                uri = parsed;
            }
        }
        catch {
            uri = undefined;
        }
        if (!uri || !vscode.workspace.getWorkspaceFolder(uri)) {
            try {
                uri = vscode.Uri.file(this.resolveWorkspaceFilePath(decodeURIComponent(unquoted)));
            }
            catch {
                return null;
            }
        }
        if (!vscode.workspace.getWorkspaceFolder(uri)) {
            return null;
        }
        const stat = await vscode.workspace.fs.stat(uri);
        const kind = (stat.type & vscode.FileType.Directory) !== 0 ? "folder" : "file";
        return this.toWorkspaceResource(uri, kind);
    }
    toWorkspaceResource(uri, kind) {
        if (!vscode.workspace.getWorkspaceFolder(uri)) {
            return null;
        }
        const includeWorkspaceFolder = (vscode.workspace.workspaceFolders?.length ?? 0) > 1;
        const relativePath = vscode.workspace.asRelativePath(uri, includeWorkspaceFolder).replace(/\\/g, "/");
        return {
            kind,
            path: kind === "folder" ? `${relativePath.replace(/\/$/, "")}/` : relativePath,
            absolutePath: uri.fsPath,
        };
    }
    async handleSelfcheckRunRequest(webview, requestId) {
        const env = (0, opencodeEnv_1.withOpencodeBinInPath)();
        const cwd = this.getDefaultCwd();
        const [opencode, health, sessions, models, agents] = await Promise.all([
            this.getOpencodeCompatibility(env, cwd),
            this.checkServeHealth(),
            this.safeCount(async () => {
                const result = await (0, opencodeCli_1.sessionListJson)({ env, cwd });
                const parsed = (0, parsers_1.parseSessionListJson)(result.stdout);
                return parsed.length;
            }),
            this.safeCount(async () => {
                const result = await (0, opencodeCli_1.modelsList)({ env, cwd });
                const parsed = (0, parsers_1.parseModelsList)(result.stdout);
                return parsed.length;
            }),
            this.safeCount(async () => {
                const result = await (0, opencodeCli_1.agentList)({ env, cwd });
                const parsed = (0, parsers_1.parseAgentList)(result.stdout);
                return parsed.length;
            }),
        ]);
        const opencodeBinary = opencode.binary;
        this.respond(webview, {
            type: "selfcheck.response",
            requestId,
            ok: true,
            payload: {
                hostKind: this.hostKind,
                isSupportedHost: this.isSupportedHost(),
                remoteName: this.remoteName,
                opencodeBinary,
                opencode,
                health,
                sessions,
                models,
                agents,
            },
        });
    }
    async checkServeHealth() {
        let lastError = "OpenCode serve 健康检查失败。";
        for (let attempt = 0; attempt < 2; attempt += 1) {
            try {
                const result = await this.requestServeJson("/global/health", { includeCwd: false });
                if (result.healthy === true) {
                    return { ok: true, version: result.version };
                }
                lastError = "OpenCode serve 返回了非健康状态。";
            }
            catch (error) {
                lastError = error instanceof Error ? error.message : String(error);
            }
            if (attempt === 0) {
                await (0, runLifecycle_1.delay)(400);
            }
        }
        return { ok: false, error: lastError };
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
            this.respond(webview, {
                type: "webview.error",
                requestId,
                ok: false,
                error: "已有运行中的任务，请先停止。",
            });
            return;
        }
        if (!this.isSupportedHost()) {
            this.respond(webview, {
                type: "webview.error",
                requestId,
                ok: false,
                error: "当前扩展宿主暂不支持运行 opencode。请在 Windows 本机、Linux 本机、Remote-WSL 或 Remote-SSH Linux 中使用。",
            });
            return;
        }
        const controller = new AbortController();
        const eventAbort = new AbortController();
        try {
            await Promise.all([
                this.workspaceState.update(SidebarProvider.WORKSPACE_KEY_LAST_SELECTED_MODEL, payload.model),
                this.workspaceState.update(SidebarProvider.WORKSPACE_KEY_LAST_SELECTED_AGENT, payload.agent),
            ]);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            (0, diagnostics_1.logWarn)(`persist selection failed: ${message}`);
            console.warn("[opencode-ui] persist selection failed:", message);
        }
        this.currentRun = { requestId, controller, eventAbort };
        this.respond(webview, { type: "run.start.response", requestId, ok: true });
        let watchdog;
        let inlineDiffRun;
        let inlineDiffFinished = false;
        const finishInlineDiff = (outcome) => {
            if (!inlineDiffRun || inlineDiffFinished) {
                return;
            }
            inlineDiffFinished = true;
            void inlineDiffRun.finish(outcome).catch((error) => {
                (0, diagnostics_1.logError)(`inline diff finish failed: ${String(error)}`);
            });
        };
        try {
            const runtime = await (0, serveManager_1.ensureServeRunning)();
            const sessionId = await this.ensureSessionForPrompt(payload, runtime.baseUrl);
            if (this.currentRun?.requestId !== requestId) {
                return;
            }
            this.invalidateSessionExportCache(sessionId);
            this.currentRun.sessionId = sessionId;
            this.respondRunEvent(webview, requestId, { type: "session", sessionId });
            inlineDiffRun = this.inlineDiff.beginRun({
                runId: requestId,
                sessionId,
                cwd: this.getDefaultCwd() ?? process.cwd(),
                startedAt: Date.now(),
                promptText: payload.message,
            });
            this.currentRun.inlineDiffRun = inlineDiffRun;
            const streamState = (0, runLifecycle_1.createServeStreamState)();
            const eventTask = this.consumeServeEvents(webview, requestId, sessionId, runtime.baseUrl, eventAbort.signal, streamState);
            const blockerPoll = this.startBlockerPoll(webview, requestId, sessionId, streamState);
            if (this.currentRun?.requestId === requestId) {
                this.currentRun.blockerPoll = blockerPoll;
            }
            const startedAt = Date.now();
            watchdog = setTimeout(() => {
                if (!this.currentRun || this.currentRun.requestId !== requestId) {
                    return;
                }
                const seconds = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
                this.respondRunEvent(webview, requestId, {
                    type: "part",
                    part: {
                        type: "tool",
                        toolName: "status",
                        status: "waiting",
                        raw: {
                            message: `opencode 还没有产出可见事件（${String(seconds)}s）。这通常意味着：provider 首 token 很慢，或当前正在等待工具/权限流转。`,
                        },
                    },
                });
            }, 8000);
            if (payload.command) {
                const parts = buildPromptParts("", payload.files, this.hostKind).filter((part) => part.type === "file");
                await this.requestServeJson(`/session/${encodeURIComponent(sessionId)}/command`, {
                    method: "POST",
                    signal: controller.signal,
                    body: JSON.stringify({
                        agent: payload.agent,
                        model: payload.model,
                        variant: payload.variant || undefined,
                        command: payload.command.name,
                        arguments: payload.command.arguments,
                        ...(parts.length > 0 ? { parts } : {}),
                    }),
                });
            }
            else {
                await this.requestServeNoContent(`/session/${encodeURIComponent(sessionId)}/prompt_async`, {
                    method: "POST",
                    signal: controller.signal,
                    body: JSON.stringify({
                        agent: payload.agent,
                        model: splitModel(payload.model),
                        variant: payload.variant || undefined,
                        parts: buildPromptParts(payload.message, payload.files, this.hostKind),
                    }),
                });
            }
            const completionResult = await eventTask;
            if (!this.currentRun || this.currentRun.requestId !== requestId) {
                return;
            }
            if (completionResult === "stopped") {
                this.clearCurrentRunForRequest(requestId);
                this.respondRunEvent(webview, requestId, { type: "stopped" });
                finishInlineDiff("stopped");
                return;
            }
            if (completionResult instanceof Error) {
                this.clearCurrentRunForRequest(requestId);
                if (completionResult.name === "AbortError") {
                    this.respondRunEvent(webview, requestId, { type: "stopped" });
                    finishInlineDiff("stopped");
                }
                else {
                    this.respondRunEvent(webview, requestId, {
                        type: "error",
                        error: completionResult.message || "运行失败。",
                    });
                    finishInlineDiff("failed");
                }
                return;
            }
            this.clearCurrentRunForRequest(requestId);
            this.respondRunEvent(webview, requestId, { type: "done" });
            finishInlineDiff("done");
        }
        catch (error) {
            if (!this.currentRun || this.currentRun.requestId !== requestId) {
                return;
            }
            const isAborted = (error instanceof opencodeCli_1.OpencodeCliError && error.code === "ABORTED") ||
                (error instanceof Error && error.name === "AbortError");
            this.clearCurrentRunForRequest(requestId);
            if (isAborted) {
                this.respondRunEvent(webview, requestId, { type: "stopped" });
                finishInlineDiff("stopped");
            }
            else {
                const errorMessage = error instanceof Error ? error.message : "运行失败。";
                this.respondRunEvent(webview, requestId, {
                    type: "error",
                    error: errorMessage,
                });
                finishInlineDiff("failed");
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
            if (!inlineDiffFinished) {
                finishInlineDiff("stopped");
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
        this.respond(webview, {
            type: "run.stop.response",
            requestId,
            ok: true,
            payload: { stopped: hadRun },
        });
    }
    async abortServeSession(sessionId) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        try {
            await this.requestServeNoContent(`/session/${encodeURIComponent(sessionId)}/abort`, {
                method: "POST",
                signal: controller.signal,
            });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            (0, diagnostics_1.logWarn)(`abort session ${sessionId} failed: ${message}`);
            console.warn("[opencode-ui] abort session failed:", message);
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
                method: "POST",
                body: JSON.stringify({
                    reply: "reject",
                    message: "侧边栏已隐藏，自动拒绝挂起的权限请求。",
                }),
            }).catch((error) => {
                const message = error instanceof Error ? error.message : String(error);
                (0, diagnostics_1.logWarn)(`auto reject hidden permission failed: ${message}`);
                console.warn("[opencode-ui] auto reject hidden permission failed:", message);
            });
        }
        if (pendingQuestion) {
            run.pendingQuestion = undefined;
            void this.requestServeJson(`/question/${encodeURIComponent(pendingQuestion.questionId)}/reject`, {
                method: "POST",
            }).catch((error) => {
                const message = error instanceof Error ? error.message : String(error);
                (0, diagnostics_1.logWarn)(`auto reject hidden question failed: ${message}`);
                console.warn("[opencode-ui] auto reject hidden question failed:", message);
            });
        }
        this.respondRunEvent(webview, run.requestId, { type: "stopped" });
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
            console.warn("[opencode-ui] cleanup temp file failed:", error);
        }
    }
    respondRunEvent(webview, requestId, event) {
        this.respond(webview, {
            type: "run.event",
            requestId,
            ok: true,
            payload: { event },
        });
    }
    async ensureSessionForPrompt(payload, baseUrl) {
        if (payload.sessionId) {
            return payload.sessionId;
        }
        const created = await this.requestServeJson("/session", {
            method: "POST",
            body: JSON.stringify({
                title: resolveNewSessionTitle(payload),
            }),
        });
        return created.id;
    }
    async consumeServeEvents(webview, requestId, sessionId, baseUrl, signal, streamState) {
        const lifecycle = this.createRunLifecycleAdapter(webview, requestId);
        try {
            const response = await fetch(`${baseUrl}/event`, {
                headers: this.buildServeHeaders({ Accept: "text/event-stream" }),
                signal,
            });
            if (!response.ok || !response.body) {
                return new Error(`订阅事件流失败（${String(response.status)}）。`);
            }
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    break;
                }
                buffer += decoder.decode(value, { stream: true });
                let boundary = buffer.indexOf("\n\n");
                while (boundary >= 0) {
                    const chunk = buffer.slice(0, boundary);
                    buffer = buffer.slice(boundary + 2);
                    boundary = buffer.indexOf("\n\n");
                    const data = chunk
                        .split("\n")
                        .filter((line) => line.startsWith("data:"))
                        .map((line) => line.slice(5).trim())
                        .join("\n");
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
                    const result = (0, runLifecycle_1.dispatchServeEvent)(lifecycle, requestId, sessionId, event, streamState);
                    if (result.done) {
                        await (0, runLifecycle_1.pollServeBlockers)(lifecycle, requestId, sessionId, streamState);
                        if (!(0, runLifecycle_1.hasPendingServeBlockers)(streamState)) {
                            return "done";
                        }
                    }
                }
            }
            await (0, runLifecycle_1.pollServeBlockers)(lifecycle, requestId, sessionId, streamState);
            while (!signal.aborted && (0, runLifecycle_1.hasPendingServeBlockers)(streamState)) {
                await (0, runLifecycle_1.delay)(runLifecycle_1.BLOCKER_POLL_INTERVAL_MS, signal).catch(() => undefined);
                await (0, runLifecycle_1.pollServeBlockers)(lifecycle, requestId, sessionId, streamState);
            }
            return signal.aborted ? "stopped" : "done";
        }
        catch (error) {
            return error instanceof Error ? error : new Error(String(error));
        }
    }
    startBlockerPoll(webview, requestId, sessionId, streamState) {
        const lifecycle = this.createRunLifecycleAdapter(webview, requestId);
        let inFlight = false;
        const poll = async () => {
            if (inFlight || this.currentRun?.requestId !== requestId) {
                return;
            }
            inFlight = true;
            try {
                await (0, runLifecycle_1.pollServeBlockers)(lifecycle, requestId, sessionId, streamState);
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                (0, diagnostics_1.logWarn)(`poll serve blockers failed: ${message}`);
                console.warn("[opencode-ui] poll serve blockers failed:", message);
            }
            finally {
                inFlight = false;
            }
        };
        void poll();
        const timer = setInterval(() => {
            void poll();
        }, runLifecycle_1.BLOCKER_POLL_INTERVAL_MS);
        timer.unref?.();
        return timer;
    }
    createRunLifecycleAdapter(webview, requestId) {
        return {
            isCurrentRun: (candidateRequestId) => this.currentRun?.requestId === candidateRequestId,
            emit: (event) => {
                if (this.currentRun?.requestId === requestId) {
                    this.currentRun.inlineDiffRun?.observe(event);
                }
                this.respondRunEvent(webview, requestId, event);
            },
            acceptBlockerSession: (candidateRequestId, sessionId, blockerSessionId) => {
                if (!blockerSessionId) {
                    return false;
                }
                return (blockerSessionId === sessionId ||
                    this.currentRun?.requestId === candidateRequestId);
            },
            setPendingPermission: (event) => {
                if (this.currentRun?.requestId === requestId) {
                    this.currentRun.pendingPermission = event;
                }
            },
            setPendingQuestion: (event) => {
                if (this.currentRun?.requestId === requestId) {
                    this.currentRun.pendingQuestion = event;
                }
            },
            requestServeJson: (pathname) => this.requestServeJson(pathname),
        };
    }
    pickSessionId(value) {
        if (typeof value !== "object" || value === null) {
            return null;
        }
        const record = value;
        const direct = record.sessionID ?? record.sessionId;
        if (typeof direct === "string") {
            const trimmed = direct.trim();
            return trimmed.length > 0 ? trimmed : null;
        }
        return null;
    }
    async computeUndoPayload(sessionId) {
        const [cachedExport, sessionInfo] = await Promise.all([
            this.getSessionExportData(sessionId),
            this.getSessionInfoForRead(sessionId),
        ]);
        const targets = collectUserTimelineTargetsFromItems(this.getTimelineItemsFromSessionExport(cachedExport));
        if (targets.length === 0) {
            return null;
        }
        const revertMessageId = sessionInfo.revert?.messageID;
        if (typeof revertMessageId !== "string" ||
            revertMessageId.trim().length === 0) {
            const last = targets[targets.length - 1];
            return last
                ? { messageId: last.messageId, composerText: last.text }
                : null;
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
    async computeRevertPayload(sessionId, messageId) {
        const cachedExport = await this.getSessionExportData(sessionId);
        const target = collectUserTimelineTargetsFromItems(this.getTimelineItemsFromSessionExport(cachedExport)).find((item) => item.messageId === messageId);
        if (!target) {
            throw new Error("The selected user message is no longer available in this session.");
        }
        return { messageId: target.messageId, composerText: target.text };
    }
    async computeForkBoundaryMessageId(sessionId, messageId) {
        const cachedExport = await this.getSessionExportData(sessionId);
        const sourceIndex = cachedExport.data.messages.findIndex((message) => {
            const info = isRecord(message.info) ? message.info : undefined;
            return info?.id === messageId;
        });
        const source = cachedExport.data.messages[sourceIndex];
        const info = source && isRecord(source.info) ? source.info : undefined;
        if (info?.role !== "assistant") {
            throw new Error("The selected assistant message is no longer available in this session.");
        }
        const finish = typeof info.finish === "string" ? info.finish.trim().toLowerCase() : "";
        const hasText = source.parts.some((part) => {
            if (!isRecord(part) || part.type !== "text") {
                return false;
            }
            return typeof part.text === "string" && part.text.trim().length > 0;
        });
        if (!hasText || !finish || finish === "tool-calls" || finish === "unknown") {
            throw new Error("Only a completed assistant response can be forked.");
        }
        for (const message of cachedExport.data.messages.slice(sourceIndex + 1)) {
            const nextInfo = isRecord(message.info) ? message.info : undefined;
            if (typeof nextInfo?.id === "string" && nextInfo.id.trim().length > 0) {
                return nextInfo.id;
            }
        }
        return undefined;
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
                transcriptsByRevertKey: new Map(),
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
        const revertKey = `${sessionInfo.revert?.messageID ?? ""}:${sessionInfo.revert?.partID ?? ""}`;
        const cachedTranscript = cachedExport.transcriptsByRevertKey.get(revertKey);
        if (cachedTranscript) {
            return cachedTranscript;
        }
        const visibleMessages = applyRevertToExportMessages(cachedExport.data.messages, sessionInfo.revert ?? undefined);
        const transcript = (0, parsers_1.exportToTranscript)({
            ...cachedExport.data,
            messages: visibleMessages,
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
                    timeoutMs: 120000,
                });
            }
            catch (error) {
                if (!isSessionNotFoundError(error)) {
                    throw error;
                }
            }
        }
        return (0, opencodeCli_1.exportSessionToJsonText)(sessionId, {
            timeoutMs: 120000,
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
        const ttlMs = cachedExport.hasAssistantText
            ? SESSION_EXPORT_CACHE_TTL_MS
            : EMPTY_SESSION_EXPORT_CACHE_TTL_MS;
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
        const filtered = providerId
            ? allModels.filter((entry) => entry.providerID === providerId)
            : allModels;
        return filtered.map((entry) => {
            const summary = { name: entry.name };
            if (entry.variants && entry.variants.length > 0) {
                summary.variants = entry.variants;
            }
            if (entry.supportsThinking) {
                summary.supportsThinking = true;
            }
            if (entry.contextWindow) {
                summary.contextWindow = entry.contextWindow;
            }
            return summary;
        });
    }
    async getAllModelsPayload(forceRefresh = false) {
        const cacheKey = "all";
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
                    providerID: entry.providerID,
                }));
            });
            this.modelsCache.set(cacheKey, {
                loadedAt: Date.now(),
                models,
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
        const configuredModels = this.readConfiguredModelMetadata();
        return (0, parsers_1.parseModelsVerbose)(result.stdout)
            .map((entry) => {
            const split = splitModel(entry.modelName);
            const discovered = (0, parsers_1.extractModelDefinitionMetadata)(entry.json);
            const configured = configuredModels.get(entry.modelName);
            return {
                name: entry.modelName,
                providerID: split?.providerID ?? "",
                variants: configured?.variants ?? discovered.variants,
                supportsThinking: hasModelThinkingCapability(entry.json),
                contextWindow: configured?.contextWindow ?? discovered.contextWindow,
            };
        })
            .filter((entry) => entry.providerID.length > 0);
    }
    async requestServeJson(pathname, init) {
        const runtime = await (0, serveManager_1.ensureServeRunning)();
        const response = await fetch(`${runtime.baseUrl}${pathname}`, {
            method: init?.method ?? "GET",
            headers: this.buildServeHeaders({ "Content-Type": "application/json" }, init?.includeCwd ?? true),
            body: init?.body,
            signal: init?.signal,
        });
        if (!response.ok) {
            const text = await response.text().catch(() => "");
            throw new Error(text.trim().length > 0
                ? text.trim()
                : `OpenCode serve 请求失败（${String(response.status)}）。`);
        }
        return (await response.json());
    }
    readConfiguredProviderLabels() {
        try {
            const configPath = resolveOpencodeConfigPath();
            const raw = fs.readFileSync(configPath, "utf8");
            return (0, parsers_1.extractConfiguredProviderLabels)(JSON.parse(raw));
        }
        catch {
            return new Map();
        }
    }
    readConfiguredModelMetadata() {
        try {
            const configPath = resolveOpencodeConfigPath();
            const raw = fs.readFileSync(configPath, "utf8");
            return (0, parsers_1.extractConfiguredModelMetadata)(JSON.parse(raw));
        }
        catch {
            return new Map();
        }
    }
    async requestServeNoContent(pathname, init) {
        const runtime = await (0, serveManager_1.ensureServeRunning)();
        const response = await fetch(`${runtime.baseUrl}${pathname}`, {
            method: init?.method ?? "POST",
            headers: this.buildServeHeaders({ "Content-Type": "application/json" }, init?.includeCwd ?? true),
            body: init?.body,
            signal: init?.signal,
        });
        if (!response.ok) {
            const text = await response.text().catch(() => "");
            throw new Error(text.trim().length > 0
                ? text.trim()
                : `OpenCode serve 请求失败（${String(response.status)}）。`);
        }
    }
    buildServeHeaders(extra, includeCwd = true) {
        const headers = { ...(extra ?? {}) };
        const cwd = includeCwd ? this.getDefaultCwd() : undefined;
        if (cwd) {
            headers["x-opencode-directory"] = cwd;
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
            const mediaDir = vscode.Uri.joinPath(this.extensionUri, "media");
            const mediaDirPath = mediaDir.fsPath;
            const indexHtmlPath = path.join(mediaDirPath, "index.html");
            const indexHtml = fs.readFileSync(indexHtmlPath, "utf8");
            const baseUri = webview.asWebviewUri(mediaDir).toString();
            const csp = [
                "default-src 'none'",
                `script-src 'nonce-${nonce}'`,
                `style-src ${webview.cspSource}`,
                `img-src ${webview.cspSource} data: blob:`,
            ].join("; ");
            return indexHtml
                .replace(/<head>/i, `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}">\n    <base href="${baseUri}/" />`)
                .replace(/<script\b([^>]*)>/gi, (_match, attrs) => {
                if (/\snonce\s*=/.test(attrs)) {
                    return `<script${attrs}>`;
                }
                return `<script nonce="${nonce}"${attrs}>`;
            })
                .replace(/(src|href)="\/([^\"]+)"/g, (_match, attr, assetPath) => {
                const assetUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", assetPath));
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
SidebarProvider.WORKSPACE_KEY_LAST_SELECTED_MODEL = "opencodeUI.lastSelectedModel";
SidebarProvider.WORKSPACE_KEY_LAST_SELECTED_AGENT = "opencodeUI.lastSelectedAgent";
function createInactiveInlineDiffController() {
    const snapshot = {
        revision: 0,
        activeRun: false,
        files: [],
    };
    return {
        onDidChange: () => ({ dispose: () => undefined }),
        beginRun: () => ({
            observe: () => undefined,
            finish: async () => undefined,
        }),
        open: async () => ({
            ok: false,
            code: "REVIEW_UNAVAILABLE",
            message: "Inline Diff is not active in this host.",
            snapshot,
        }),
        resolve: async () => ({
            ok: false,
            code: "REVIEW_UNAVAILABLE",
            message: "Inline Diff is not active in this host.",
            snapshot,
        }),
        dismiss: () => undefined,
        invalidateAll: () => undefined,
        getSnapshot: () => snapshot,
        dispose: () => undefined,
    };
}
function summarizeSessionTitle(message) {
    const normalized = normalizeTitleSource(message);
    if (!normalized) {
        return "New Session";
    }
    const withoutCommand = normalized.replace(/^\/\S+\s+/, "").trim();
    const cleaned = stripTitleNoise(withoutCommand || normalized);
    const sentence = cleaned.split(/[.!?。！？]/u)[0]?.trim() || cleaned;
    const maxLength = hasCjk(sentence) ? 18 : 36;
    const clipped = clipTitle(sentence, maxLength);
    return clipped || "New Session";
}
function resolveNewSessionTitle(payload) {
    const explicitTitle = typeof payload.title === "string" ? payload.title.trim() : "";
    if (explicitTitle && explicitTitle !== "New Session") {
        return explicitTitle;
    }
    return summarizeSessionTitle(payload.message);
}
function normalizeTitleSource(message) {
    return message.replace(/\s+/g, " ").trim();
}
function stripTitleNoise(message) {
    return message
        .replace(/^(?:请帮我|帮我|请你|请|麻烦你|麻烦|我想让你|我需要你|需要你)\s*/u, "")
        .replace(/^(?:please\s+)?(?:help me\s+(?:to\s+)?)?/iu, "")
        .replace(/^[#>*\-\d.()\[\]\s]+/u, "")
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
        .join("")
        .replace(/[\s,.;:!?，。；：！？、-]+$/u, "")
        .trim();
    if (hasCjk(clipped)) {
        return clipped.replace(/\s+[A-Za-z0-9_-]+$/u, "").trim();
    }
    return clipped;
}
function applyRevertToExportMessages(messages, revert) {
    const revertMessageId = typeof revert?.messageID === "string" ? revert.messageID : undefined;
    if (!revertMessageId) {
        return messages;
    }
    const revertPartId = typeof revert?.partID === "string" ? revert.partID : undefined;
    const next = [];
    for (const message of messages) {
        const info = isRecord(message.info) ? message.info : undefined;
        const messageId = typeof info?.id === "string" ? info.id : undefined;
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
            const partId = typeof partRecord?.id === "string" ? partRecord.id : undefined;
            if (partId === revertPartId) {
                break;
            }
            keptParts.push(part);
        }
        next.push({
            info: message.info,
            parts: keptParts,
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
        const role = typeof info?.role === "string" ? info.role : undefined;
        const messageId = typeof info?.id === "string" ? info.id : undefined;
        const created = getCreatedTime(info);
        if (role === "user" && messageId) {
            pendingUser = {
                messageId,
                created,
                text: extractUserText(message.parts),
            };
            continue;
        }
        if (role === "assistant" && pendingUser) {
            items.push({
                messageId: pendingUser.messageId,
                created: pendingUser.created,
                text: pendingUser.text,
                assistantText: extractAssistantText(message.parts),
                toolCount: countPartsByType(message.parts, "tool"),
                reasoningCount: countPartsByType(message.parts, "reasoning"),
                stepCount: countStepParts(message.parts),
            });
            pendingUser = null;
        }
    }
    if (pendingUser) {
        items.push({
            messageId: pendingUser.messageId,
            created: pendingUser.created,
            text: pendingUser.text,
            assistantText: "",
            toolCount: 0,
            reasoningCount: 0,
            stepCount: 0,
        });
    }
    return items;
}
function collectUserTimelineTargets(payload) {
    return buildTimelineItems(payload)
        .filter((item) => item.messageId.trim().length > 0)
        .map((item) => ({
        messageId: item.messageId,
        text: item.text,
    }));
}
function collectUserTimelineTargetsFromItems(items) {
    return items
        .filter((item) => item.messageId.trim().length > 0)
        .map((item) => ({
        messageId: item.messageId,
        text: item.text,
    }));
}
function hasAssistantTextInExportMessages(messages) {
    for (const message of messages) {
        const info = isRecord(message.info) ? message.info : undefined;
        if (info?.role !== "assistant") {
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
        if (part.type === "text" && typeof part.text === "string") {
            const text = part.synthetic === true ? "" : part.text.trim();
            if (text) {
                chunks.push(text);
            }
        }
    }
    return chunks.join("\n\n").trim();
}
function extractAssistantText(parts) {
    const chunks = [];
    for (const part of parts) {
        if (!isRecord(part)) {
            continue;
        }
        if (part.type === "text" && typeof part.text === "string") {
            const text = part.text.trim();
            if (text) {
                chunks.push(text);
            }
        }
    }
    return chunks.join("\n\n").trim();
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
        if (part.type === "step-start" || part.type === "step-finish") {
            count += 1;
        }
    }
    return count;
}
function getCreatedTime(info) {
    const time = isRecord(info?.time) ? info.time : undefined;
    return typeof time?.created === "number" ? time.created : 0;
}
function isRecord(value) {
    return typeof value === "object" && value !== null;
}
function splitModel(model) {
    const slash = model.indexOf("/");
    if (slash <= 0 || slash >= model.length - 1) {
        return undefined;
    }
    return {
        providerID: model.slice(0, slash),
        modelID: model.slice(slash + 1),
    };
}
function hasModelThinkingCapability(json) {
    if (!isRecord(json) || !isRecord(json.capabilities)) {
        return false;
    }
    return json.capabilities.reasoning === true;
}
function normalizeComposerCommands(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.flatMap((entry) => {
        if (!isRecord(entry) || typeof entry.name !== "string") {
            return [];
        }
        const name = entry.name.replace(/^\/+/, "").trim();
        if (!name) {
            return [];
        }
        const source = ["command", "mcp", "skill"].includes(String(entry.source))
            ? entry.source
            : undefined;
        return [
            {
                name,
                description: typeof entry.description === "string"
                    ? entry.description.trim() || undefined
                    : undefined,
                source,
                hints: Array.isArray(entry.hints)
                    ? entry.hints.filter((hint) => typeof hint === "string")
                    : [],
            },
        ];
    });
}
function normalizeComposerSkills(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.flatMap((entry) => {
        if (!isRecord(entry) || typeof entry.name !== "string") {
            return [];
        }
        const name = entry.name.trim();
        if (!name) {
            return [];
        }
        return [
            {
                name,
                description: typeof entry.description === "string"
                    ? entry.description.trim() || undefined
                    : undefined,
            },
        ];
    });
}
function normalizeComposerMcpServers(value) {
    if (!isRecord(value)) {
        return [];
    }
    return Object.entries(value).map(([name, entry]) => {
        const record = isRecord(entry) ? entry : undefined;
        const status = (typeof record?.status === "string" && record.status) ||
            (typeof record?.type === "string" && record.type) ||
            (typeof entry === "string" && entry) ||
            "unknown";
        const normalizedStatus = status.trim().toLowerCase();
        const error = typeof record?.error === "string"
            ? record.error.trim() || undefined
            : undefined;
        return {
            name,
            status,
            enabled: ["connected", "ready", "active"].includes(normalizedStatus),
            ...(error ? { error } : {}),
        };
    });
}
function uniqueWorkspaceResources(resources) {
    const seen = new Set();
    return resources.filter((resource) => {
        const key = `${resource.kind}:${resource.absolutePath}`;
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}
function scoreWorkspaceResource(resource, query) {
    const normalizedQuery = query.trim().replace(/\\/g, "/").toLowerCase();
    const candidate = resource.path.toLowerCase();
    const basename = candidate.replace(/\/$/, "").split("/").pop() ?? candidate;
    if (!normalizedQuery) {
        return resource.kind === "folder" ? 10 : 20;
    }
    if (candidate === normalizedQuery || basename === normalizedQuery) {
        return 0;
    }
    if (basename.startsWith(normalizedQuery)) {
        return 10 + basename.length / 1000;
    }
    if (candidate.startsWith(normalizedQuery)) {
        return 20 + candidate.length / 1000;
    }
    const includesAt = candidate.indexOf(normalizedQuery);
    if (includesAt >= 0) {
        return 30 + includesAt + candidate.length / 1000;
    }
    let queryIndex = 0;
    for (const character of candidate) {
        if (character === normalizedQuery[queryIndex]) {
            queryIndex += 1;
            if (queryIndex === normalizedQuery.length) {
                return 50 + candidate.length / 1000;
            }
        }
    }
    return Number.POSITIVE_INFINITY;
}
function isBareWorkspaceFilename(value) {
    return value.length > 0
        && !/[\\/]/.test(value)
        && !path.isAbsolute(value)
        && !path.win32.isAbsolute(value)
        && !path.posix.isAbsolute(value);
}
function escapeGlobSegment(value) {
    return value.replace(/[*?\[\]{}]/g, (character) => {
        if (character === "[") {
            return "[[]";
        }
        if (character === "]") {
            return "[]]";
        }
        return `[${character}]`;
    });
}
function buildWorkspaceSearchGlobs(query) {
    const literal = query
        .trim()
        .replace(/\\/g, "/")
        .replace(/[*?\[\]{}]/g, "")
        .replace(/^\/+|\/+$/g, "");
    if (!literal) {
        return ["**/*"];
    }
    return [
        "**/*",
        `**/*${literal}*`,
        `**/*${literal}*/**/*`,
    ];
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
        return path.join(xdgConfigHome, "opencode", "opencode.json");
    }
    return path.join((0, node_os_1.homedir)(), ".config", "opencode", "opencode.json");
}
function isSessionNotFoundError(error) {
    if (!(error instanceof Error)) {
        return false;
    }
    const message = error.message.toLowerCase();
    return (message.includes("session not found") || message.includes("notfounderror"));
}
function buildPromptParts(message, files, hostKind = "wsl") {
    const parts = [];
    for (const filePath of files ?? []) {
        const absolutePath = normalizePromptFilePath(filePath, hostKind);
        parts.push({
            type: "file",
            url: buildPromptFileUrl(absolutePath, hostKind),
            filename: getPromptFileName(absolutePath, hostKind),
            mime: inferPromptFileMime(absolutePath),
        });
    }
    parts.push({ type: "text", text: message });
    return parts;
}
function normalizePromptFilePath(filePath, hostKind = "wsl") {
    const trimmed = filePath.trim();
    if (!trimmed) {
        throw new Error("文件路径为空。");
    }
    if (hostKind === "local-windows") {
        return path.win32.resolve(trimmed);
    }
    const wslMatch = /^\\\\wsl(?:\.localhost|\$)\\[^\\]+\\(.+)$/i.exec(trimmed);
    if (hostKind === "wsl" && wslMatch?.[1]) {
        return `/${wslMatch[1].replace(/\\/g, "/")}`;
    }
    if (isWindowsDrivePath(trimmed) || isWindowsUncPath(trimmed)) {
        throw new Error("当前宿主无法直接读取 Windows 路径，请选择该宿主文件系统内的文件。");
    }
    return path.posix.resolve(trimmed);
}
function buildPromptFileUrl(filePath, hostKind) {
    if (hostKind === "local-windows") {
        return windowsPathToFileUrl(filePath);
    }
    return posixPathToFileUrl(filePath);
}
function getPromptFileName(filePath, hostKind) {
    return hostKind === "local-windows"
        ? path.win32.basename(filePath)
        : path.posix.basename(filePath);
}
function windowsPathToFileUrl(filePath) {
    const normalized = path.win32.resolve(filePath);
    const uncMatch = /^\\\\([^\\]+)\\([^\\]+)(?:\\(.*))?$/u.exec(normalized);
    if (uncMatch) {
        const [, server, share, rest] = uncMatch;
        const segments = [
            share,
            ...(rest ? rest.split(/\\+/u).filter(Boolean) : []),
        ].map(encodeURIComponent);
        return `file://${encodeURIComponent(server)}/${segments.join("/")}`;
    }
    const driveMatch = /^([A-Za-z]):\\?(.*)$/u.exec(normalized);
    if (driveMatch) {
        const [, drive, rest] = driveMatch;
        const segments = rest.split(/\\+/u).filter(Boolean).map(encodeURIComponent);
        return `file:///${drive.toUpperCase()}:/${segments.join("/")}`;
    }
    return (0, node_url_1.pathToFileURL)(normalized).toString();
}
function posixPathToFileUrl(filePath) {
    const normalized = path.posix.resolve(filePath);
    const segments = normalized.split("/").map(encodeURIComponent);
    return `file://${segments.join("/")}`;
}
function isWindowsDrivePath(filePath) {
    return /^[A-Za-z]:[\\/]/u.test(filePath);
}
function isWindowsUncPath(filePath) {
    return /^\\\\/u.test(filePath);
}
function decodeTempfileImage(bytesBase64) {
    const normalized = bytesBase64.replace(/\s+/g, "");
    if (normalized.length === 0) {
        throw new Error("图片内容为空。");
    }
    if (normalized.length > TEMPFILE_MAX_BASE64_CHARS) {
        throw new Error(`图片过大，最大支持 ${String(Math.floor(TEMPFILE_MAX_BYTES / 1024 / 1024))}MB。`);
    }
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized) ||
        normalized.length % 4 === 1) {
        throw new Error("图片内容不是有效的 base64。");
    }
    const bytes = Buffer.from(normalized, "base64");
    if (bytes.length === 0) {
        throw new Error("图片内容为空。");
    }
    if (bytes.length > TEMPFILE_MAX_BYTES) {
        throw new Error(`图片过大，最大支持 ${String(Math.floor(TEMPFILE_MAX_BYTES / 1024 / 1024))}MB。`);
    }
    return bytes;
}
function detectImageMimeType(bytes) {
    if (bytes.length >= 8 &&
        bytes
            .subarray(0, 8)
            .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
        return "image/png";
    }
    if (bytes.length >= 3 &&
        bytes[0] === 0xff &&
        bytes[1] === 0xd8 &&
        bytes[2] === 0xff) {
        return "image/jpeg";
    }
    if (bytes.length >= 6 &&
        (bytes.subarray(0, 6).toString("ascii") === "GIF87a" ||
            bytes.subarray(0, 6).toString("ascii") === "GIF89a")) {
        return "image/gif";
    }
    if (bytes.length >= 12 &&
        bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
        bytes.subarray(8, 12).toString("ascii") === "WEBP") {
        return "image/webp";
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
    return normalized === "image/jpg" && detectedMime === "image/jpeg";
}
function sanitizeTempfileName(fileName, mimeType) {
    const extension = extensionForImageMime(mimeType);
    const rawBaseName = path.basename(fileName || `pasted-image${extension}`);
    const withoutExtension = rawBaseName.replace(/\.[^.]*$/u, "");
    const safeStem = withoutExtension
        .replace(/[^A-Za-z0-9._-]+/g, "-")
        .replace(/^[.-]+/g, "")
        .slice(0, 80) || "pasted-image";
    return `${safeStem}${extension}`;
}
function extensionForImageMime(mimeType) {
    switch (mimeType) {
        case "image/png":
            return ".png";
        case "image/jpeg":
            return ".jpg";
        case "image/gif":
            return ".gif";
        case "image/webp":
            return ".webp";
        default:
            return ".bin";
    }
}
function inferPromptFileMime(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
        case ".png":
            return "image/png";
        case ".jpg":
        case ".jpeg":
            return "image/jpeg";
        case ".gif":
            return "image/gif";
        case ".webp":
            return "image/webp";
        default:
            return "text/plain";
    }
}
//# sourceMappingURL=SidebarProvider.js.map