import * as fs from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";
import type {
	ProviderSettingsDraft,
	ProviderSettingsScope,
	ProviderUpstreamModel,
} from "./shared/protocol";
import {
	readProviderConfigDocument,
	type ProviderSettingsPathOptions,
} from "./providerSettings";

type JsonObject = Record<string, unknown>;

export type ProviderUpstreamModelsOptions = ProviderSettingsPathOptions & {
	fetchImpl?: typeof fetch;
	timeoutMs?: number;
	maxResponseBytes?: number;
};

export type ProviderUpstreamModelsResult = {
	endpoint: string;
	models: ProviderUpstreamModel[];
};

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_MODELS = 5_000;
const MAX_AUTH_FILE_BYTES = 2 * 1024 * 1024;

export async function fetchProviderUpstreamModels(
	scope: ProviderSettingsScope,
	draft: ProviderSettingsDraft,
	endpoint: string,
	options: ProviderUpstreamModelsOptions = {},
): Promise<ProviderUpstreamModelsResult> {
	const url = parseEndpoint(endpoint);
	const document = await readProviderConfigDocument(scope, options);
	const existingProvider = findExistingProvider(document.config, draft.originalId ?? draft.id);
	const existingOptions = asObject(existingProvider?.options) ?? {};
	const headers = resolveRequestHeaders(draft, existingOptions, options);
	const credential = await resolveCredential(draft, existingOptions, options);
	applyCredentialHeader(headers, credential, draft.npm);

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
	try {
		const response = await (options.fetchImpl ?? fetch)(url, {
			method: "GET",
			headers,
			redirect: "manual",
			signal: controller.signal,
		});
		if (response.status >= 300 && response.status < 400) {
			throw new Error("Upstream model endpoint redirected. Enter the final endpoint URL directly.");
		}

		const maxBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
		const declaredBytes = Number(response.headers.get("content-length"));
		if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
			await response.body?.cancel();
			throw new Error(`Upstream model response exceeds ${String(Math.round(maxBytes / 1024 / 1024))} MB.`);
		}

		const bytes = Buffer.from(await response.arrayBuffer());
		if (bytes.byteLength > maxBytes) {
			throw new Error(`Upstream model response exceeds ${String(Math.round(maxBytes / 1024 / 1024))} MB.`);
		}
		const text = bytes.toString("utf8");
		if (!response.ok) {
			throw new Error(formatUpstreamError(response.status, response.statusText, text));
		}

		let payload: unknown;
		try {
			payload = JSON.parse(text) as unknown;
		} catch {
			throw new Error("Upstream model endpoint did not return valid JSON.");
		}
		const models = normalizeUpstreamModels(payload);
		if (models.length === 0) {
			throw new Error("No models were found in the upstream response.");
		}
		return { endpoint: url.toString(), models };
	} catch (error) {
		if (controller.signal.aborted) {
			throw new Error("Fetching upstream models timed out.");
		}
		throw error;
	} finally {
		clearTimeout(timeout);
	}
}

export function normalizeUpstreamModels(payload: unknown): ProviderUpstreamModel[] {
	const candidates = findModelArray(payload);
	const seen = new Set<string>();
	const models: ProviderUpstreamModel[] = [];
	for (const candidate of candidates) {
		const model = normalizeModel(candidate);
		if (!model || seen.has(model.id)) {
			continue;
		}
		seen.add(model.id);
		models.push(model);
		if (models.length >= MAX_MODELS) {
			break;
		}
	}
	return models;
}

function parseEndpoint(value: string): URL {
	let url: URL;
	try {
		url = new URL(value.trim());
	} catch {
		throw new Error("Enter a valid upstream models endpoint URL.");
	}
	if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
		throw new Error("Upstream models endpoint must be an HTTP(S) URL without embedded credentials.");
	}
	return url;
}

function findExistingProvider(config: JsonObject, providerId: string): JsonObject | undefined {
	const providers = asObject(config.provider);
	return providers ? asObject(providers[providerId]) : undefined;
}

function resolveRequestHeaders(
	draft: ProviderSettingsDraft,
	existingOptions: JsonObject,
	options: ProviderUpstreamModelsOptions,
): Headers {
	const headers = new Headers({ Accept: "application/json" });
	const existingHeaders = asObject(existingOptions.headers) ?? {};
	for (const header of draft.headers) {
		const name = header.name.trim();
		if (!name) {
			continue;
		}
		const stored = findHeaderValue(existingHeaders, name);
		const value = header.value || (header.hasStoredValue ? stored : undefined);
		if (value) {
			headers.set(name, expandEnvironmentReferences(value, options.env ?? process.env));
		}
	}
	return headers;
}

async function resolveCredential(
	draft: ProviderSettingsDraft,
	existingOptions: JsonObject,
	options: ProviderUpstreamModelsOptions,
): Promise<string | undefined> {
	const env = options.env ?? process.env;
	if (draft.credential.value) {
		return draft.credential.value;
	}
	if (draft.credential.mode === "env") {
		return env[draft.credential.env.trim()]?.trim() || undefined;
	}
	if (draft.credential.mode === "config") {
		const configured = typeof existingOptions.apiKey === "string" ? existingOptions.apiKey : "";
		return expandEnvironmentReferences(configured, env) || undefined;
	}
	if (draft.credential.mode === "store") {
		return readStoredApiKey(draft.originalId ?? draft.id, options);
	}
	return undefined;
}

