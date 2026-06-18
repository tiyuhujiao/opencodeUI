"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ModelsVerboseParseError = void 0;
exports.parseModelsVerbose = parseModelsVerbose;
class ModelsVerboseParseError extends Error {
    constructor(code, message, options) {
        super(message);
        this.name = 'ModelsVerboseParseError';
        this.code = code;
        this.cause = options?.cause;
    }
}
exports.ModelsVerboseParseError = ModelsVerboseParseError;
// Example outputs include names like:
// - opencode/big-pickle
// - google-vertex/deepseek-ai/deepseek-v3.1-maas
// - google-vertex-anthropic/claude-3-5-haiku@20241022
// so we allow multiple path segments separated by '/'.
const MODEL_NAME_PATTERN = /^[\w.@-]+(?:\/[\w.@-]+)+$/;
function parseModelsVerbose(stdout) {
    const lines = stdout.split(/\r?\n/);
    const entries = [];
    let lineIndex = 0;
    while (lineIndex < lines.length) {
        while (lineIndex < lines.length && lines[lineIndex]?.trim() === '') {
            lineIndex += 1;
        }
        if (lineIndex >= lines.length) {
            break;
        }
        const modelLine = lines[lineIndex]?.trim() ?? '';
        if (!MODEL_NAME_PATTERN.test(modelLine)) {
            throw new ModelsVerboseParseError('INVALID_INPUT', `解析 models --verbose 失败：第 ${String(lineIndex + 1)} 行不是合法模型名。`);
        }
        const modelName = modelLine;
        lineIndex += 1;
        while (lineIndex < lines.length && lines[lineIndex]?.trim() === '') {
            lineIndex += 1;
        }
        if (lineIndex >= lines.length) {
            throw new ModelsVerboseParseError('INVALID_INPUT', `解析 models --verbose 失败：模型 ${modelName} 缺少 JSON 区块。`);
        }
        const jsonStartLine = lines[lineIndex] ?? '';
        if (jsonStartLine !== '{') {
            throw new ModelsVerboseParseError('INVALID_SHAPE', `解析 models --verbose 失败：模型 ${modelName} 的 JSON 必须以独立一行 "{" 开始。`);
        }
        const jsonLines = [];
        let depth = 0;
        let inString = false;
        let escaped = false;
        let closed = false;
        while (lineIndex < lines.length) {
            const currentLine = lines[lineIndex] ?? '';
            jsonLines.push(currentLine);
            for (let charIndex = 0; charIndex < currentLine.length; charIndex += 1) {
                const char = currentLine[charIndex];
                if (inString) {
                    if (escaped) {
                        escaped = false;
                        continue;
                    }
                    if (char === '\\') {
                        escaped = true;
                        continue;
                    }
                    if (char === '"') {
                        inString = false;
                    }
                    continue;
                }
                if (char === '"') {
                    inString = true;
                    continue;
                }
                if (char === '{') {
                    depth += 1;
                    continue;
                }
                if (char === '}') {
                    depth -= 1;
                    if (depth < 0) {
                        throw new ModelsVerboseParseError('INVALID_SHAPE', `解析 models --verbose 失败：模型 ${modelName} 的 JSON 出现了多余右花括号。`);
                    }
                }
            }
            if (!inString && depth === 0) {
                if (currentLine !== '}') {
                    throw new ModelsVerboseParseError('INVALID_SHAPE', `解析 models --verbose 失败：模型 ${modelName} 的 JSON 结束行必须是独立一行 "}"。`);
                }
                closed = true;
                lineIndex += 1;
                break;
            }
            lineIndex += 1;
        }
        if (!closed) {
            throw new ModelsVerboseParseError('INVALID_SHAPE', `解析 models --verbose 失败：模型 ${modelName} 的 JSON 未闭合。`);
        }
        const jsonText = jsonLines.join('\n');
        let parsed;
        try {
            parsed = JSON.parse(jsonText);
        }
        catch (error) {
            throw new ModelsVerboseParseError('INVALID_JSON', `解析 models --verbose 失败：模型 ${modelName} 的 JSON 非法。`, {
                cause: error
            });
        }
        if (!isRecord(parsed)) {
            throw new ModelsVerboseParseError('INVALID_SHAPE', `解析 models --verbose 失败：模型 ${modelName} 的 JSON 根节点必须是对象。`);
        }
        entries.push({ modelName, json: parsed });
    }
    if (entries.length === 0) {
        throw new ModelsVerboseParseError('INVALID_INPUT', '解析 models --verbose 失败：未找到任何模型区块。');
    }
    return entries;
}
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
//# sourceMappingURL=modelsVerbose.js.map