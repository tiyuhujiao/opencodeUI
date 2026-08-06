import { createHash, randomBytes } from "node:crypto";
import * as fs from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";
import type { FormattingOptions, ParseError } from "jsonc-parser";
import type {
	ProviderSettingsDraft,
	ProviderSettingsHeader,
	ProviderSettingsModelDraft,
	ProviderSettingsScope,
} from "./shared/protocol";

type JsonObject = Record<string, unknown>;
type JsoncParser = typeof import("jsonc-parser");

export type ProviderSettingsPathOptions = {
	workspaceFolder?: string;
	env?: NodeJS.ProcessEnv;
	homeDir?: string;
};

export type ProviderConfigTarget = {
	scope: ProviderSettingsScope;
	path: string;
	workspaceAvailable: boolean;
	customConfigPath?: string;
};

export type ProviderConfigDocument = ProviderConfigTarget & {
	exists: boolean;
	revision: string;
	raw: string;
	config: JsonObject;
};

export type ProviderDraftExtractionOptions = {
	connectedProviderIds?: ReadonlySet<string>;
	storedCredentialProviderIds?: ReadonlySet<string>;
	knownProviderIds?: ReadonlySet<string>;
};

const MISSING_REVISION = "missing";
const MAX_CONFIG_BYTES = 5 * 1024 * 1024;
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SENSITIVE_HEADER_PATTERN = /(?:authorization|proxy-authorization|api[-_]?key|token|cookie|secret)/i;
const FORBIDDEN_JSON_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const PROVIDER_RESERVED_KEYS = new Set([
	"id",
	"api",
	"name",
	"env",
	"npm",
	"whitelist",
	"blacklist",
	"options",
	"models",
]);
const PROVIDER_OPTION_RESERVED_KEYS = new Set([
	"apiKey",
	"baseURL",
	"enterpriseUrl",
	"setCacheKey",
	"timeout",
	"headerTimeout",
	"chunkTimeout",
	"headers",
]);
const MODEL_RESERVED_KEYS = new Set([
	"id",
	"name",
	"description",
	"family",
	"release_date",
	"attachment",
	"reasoning",
	"temperature",
	"tool_call",
	"interleaved",
	"cost",
	"limit",
	"modalities",
	"experimental",
	"status",
	"provider",
	"options",
	"headers",
	"variants",
]);

let jsoncParser: JsoncParser | undefined;

export class ProviderConfigParseError extends Error {
	public constructor(
		message: string,
		public readonly filePath: string,
		public readonly line: number,
		public readonly column: number,
	) {
		super(message);
		this.name = "ProviderConfigParseError";
	}
}

export class ProviderConfigConflictError extends Error {
	public constructor(public readonly filePath: string) {
		super("配置文件已在编辑器或其他进程中发生变化。请刷新设置后再保存。");
		this.name = "ProviderConfigConflictError";
	}
}

export function resolveProviderConfigTarget(
	scope: ProviderSettingsScope,
	options: ProviderSettingsPathOptions = {},
): ProviderConfigTarget {
	const env = options.env ?? process.env;
	if (scope === "workspace") {
		const workspaceFolder = options.workspaceFolder?.trim();
		if (!workspaceFolder) {
			return {
				scope,
				path: "",
				workspaceAvailable: false,
			};
		}

		return {
			scope,
			path: resolveExistingConfigFile(workspaceFolder),
			workspaceAvailable: true,
		};
	}

	const custom = env.OPENCODE_CONFIG?.trim();
	if (custom) {
		const customPath = path.isAbsolute(custom) ? custom : path.resolve(custom);
		return {
			scope,
			path: customPath,
			workspaceAvailable: Boolean(options.workspaceFolder?.trim()),
			customConfigPath: customPath,
		};
	}

	const home = options.homeDir ?? homedir();
	const configRoot = env.XDG_CONFIG_HOME?.trim() || path.join(home, ".config");
	return {
		scope,
		path: resolveExistingConfigFile(path.join(configRoot, "opencode")),
		workspaceAvailable: Boolean(options.workspaceFolder?.trim()),
	};
}

export async function readProviderConfigDocument(
	scope: ProviderSettingsScope,
	options: ProviderSettingsPathOptions = {},
): Promise<ProviderConfigDocument> {
	const target = resolveProviderConfigTarget(scope, options);
	if (!target.path) {
		return {
			...target,
			exists: false,
			revision: MISSING_REVISION,
			raw: "",
			config: {},
		};
	}

	let raw = "";
	let exists = true;
	try {
		raw = await fs.promises.readFile(target.path, "utf8");
	} catch (error) {
		if (isNodeError(error, "ENOENT")) {
			exists = false;
		} else {
			throw error;
		}
	}

	if (Buffer.byteLength(raw, "utf8") > MAX_CONFIG_BYTES) {
		throw new Error(`配置文件超过 ${String(MAX_CONFIG_BYTES / 1024 / 1024)} MB，无法安全地在设置页中编辑。`);
	}

	return {
		...target,
		exists,
		revision: revisionFor(raw, exists),
		raw,
		config: parseConfigObject(raw, target.path),
	};
}

