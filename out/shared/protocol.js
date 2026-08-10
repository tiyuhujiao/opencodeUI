"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WEBVIEW_REQUEST_WHITELIST = void 0;
exports.isWhitelistedWebviewRequestType = isWhitelistedWebviewRequestType;
exports.getRequestIdFromUnknown = getRequestIdFromUnknown;
exports.isExtensionResponseMessage = isExtensionResponseMessage;
exports.isWebviewRequestMessage = isWebviewRequestMessage;
exports.WEBVIEW_REQUEST_WHITELIST = [
    'webview.ready',
    'sessions.list',
    'session.export',
    'session.export.markdown',
    'subtask.transcript',
    'session.timeline',
    'session.undo',
    'session.revert',
    'session.redo',
    'session.fork',
    'session.delete',
    'permission.reply',
    'question.reply',
    'question.reject',
    'file.open',
    'inlineDiff.open',
    'inlineDiff.resolve',
    'inlineDiff.dismiss',
    'tempfile.write',
    'providers.list',
    'models.list',
    'models.list.byProvider',
    'provider.settings.get',
    'provider.settings.models',
    'provider.settings.upstreamModels',
    'provider.settings.save',
    'provider.settings.delete',
    'provider.settings.openConfig',
    'provider.auth.api',
    'provider.auth.oauth.authorize',
    'provider.auth.oauth.callback',
    'provider.auth.disconnect',
    'provider.auth.openExternal',
    'agents.list',
    'composer.resources.list',
    'mcp.setEnabled',
    'workspace.resources.search',
    'workspace.resources.resolve',
    'selfcheck.run',
    'run.start',
    'run.queue.add',
    'run.queue.update',
    'run.queue.remove',
    'run.stop'
];
const WEBVIEW_REQUEST_WHITELIST_SET = new Set(exports.WEBVIEW_REQUEST_WHITELIST);
const EXTENSION_RESPONSE_TYPE_SET = new Set([
    'webview.ready.ack',
    'sessions.list.response',
    'session.export.response',
    'session.export.markdown.response',
    'subtask.transcript.response',
    'session.timeline.response',
    'session.undo.response',
    'session.revert.response',
    'session.redo.response',
    'session.fork.response',
    'session.delete.response',
    'file.open.response',
    'inlineDiff.open.response',
    'inlineDiff.resolve.response',
    'inlineDiff.dismiss.response',
    'inlineDiff.state',
    'tempfile.write.response',
    'providers.list.response',
    'models.list.response',
    'provider.settings.get.response',
    'provider.settings.models.response',
    'provider.settings.upstreamModels.response',
    'provider.settings.save.response',
    'provider.settings.delete.response',
    'provider.settings.openConfig.response',
    'provider.auth.api.response',
    'provider.auth.oauth.authorize.response',
    'provider.auth.oauth.callback.response',
    'provider.auth.disconnect.response',
    'provider.auth.openExternal.response',
    'agents.list.response',
    'composer.resources.list.response',
    'mcp.setEnabled.response',
    'workspace.resources.search.response',
    'workspace.resources.resolve.response',
    'run.start.response',
    'run.queue.add.response',
    'run.queue.update.response',
    'run.queue.remove.response',
    'run.queue.state',
    'run.stop.response',
    'permission.reply.response',
    'question.reply.response',
    'question.reject.response',
    'run.event',
    'run.snapshot',
    'selfcheck.response',
    'webview.error'
]);
function isObject(value) {
    return typeof value === 'object' && value !== null;
}
function isProviderSettingsScope(value) {
    return value === 'workspace' || value === 'global';
}
function isBoundedString(value, maxLength = 100000) {
    return typeof value === 'string' && value.length <= maxLength;
}
function isQueuedPromptSummary(value) {
    return isObject(value)
        && isNonEmptyString(value.id)
        && isBoundedString(value.message)
        && value.message.trim().length > 0
        && typeof value.createdAt === 'number'
        && Number.isFinite(value.createdAt)
        && value.createdAt >= 0
        && isNonNegativeInteger(value.attachmentCount)
        && typeof value.locked === 'boolean'
        && (value.commandName === undefined || isNonEmptyString(value.commandName));
}
function isRunQueueState(value) {
    return isObject(value)
        && Array.isArray(value.items)
        && value.items.length <= 500
        && value.items.every(isQueuedPromptSummary);
}
function isRunPromptPayload(value) {
    if (!isObject(value)
        || !isNonEmptyString(value.message)
        || !isNonEmptyString(value.model)
        || !isNonEmptyString(value.agent)) {
        return false;
    }
    if (value.sessionId !== undefined && !isNonEmptyString(value.sessionId)) {
        return false;
    }
    if (value.title !== undefined && typeof value.title !== 'string') {
        return false;
    }
    if (value.thinking !== undefined && typeof value.thinking !== 'boolean') {
        return false;
    }
    if (value.variant !== undefined && typeof value.variant !== 'string') {
        return false;
    }
    if (value.files !== undefined) {
        if (!isStringArray(value.files, 100, 16384)
            || value.files.some((file) => file.trim().length === 0)) {
            return false;
        }
    }
    if (value.command !== undefined) {
        if (!isObject(value.command)
            || !isNonEmptyString(value.command.name)
            || typeof value.command.arguments !== 'string') {
            return false;
        }
    }
    return true;
}
function isStringArray(value, maxItems = 500, maxItemLength = 2048) {
    return Array.isArray(value)
        && value.length <= maxItems
        && value.every((item) => isBoundedString(item, maxItemLength));
}
function isStringRecord(value, maxEntries = 50, maxKeyLength = 256, maxValueLength = 16384) {
    return isObject(value)
        && Object.entries(value).length <= maxEntries
        && Object.entries(value).every(([key, entry]) => key.length <= maxKeyLength && isBoundedString(entry, maxValueLength));
}
function isProviderSettingsAuthPromptWhen(value) {
    return isObject(value)
        && isBoundedString(value.key, 256)
        && (value.op === 'eq' || value.op === 'neq')
        && isBoundedString(value.value, 2048);
}
function isProviderSettingsAuthPrompt(value) {
    if (!isObject(value)
        || (value.type !== 'text' && value.type !== 'select')
        || !isBoundedString(value.key, 256)
        || !isBoundedString(value.message, 4096)
        || (value.when !== undefined && !isProviderSettingsAuthPromptWhen(value.when))) {
        return false;
    }
    if (value.type === 'text') {
        return value.placeholder === undefined || isBoundedString(value.placeholder, 4096);
    }
    return Array.isArray(value.options)
        && value.options.length <= 100
        && value.options.every((option) => isObject(option)
            && isBoundedString(option.label, 2048)
            && isBoundedString(option.value, 2048)
            && (option.hint === undefined || isBoundedString(option.hint, 2048)));
}
function isNullableFiniteNumber(value) {
    return value === null || (typeof value === 'number' && Number.isFinite(value));
}
function isProviderSettingsHeader(value) {
    return isObject(value)
        && isBoundedString(value.name, 512)
        && isBoundedString(value.value, 16384)
        && typeof value.hasStoredValue === 'boolean';
}
function isProviderSettingsHeaders(value) {
    return Array.isArray(value)
        && value.length <= 100
        && value.every(isProviderSettingsHeader);
}
function isProviderSettingsModelDraft(value) {
    if (!isObject(value)) {
        return false;
    }
    for (const key of ['id', 'apiModelId', 'name', 'description', 'api', 'npm', 'family', 'releaseDate', 'optionsJson', 'variantsJson', 'extrasJson']) {
        if (!isBoundedString(value[key], key.endsWith('Json') ? 200000 : 2048)) {
            return false;
        }
    }
    if (!['', 'alpha', 'beta', 'deprecated', 'active'].includes(String(value.status))) {
        return false;
    }
    for (const key of ['experimental', 'attachment', 'reasoning', 'temperature', 'toolCall']) {
        if (value[key] !== null && typeof value[key] !== 'boolean') {
            return false;
        }
    }
    if (value.interleaved !== null
        && typeof value.interleaved !== 'boolean'
        && !isBoundedString(value.interleaved, 512)
        && !(isObject(value.interleaved) && isBoundedString(value.interleaved.field, 512))) {
        return false;
    }
    if (!isObject(value.limit) || !isObject(value.cost) || !isObject(value.modalities)) {
        return false;
    }
    for (const key of ['context', 'input', 'output']) {
        if (!isNullableFiniteNumber(value.limit[key])) {
            return false;
        }
    }
    for (const key of ['input', 'output', 'cacheRead', 'cacheWrite']) {
        if (!isNullableFiniteNumber(value.cost[key])) {
            return false;
        }
    }
    if (!isObject(value.cost.contextOver200k)) {
        return false;
    }
    for (const key of ['input', 'output', 'cacheRead', 'cacheWrite']) {
        if (!isNullableFiniteNumber(value.cost.contextOver200k[key])) {
            return false;
        }
    }
    const modalitySet = new Set(['text', 'audio', 'image', 'video', 'pdf']);
    for (const key of ['input', 'output']) {
        const list = value.modalities[key];
        if (list !== null && (!Array.isArray(list) || list.length > 5 || !list.every((item) => typeof item === 'string' && modalitySet.has(item)))) {
            return false;
        }
    }
    return isProviderSettingsHeaders(value.headers);
}
function isProviderSettingsDraft(value) {
    if (!isObject(value)) {
        return false;
    }
    if (value.originalId !== null && !isBoundedString(value.originalId, 256)) {
        return false;
    }
    for (const key of ['id', 'configId', 'name', 'api', 'npm', 'baseURL', 'enterpriseUrl']) {
        if (!isBoundedString(value[key], 4096)) {
            return false;
        }
    }
    if (!isBoundedString(value.optionExtrasJson, 200000) || !isBoundedString(value.providerExtrasJson, 200000)) {
        return false;
    }
    if (typeof value.custom !== 'boolean' || !isStringArray(value.env) || !isStringArray(value.whitelist) || !isStringArray(value.blacklist)) {
        return false;
    }
    if (value.setCacheKey !== null && typeof value.setCacheKey !== 'boolean') {
        return false;
    }
    for (const key of ['timeout', 'headerTimeout']) {
        const candidate = value[key];
        if (candidate !== null && candidate !== false && (typeof candidate !== 'number' || !Number.isFinite(candidate))) {
            return false;
        }
    }
    if (!isNullableFiniteNumber(value.chunkTimeout) || !isProviderSettingsHeaders(value.headers)) {
        return false;
    }
    if (!isObject(value.credential)) {
        return false;
    }
    if (!['store', 'env', 'config', 'none'].includes(String(value.credential.mode))) {
        return false;
    }
    if (!['store', 'env', 'config', 'none'].includes(String(value.credential.initialMode))) {
        return false;
    }
    if (!isBoundedString(value.credential.value, 32768)
        || !isBoundedString(value.credential.env, 512)
        || typeof value.credential.hasConfigValue !== 'boolean'
        || typeof value.credential.hasStoreValue !== 'boolean'
        || typeof value.credential.connected !== 'boolean') {
        return false;
    }
    return Array.isArray(value.models)
        && value.models.length <= 200
        && value.models.every(isProviderSettingsModelDraft);
}
function isProviderSettingsCatalogEntry(value) {
    return isObject(value)
        && isNonEmptyString(value.id)
        && isBoundedString(value.label, 2048)
        && isBoundedString(value.source, 128)
        && isBoundedString(value.api, 4096)
        && isBoundedString(value.npm, 4096)
        && typeof value.builtIn === 'boolean'
        && typeof value.connected === 'boolean'
        && typeof value.credentialStored === 'boolean'
        && (value.credentialType === null || value.credentialType === 'api' || value.credentialType === 'oauth')
        && typeof value.configuredInScope === 'boolean'
        && isStringArray(value.env, 100, 512)
        && isNonNegativeInteger(value.modelCount)
        && Array.isArray(value.authMethods)
        && value.authMethods.length <= 20
        && value.authMethods.every((method) => isObject(method)
            && (method.type === 'api' || method.type === 'oauth')
            && isBoundedString(method.label, 2048)
            && Array.isArray(method.prompts)
            && method.prompts.length <= 50
            && method.prompts.every(isProviderSettingsAuthPrompt));
}
function isProviderSettingsCatalogModel(value) {
    return isProviderSettingsModelDraft(value);
}
function isProviderUpstreamModel(value) {
    return isObject(value)
        && isNonEmptyString(value.id)
        && isBoundedString(value.id, 512)
        && isBoundedString(value.name, 1024)
        && isBoundedString(value.description, 4096)
        && isBoundedString(value.ownedBy, 512)
        && isBoundedString(value.createdAt, 128)
        && (value.contextWindow === null || (isNonNegativeInteger(value.contextWindow) && value.contextWindow > 0))
        && (value.maxOutputTokens === null || (isNonNegativeInteger(value.maxOutputTokens) && value.maxOutputTokens > 0));
}
function isProviderSettingsSnapshot(value) {
    return isObject(value)
        && isProviderSettingsScope(value.scope)
        && isBoundedString(value.path, 16384)
        && typeof value.exists === 'boolean'
        && isBoundedString(value.revision, 256)
        && typeof value.workspaceAvailable === 'boolean'
        && (value.customConfigPath === undefined || isBoundedString(value.customConfigPath, 16384))
        && Array.isArray(value.catalog)
        && value.catalog.length <= 1000
        && value.catalog.every(isProviderSettingsCatalogEntry)
        && Array.isArray(value.configured)
        && value.configured.length <= 500
        && value.configured.every(isProviderSettingsDraft);
}
function isWhitelistedWebviewRequestType(type) {
    return typeof type === 'string' && WEBVIEW_REQUEST_WHITELIST_SET.has(type);
}
function getRequestIdFromUnknown(message) {
    if (!isObject(message)) {
        return undefined;
    }
    return typeof message.requestId === 'string' ? message.requestId : undefined;
}
function isExtensionResponseMessage(message) {
    if (!isObject(message)) {
        return false;
    }
    if (typeof message.type !== 'string' || !EXTENSION_RESPONSE_TYPE_SET.has(message.type)) {
        return false;
    }
    if (typeof message.requestId !== 'string' || message.requestId.length === 0) {
        return false;
    }
    if (typeof message.ok !== 'boolean') {
        return false;
    }
    if (message.type === 'webview.ready.ack' || message.type === 'run.snapshot') {
        return message.ok === true
            && isObject(message.payload)
            && isRunQueueState(message.payload.queue);
    }
    if (message.type === 'run.queue.state') {
        return message.ok === true && isRunQueueState(message.payload);
    }
    if (message.type === 'run.queue.add.response') {
        return message.ok === true
            && isObject(message.payload)
            && isRunQueueState(message.payload.state);
    }
    if (message.type === 'run.queue.update.response' || message.type === 'run.queue.remove.response') {
        return message.ok === true
            && isObject(message.payload)
            && isRunQueueState(message.payload.state);
    }
    if (message.type === 'subtask.transcript.response') {
        return message.ok === true
            && isObject(message.payload)
            && isNonEmptyString(message.payload.sessionId)
            && Array.isArray(message.payload.messages);
    }
    if (message.type === 'session.revert.response') {
        return message.ok === true
            && isObject(message.payload)
            && typeof message.payload.changed === 'boolean'
            && isNonEmptyString(message.payload.sessionId)
            && (typeof message.payload.revertMessageId === 'undefined' || isNonEmptyString(message.payload.revertMessageId))
            && (typeof message.payload.composerText === 'undefined' || isBoundedString(message.payload.composerText));
    }
    if (message.type === 'session.fork.response') {
        return message.ok === true
            && isObject(message.payload)
            && isNonEmptyString(message.payload.sourceSessionId)
            && isNonEmptyString(message.payload.sessionId);
    }
    if (message.type === 'inlineDiff.open.response' || message.type === 'inlineDiff.dismiss.response') {
        return message.ok === true && isObject(message.payload) && isNonEmptyString(message.payload.fileId);
    }
    if (message.type === 'inlineDiff.resolve.response') {
        return message.ok === true
            && isObject(message.payload)
            && isNonEmptyString(message.payload.fileId)
            && (message.payload.decision === 'accept' || message.payload.decision === 'reject');
    }
    if (message.type === 'inlineDiff.state') {
        if (message.ok !== true
            || !isObject(message.payload)
            || !isNonNegativeInteger(message.payload.revision)
            || typeof message.payload.activeRun !== 'boolean'
            || !Array.isArray(message.payload.files)) {
            return false;
        }
        return message.payload.files.every(isInlineDiffFileSummary);
    }
    if (message.type === 'provider.settings.get.response'
        || message.type === 'provider.settings.save.response'
        || message.type === 'provider.settings.delete.response') {
        return message.ok === true && isProviderSettingsSnapshot(message.payload);
    }
    if (message.type === 'provider.settings.models.response') {
        return message.ok === true
            && isObject(message.payload)
            && isNonEmptyString(message.payload.providerId)
            && Array.isArray(message.payload.models)
            && message.payload.models.length <= 1000
            && message.payload.models.every(isProviderSettingsCatalogModel);
    }
    if (message.type === 'provider.settings.upstreamModels.response') {
        return message.ok === true
            && isObject(message.payload)
            && isNonEmptyString(message.payload.providerId)
            && isBoundedString(message.payload.endpoint, 16384)
            && Array.isArray(message.payload.models)
            && message.payload.models.length <= 5000
            && message.payload.models.every(isProviderUpstreamModel);
    }
    if (message.type === 'provider.settings.openConfig.response') {
        return message.ok === true
            && isObject(message.payload)
            && isProviderSettingsScope(message.payload.scope)
            && isBoundedString(message.payload.path, 16384);
    }
    if (message.type === 'provider.auth.api.response'
        || message.type === 'provider.auth.oauth.callback.response'
        || message.type === 'provider.auth.disconnect.response') {
        return message.ok === true
            && isObject(message.payload)
            && isNonEmptyString(message.payload.providerId);
    }
    if (message.type === 'provider.auth.oauth.authorize.response') {
        return message.ok === true
            && isObject(message.payload)
            && isNonEmptyString(message.payload.providerId)
            && isNonNegativeInteger(message.payload.method)
            && isObject(message.payload.authorization)
            && isBoundedString(message.payload.authorization.url, 16384)
            && (message.payload.authorization.method === 'auto' || message.payload.authorization.method === 'code')
            && isBoundedString(message.payload.authorization.instructions, 16384);
    }
    if (message.type === 'provider.auth.openExternal.response') {
        return message.ok === true
            && isObject(message.payload)
            && isBoundedString(message.payload.url, 16384);
    }
    return true;
}
function isWebviewRequestMessage(message) {
    if (!isObject(message)) {
        return false;
    }
    if (!isWhitelistedWebviewRequestType(message.type)) {
        return false;
    }
    if (typeof message.requestId !== 'string' || message.requestId.length === 0) {
        return false;
    }
    if (message.type === 'session.export' || message.type === 'subtask.transcript') {
        if (!isObject(message.payload)) {
            return false;
        }
        if (typeof message.payload.sessionId !== 'string' || message.payload.sessionId.trim().length === 0) {
            return false;
        }
    }
    if (message.type === 'session.export.markdown') {
        if (!isObject(message.payload)) {
            return false;
        }
        if (!isNonEmptyString(message.payload.sessionId) || !isBoundedString(message.payload.filename, 4096)) {
            return false;
        }
        if (typeof message.payload.includeThinking !== 'boolean'
            || typeof message.payload.includeToolDetails !== 'boolean'
            || typeof message.payload.includeAssistantMetadata !== 'boolean'
            || typeof message.payload.openWithoutSaving !== 'boolean') {
            return false;
        }
        if (!message.payload.openWithoutSaving && message.payload.filename.trim().length === 0) {
            return false;
        }
    }
    if (message.type === 'session.timeline' || message.type === 'session.undo' || message.type === 'session.redo') {
        if (!isObject(message.payload)) {
            return false;
        }
        if (typeof message.payload.sessionId !== 'string' || message.payload.sessionId.trim().length === 0) {
            return false;
        }
    }
    if (message.type === 'session.revert' || message.type === 'session.fork') {
        if (!isObject(message.payload)) {
            return false;
        }
        if (!isNonEmptyString(message.payload.sessionId) || !isNonEmptyString(message.payload.messageId)) {
            return false;
        }
    }
    if (message.type === 'session.delete') {
        if (!isObject(message.payload)) {
            return false;
        }
        if (typeof message.payload.sessionId !== 'string' || message.payload.sessionId.trim().length === 0) {
            return false;
        }
    }
    if (message.type === 'permission.reply') {
        if (!isObject(message.payload)) {
            return false;
        }
        if (typeof message.payload.permissionId !== 'string' || message.payload.permissionId.trim().length === 0) {
            return false;
        }
        if (!['once', 'always', 'reject'].includes(String(message.payload.reply))) {
            return false;
        }
        if (typeof message.payload.message !== 'undefined' && typeof message.payload.message !== 'string') {
            return false;
        }
    }
    if (message.type === 'question.reply') {
        if (!isObject(message.payload)) {
            return false;
        }
        if (typeof message.payload.questionId !== 'string' || message.payload.questionId.trim().length === 0) {
            return false;
        }
        if (!Array.isArray(message.payload.answers)) {
            return false;
        }
        if (!message.payload.answers.every((answer) => Array.isArray(answer) && answer.every((item) => typeof item === 'string'))) {
            return false;
        }
    }
    if (message.type === 'question.reject') {
        if (!isObject(message.payload)) {
            return false;
        }
        if (typeof message.payload.questionId !== 'string' || message.payload.questionId.trim().length === 0) {
            return false;
        }
    }
    if (message.type === 'file.open') {
        if (!isObject(message.payload)) {
            return false;
        }
        if (typeof message.payload.path !== 'string' || message.payload.path.trim().length === 0) {
            return false;
        }
        for (const key of ['line', 'column']) {
            const value = message.payload[key];
            if (typeof value !== 'undefined' && (typeof value !== 'number' || !Number.isInteger(value) || value < 1)) {
                return false;
            }
        }
    }
    if (message.type === 'mcp.setEnabled') {
        if (!isObject(message.payload) || !isNonEmptyString(message.payload.name) || typeof message.payload.enabled !== 'boolean') {
            return false;
        }
    }
    if (message.type === 'workspace.resources.search') {
        if (!isObject(message.payload) || typeof message.payload.query !== 'string' || message.payload.query.length > 256) {
            return false;
        }
    }
    if (message.type === 'workspace.resources.resolve') {
        if (!isObject(message.payload) || !Array.isArray(message.payload.values) || message.payload.values.length > 32) {
            return false;
        }
        if (!message.payload.values.every((value) => typeof value === 'string' && value.trim().length > 0 && value.length <= 4096)) {
            return false;
        }
    }
    if (message.type === 'inlineDiff.open' || message.type === 'inlineDiff.dismiss') {
        if (!isObject(message.payload) || !isNonEmptyString(message.payload.fileId)) {
            return false;
        }
    }
    if (message.type === 'inlineDiff.resolve') {
        if (!isObject(message.payload)
            || !isNonEmptyString(message.payload.fileId)
            || !isNonNegativeInteger(message.payload.revision)
            || (message.payload.decision !== 'accept' && message.payload.decision !== 'reject')) {
            return false;
        }
    }
    if (message.type === 'tempfile.write') {
        if (!isObject(message.payload)) {
            return false;
        }
        if (typeof message.payload.fileName !== 'string' || message.payload.fileName.trim().length === 0) {
            return false;
        }
        if (typeof message.payload.bytesBase64 !== 'string' || message.payload.bytesBase64.trim().length === 0) {
            return false;
        }
        if (typeof message.payload.mimeType !== 'undefined' && typeof message.payload.mimeType !== 'string') {
            return false;
        }
    }
    if (message.type === 'providers.list' || message.type === 'models.list') {
        if (typeof message.payload !== 'undefined') {
            if (!isObject(message.payload)) {
                return false;
            }
            if (typeof message.payload.forceRefresh !== 'undefined' && typeof message.payload.forceRefresh !== 'boolean') {
                return false;
            }
        }
    }
    if (message.type === 'provider.settings.get') {
        if (!isObject(message.payload) || !isProviderSettingsScope(message.payload.scope)) {
            return false;
        }
        if (message.payload.forceRefresh !== undefined && typeof message.payload.forceRefresh !== 'boolean') {
            return false;
        }
    }
    if (message.type === 'provider.settings.models') {
        if (!isObject(message.payload) || !isNonEmptyString(message.payload.providerId)) {
            return false;
        }
        if (message.payload.forceRefresh !== undefined && typeof message.payload.forceRefresh !== 'boolean') {
            return false;
        }
    }
    if (message.type === 'provider.settings.upstreamModels') {
        if (!isObject(message.payload)
            || !isProviderSettingsScope(message.payload.scope)
            || !isProviderSettingsDraft(message.payload.draft)
            || !isNonEmptyString(message.payload.endpoint)
            || !isBoundedString(message.payload.endpoint, 16384)) {
            return false;
        }
    }
    if (message.type === 'provider.settings.save') {
        if (!isObject(message.payload)
            || !isProviderSettingsScope(message.payload.scope)
            || !isBoundedString(message.payload.revision, 256)
            || !isProviderSettingsDraft(message.payload.draft)) {
            return false;
        }
    }
    if (message.type === 'provider.settings.delete') {
        if (!isObject(message.payload)
            || !isProviderSettingsScope(message.payload.scope)
            || !isBoundedString(message.payload.revision, 256)
            || !isNonEmptyString(message.payload.providerId)) {
            return false;
        }
    }
    if (message.type === 'provider.settings.openConfig') {
        if (!isObject(message.payload) || !isProviderSettingsScope(message.payload.scope)) {
            return false;
        }
    }
    if (message.type === 'provider.auth.api') {
        if (!isObject(message.payload)
            || !isNonEmptyString(message.payload.providerId)
            || !isBoundedString(message.payload.key, 32768)
            || message.payload.key.trim().length === 0
            || !isStringRecord(message.payload.metadata)) {
            return false;
        }
    }
    if (message.type === 'provider.auth.oauth.authorize') {
        if (!isObject(message.payload)
            || !isNonEmptyString(message.payload.providerId)
            || !isNonNegativeInteger(message.payload.method)
            || message.payload.method > 100
            || !isStringRecord(message.payload.inputs)) {
            return false;
        }
    }
    if (message.type === 'provider.auth.oauth.callback') {
        if (!isObject(message.payload)
            || !isNonEmptyString(message.payload.providerId)
            || !isNonNegativeInteger(message.payload.method)
            || message.payload.method > 100
            || (message.payload.code !== undefined && !isBoundedString(message.payload.code, 16384))) {
            return false;
        }
    }
    if (message.type === 'provider.auth.disconnect') {
        if (!isObject(message.payload) || !isNonEmptyString(message.payload.providerId)) {
            return false;
        }
    }
    if (message.type === 'provider.auth.openExternal') {
        if (!isObject(message.payload) || !isBoundedString(message.payload.url, 16384)) {
            return false;
        }
    }
    if (message.type === 'run.start' || message.type === 'run.queue.add') {
        if (!isRunPromptPayload(message.payload)) {
            return false;
        }
    }
    if (message.type === 'run.queue.update') {
        if (!isObject(message.payload)
            || !isNonEmptyString(message.payload.id)
            || !isBoundedString(message.payload.message)
            || message.payload.message.trim().length === 0) {
            return false;
        }
    }
    if (message.type === 'run.queue.remove') {
        if (!isObject(message.payload) || !isNonEmptyString(message.payload.id)) {
            return false;
        }
    }
    if (message.type === 'models.list.byProvider') {
        if (!isObject(message.payload)) {
            return false;
        }
        if (typeof message.payload.providerId !== 'string' || message.payload.providerId.trim().length === 0) {
            return false;
        }
        if (typeof message.payload.forceRefresh !== 'undefined' && typeof message.payload.forceRefresh !== 'boolean') {
            return false;
        }
    }
    return true;
}
function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}
function isNonNegativeInteger(value) {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}
function isInlineDiffFileSummary(value) {
    if (!isObject(value)) {
        return false;
    }
    return isNonEmptyString(value.fileId)
        && isNonNegativeInteger(value.revision)
        && isNonEmptyString(value.path)
        && isNonEmptyString(value.displayPath)
        && isNonNegativeInteger(value.additions)
        && isNonNegativeInteger(value.deletions)
        && isNonNegativeInteger(value.hunks)
        && ['pending', 'stale', 'unavailable'].includes(String(value.status))
        && (typeof value.reason === 'undefined' || typeof value.reason === 'string');
}
//# sourceMappingURL=protocol.js.map