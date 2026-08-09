"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.exportToTranscript = exportToTranscript;
exports.liveMessagesToTranscript = liveMessagesToTranscript;
const exportJson_1 = require("./exportJson");
function exportToTranscript(payload) {
    return payload.messages.map((message) => {
        const id = resolveMessageId(message.info);
        const created = resolveCreated(message.info);
        const completed = resolveCompleted(message.info);
        const finish = resolveFinish(message.info);
        const contextUsage = resolveContextUsage(message.info);
        return {
            ...(id ? { id } : {}),
            ...(created !== undefined ? { created } : {}),
            ...(completed !== undefined ? { completed } : {}),
            ...(finish ? { finish } : {}),
            role: resolveRole(message.info),
            parts: message.parts.map((part) => mapPart(part, id)),
            ...(contextUsage ? { contextUsage } : {})
        };
    });
}
function liveMessagesToTranscript(value) {
    if (!Array.isArray(value)) {
        throw new exportJson_1.ExportJsonParseError('INVALID_SHAPE', 'OpenCode session messages must be an array.');
    }
    const messages = value.map((message, index) => {
        if (!isRecord(message) || !Array.isArray(message.parts)) {
            throw new exportJson_1.ExportJsonParseError('INVALID_SHAPE', `OpenCode session messages[${String(index)}] must include a parts array.`);
        }
        return {
            info: message.info,
            parts: message.parts
        };
    });
    return exportToTranscript({ info: undefined, messages });
}
function resolveRole(info) {
    const role = getStringFromRecord(info, 'role') ?? getNestedStringFromRecord(info, 'author', 'role');
    if (role === 'user' || role === 'assistant') {
        return role;
    }
    return 'unknown';
}
function resolveMessageId(info) {
    const id = getStringFromRecord(info, 'id');
    return id?.trim() ? id : undefined;
}
function resolveCreated(info) {
    return resolveMessageTime(info, 'created');
}
function resolveCompleted(info) {
    return resolveMessageTime(info, 'completed');
}
function resolveMessageTime(info, key) {
    if (!isRecord(info)) {
        return undefined;
    }
    const time = isRecord(info.time) ? info.time : undefined;
    const candidate = time?.[key] ?? info[key];
    if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0) {
        return candidate;
    }
    if (typeof candidate === 'string') {
        const parsed = Date.parse(candidate);
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
}
function resolveFinish(info) {
    const finish = getStringFromRecord(info, 'finish')?.trim();
    return finish || undefined;
}
function resolveContextUsage(info) {
    if (!isRecord(info)) {
        return undefined;
    }
    const metadata = isRecord(info.metadata) ? info.metadata : undefined;
    const assistant = isRecord(metadata?.assistant) ? metadata.assistant : info;
    const tokens = isRecord(assistant.tokens) ? assistant.tokens : undefined;
    if (!tokens) {
        return undefined;
    }
    const cache = isRecord(tokens.cache) ? tokens.cache : undefined;
    const input = toNonNegativeFiniteNumber(tokens.input);
    const cacheRead = toNonNegativeFiniteNumber(cache?.read);
    if (input === undefined && cacheRead === undefined) {
        return undefined;
    }
    const providerId = getStringFromRecord(assistant, 'providerID');
    const modelId = getStringFromRecord(assistant, 'modelID');
    return {
        usedTokens: (input ?? 0) + (cacheRead ?? 0),
        ...(providerId && modelId ? { model: `${providerId}/${modelId}` } : {})
    };
}
function mapPart(part, messageId) {
    if (isRecord(part)) {
        const text = getStringFromRecord(part, 'text');
        const streamKey = resolveStreamKey(part, messageId);
        if (getStringFromRecord(part, 'type') === 'text' && typeof text === 'string') {
            return {
                type: 'text',
                text,
                ...(streamKey ? { streamKey } : {})
            };
        }
        const partType = getStringFromRecord(part, 'type');
        if (partType === 'reasoning' && typeof text === 'string') {
            return {
                type: 'reasoning',
                text,
                ...(streamKey ? { streamKey } : {}),
                raw: part
            };
        }
        if (isToolLikePart(part)) {
            const state = part.state;
            const nestedStatus = isRecord(state) ? getStringFromRecord(state, 'status') : undefined;
            return {
                type: 'tool',
                toolName: getStringFromRecord(part, 'tool') ?? getStringFromRecord(part, 'toolName') ?? getStringFromRecord(part, 'name') ?? 'tool',
                status: nestedStatus ?? getStringFromRecord(part, 'status') ?? getStringFromRecord(part, 'state') ?? 'unknown',
                raw: part
            };
        }
    }
    return {
        type: 'unknown',
        raw: part
    };
}
function resolveStreamKey(part, messageId) {
    const partId = getStringFromRecord(part, 'id')?.trim();
    if (!partId) {
        return undefined;
    }
    const ownerMessageId = getStringFromRecord(part, 'messageID')?.trim() || messageId || 'message';
    return `${ownerMessageId}:${partId}`;
}
function isToolLikePart(part) {
    const partType = getStringFromRecord(part, 'type');
    if (partType?.toLowerCase().includes('tool')) {
        return true;
    }
    return (typeof getStringFromRecord(part, 'toolName') === 'string' ||
        typeof getStringFromRecord(part, 'name') === 'string' ||
        typeof getStringFromRecord(part, 'status') === 'string' ||
        typeof getStringFromRecord(part, 'state') === 'string');
}
function getStringFromRecord(value, key) {
    if (!isRecord(value)) {
        return undefined;
    }
    const candidate = value[key];
    return typeof candidate === 'string' ? candidate : undefined;
}
function getNestedStringFromRecord(value, outer, inner) {
    if (!isRecord(value)) {
        return undefined;
    }
    return getStringFromRecord(value[outer], inner);
}
function toNonNegativeFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
//# sourceMappingURL=exportToTranscript.js.map