export function providerConfigToDrafts(
	config: JsonObject,
	options: ProviderDraftExtractionOptions = {},
): ProviderSettingsDraft[] {
	const providers = asObject(config.provider);
	if (!providers) {
		return [];
	}

	const connected = options.connectedProviderIds ?? new Set<string>();
	const storedCredentials = options.storedCredentialProviderIds ?? new Set<string>();
	const known = options.knownProviderIds ?? new Set<string>();
	const drafts: ProviderSettingsDraft[] = [];
	for (const [providerId, value] of Object.entries(providers)) {
		const provider = asObject(value);
		if (!provider) {
			continue;
		}
		const providerOptions = asObject(provider.options) ?? {};
		const apiKey = providerOptions.apiKey;
		const envReference = typeof apiKey === "string" ? parseEnvReference(apiKey) : undefined;
		const hasConfigCredential = apiKey !== undefined && apiKey !== null && apiKey !== "";
		const isConnected = connected.has(providerId);
		const hasStoreCredential = storedCredentials.has(providerId);
		const models = asObject(provider.models) ?? {};
		const credentialMode = envReference
			? "env"
			: hasConfigCredential
				? "config"
				: hasStoreCredential
					? "store"
					: "none";

		drafts.push({
			originalId: providerId,
			id: providerId,
			configId: stringValue(provider.id),
			custom: known.size > 0 ? !known.has(providerId) : true,
			name: stringValue(provider.name),
			api: stringValue(provider.api),
			npm: stringValue(provider.npm),
			env: stringArray(provider.env),
			whitelist: stringArray(provider.whitelist),
			blacklist: stringArray(provider.blacklist),
			baseURL: stringValue(providerOptions.baseURL),
			enterpriseUrl: stringValue(providerOptions.enterpriseUrl),
			setCacheKey: nullableBoolean(providerOptions.setCacheKey),
			timeout: numberFalseOrNull(providerOptions.timeout),
			headerTimeout: numberFalseOrNull(providerOptions.headerTimeout),
			chunkTimeout: nullableNumber(providerOptions.chunkTimeout),
			headers: headersToDraft(providerOptions.headers),
			credential: {
				mode: credentialMode,
				initialMode: credentialMode,
				value: "",
				env: envReference ?? "",
				hasConfigValue: hasConfigCredential && !envReference,
				hasStoreValue: hasStoreCredential,
				connected: isConnected,
			},
			optionExtrasJson: prettyJson(withoutKeys(providerOptions, PROVIDER_OPTION_RESERVED_KEYS)),
			providerExtrasJson: prettyJson(withoutKeys(provider, PROVIDER_RESERVED_KEYS)),
			models: Object.entries(models)
				.filter((entry): entry is [string, JsonObject] => Boolean(asObject(entry[1])))
				.map(([modelId, model]) => modelConfigToDraft(modelId, model)),
		});
	}

	return drafts;
}

export function createEmptyProviderModelDraft(id = ""): ProviderSettingsModelDraft {
	return {
		id,
		apiModelId: "",
		name: id,
		description: "",
		api: "",
		npm: "",
		family: "",
		releaseDate: "",
		status: "",
		experimental: null,
		attachment: null,
		reasoning: null,
		temperature: null,
		toolCall: null,
		interleaved: null,
		limit: { context: null, input: null, output: null },
		cost: {
			input: null,
			output: null,
			cacheRead: null,
			cacheWrite: null,
			contextOver200k: {
				input: null,
				output: null,
				cacheRead: null,
				cacheWrite: null,
			},
		},
		modalities: { input: null, output: null },
		headers: [],
		optionsJson: "{}",
		variantsJson: "{}",
		extrasJson: "{}",
	};
}

