"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionListJsonParseError = void 0;
exports.parseSessionListJson = parseSessionListJson;
const lenientJson_1 = require("./lenientJson");
class SessionListJsonParseError extends Error {
    constructor(code, message, options) {
        super(message);
        this.name = 'SessionListJsonParseError';
        this.code = code;
        this.cause = options?.cause;
    }
}
exports.SessionListJsonParseError = SessionListJsonParseError;
function parseSessionListJson(stdout) {
    let parsed;
    try {
        parsed = JSON.parse((0, lenientJson_1.coerceFirstJsonValue)(stdout));
    }
    catch (error) {
        throw new SessionListJsonParseError('INVALID_JSON', '解析 session list JSON 失败：输入不是合法 JSON。', {
            cause: error
        });
    }
    if (!Array.isArray(parsed)) {
        throw new SessionListJsonParseError('INVALID_SHAPE', '解析 session list JSON 失败：根节点必须是数组。');
    }
    return parsed.map((item, index) => parseSessionItem(item, index));
}
function parseSessionItem(value, index) {
    if (!isRecord(value)) {
        throw new SessionListJsonParseError('INVALID_SHAPE', `解析 session list JSON 失败：sessions[${String(index)}] 必须是对象。`);
    }
    return {
        id: readRequiredString(value, 'id', index),
        title: readRequiredString(value, 'title', index),
        updated: readRequiredTimestamp(value, 'updated', index),
        created: readRequiredTimestamp(value, 'created', index),
        projectId: readRequiredString(value, 'projectId', index),
        directory: readRequiredString(value, 'directory', index)
    };
}
function readRequiredString(record, key, index) {
    if (!(key in record)) {
        throw new SessionListJsonParseError('INVALID_SHAPE', `解析 session list JSON 失败：sessions[${String(index)}].${key} 为必填字段。`);
    }
    const value = record[key];
    if (typeof value !== 'string') {
        throw new SessionListJsonParseError('INVALID_SHAPE', `解析 session list JSON 失败：sessions[${String(index)}].${key} 必须是字符串。`);
    }
    return value;
}
function readRequiredTimestamp(record, key, index) {
    if (!(key in record)) {
        throw new SessionListJsonParseError('INVALID_SHAPE', `解析 session list JSON 失败：sessions[${String(index)}].${key} 为必填字段。`);
    }
    const raw = record[key];
    if (typeof raw === 'string') {
        return raw;
    }
    if (typeof raw === 'number' && Number.isFinite(raw)) {
        const date = new Date(raw);
        const iso = date.toISOString();
        if (iso === 'Invalid Date') {
            throw new SessionListJsonParseError('INVALID_SHAPE', `解析 session list JSON 失败：sessions[${String(index)}].${key} 不是合法时间戳。`);
        }
        return iso;
    }
    throw new SessionListJsonParseError('INVALID_SHAPE', `解析 session list JSON 失败：sessions[${String(index)}].${key} 必须是字符串或数字时间戳。`);
}
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
//# sourceMappingURL=sessionListJson.js.map