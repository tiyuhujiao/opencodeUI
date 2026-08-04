"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractModelDefinitionMetadata = extractModelDefinitionMetadata;
exports.extractConfiguredModelMetadata = extractConfiguredModelMetadata;
function extractModelDefinitionMetadata(value) {
    if (!isRecord(value)) {
        return {};
    }
    const variants = readVariants(value.variants);
    const limit = isRecord(value.limit) ? value.limit : isRecord(value.limits) ? value.limits : undefined;
    const contextWindow = toPositiveFiniteNumber(limit?.context);
    return {
        ...(variants.length > 0 ? { variants } : {}),
        ...(contextWindow !== undefined ? { contextWindow } : {})
    };
}
function extractConfiguredModelMetadata(value) {
    const result = new Map();
    if (!isRecord(value) || !isRecord(value.provider)) {
        return result;
    }
    for (const [providerId, providerValue] of Object.entries(value.provider)) {
        if (!isRecord(providerValue) || !isRecord(providerValue.models)) {
            continue;
        }
        for (const [modelId, modelValue] of Object.entries(providerValue.models)) {
            const normalizedProviderId = providerId.trim();
            const normalizedModelId = modelId.trim();
            if (!normalizedProviderId || !normalizedModelId) {
                continue;
            }
            const modelName = `${normalizedProviderId}/${normalizedModelId}`;
            result.set(modelName, extractModelDefinitionMetadata(modelValue));
        }
    }
    return result;
}
function readVariants(value) {
    const names = Array.isArray(value)
        ? value.filter((entry) => typeof entry === 'string')
        : isRecord(value)
            ? Object.keys(value)
            : [];
    const seen = new Set();
    const result = [];
    for (const name of names) {
        const trimmed = name.trim();
        const normalized = trimmed.toLowerCase();
        if (!trimmed || seen.has(normalized)) {
            continue;
        }
        seen.add(normalized);
        result.push(trimmed);
    }
    return result;
}
function toPositiveFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
//# sourceMappingURL=modelConfig.js.map