export function modelConfigToDraft(modelId: string, value: unknown): ProviderSettingsModelDraft {
	const model = asObject(value) ?? {};
	const providerOverride = asObject(model.provider) ?? {};
	const limit = asObject(model.limit) ?? {};
	const cost = asObject(model.cost) ?? {};
	const contextOver200k = asObject(cost.context_over_200k) ?? {};
	const modalities = asObject(model.modalities) ?? {};
	const interleaved = normalizeInterleaved(model.interleaved);

	return {
		...createEmptyProviderModelDraft(modelId),
		apiModelId: stringValue(model.id),
		name: stringValue(model.name),
		description: stringValue(model.description),
		api: stringValue(providerOverride.api),
		npm: stringValue(providerOverride.npm),
		family: stringValue(model.family),
		releaseDate: stringValue(model.release_date),
		status: normalizeModelStatus(model.status),
		experimental: nullableBoolean(model.experimental),
		attachment: nullableBoolean(model.attachment),
		reasoning: nullableBoolean(model.reasoning),
		temperature: nullableBoolean(model.temperature),
		toolCall: nullableBoolean(model.tool_call),
		interleaved,
		limit: {
			context: nullableNumber(limit.context),
			input: nullableNumber(limit.input),
			output: nullableNumber(limit.output),
		},
		cost: {
			input: nullableNumber(cost.input),
			output: nullableNumber(cost.output),
			cacheRead: nullableNumber(cost.cache_read),
			cacheWrite: nullableNumber(cost.cache_write),
			contextOver200k: {
				input: nullableNumber(contextOver200k.input),
				output: nullableNumber(contextOver200k.output),
				cacheRead: nullableNumber(contextOver200k.cache_read),
				cacheWrite: nullableNumber(contextOver200k.cache_write),
			},
		},
		modalities: {
			input: nullableModalityArray(modalities.input),
			output: nullableModalityArray(modalities.output),
		},
		headers: headersToDraft(model.headers),
		optionsJson: prettyJson(asObject(model.options) ?? {}),
		variantsJson: prettyJson(asObject(model.variants) ?? {}),
		extrasJson: prettyJson(withoutKeys(model, MODEL_RESERVED_KEYS)),
	};
}

export async function saveProviderConfigDraft(
	scope: ProviderSettingsScope,
	expectedRevision: string,
	draft: ProviderSettingsDraft,
	options: ProviderSettingsPathOptions = {},
): Promise<ProviderConfigDocument> {
	const document = await readProviderConfigDocument(scope, options);
	assertWritableTarget(document);
	assertRevision(document, expectedRevision);
	validateProviderDraft(draft);
	if (draft.originalId && draft.originalId !== draft.id) {
		throw new Error("已有 provider 的 ID 不可直接改名。请新建 provider，再删除旧配置。");
	}

	const providers = asObject(document.config.provider) ?? {};
	const existingProvider = asObject(providers[draft.id]) ?? {};
	const desiredProvider = providerDraftToConfig(draft, existingProvider);
	const nextRaw = patchConfigRaw(document.raw, document.config, ["provider", draft.id], existingProvider, desiredProvider);
	await assertRevisionUnchanged(document);
	await writeFileAtomically(document.path, nextRaw);
	return readProviderConfigDocument(scope, options);
}

export async function deleteProviderConfigDraft(
	scope: ProviderSettingsScope,
	expectedRevision: string,
	providerId: string,
	options: ProviderSettingsPathOptions = {},
): Promise<ProviderConfigDocument> {
	if (!isValidConfigMapKey(providerId, 512)) {
		throw new Error("Provider ID 无效。");
	}
	const document = await readProviderConfigDocument(scope, options);
	assertWritableTarget(document);
	assertRevision(document, expectedRevision);
	const providers = asObject(document.config.provider);
	if (!providers || !(providerId in providers)) {
		return document;
	}

	const nextRaw = patchConfigRaw(document.raw, document.config, ["provider", providerId], providers[providerId], undefined);
	await assertRevisionUnchanged(document);
	await writeFileAtomically(document.path, nextRaw);
	return readProviderConfigDocument(scope, options);
}

export async function ensureProviderConfigFile(
	scope: ProviderSettingsScope,
	options: ProviderSettingsPathOptions = {},
): Promise<ProviderConfigDocument> {
	const document = await readProviderConfigDocument(scope, options);
	assertWritableTarget(document);
	if (document.exists) {
		return document;
	}

	await fs.promises.mkdir(path.dirname(document.path), { recursive: true });
	try {
		await fs.promises.writeFile(
			document.path,
			'{\n  "$schema": "https://opencode.ai/config.json"\n}\n',
			{ encoding: "utf8", flag: "wx" },
		);
	} catch (error) {
		if (!isNodeError(error, "EEXIST")) {
			throw error;
		}
	}
	return readProviderConfigDocument(scope, options);
}

