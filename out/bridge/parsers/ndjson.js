"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createNdjsonParser = createNdjsonParser;
function createNdjsonParser() {
    let buffer = '';
    const parseLine = (rawLine) => {
        const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
        if (line.trim().length === 0) {
            return null;
        }
        try {
            return {
                ok: true,
                value: JSON.parse(line)
            };
        }
        catch {
            return {
                ok: false,
                error: new Error('NDJSON 行不是合法 JSON'),
                line
            };
        }
    };
    const parseCompleteLines = () => {
        const out = [];
        let lineStart = 0;
        let lineEnd = buffer.indexOf('\n');
        while (lineEnd !== -1) {
            const parsed = parseLine(buffer.slice(lineStart, lineEnd));
            if (parsed !== null) {
                out.push(parsed);
            }
            lineStart = lineEnd + 1;
            lineEnd = buffer.indexOf('\n', lineStart);
        }
        buffer = buffer.slice(lineStart);
        return out;
    };
    return {
        push(chunk) {
            if (chunk.length === 0) {
                return [];
            }
            buffer += chunk;
            return parseCompleteLines();
        },
        end() {
            const out = parseCompleteLines();
            if (buffer.length > 0) {
                const parsed = parseLine(buffer);
                if (parsed !== null) {
                    out.push(parsed);
                }
                buffer = '';
            }
            return out;
        }
    };
}
//# sourceMappingURL=ndjson.js.map