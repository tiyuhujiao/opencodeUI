import type { AuthProviderEntry } from './authList';

export function buildProviderSummaries(
  authProviders: AuthProviderEntry[],
  providerIds: string[],
  configuredLabels?: Map<string, string>
): Array<{ id: string; label: string }> {
  const authById = new Map(authProviders.map((entry) => [entry.id, entry.label]));
  const availableIds = new Set(providerIds);
  const orderedIds: string[] = [];
  const seenIds = new Set<string>();

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

export function extractConfiguredProviderLabels(config: unknown): Map<string, string> {
  const labels = new Map<string, string>();
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

function deriveProviderLabel(
  providerID: string,
  authById: Map<string, string>,
  configuredLabels?: Map<string, string>
): string {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