export function providerDraftToConfig(
	draft: ProviderSettingsDraft,
	existingProviderValue: unknown = {},
): JsonObject {
	validateProviderDraft(draft);
	const existingProvider = asObject(existingProviderValue) ?? {};
	const existingOptions = asObject(existingProvider.options) ?? {};
	const provider = parseJsonObject("Provider 扩展参数", draft.providerExtrasJson, PROVIDER_RESERVED_KEYS);
	const optionExtras = parseJsonObject("Provider options 扩展参数", draft.optionExtrasJson, PROVIDER_OPTION_RESERVED_KEYS);
	const providerOptions: JsonObject = { ...optionExtras };

	assignString(provider, "id", draft.configId);
	assignString(provider, "name", draft.name);
	assignString(provider, "api", draft.api);
	assignString(provider, "npm", draft.npm);
	assignStringArray(provider, "env", draft.env);
	assignStringArray(provider, "whitelist", draft.whitelist);
	assignStringArray(provider, "blacklist", draft.blacklist);

	assignString(providerOptions, "baseURL", draft.baseURL);
	assignString(providerOptions, "enterpriseUrl", draft.enterpriseUrl);
	assignNullable(providerOptions, "setCacheKey", draft.setCacheKey);
	assignNullable(providerOptions, "timeout", draft.timeout);
	assignNullable(providerOptions, "headerTimeout", draft.headerTimeout);
	assignNullable(providerOptions, "chunkTimeout", draft.chunkTimeout);

	if (draft.credential.mode === "env") {
		providerOptions.apiKey = `{env:${draft.credential.env.trim()}}`;
	} else if (draft.credential.mode === "config") {
		if (draft.credential.value.length > 0) {
			providerOptions.apiKey = draft.credential.value;
		} else if (
			draft.credential.hasConfigValue
			&& existingOptions.apiKey !== undefined
		) {
			providerOptions.apiKey = existingOptions.apiKey;
		} else {
			throw new Error("请输入要写入配置文件的 API key。");
		}
	}

	const providerHeaders = headersFromDraft(draft.headers, existingOptions.headers, "Provider");
	if (Object.keys(providerHeaders).length > 0) {
		providerOptions.headers = providerHeaders;
	}
	if (Object.keys(providerOptions).length > 0) {
		provider.options = providerOptions;
	}

	const existingModels = asObject(existingProvider.models) ?? {};
	const models: JsonObject = {};
	for (const model of draft.models) {
		models[model.id] = modelDraftToConfig(model, existingModels[model.id]);
	}
	if (Object.keys(models).length > 0) {
		provider.models = models;
	}

	return provider;
}

export function validateProviderDraft(draft: ProviderSettingsDraft): void {
	if (!isValidConfigMapKey(draft.id, 512)) {
		throw new Error("Provider ID 不能为空、不能带首尾空格，也不能使用保留的 JSON 属性名。");
	}
	validateOptionalHttpUrl(draft.baseURL, "Base URL");
	validateOptionalHttpUrl(draft.enterpriseUrl, "Enterprise URL");
	validateTimeout(draft.timeout, "Timeout");
	validateTimeout(draft.headerTimeout, "Header timeout");
	if (draft.chunkTimeout !== null && (!Number.isSafeInteger(draft.chunkTimeout) || draft.chunkTimeout <= 0)) {
		throw new Error("Chunk timeout 必须是大于 0 的整数毫秒数。");
	}
	if (draft.credential.mode === "env" && !ENV_NAME_PATTERN.test(draft.credential.env.trim())) {
		throw new Error("环境变量名无效。");
	}
	if (
		draft.credential.mode === "store"
		&& !draft.credential.value
		&& !draft.credential.hasStoreValue
	) {
		throw new Error("请输入要保存到 OpenCode credential store 的 API key。");
	}
	validateHeaders(draft.headers, "Provider");
	parseJsonObject("Provider options 扩展参数", draft.optionExtrasJson, PROVIDER_OPTION_RESERVED_KEYS);
	parseJsonObject("Provider 扩展参数", draft.providerExtrasJson, PROVIDER_RESERVED_KEYS);

	const modelIds = new Set<string>();
	for (const model of draft.models) {
		if (!isValidConfigMapKey(model.id, 512)) {
			throw new Error("每个模型都必须填写有效的 Model ID。");
		}
		if (modelIds.has(model.id)) {
			throw new Error(`Model ID 重复：${model.id}`);
		}
		modelIds.add(model.id);
		validateModelDraft(model);
	}
}

export function shouldDeleteStoredProviderCredential(draft: ProviderSettingsDraft): boolean {
	return draft.credential.initialMode === "store"
		&& draft.credential.mode !== "store"
		&& draft.credential.hasStoreValue;
}

