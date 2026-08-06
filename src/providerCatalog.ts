import {
	modelConfigToDraft,
} from "./providerSettings";
import type {
	ProviderSettingsAuthMethod,
	ProviderSettingsAuthPrompt,
	ProviderSettingsAuthPromptWhen,
	ProviderSettingsCatalogEntry,
	ProviderSettingsCatalogModel,
} from "./shared/protocol";

type JsonRecord = Record<string, unknown>;

export type NormalizedProviderCatalog = {
	entries: ProviderSettingsCatalogEntry[];
	modelsByProvider: Map<string, ProviderSettingsCatalogModel[]>;
	connectedProviderIds: Set<string>;
	builtInProviderIds: Set<string>;
};

export function normalizeProviderCatalog(
	providerPayload: unknown,
	authPayload: unknown,
	configuredProviderIds: ReadonlySet<string> = new Set(),
): NormalizedProviderCatalog {
	const root = asRecord(providerPayload) ?? {};
	const connectedProviderIds = new Set(readConnectedProviderIds(root.connected));
	const authMethods = normalizeAuthMethods(authPayload);
	const providers = normalizeProviderList(root.all ?? providerPayload);
	const modelsByProvider = new Map<string, ProviderSettingsCatalogModel[]>();
	const entries: ProviderSettingsCatalogEntry[] = [];
	const builtInProviderIds = new Set<string>();

	for (const provider of providers) {
		const id = readString(provider.id);
		if (!id) {
			continue;
		}
		const source = readString(provider.source) || "builtin";
		const builtIn = source !== "config" || authMethods.has(id);
		if (builtIn) {
			builtInProviderIds.add(id);
		}
		const models = normalizeModels(provider.models);
		modelsByProvider.set(id, models);
		entries.push({
			id,
			label: readString(provider.name) || id,
			source,
			api: readString(provider.api),
			npm: readString(provider.npm),
			builtIn,
			connected: connectedProviderIds.has(id),
			credentialStored: false,
			credentialType: null,
			configuredInScope: configuredProviderIds.has(id),
			env: readStringArray(provider.env),
			modelCount: models.length,
			authMethods: authMethods.get(id) ?? [],
		});
	}

	entries.sort((left, right) => {
		if (left.configuredInScope !== right.configuredInScope) {
			return left.configuredInScope ? -1 : 1;
		}
		if (left.connected !== right.connected) {
			return left.connected ? -1 : 1;
		}
		return left.label.localeCompare(right.label) || left.id.localeCompare(right.id);
	});

	return { entries, modelsByProvider, connectedProviderIds, builtInProviderIds };
}

export function mergeConfiguredCatalogEntries(
	catalog: ProviderSettingsCatalogEntry[],
	configured: Array<{ id: string; name: string; npm: string; api: string; env: string[]; credential: { connected: boolean; hasStoreValue: boolean } }>,
): ProviderSettingsCatalogEntry[] {
	const byId = new Map(catalog.map((entry) => [entry.id, { ...entry }]));
	for (const provider of configured) {
		const existing = byId.get(provider.id);
		if (existing) {
			byId.set(provider.id, {
				...existing,
				credentialStored: existing.credentialStored || provider.credential.hasStoreValue,
				credentialType: existing.credentialType ?? (provider.credential.hasStoreValue ? "api" : null),
				configuredInScope: true,
			});
			continue;
		}
		byId.set(provider.id, {
			id: provider.id,
			label: provider.name || provider.id,
			source: "config",
			api: provider.api,
			npm: provider.npm,
			builtIn: false,
			connected: provider.credential.connected,
			credentialStored: provider.credential.hasStoreValue,
			credentialType: provider.credential.hasStoreValue ? "api" : null,
			configuredInScope: true,
			env: provider.env,
			modelCount: 0,
			authMethods: [],
		});
	}
	return [...byId.values()].sort((left, right) => {
		if (left.configuredInScope !== right.configuredInScope) {
			return left.configuredInScope ? -1 : 1;
		}
		if (left.connected !== right.connected) {
			return left.connected ? -1 : 1;
		}
		return left.label.localeCompare(right.label) || left.id.localeCompare(right.id);
	});
}

