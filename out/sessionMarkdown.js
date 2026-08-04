"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultSessionExportFilename = defaultSessionExportFilename;
exports.resolveSessionExportPath = resolveSessionExportPath;
exports.formatSessionMarkdown = formatSessionMarkdown;
const path = __importStar(require("node:path"));
function defaultSessionExportFilename(sessionId) {
    const prefix = sessionId.trim().slice(0, 8) || "session";
    return `session-${prefix}.md`;
}
function resolveSessionExportPath(workspaceRoot, filename) {
    const root = path.resolve(workspaceRoot);
    const normalized = filename.trim();
    if (!normalized) {
        throw new Error("请输入导出文件名。");
    }
    if (path.isAbsolute(normalized)) {
        throw new Error("导出文件名必须是当前工作区内的相对路径。");
    }
    const withExtension = /\.md$/i.test(normalized)
        ? normalized
        : `${normalized}.md`;
    const target = path.resolve(root, withExtension);
    const relative = path.relative(root, target);
    if (relative === "" ||
        relative === ".." ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative)) {
        throw new Error("导出文件必须位于当前工作区内。");
    }
    return target;
}
function formatSessionMarkdown(input) {
    const exportInfo = asRecord(input.exportPayload.info);
    const sessionInfo = asRecord(input.sessionInfo);
    const title = readString(sessionInfo, "title") ??
        readString(exportInfo, "title") ??
        `Session ${input.sessionId.slice(0, 8)}`;
    const time = asRecord(sessionInfo?.time) ?? asRecord(exportInfo?.time);
    const created = readFiniteNumber(time, "created");
    const updated = readFiniteNumber(time, "updated");
    let transcript = `# ${title}\n\n`;
    transcript += `**Session ID:** ${input.sessionId}\n`;
    if (created !== undefined) {
        transcript += `**Created:** ${new Date(created).toLocaleString()}\n`;
    }
    if (updated !== undefined) {
        transcript += `**Updated:** ${new Date(updated).toLocaleString()}\n`;
    }
    transcript += "\n---\n\n";
    for (const message of input.exportPayload.messages) {
        const formatted = formatMessage(message.info, message.parts, input.options);
        if (!formatted) {
            continue;
        }
        transcript += formatted;
        transcript += "---\n\n";
    }
    return transcript;
}
function formatMessage(info, parts, options) {
    const record = asRecord(info);
    const role = readString(record, "role");
    let result = "";
    if (role === "user") {
        result = "## User\n\n";
    }
    else if (role === "assistant") {
        result = formatAssistantHeader(record, options.includeAssistantMetadata);
    }
    else {
        return "";
    }
    for (const part of parts) {
        result += formatPart(part, options);
    }
    return result;
}
function formatAssistantHeader(info, includeMetadata) {
    if (!includeMetadata) {
        return "## Assistant\n\n";
    }
    const agent = titleCase(readString(info, "agent") ?? "assistant");
    const providerId = readString(info, "providerID");
    const modelId = readString(info, "modelID");
    const model = providerId && modelId
        ? `${providerId}/${modelId}`
        : modelId ?? providerId ?? "unknown model";
    const time = asRecord(info?.time);
    const created = readFiniteNumber(time, "created");
    const completed = readFiniteNumber(time, "completed");
    const duration = created !== undefined && completed !== undefined && completed >= created
        ? ` · ${((completed - created) / 1000).toFixed(1)}s`
        : "";
    return `## Assistant (${agent} · ${model}${duration})\n\n`;
}
function formatPart(part, options) {
    const record = asRecord(part);
    const type = readString(record, "type");
    if (type === "text" && record?.synthetic !== true) {
        const text = readString(record, "text");
        return text === undefined ? "" : `${text}\n\n`;
    }
    if (type === "reasoning") {
        const text = readString(record, "text");
        return options.includeThinking && text
            ? `_Thinking:_\n\n${text}\n\n`
            : "";
    }
    if (type !== "tool") {
        return "";
    }
    const toolName = readString(record, "tool") ??
        readString(record, "toolName") ??
        readString(record, "name") ??
        "tool";
    let result = `**Tool: ${toolName}**\n`;
    if (!options.includeToolDetails) {
        return `${result}\n`;
    }
    const state = asRecord(record?.state);
    if (state?.input !== undefined) {
        result += `\n**Input:**\n\`\`\`json\n${stringifyJson(state.input)}\n\`\`\`\n`;
    }
    const status = readString(state, "status");
    if (status === "completed" && state?.output !== undefined) {
        result += `\n**Output:**\n\`\`\`\n${stringifyBlock(state.output)}\n\`\`\`\n`;
    }
    if (status === "error" && state?.error !== undefined) {
        result += `\n**Error:**\n\`\`\`\n${stringifyBlock(state.error)}\n\`\`\`\n`;
    }
    return `${result}\n`;
}
function stringifyJson(value) {
    try {
        return JSON.stringify(value, null, 2);
    }
    catch {
        return String(value);
    }
}
function stringifyBlock(value) {
    return typeof value === "string" ? value : stringifyJson(value);
}
function titleCase(value) {
    return value.length > 0 ? `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}` : value;
}
function asRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? value
        : undefined;
}
function readString(value, key) {
    const candidate = value?.[key];
    return typeof candidate === "string" ? candidate : undefined;
}
function readFiniteNumber(value, key) {
    const candidate = value?.[key];
    return typeof candidate === "number" && Number.isFinite(candidate)
        ? candidate
        : undefined;
}
//# sourceMappingURL=sessionMarkdown.js.map