function validateModelDraft(model: ProviderSettingsModelDraft): void {
	validateHeaders(model.headers, `模型 ${model.id}`);
	for (const [label, value] of [
		["context limit", model.limit.context],
		["input limit", model.limit.input],
		["output limit", model.limit.output],
	] as const) {
		if (value !== null && (!Number.isFinite(value) || value < 0)) {
			throw new Error(`模型 ${model.id} 的 ${label} 必须是非负数。`);
		}
	}
	for (const [label, value] of costEntries(model)) {
		if (value !== null && (!Number.isFinite(value) || value < 0)) {
			throw new Error(`模型 ${model.id} 的 ${label} 必须是非负数。`);
		}
	}
	validateRequiredPair(
		model.limit,
		["context", "output"],
		`模型 ${model.id} 的 limit 一旦填写，就必须同时包含 context 和 output。`,
	);
	validateRequiredPair(
		model.cost,
		["input", "output"],
		`模型 ${model.id} 的 cost 一旦填写，就必须同时包含 input 和 output。`,
		["contextOver200k"],
	);
	validateRequiredPair(
		model.cost.contextOver200k,
		["input", "output"],
		`模型 ${model.id} 的 context_over_200k 一旦填写，就必须同时包含 input 和 output。`,
	);
	parseJsonObject(`模型 ${model.id} options`, model.optionsJson);
	parseJsonObject(`模型 ${model.id} variants`, model.variantsJson);
	parseJsonObject(`模型 ${model.id} 扩展参数`, model.extrasJson, MODEL_RESERVED_KEYS);
}

function modelDraftToConfig(model: ProviderSettingsModelDraft, existingValue: unknown): JsonObject {
	const existing = asObject(existingValue) ?? {};
	const output = parseJsonObject(`模型 ${model.id} 扩展参数`, model.extrasJson, MODEL_RESERVED_KEYS);
	assignString(output, "id", model.apiModelId);
	assignString(output, "name", model.name);
	assignString(output, "description", model.description);
	assignString(output, "family", model.family);
	assignString(output, "release_date", model.releaseDate);
	assignString(output, "status", model.status);
	assignNullable(output, "experimental", model.experimental);
	assignNullable(output, "attachment", model.attachment);
	assignNullable(output, "reasoning", model.reasoning);
	assignNullable(output, "temperature", model.temperature);
	assignNullable(output, "tool_call", model.toolCall);
	assignNullable(output, "interleaved", model.interleaved);

	const limit = compactObject({
		context: model.limit.context,
		input: model.limit.input,
		output: model.limit.output,
	});
	if (Object.keys(limit).length > 0) {
		output.limit = limit;
	}

	const contextOver200k = compactObject({
		input: model.cost.contextOver200k.input,
		output: model.cost.contextOver200k.output,
		cache_read: model.cost.contextOver200k.cacheRead,
		cache_write: model.cost.contextOver200k.cacheWrite,
	});
	const cost = compactObject({
		input: model.cost.input,
		output: model.cost.output,
		cache_read: model.cost.cacheRead,
		cache_write: model.cost.cacheWrite,
		context_over_200k: Object.keys(contextOver200k).length > 0 ? contextOver200k : null,
	});
	if (Object.keys(cost).length > 0) {
		output.cost = cost;
	}

	if (model.modalities.input !== null || model.modalities.output !== null) {
		output.modalities = compactObject({
			input: model.modalities.input === null ? null : [...model.modalities.input],
			output: model.modalities.output === null ? null : [...model.modalities.output],
		});
	}

	const providerOverride = compactObject({ api: model.api.trim() || null, npm: model.npm.trim() || null });
	if (Object.keys(providerOverride).length > 0) {
		output.provider = providerOverride;
	}

	const options = parseJsonObject(`模型 ${model.id} options`, model.optionsJson);
	if (Object.keys(options).length > 0) {
		output.options = options;
	}
	const variants = parseJsonObject(`模型 ${model.id} variants`, model.variantsJson);
	if (Object.keys(variants).length > 0) {
		output.variants = variants;
	}
	const headers = headersFromDraft(model.headers, existing.headers, `模型 ${model.id}`);
	if (Object.keys(headers).length > 0) {
		output.headers = headers;
	}
	return output;
}

function parseConfigObject(raw: string, filePath: string): JsonObject {
	const body = stripBom(raw);
	if (!body.trim()) {
		return {};
	}
	const parser = getJsoncParser();
	const errors: ParseError[] = [];
	const parsed = parser.parse(body, errors, { allowTrailingComma: true, disallowComments: false }) as unknown;
	if (errors.length > 0) {
		const first = errors[0];
		const location = offsetToLocation(body, first.offset);
		const code = parser.printParseErrorCode(first.error);
		throw new ProviderConfigParseError(
			`${path.basename(filePath)}:${String(location.line)}:${String(location.column)} JSONC 解析失败（${code}）。`,
			filePath,
			location.line,
			location.column,
		);
	}
	if (!asObject(parsed)) {
		throw new ProviderConfigParseError(
			`${path.basename(filePath)} 的根值必须是对象。`,
			filePath,
			1,
			1,
		);
	}
	return parsed as JsonObject;
}

