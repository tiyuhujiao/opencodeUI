export type ConfiguredModelMetadata = {
  variants?: string[];
  contextWindow?: number;
};

export function extractModelDefinitionMetadata(value: unknown): ConfiguredModelMetadata {
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

export function extractConfiguredModelMetadata(value: unknown): Map<string, ConfiguredModelMetadata> {
  const result = new Map<string, ConfiguredModelMetadata>();
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

function readVariants(value: unknown): string[] {
  const names = Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : isRecord(value)
      ? Object.keys(value)
      : [];

  const seen = new Set<string>();
  const result: string[] = [];
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

function toPositiveFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