export function resolveStoredCredentialProviderIds(
	credentials: Array<{ id: string; label: string; type?: string }>,
	providers: Array<{ id: string; label: string }>,
): Set<string> {
	return new Set(
		[...resolveStoredCredentialTypes(credentials, providers)]
			.filter(([, type]) => type === "api")
			.map(([providerId]) => providerId),
	);
}

export function resolveStoredCredentialTypes(
	credentials: Array<{ id: string; label: string; type?: string }>,
	providers: Array<{ id: string; label: string }>,
): Map<string, "api" | "oauth"> {
	const exactIds = new Map(providers.map((provider) => [provider.id, provider.id]));
	const foldedIds = groupProviderIdentities(providers, (provider) => provider.id);
	const foldedLabels = groupProviderIdentities(providers, (provider) => provider.label);
	const result = new Map<string, "api" | "oauth">();

	for (const credential of credentials) {
		const type = credential.type?.toLowerCase();
		if (type !== "api" && type !== "oauth") {
			continue;
		}
		const exact = exactIds.get(credential.id);
		const byId = uniqueIdentity(foldedIds.get(foldIdentity(credential.id)));
		const byLabel = uniqueIdentity(foldedLabels.get(foldIdentity(credential.label)));
		result.set(exact ?? byId ?? byLabel ?? credential.id, type);
	}
	return result;
}

function groupProviderIdentities(
	providers: Array<{ id: string; label: string }>,
	select: (provider: { id: string; label: string }) => string,
): Map<string, string[]> {
	const result = new Map<string, string[]>();
	for (const provider of providers) {
		const key = foldIdentity(select(provider));
		const ids = result.get(key) ?? [];
		ids.push(provider.id);
		result.set(key, ids);
	}
	return result;
}

function uniqueIdentity(ids: string[] | undefined): string | undefined {
	return ids?.length === 1 ? ids[0] : undefined;
}

function foldIdentity(value: string): string {
	return value.trim().toLocaleLowerCase("en-US");
}

function normalizeProviderList(value: unknown): JsonRecord[] {
	if (Array.isArray(value)) {
		return value.map(asRecord).filter((entry): entry is JsonRecord => Boolean(entry));
	}
	const record = asRecord(value);
	if (!record) {
		return [];
	}
	return Object.entries(record).flatMap(([id, provider]) => {
		const normalized = asRecord(provider);
		return normalized ? [{ id, ...normalized }] : [];
	});
}

function normalizeModels(value: unknown): ProviderSettingsCatalogModel[] {
	if (Array.isArray(value)) {
		return value.flatMap((model) => {
			const normalized = asRecord(model);
			const id = readString(normalized?.id);
			return normalized && id ? [catalogModelToDraft(id, normalized)] : [];
		});
	}
	const record = asRecord(value);
	if (!record) {
		return [];
	}
	return Object.entries(record)
		.map(([id, model]) => catalogModelToDraft(id, model))
		.sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}

function catalogModelToDraft(id: string, value: unknown): ProviderSettingsCatalogModel {
	const model = asRecord(value) ?? {};
	const capabilities = asRecord(model.capabilities) ?? {};
	const api = asRecord(model.api);
	const upstreamModelId = readString(api?.id) || (typeof model.api === "string" ? model.api : "");
	const configShape = {
		id: upstreamModelId && upstreamModelId !== id ? upstreamModelId : undefined,
		name: model.name,
		description: model.description,
		family: model.family,
		release_date: model.release_date,
		status: model.status,
		experimental: model.experimental,
		attachment: capabilities.attachment ?? model.attachment,
		reasoning: capabilities.reasoning ?? model.reasoning,
		temperature: capabilities.temperature ?? model.temperature,
		tool_call: capabilities.toolcall ?? capabilities.tool_call ?? model.tool_call,
		interleaved: capabilities.interleaved ?? model.interleaved,
		cost: normalizeCatalogCost(model.cost),
		limit: model.limit,
		modalities: normalizeCatalogModalities(model.modalities, capabilities),
		options: model.options,
		headers: model.headers,
		variants: model.variants,
	};
	return modelConfigToDraft(id, configShape);
}