function patchConfigRaw(
	raw: string,
	config: JsonObject,
	propertyPath: Array<string | number>,
	existingValue: unknown,
	desiredValue: unknown,
): string {
	const parser = getJsoncParser();
	const hasBom = raw.startsWith("\uFEFF");
	let body = stripBom(raw);
	if (!body.trim()) {
		body = "{}\n";
	}
	const formatting = detectFormatting(body);
	const nextBody = patchJsonValue(parser, body, propertyPath, existingValue, desiredValue, formatting);
	parseConfigObject(nextBody, "opencode.json");
	return `${hasBom ? "\uFEFF" : ""}${ensureFinalNewline(nextBody, formatting.eol)}`;
}

function patchJsonValue(
	parser: JsoncParser,
	text: string,
	propertyPath: Array<string | number>,
	existingValue: unknown,
	desiredValue: unknown,
	formatting: FormattingOptions,
): string {
	if (jsonEqual(existingValue, desiredValue)) {
		return text;
	}
	const existingObject = asObject(existingValue);
	const desiredObject = asObject(desiredValue);
	if (existingObject && desiredObject) {
		let next = text;
		for (const key of Object.keys(existingObject)) {
			if (!(key in desiredObject)) {
				next = patchJsonValue(parser, next, [...propertyPath, key], existingObject[key], undefined, formatting);
			}
		}
		for (const [key, value] of Object.entries(desiredObject)) {
			next = patchJsonValue(parser, next, [...propertyPath, key], existingObject[key], value, formatting);
		}
		return next;
	}
	if (desiredValue === undefined) {
		const deleted = deleteJsonProperty(parser, text, propertyPath);
		if (deleted !== undefined) {
			return deleted;
		}
	}

	const edits = parser.modify(text, propertyPath, desiredValue, { formattingOptions: formatting });
	return parser.applyEdits(text, edits);
}

function deleteJsonProperty(
	parser: JsoncParser,
	text: string,
	propertyPath: Array<string | number>,
): string | undefined {
	const key = propertyPath.at(-1);
	if (typeof key !== "string") {
		return undefined;
	}
	const root = parser.parseTree(text);
	const parent = root ? parser.findNodeAtLocation(root, propertyPath.slice(0, -1)) : undefined;
	if (parent?.type !== "object" || !parent.children) {
		return undefined;
	}
	const properties = parent.children;
	const index = properties.findIndex((property) => property.children?.[0]?.value === key);
	if (index < 0) {
		return undefined;
	}
	const property = properties[index];
	const edits = [{ offset: property.offset, length: property.length, content: "" }];
	const adjacent = index < properties.length - 1 ? properties[index + 1] : properties[index - 1];
	if (adjacent) {
		const searchStart = index < properties.length - 1
			? property.offset + property.length
			: adjacent.offset + adjacent.length;
		const searchEnd = index < properties.length - 1 ? adjacent.offset : property.offset;
		const comma = text.indexOf(",", searchStart);
		if (comma >= 0 && comma < searchEnd) {
			edits.push({ offset: comma, length: 1, content: "" });
		}
	}
	return parser.applyEdits(text, edits);
}

async function writeFileAtomically(filePath: string, raw: string): Promise<void> {
	await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
	const tempPath = path.join(
		path.dirname(filePath),
		`.${path.basename(filePath)}.${String(process.pid)}.${randomBytes(6).toString("hex")}.tmp`,
	);
	try {
		await fs.promises.writeFile(tempPath, raw, { encoding: "utf8", flag: "wx" });
		await fs.promises.rename(tempPath, filePath);
	} finally {
		await fs.promises.rm(tempPath, { force: true }).catch(() => undefined);
	}
}

async function assertRevisionUnchanged(document: ProviderConfigDocument): Promise<void> {
	let raw = "";
	let exists = true;
	try {
		raw = await fs.promises.readFile(document.path, "utf8");
	} catch (error) {
		if (isNodeError(error, "ENOENT")) {
			exists = false;
		} else {
			throw error;
		}
	}
	if (revisionFor(raw, exists) !== document.revision) {
		throw new ProviderConfigConflictError(document.path);
	}
}

function assertWritableTarget(document: ProviderConfigDocument): void {
	if (!document.path || (document.scope === "workspace" && !document.workspaceAvailable)) {
		throw new Error("当前没有打开的工作区，无法写入工作区 opencode.json。");
	}
}

function assertRevision(document: ProviderConfigDocument, expectedRevision: string): void {
	if (document.revision !== expectedRevision) {
		throw new ProviderConfigConflictError(document.path);
	}
}