function applyCredentialHeader(headers: Headers, credential: string | undefined, npm: string): void {
	if (!credential || headers.has("authorization") || headers.has("x-api-key") || headers.has("x-goog-api-key")) {
		return;
	}
	if (npm === "@ai-sdk/anthropic") {
		headers.set("x-api-key", credential);
		return;
	}
	if (npm === "@ai-sdk/google") {
		headers.set("x-goog-api-key", credential);
		return;
	}
	headers.set("authorization", `Bearer ${credential}`);
}

async function readStoredApiKey(
	providerId: string,
	options: ProviderUpstreamModelsOptions,
): Promise<string | undefined> {
	const env = options.env ?? process.env;
	const home = options.homeDir ?? homedir();
	const dataRoot = env.XDG_DATA_HOME?.trim() || path.join(home, ".local", "share");
	const candidates = [
		path.join(dataRoot, "opencode", "auth.json"),
		...(env.APPDATA ? [path.join(env.APPDATA, "opencode", "auth.json")] : []),
	];
	for (const candidate of candidates) {
		let stat: fs.Stats;
		try {
			stat = await fs.promises.stat(candidate);
		} catch (error) {
			if (isNodeError(error, "ENOENT")) {
				continue;
			}
			throw error;
		}
		if (stat.size > MAX_AUTH_FILE_BYTES) {
			throw new Error("OpenCode credential store is unexpectedly large.");
		}
		const parsed = JSON.parse(await fs.promises.readFile(candidate, "utf8")) as unknown;
		const entry = asObject(asObject(parsed)?.[providerId]);
		if (entry?.type === "api" && typeof entry.key === "string" && entry.key) {
			return entry.key;
		}
	}
	return undefined;
}

function expandEnvironmentReferences(value: string, env: NodeJS.ProcessEnv): string {
	const exact = /^\{env:([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(value.trim());
	if (exact) {
		return env[exact[1]] ?? "";
	}
	return value.replace(/\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name: string) => env[name] ?? "");
}

function findHeaderValue(headers: JsonObject, name: string): string | undefined {
	const match = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
	return match && typeof match[1] === "string" ? match[1] : undefined;
}

function findModelArray(payload: unknown): unknown[] {
	if (Array.isArray(payload)) {
		return payload;
	}
	const object = asObject(payload);
	if (!object) {
		return [];
	}
	for (const key of ["data", "models", "items", "results"]) {
		if (Array.isArray(object[key])) {
			return object[key] as unknown[];
		}
	}
	return [];
}

function normalizeModel(value: unknown): ProviderUpstreamModel | undefined {
	if (typeof value === "string") {
		const id = boundedText(value, 512);
		return id ? emptyNormalizedModel(id, id) : undefined;
	}
	const object = asObject(value);
	if (!object) {
		return undefined;
	}
	const id = firstText(object, ["id", "model", "name"], 512);
	if (!id) {
		return undefined;
	}
	const name = firstText(object, ["display_name", "displayName", "label", "name"], 1024) || id;
	return {
		id,
		name,
		description: firstText(object, ["description", "summary"], 4_096),
		ownedBy: firstText(object, ["owned_by", "ownedBy", "provider", "publisher"], 512),
		createdAt: normalizeCreatedAt(object.created_at ?? object.createdAt ?? object.created),
		contextWindow: firstPositiveInteger(object, ["context_window", "contextWindow", "inputTokenLimit"]),
		maxOutputTokens: firstPositiveInteger(object, ["max_output_tokens", "maxOutputTokens", "outputTokenLimit"]),
	};
}

function emptyNormalizedModel(id: string, name: string): ProviderUpstreamModel {
	return {
		id,
		name,
		description: "",
		ownedBy: "",
		createdAt: "",
		contextWindow: null,
		maxOutputTokens: null,
	};
}

function firstText(object: JsonObject, keys: string[], maxLength: number): string {
	for (const key of keys) {
		if (typeof object[key] === "string") {
			const value = boundedText(object[key], maxLength);
			if (value) {
				return value;
			}
		}
	}
	return "";
}

function boundedText(value: string, maxLength: number): string {
	return value.trim().slice(0, maxLength);
}

function firstPositiveInteger(object: JsonObject, keys: string[]): number | null {
	for (const key of keys) {
		const value = object[key];
		if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
			return value;
		}
	}
	return null;
}

function normalizeCreatedAt(value: unknown): string {
	if (typeof value === "string") {
		return boundedText(value, 128);
	}
	if (typeof value === "number" && Number.isFinite(value) && value > 0) {
		const milliseconds = value < 10_000_000_000 ? value * 1_000 : value;
		const date = new Date(milliseconds);
		return Number.isNaN(date.getTime()) ? "" : date.toISOString();
	}
	return "";
}

function formatUpstreamError(status: number, statusText: string, text: string): string {
	let detail = "";
	try {
		const payload = asObject(JSON.parse(text) as unknown);
		const error = asObject(payload?.error);
		detail = firstText(error ?? payload ?? {}, ["message", "detail", "error_description", "error"], 1_000);
	} catch {
		detail = boundedText(text.replace(/\s+/g, " "), 1_000);
	}
	const label = `${String(status)}${statusText ? ` ${statusText}` : ""}`;
	return detail ? `Upstream models request failed (${label}): ${detail}` : `Upstream models request failed (${label}).`;
}

function asObject(value: unknown): JsonObject | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? value as JsonObject
		: undefined;
}

function isNodeError(error: unknown, code: string): boolean {
	return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === code;
}
