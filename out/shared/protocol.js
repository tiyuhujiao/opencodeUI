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
    'session.timeline',
    'session.undo',
    'session.redo',
    'session.delete',
    'permission.reply',
    'question.reply',
    'question.reject',
    'file.open',
    'tempfile.write',
    'providers.list',
    'models.list',
    'models.list.byProvider',
    'agents.list',
    'selfcheck.run',
    'run.start',
    'run.stop'
];
const WEBVIEW_REQUEST_WHITELIST_SET = new Set(exports.WEBVIEW_REQUEST_WHITELIST);
const EXTENSION_RESPONSE_TYPE_SET = new Set([
    'webview.ready.ack',
    'sessions.list.response',
    'session.export.response',
    'session.timeline.response',
    'session.undo.response',
    'session.redo.response',
    'session.delete.response',
    'file.open.response',
    'tempfile.write.response',
    'providers.list.response',
    'models.list.response',
    'agents.list.response',
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
    if (message.type === 'session.export') {
        if (!isObject(message.payload)) {
            return false;
        }
        if (typeof message.payload.sessionId !== 'string' || message.payload.sessionId.trim().length === 0) {
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
//# sourceMappingURL=protocol.js.map