function resolveExistingConfigFile(directory: string): string {
	const jsonPath = path.join(directory, "opencode.json");
	if (fs.existsSync(jsonPath)) {
		return jsonPath;
	}
	const jsoncPath = path.join(directory, "opencode.jsonc");
	return fs.existsSync(jsoncPath) ? jsoncPath : jsonPath;
}

function getJsoncParser(): JsoncParser {
	if (jsoncParser) {
		return jsoncParser;
	}
	try {
		jsoncParser = require(path.join(__dirname, "vendor", "jsonc-parser", "main.js")) as JsoncParser;
	} catch {
		jsoncParser = require("jsonc-parser") as JsoncParser;
	}
	return jsoncParser;
}

function revisionFor(raw: string, exists: boolean): string {
	return exists ? createHash("sha256").update(raw, "utf8").digest("hex") : MISSING_REVISION;
}

function stripBom(value: string): string {
	return value.startsWith("\uFEFF") ? value.slice(1) : value;
}

function detectFormatting(value: string): FormattingOptions {
	const eol = value.includes("\r\n") ? "\r\n" : "\n";
	const indent = value.match(/(?:^|\r?\n)([\t ]+)["}]/)?.[1] ?? "  ";
	return {
		insertSpaces: !indent.includes("\t"),
		tabSize: indent.includes("\t") ? 1 : Math.max(1, indent.length),
		eol,
	};
}

function ensureFinalNewline(value: string, eol = "\n"): string {
	return value.endsWith("\n") ? value : `${value}${eol}`;
}

function offsetToLocation(value: string, offset: number): { line: number; column: number } {
	const before = value.slice(0, Math.max(0, offset));
	const lines = before.split(/\r?\n/);
	return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
}

function parseJsonObject(label: string, value: string, reserved?: ReadonlySet<string>): JsonObject {
	const source = value.trim() || "{}";
	let parsed: unknown;
	try {
		parsed = JSON.parse(source);
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		throw new Error(`${label} 必须是有效的 JSON 对象：${detail}`);
	}
	const object = asObject(parsed);
	if (!object) {
		throw new Error(`${label} 必须是 JSON 对象。`);
	}
	assertSafeJson(object, label);
	if (reserved) {
		const collision = Object.keys(object).find((key) => reserved.has(key));
		if (collision) {
			throw new Error(`${label} 中的 ${collision} 已有专用表单字段，请不要重复填写。`);
		}
	}
	return object;
}

function assertSafeJson(value: unknown, label: string): void {
	if (Array.isArray(value)) {
		for (const item of value) {
			assertSafeJson(item, label);
		}
		return;
	}
	const object = asObject(value);
	if (!object) {
		return;
	}
	for (const [key, child] of Object.entries(object)) {
		if (FORBIDDEN_JSON_KEYS.has(key)) {
			throw new Error(`${label} 包含不允许的字段：${key}`);
		}
		assertSafeJson(child, label);
	}
}

function headersToDraft(value: unknown): ProviderSettingsHeader[] {
	const headers = asObject(value);
	if (!headers) {
		return [];
	}
	return Object.entries(headers).map(([name, headerValue]) => {
		const text = typeof headerValue === "string" ? headerValue : JSON.stringify(headerValue);
		const sensitive = SENSITIVE_HEADER_PATTERN.test(name) && text.length > 0;
		return {
			name,
			value: sensitive ? "" : text,
			hasStoredValue: sensitive,
		};
	});
}

function headersFromDraft(headers: ProviderSettingsHeader[], existingValue: unknown, label: string): JsonObject {
	validateHeaders(headers, label);
	const existing = asObject(existingValue) ?? {};
	const existingByLowerName = new Map(Object.entries(existing).map(([name, value]) => [name.toLowerCase(), value]));
	const output: JsonObject = {};
	for (const header of headers) {
		const name = header.name.trim();
		if (header.value.length > 0) {
			output[name] = header.value;
			continue;
		}
		if (header.hasStoredValue) {
			const previous = existingByLowerName.get(name.toLowerCase());
			if (previous === undefined) {
				throw new Error(`${label} 的敏感 header ${name} 已变化，请重新填写值。`);
			}
			output[name] = previous;
		}
	}
	return output;
}

function validateHeaders(headers: ProviderSettingsHeader[], label: string): void {
	const names = new Set<string>();
	for (const header of headers) {
		const name = header.name.trim();
		if (!name) {
			throw new Error(`${label} 存在未填写名称的 header。`);
		}
		const normalized = name.toLowerCase();
		if (names.has(normalized)) {
			throw new Error(`${label} 的 header 名称重复：${name}`);
		}
		names.add(normalized);
	}
}

function isValidConfigMapKey(value: string, maxLength: number): boolean {
	return Boolean(value)
		&& value === value.trim()
		&& value.length <= maxLength
		&& !FORBIDDEN_JSON_KEYS.has(value);
}

function withoutKeys(value: JsonObject, keys: ReadonlySet<string>): JsonObject {
	return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.has(key)));
}

