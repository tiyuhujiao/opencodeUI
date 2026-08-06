import * as path from "node:path";
import type { ExportPayload } from "./bridge/parsers";

export type SessionMarkdownOptions = {
	includeThinking: boolean;
	includeToolDetails: boolean;
	includeAssistantMetadata: boolean;
};

export type SessionMarkdownInput = {
	sessionId: string;
	sessionInfo?: unknown;
	exportPayload: ExportPayload;
	options: SessionMarkdownOptions;
	modelNames?: ReadonlyMap<string, string>;
};

export function defaultSessionExportFilename(sessionId: string): string {
	const prefix = sessionId.trim().slice(0, 8) || "session";
	return `session-${prefix}.md`;
}

export function resolveSessionExportPath(
	workspaceRoot: string,
	filename: string,
): string {
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
	if (
		relative === "" ||
		relative === ".." ||
		relative.startsWith(`..${path.sep}`) ||
		path.isAbsolute(relative)
	) {
		throw new Error("导出文件必须位于当前工作区内。");
	}
	return target;
}

export function formatSessionMarkdown(input: SessionMarkdownInput): string {
	const exportInfo = asRecord(input.exportPayload.info);
	const sessionInfo = asRecord(input.sessionInfo);
	const title =
		readString(sessionInfo, "title") ??
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
		const formatted = formatMessage(
			message.info,
			message.parts,
			input.options,
			input.modelNames,
		);
		if (!formatted) {
			continue;
		}
		transcript += formatted;
		transcript += "---\n\n";
	}

	return transcript;
}

function formatMessage(
	info: unknown,
	parts: unknown[],
	options: SessionMarkdownOptions,
	modelNames?: ReadonlyMap<string, string>,
): string {
	const record = asRecord(info);
	const role = readString(record, "role");
	let result = "";
	if (role === "user") {
		result = "## User\n\n";
	} else if (role === "assistant") {
		result = formatAssistantHeader(
			record,
			options.includeAssistantMetadata,
			modelNames,
		);
	} else {
		return "";
	}

	for (const part of parts) {
		result += formatPart(part, options);
	}
	return result;
}

function formatAssistantHeader(
	info: Record<string, unknown> | undefined,
	includeMetadata: boolean,
	modelNames?: ReadonlyMap<string, string>,
): string {
	if (!includeMetadata) {
		return "## Assistant\n\n";
	}

	const agent = titleCase(readString(info, "agent") ?? "assistant");
	const providerId = readString(info, "providerID");
	const modelId = readString(info, "modelID");
	const modelKey = providerId && modelId ? `${providerId}/${modelId}` : undefined;
	const model =
		(modelKey ? modelNames?.get(modelKey)?.trim() : undefined) ||
		modelId ||
		providerId ||
		"unknown model";
	const time = asRecord(info?.time);
	const created = readFiniteNumber(time, "created");
	const completed = readFiniteNumber(time, "completed");
	const duration =
		created !== undefined && completed !== undefined && completed >= created
			? ` · ${((completed - created) / 1000).toFixed(1)}s`
			: "";
	return `## Assistant (${agent} · ${model}${duration})\n\n`;
}

function formatPart(part: unknown, options: SessionMarkdownOptions): string {
	const record = asRecord(part);
	const type = readString(record, "type");
	if (type === "text" && record?.synthetic !== true) {
		const text = readString(record, "text");
		return text === undefined ? "" : `${text}\n\n`;
	}
	if (type === "reasoning") {
		const text = readString(record, "text");
		return options.includeThinking && text !== undefined
			? `_Thinking:_\n\n${text}\n\n`
			: "";
	}
	if (type !== "tool") {
		return "";
	}

	const toolName =
		readString(record, "tool") ??
		readString(record, "toolName") ??
		readString(record, "name") ??
		"tool";
	let result = `**Tool: ${toolName}**\n`;
	if (!options.includeToolDetails) {
		return `${result}\n`;
	}

	const state = asRecord(record?.state);
	if (state?.input) {
		result += `\n**Input:**\n\`\`\`json\n${stringifyJson(state.input)}\n\`\`\`\n`;
	}
	const status = readString(state, "status");
	if (status === "completed" && state?.output) {
		result += `\n**Output:**\n\`\`\`\n${stringifyBlock(state.output)}\n\`\`\`\n`;
	}
	if (status === "error" && state?.error) {
		result += `\n**Error:**\n\`\`\`\n${stringifyBlock(state.error)}\n\`\`\`\n`;
	}
	return `${result}\n`;
}

function stringifyJson(value: unknown): string {
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

function stringifyBlock(value: unknown): string {
	return typeof value === "string" ? value : stringifyJson(value);
}

function titleCase(value: string): string {
	return value.length > 0 ? `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}` : value;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function readString(
	value: Record<string, unknown> | undefined,
	key: string,
): string | undefined {
	const candidate = value?.[key];
	return typeof candidate === "string" ? candidate : undefined;
}

function readFiniteNumber(
	value: Record<string, unknown> | undefined,
	key: string,
): number | undefined {
	const candidate = value?.[key];
	return typeof candidate === "number" && Number.isFinite(candidate)
		? candidate
		: undefined;
}
