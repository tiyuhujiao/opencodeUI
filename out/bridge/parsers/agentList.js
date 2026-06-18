"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentListParseError = void 0;
exports.parseAgentList = parseAgentList;
class AgentListParseError extends Error {
    constructor(code, message, options) {
        super(message);
        this.name = 'AgentListParseError';
        this.code = code;
        this.cause = options?.cause;
    }
}
exports.AgentListParseError = AgentListParseError;
// Real output includes names like:
// - build (primary)
// - explore (subagent)
// and sometimes the closing JSON array line `]` is not indented.
// We accept header-like lines and skip bracket-only lines safely.
const HEADER_PATTERN = /^([a-zA-Z0-9_-]+)(?:\s+\(([^)]+)\))?$/;
function parseAgentList(stdout) {
    const lines = stdout.split(/\r?\n/);
    const entries = [];
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const line = lines[lineIndex] ?? '';
        if (line.trim() === '') {
            continue;
        }
        if (line.trim() === '[' || line.trim() === ']') {
            continue;
        }
        if (/^\s/.test(line)) {
            continue;
        }
        const match = HEADER_PATTERN.exec(line.trim());
        if (!match) {
            throw new AgentListParseError('INVALID_INPUT', `解析 agent list 失败：第 ${String(lineIndex + 1)} 行不是合法 agent 头部。`);
        }
        const name = match[1] ?? '';
        const tag = (match[2] ?? '').trim().toLowerCase();
        entries.push({
            name,
            isPrimary: tag === 'primary'
        });
    }
    if (entries.length === 0) {
        throw new AgentListParseError('INVALID_INPUT', '解析 agent list 失败：未找到任何 agent 头部。');
    }
    return entries;
}
//# sourceMappingURL=agentList.js.map