function prettyJson(value: JsonObject): string {
	return JSON.stringify(value, null, 2);
}

function stringArray(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.filter((item): item is string => typeof item === "string");
}

function nullableModalityArray(value: unknown): ProviderSettingsModelDraft["modalities"]["input"] {
	if (!Array.isArray(value)) {
		return null;
	}
	type Modality = NonNullable<ProviderSettingsModelDraft["modalities"]["input"]>[number];
	const allowed: ReadonlySet<string> = new Set(["text", "audio", "image", "video", "pdf"]);
	return stringArray(value).filter((item): item is Modality => allowed.has(item));
}

function normalizeInterleaved(value: unknown): ProviderSettingsModelDraft["interleaved"] {
	if (typeof value === "boolean" || typeof value === "string") {
		return value;
	}
	const object = asObject(value);
	return object && typeof object.field === "string" ? { field: object.field } : null;
}

function normalizeModelStatus(value: unknown): ProviderSettingsModelDraft["status"] {
	return value === "alpha" || value === "beta" || value === "deprecated" || value === "active" ? value : "";
}

function parseEnvReference(value: string): string | undefined {
	return value.match(/^\{env:([A-Za-z_][A-Za-z0-9_]*)\}$/)?.[1];
}

function stringValue(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function nullableBoolean(value: unknown): boolean | null {
	return typeof value === "boolean" ? value : null;
}

function nullableNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function numberFalseOrNull(value: unknown): number | false | null {
	return value === false ? false : nullableNumber(value);
}

function asObject(value: unknown): JsonObject | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonObject) : undefined;
}

function assignString(target: JsonObject, key: string, value: string): void {
	if (value.trim()) {
		target[key] = value;
	}
}

function assignStringArray(target: JsonObject, key: string, values: string[]): void {
	const normalized = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
	if (normalized.length > 0) {
		target[key] = normalized;
	}
}

function assignNullable(target: JsonObject, key: string, value: unknown): void {
	if (value !== null && value !== undefined && value !== "") {
		target[key] = value;
	}
}

function compactObject(value: JsonObject): JsonObject {
	return Object.fromEntries(Object.entries(value).filter((entry) => entry[1] !== null && entry[1] !== undefined));
}

function validateOptionalHttpUrl(value: string, label: string): void {
	if (!value.trim()) {
		return;
	}
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		throw new Error(`${label} 必须是完整 URL。`);
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error(`${label} 仅支持 http 或 https。`);
	}
}

function validateTimeout(value: number | false | null, label: string): void {
	if (value !== null && value !== false && (!Number.isSafeInteger(value) || value <= 0)) {
		throw new Error(`${label} 必须是大于 0 的整数毫秒数，或设为 false。`);
	}
}

function validateRequiredPair(
	value: Record<string, unknown>,
	required: readonly string[],
	message: string,
	ignored: readonly string[] = [],
): void {
	const ignoredKeys = new Set(ignored);
	const hasAnyValue = Object.entries(value).some(
		([key, candidate]) => !ignoredKeys.has(key) && candidate !== null && candidate !== undefined,
	);
	if (hasAnyValue && required.some((key) => value[key] === null || value[key] === undefined)) {
		throw new Error(message);
	}
}

function costEntries(model: ProviderSettingsModelDraft): Array<[string, number | null]> {
	return [
		["input cost", model.cost.input],
		["output cost", model.cost.output],
		["cache read cost", model.cost.cacheRead],
		["cache write cost", model.cost.cacheWrite],
		["context_over_200k input cost", model.cost.contextOver200k.input],
		["context_over_200k output cost", model.cost.contextOver200k.output],
		["context_over_200k cache read cost", model.cost.contextOver200k.cacheRead],
		["context_over_200k cache write cost", model.cost.contextOver200k.cacheWrite],
	];
}

function jsonEqual(left: unknown, right: unknown): boolean {
	if (Object.is(left, right)) {
		return true;
	}
	if (Array.isArray(left) && Array.isArray(right)) {
		return left.length === right.length && left.every((value, index) => jsonEqual(value, right[index]));
	}
	const leftObject = asObject(left);
	const rightObject = asObject(right);
	if (!leftObject || !rightObject) {
		return false;
	}
	const leftKeys = Object.keys(leftObject);
	const rightKeys = Object.keys(rightObject);
	return leftKeys.length === rightKeys.length
		&& leftKeys.every((key) => key in rightObject && jsonEqual(leftObject[key], rightObject[key]));
}

function isNodeError(error: unknown, code: string): boolean {
	return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === code;
}
