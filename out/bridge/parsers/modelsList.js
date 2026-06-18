"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ModelsListParseError = void 0;
exports.parseModelsList = parseModelsList;
class ModelsListParseError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'ModelsListParseError';
        this.code = code;
    }
}
exports.ModelsListParseError = ModelsListParseError;
const MODEL_NAME_PATTERN = /^[\w.@-]+(?:\/[\w.@-]+)+$/;
function parseModelsList(stdout) {
    if (typeof stdout !== 'string') {
        throw new ModelsListParseError('INVALID_INPUT', '解析 models 失败：stdout 不是字符串。');
    }
    const entries = [];
    for (const rawLine of stdout.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) {
            continue;
        }
        if (!MODEL_NAME_PATTERN.test(line)) {
            throw new ModelsListParseError('INVALID_INPUT', `解析 models 失败：存在非法模型名 ${line}。`);
        }
        const slash = line.indexOf('/');
        entries.push({
            modelName: line,
            providerID: line.slice(0, slash),
            modelID: line.slice(slash + 1)
        });
    }
    if (entries.length === 0) {
        throw new ModelsListParseError('INVALID_INPUT', '解析 models 失败：未找到任何模型。');
    }
    return entries;
}
//# sourceMappingURL=modelsList.js.map