"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExportJsonParseError = void 0;
exports.parseExportJson = parseExportJson;
class ExportJsonParseError extends Error {
    constructor(code, message, options) {
        super(message);
        this.name = 'ExportJsonParseError';
        this.code = code;
        this.cause = options?.cause;
    }
}
exports.ExportJsonParseError = ExportJsonParseError;
function parseExportJson(stdout) {
    let parsed;
    try {
        parsed = JSON.parse(stdout);
    }
    catch (error) {
        throw new ExportJsonParseError('INVALID_JSON', '解析 export JSON 失败：输入不是合法 JSON。', {
            cause: error
        });
    }
    if (!isRecord(parsed)) {
        throw new ExportJsonParseError('INVALID_SHAPE', '解析 export JSON 失败：根节点必须是对象。');
    }
    if (!('messages' in parsed)) {
        throw new ExportJsonParseError('INVALID_SHAPE', '解析 export JSON 失败：缺少必填字段 messages。');
    }
    const messagesRaw = parsed.messages;
    if (!Array.isArray(messagesRaw)) {
        throw new ExportJsonParseError('INVALID_SHAPE', '解析 export JSON 失败：messages 必须是数组。');
    }
    const messages = messagesRaw.map((message, index) => parseMessage(message, index));
    return {
        info: parsed.info,
        messages
    };
}
function parseMessage(value, index) {
    if (!isRecord(value)) {
        throw new ExportJsonParseError('INVALID_SHAPE', `解析 export JSON 失败：messages[${String(index)}] 必须是对象。`);
    }
    if (!('parts' in value)) {
        throw new ExportJsonParseError('INVALID_SHAPE', `解析 export JSON 失败：messages[${String(index)}].parts 为必填字段。`);
    }
    const parts = value.parts;
    if (!Array.isArray(parts)) {
        throw new ExportJsonParseError('INVALID_SHAPE', `解析 export JSON 失败：messages[${String(index)}].parts 必须是数组。`);
    }
    return {
        info: value.info,
        parts
    };
}
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
//# sourceMappingURL=exportJson.js.map