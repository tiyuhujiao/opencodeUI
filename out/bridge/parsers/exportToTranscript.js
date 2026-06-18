"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.exportToTranscript = exportToTranscript;
function exportToTranscript(payload) {
    return payload.messages.map((message) => ({
        role: resolveRole(message.info),
        parts: message.parts.map(mapPart)
    }));
}
function resolveRole(info) {
    const role = getStringFromRecord(info, 'role') ?? getNestedStringFromRecord(info, 'author', 'role');
    if (role === 'user' || role === 'assistant') {
        return role;
    }
    return 'unknown';
}
function mapPart(part) {
    if (isRecord(part)) {
        const text = getStringFromRecord(part, 'text');
        if (getStringFromRecord(part, 'type') === 'text' && typeof text === 'string') {
            return {
                type: 'text',
                text
            };
        }
        const partType = getStringFromRecord(part, 'type');
        if (partType === 'reasoning' && typeof text === 'string') {
            return {
                type: 'reasoning',
                text,
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
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
//# sourceMappingURL=exportToTranscript.js.map