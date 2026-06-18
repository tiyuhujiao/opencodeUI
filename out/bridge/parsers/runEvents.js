"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseRunEvent = parseRunEvent;
function parseRunEvent(value) {
    const error = pickError(value);
    if (error) {
        return {
            type: 'error',
            error
        };
    }
    // Reasoning events can look like `{ type: 'reasoning', text: '...' }`.
    // Parse them before `pickText` so we don't accidentally treat them as regular text.
    const reasoning = pickReasoning(value);
    if (reasoning) {
        return {
            type: 'part',
            part: reasoning
        };
    }
    const text = pickText(value);
    if (text !== null) {
        return {
            type: 'part',
            part: {
                type: 'text',
                text
            }
        };
    }
    const tool = pickTool(value);
    if (tool) {
        return {
            type: 'part',
            part: tool
        };
    }
    const maybeTextPart = pickPartText(value);
    if (maybeTextPart !== null) {
        return {
            type: 'part',
            part: {
                type: 'text',
                text: maybeTextPart
            }
        };
    }
    return null;
}
function pickPartText(value) {
    if (!isRecord(value)) {
        return null;
    }
    const part = value.part;
    if (!isRecord(part)) {
        return null;
    }
    const partType = toNonEmptyString(part.type)?.toLowerCase();
    if (partType !== 'text') {
        return null;
    }
    const text = toTextString(part.text);
    return text ?? null;
}
function pickError(value) {
    if (!isRecord(value)) {
        return null;
    }
    const directError = toNonEmptyString(value.error);
    if (directError) {
        return directError;
    }
    const directType = toNonEmptyString(value.type)?.toLowerCase();
    if (directType === 'error') {
        const message = toNonEmptyString(value.message) ?? toNonEmptyString(value.text);
        return message ?? '运行失败。';
    }
    if (isRecord(value.error)) {
        const nested = toNonEmptyString(value.error.message) ?? toNonEmptyString(value.error.text);
        if (nested) {
            return nested;
        }
    }
    return null;
}
function pickText(value) {
    if (!isRecord(value)) {
        return null;
    }
    const direct = toTextString(value.text) ?? toTextString(value.delta) ?? toTextString(value.content);
    if (direct !== null) {
        return direct;
    }
    const part = pickText(value.part);
    if (part !== null) {
        return part;
    }
    const data = pickText(value.data);
    if (data !== null) {
        return data;
    }
    const parts = value.parts;
    if (Array.isArray(parts)) {
        for (const entry of parts) {
            const next = pickText(entry);
            if (next !== null) {
                return next;
            }
        }
    }
    return null;
}
function pickTool(value) {
    if (!isRecord(value)) {
        return null;
    }
    const type = toNonEmptyString(value.type)?.toLowerCase();
    // Most runtime events look like:
    // { type: 'tool_use', part: { type: 'tool', tool: 'bash', state: { status, input, output, ... } } }
    // Prefer the nested part payload when present.
    const nestedPart = value.part;
    if (isRecord(nestedPart)) {
        const partType = toNonEmptyString(nestedPart.type)?.toLowerCase();
        const toolName = toNonEmptyString(nestedPart.tool) ??
            toNonEmptyString(nestedPart.toolName) ??
            toNonEmptyString(nestedPart.name) ??
            toNonEmptyString(nestedPart.tool);
        const state = nestedPart.state;
        const nestedStatus = (isRecord(state) ? toNonEmptyString(state.status) : null) ??
            toNonEmptyString(nestedPart.status) ??
            toNonEmptyString(nestedPart.state);
        if (partType?.includes('tool') || toolName || nestedStatus) {
            return {
                type: 'tool',
                toolName: toolName ?? 'tool',
                status: nestedStatus ?? 'unknown',
                raw: value
            };
        }
    }
    const name = toNonEmptyString(value.toolName) ?? toNonEmptyString(value.name);
    const status = toNonEmptyString(value.status) ?? toNonEmptyString(value.state);
    if (type?.includes('tool') || name || status) {
        return {
            type: 'tool',
            toolName: name ?? 'tool',
            status: status ?? 'unknown',
            raw: value
        };
    }
    return null;
}
function pickReasoning(value) {
    if (!isRecord(value)) {
        return null;
    }
    const type = toNonEmptyString(value.type)?.toLowerCase();
    const part = value.part;
    const nestedType = isRecord(part) ? toNonEmptyString(part.type)?.toLowerCase() : null;
    if (type !== 'reasoning' && nestedType !== 'reasoning') {
        return null;
    }
    // Providers can emit reasoning either as a top-level `text` field or as a nested
    // `part.text` field depending on the runtime/event source.
    const directText = toTextString(value.text) ?? toTextString(value.delta) ?? toTextString(value.content);
    const nestedText = isRecord(part) ? toTextString(part.text) : null;
    const text = directText ?? nestedText;
    if (text === null) {
        return null;
    }
    return { type: 'reasoning', text, raw: value };
}
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
function toNonEmptyString(value) {
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}
function toTextString(value) {
    return typeof value === 'string' ? value : null;
}
//# sourceMappingURL=runEvents.js.map