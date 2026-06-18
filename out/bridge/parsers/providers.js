"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildProviderSummaries = buildProviderSummaries;
exports.extractConfiguredProviderLabels = extractConfiguredProviderLabels;
function buildProviderSummaries(authProviders, providerIds, configuredLabels) {
    const authById = new Map(authProviders.map((entry) => [entry.id, entry.label]));
    const availableIds = new Set(providerIds);
    const orderedIds = [];
    const seenIds = new Set();
    for (const entry of authProviders) {
        if (!availableIds.has(entry.id) || seenIds.has(entry.id)) {
            continue;
        }
        seenIds.add(entry.id);
        orderedIds.push(entry.id);
    }
    for (const providerID of providerIds) {
        if (seenIds.has(providerID)) {
            continue;
        }
        seenIds.add(providerID);
        orderedIds.push(providerID);
    }
    return orderedIds.map((providerID) => ({
        id: providerID,
        label: deriveProviderLabel(providerID, authById, configuredLabels)
    }));
}
function extractConfiguredProviderLabels(config) {
    const labels = new Map();
    if (!isRecord(config) || !isRecord(config.provider)) {
        return labels;
    }
    for (const [providerID, value] of Object.entries(config.provider)) {
        if (!providerID.trim()) {
            continue;
        }
        const configuredName = isRecord(value) && typeof value.name === 'string' ? value.name.trim() : '';
        labels.set(providerID, configuredName || providerID);
    }
    return labels;
}
function deriveProviderLabel(providerID, authById, configuredLabels) {
    const configuredLabel = configuredLabels?.get(providerID)?.trim();
    if (configuredLabel) {
        return configuredLabel;
    }
    const directLabel = authById.get(providerID);
    if (directLabel) {
        return directLabel;
    }
    return providerID;
}
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
//# sourceMappingURL=providers.js.map