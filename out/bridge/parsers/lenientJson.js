"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.coerceFirstJsonObject = coerceFirstJsonObject;
exports.coerceFirstJsonValue = coerceFirstJsonValue;
function coerceFirstJsonObject(stdout) {
    const input = stdout.trim();
    const start = input.indexOf('{');
    if (start === -1) {
        return stdout;
    }
    let inString = false;
    let escaped = false;
    let depth = 0;
    for (let index = start; index < input.length; index += 1) {
        const char = input[index] ?? '';
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
            if (depth === 0) {
                return input.slice(start, index + 1);
            }
        }
    }
    return stdout;
}
function coerceFirstJsonValue(stdout) {
    const input = stdout.trim();
    const objectStart = input.indexOf('{');
    const arrayStart = input.indexOf('[');
    const startCandidates = [objectStart, arrayStart].filter((value) => value >= 0);
    const start = startCandidates.length > 0 ? Math.min(...startCandidates) : -1;
    if (start === -1) {
        return stdout;
    }
    const opener = input[start] ?? '';
    const closer = opener === '[' ? ']' : '}';
    let inString = false;
    let escaped = false;
    let depth = 0;
    for (let index = start; index < input.length; index += 1) {
        const char = input[index] ?? '';
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
        if (char === opener) {
            depth += 1;
            continue;
        }
        if (char === closer) {
            depth -= 1;
            if (depth === 0) {
                return input.slice(start, index + 1);
            }
        }
    }
    return stdout;
}
//# sourceMappingURL=lenientJson.js.map