function normalizeCatalogCost(value: unknown): JsonRecord | undefined {
	const cost = asRecord(value);
	if (!cost) {
		return undefined;
	}
	const cache = asRecord(cost.cache);
	const contextOver200k = asRecord(cost.context_over_200k ?? cost.experimentalOver200K);
	const contextCache = asRecord(contextOver200k?.cache);
	return {
		input: cost.input,
		output: cost.output,
		cache_read: cost.cache_read ?? cache?.read,
		cache_write: cost.cache_write ?? cache?.write,
		context_over_200k: contextOver200k
			? {
				input: contextOver200k.input,
				output: contextOver200k.output,
				cache_read: contextOver200k.cache_read ?? contextCache?.read,
				cache_write: contextOver200k.cache_write ?? contextCache?.write,
			}
			: undefined,
	};
}

function normalizeCatalogModalities(
	value: unknown,
	capabilities: JsonRecord,
): { input: string[]; output: string[] } {
	const modalities = asRecord(value);
	return {
		input: readCapabilityModalities(modalities?.input ?? capabilities.input),
		output: readCapabilityModalities(modalities?.output ?? capabilities.output),
	};
}

function readCapabilityModalities(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value.filter((item): item is string => typeof item === "string");
	}
	const record = asRecord(value);
	if (!record) {
		return [];
	}
	return Object.entries(record)
		.filter(([, enabled]) => enabled === true)
		.map(([name]) => name);
}

function readConnectedProviderIds(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.flatMap((entry) => {
		if (typeof entry === "string") {
			return [entry];
		}
		const record = asRecord(entry);
		const id = readString(record?.id ?? record?.providerID);
		return id ? [id] : [];
	});
}

function normalizeAuthMethods(value: unknown): Map<string, ProviderSettingsAuthMethod[]> {
	const result = new Map<string, ProviderSettingsAuthMethod[]>();
	const record = asRecord(value);
	if (record) {
		for (const [providerId, methods] of Object.entries(record)) {
			result.set(providerId, normalizeAuthMethodList(methods));
		}
		return result;
	}
	if (!Array.isArray(value)) {
		return result;
	}
	for (const entry of value) {
		const provider = asRecord(entry);
		const providerId = readString(provider?.id ?? provider?.providerID);
		if (providerId) {
			result.set(providerId, normalizeAuthMethodList(provider?.methods ?? provider?.auth));
		}
	}
	return result;
}

function normalizeAuthMethodList(value: unknown): ProviderSettingsAuthMethod[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.flatMap((entry) => {
		const method = asRecord(entry);
		const type = readString(method?.type);
		if (!type) {
			return [];
		}
		if (type !== "api" && type !== "oauth") {
			return [];
		}
		return [{
			type,
			label: readString(method?.label ?? method?.name) || formatAuthType(type),
			prompts: normalizeAuthPrompts(method?.prompts),
		}];
	});
}

function normalizeAuthPrompts(value: unknown): ProviderSettingsAuthPrompt[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.flatMap<ProviderSettingsAuthPrompt>((entry) => {
		const prompt = asRecord(entry);
		const type = readString(prompt?.type);
		const key = readString(prompt?.key);
		const message = readString(prompt?.message);
		if ((type !== "text" && type !== "select") || !key || !message) {
			return [];
		}
		const whenRecord = asRecord(prompt?.when);
		const whenKey = readString(whenRecord?.key);
		const whenOp = readString(whenRecord?.op);
		const whenValue = readString(whenRecord?.value);
		const when: ProviderSettingsAuthPromptWhen | undefined = whenKey && (whenOp === "eq" || whenOp === "neq")
			? { key: whenKey, op: whenOp, value: whenValue }
			: undefined;
		if (type === "text") {
			const placeholder = readString(prompt?.placeholder);
			return [{
				type,
				key,
				message,
				...(placeholder ? { placeholder } : {}),
				...(when ? { when } : {}),
			}];
		}
		const options = Array.isArray(prompt?.options)
			? prompt.options.flatMap((item) => {
				const option = asRecord(item);
				const label = readString(option?.label);
				const optionValue = readString(option?.value);
				if (!label || !optionValue) {
					return [];
				}
				const hint = readString(option?.hint);
				return [{ label, value: optionValue, ...(hint ? { hint } : {}) }];
			})
			: [];
		return [{ type, key, message, options, ...(when ? { when } : {}) }];
	});
}

function formatAuthType(value: string): string {
	return value
		.split(/[-_]/)
		.filter(Boolean)
		.map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
		.join(" ");
}

function readString(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function readStringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

function asRecord(value: unknown): JsonRecord | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as JsonRecord)
		: undefined;
}
