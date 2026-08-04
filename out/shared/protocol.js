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
    'session.redo',
    'session.delete',
    'permission.reply',
    'question.reply',
    'question.reject',
    'file.open',
    'inlineDiff.open',
    'inlineDiff.dismiss',
    'tempfile.write',
    'providers.list',
    'models.list',
    'models.list.byProvider',
    'agents.list',
    'composer.resources.list',
    'mcp.setEnabled',
    'workspace.resources.search',
    'workspace.resources.resolve',
    'selfcheck.run',
    'run.start',
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
    'session.redo.response',
    'session.delete.response',
    'file.open.response',
    'inlineDiff.open.response',
    'inlineDiff.dismiss.response',
    'inlineDiff.state',
    'tempfile.write.response',
    'providers.list.response',
    'models.list.response',
    'agents.list.response',
    'composer.resources.list.response',
    'mcp.setEnabled.response',
    'workspace.resources.search.response',
    'workspace.resources.resolve.response',
    'run.start.response',
    'run.stop.response',
    'permission.reply.response',
    'question.reply.response',
    'question.reject.response',
    'run.event',
    'selfcheck.response',
    'webview.error'
]);
function isObject(value) {
    return typeof value === 'object' && value !== null;
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
    if (message.type === 'subtask.transcript.response') {
        return message.ok === true
            && isObject(message.payload)
            && isNonEmptyString(message.payload.sessionId)
            && Array.isArray(message.payload.messages);
    }
    if (message.type === 'inlineDiff.open.response' || message.type === 'inlineDiff.dismiss.response') {
        return message.ok === true && isObject(message.payload) && isNonEmptyString(message.payload.fileId);
    }
    if (message.type === 'inlineDiff.state') {
        if (message.ok !== true || !isObject(message.payload) || !isNonNegativeInteger(message.payload.revision) || !Array.isArray(message.payload.files)) {
            return false;
        }
        return message.payload.files.every(isInlineDiffFileSummary);
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
        if (!isNonEmptyString(message.payload.sessionId) || !isNonEmptyString(message.payload.filename)) {
            return false;
        }
        if (typeof message.payload.includeThinking !== 'boolean'
            || typeof message.payload.includeToolDetails !== 'boolean'
            || typeof message.payload.includeAssistantMetadata !== 'boolean'
            || typeof message.payload.openWithoutSaving !== 'boolean') {
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
    if (message.type === 'run.start') {
        if (!isObject(message.payload)) {
            return false;
        }
        if (Array.isArray(message.payload.files)) {
            for (const file of message.payload.files) {
                if (typeof file !== 'string' || file.trim().length === 0) {
                    return false;
                }
            }
        }
        if (typeof message.payload.command !== 'undefined') {
            if (!isObject(message.payload.command)) {
                return false;
            }
            if (!isNonEmptyString(message.payload.command.name) || typeof message.payload.command.arguments !== 'string') {
                return false;
            }
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
    if (message.type === 'run.start') {
        if (!isObject(message.payload)) {
            return false;
        }
        if (typeof message.payload.message !== 'string' || message.payload.message.trim().length === 0) {
            return false;
        }
        if (typeof message.payload.model !== 'string' || message.payload.model.trim().length === 0) {
            return false;
        }
        if (typeof message.payload.agent !== 'string' || message.payload.agent.trim().length === 0) {
            return false;
        }
        if (typeof message.payload.sessionId !== 'undefined') {
            if (typeof message.payload.sessionId !== 'string' || message.payload.sessionId.trim().length === 0) {
                return false;
            }
        }
        if (typeof message.payload.title !== 'undefined') {
            if (typeof message.payload.title !== 'string') {
                return false;
            }
        }
        if (typeof message.payload.thinking !== 'undefined') {
            if (typeof message.payload.thinking !== 'boolean') {
                return false;
            }
        }
        if (typeof message.payload.variant !== 'undefined') {
            if (typeof message.payload.variant !== 'string') {
                return false;
            }
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
        && isNonEmptyString(value.path)
        && isNonEmptyString(value.displayPath)
        && isNonNegativeInteger(value.additions)
        && isNonNegativeInteger(value.deletions)
        && isNonNegativeInteger(value.hunks)
        && ['pending', 'stale', 'unavailable'].includes(String(value.status))
        && (typeof value.reason === 'undefined' || typeof value.reason === 'string');
}
//# sourceMappingURL=protocol.js.map