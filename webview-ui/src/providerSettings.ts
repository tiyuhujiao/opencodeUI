import type {
  ProviderSettingsCatalogEntry,
  ProviderSettingsDraft,
  ProviderSettingsModelDraft,
  ProviderUpstreamModel
} from '../../src/shared/protocol'

export type EditableJsonObject = Record<string, unknown>

export type ModelThinkingAvailability = {
  available: boolean
  source: 'metadata' | 'variants' | 'metadata-and-variants' | 'none'
  activeLevelCount: number
  metadata: boolean | null
  metadataConflict: boolean
}

const THINKING_OPTION_KEYS = [
  'reasoningEffort',
  'reasoningSummary',
  'reasoning',
  'thinking',
  'thinkingBudget',
  'thinkingConfig',
  'reasoning_effort'
] as const

const THINKING_DEPTH_ORDER = new Map(
  ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].map((option, index) => [option, index])
)

const OPENAI_SERVICE_TIER_ADAPTER = '@ai-sdk/openai'
const OPENAI_SERVICE_TIER_MODEL_PATTERN = /^(?:gpt-\d|chatgpt-|o\d(?:-|$))/i

export function createEmptyProviderModelDraft(id = ''): ProviderSettingsModelDraft {
  return {
    id,
    apiModelId: '',
    name: id,
    description: '',
    api: '',
    npm: '',
    family: '',
    releaseDate: '',
    status: '',
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
        cacheWrite: null
      }
    },
    modalities: { input: null, output: null },
    headers: [],
    optionsJson: '{}',
    variantsJson: '{}',
    extrasJson: '{}'
  }
}

export function createEmptyProviderDraft(): ProviderSettingsDraft {
  return {
    originalId: null,
    id: '',
    configId: '',
    custom: true,
    name: '',
    api: '',
    npm: '@ai-sdk/openai-compatible',
    env: [],
    whitelist: [],
    blacklist: [],
    baseURL: '',
    enterpriseUrl: '',
    setCacheKey: null,
    timeout: null,
    headerTimeout: null,
    chunkTimeout: null,
    headers: [],
    credential: {
      mode: 'store',
      initialMode: 'none',
      value: '',
      env: '',
      hasConfigValue: false,
      hasStoreValue: false,
      connected: false
    },
    optionExtrasJson: '{}',
    providerExtrasJson: '{}',
    models: []
  }
}

export function providerDraftFromCatalog(entry: ProviderSettingsCatalogEntry): ProviderSettingsDraft {
  return {
    ...createEmptyProviderDraft(),
    id: entry.id,
    custom: !entry.builtIn,
    name: entry.label === entry.id ? '' : entry.label,
    api: entry.api,
    npm: entry.npm,
    env: [...entry.env],
    credential: {
      mode: entry.credentialStored ? 'store' : 'none',
      initialMode: entry.credentialStored ? 'store' : 'none',
      value: '',
      env: entry.env[0] ?? '',
      hasConfigValue: false,
      hasStoreValue: entry.credentialStored,
      connected: entry.connected
    }
  }
}

export function cloneProviderDraft(draft: ProviderSettingsDraft): ProviderSettingsDraft {
  return JSON.parse(JSON.stringify(draft)) as ProviderSettingsDraft
}

export function duplicateProviderModelDraft(
  model: ProviderSettingsModelDraft,
  models: ProviderSettingsModelDraft[]
): ProviderSettingsModelDraft {
  const copy = JSON.parse(JSON.stringify(model)) as ProviderSettingsModelDraft
  const baseId = model.id.trim() || 'model'
  const ids = new Set(models.map((entry) => entry.id))
  let id = `${baseId}-copy`
  let index = 2
  while (ids.has(id)) {
    id = `${baseId}-copy-${String(index)}`
    index += 1
  }
  copy.id = id
  copy.name = model.name.trim() ? `${model.name} copy` : id
  return copy
}

export function providerModelDraftFromUpstream(model: ProviderUpstreamModel): ProviderSettingsModelDraft {
  const draft = createEmptyProviderModelDraft(model.id)
  draft.name = model.name || model.id
  draft.description = model.description
  draft.limit.context = model.contextWindow
  draft.limit.output = model.maxOutputTokens
  return draft
}

export function defaultUpstreamModelsEndpoint(baseURL: string): string {
  try {
    const url = new URL(baseURL.trim())
    url.search = ''
    url.hash = ''
    if (!url.pathname.toLowerCase().endsWith('/models')) {
      url.pathname = `${url.pathname.replace(/\/+$/, '')}/models`
    }
    return url.toString()
  } catch {
    return baseURL.trim()
  }
}

export function linesToList(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
}

export function listToLines(value: string[]): string {
  return value.join('\n')
}

export function parseEditableJsonObject(value: string): EditableJsonObject | null {
  try {
    const parsed = JSON.parse(value.trim() || '{}') as unknown
    return isEditableJsonObject(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function formatEditableJsonObject(value: EditableJsonObject): string {
  return JSON.stringify(value, null, 2)
}

export function setEditableJsonProperty(
  source: string,
  key: string,
  value: unknown | undefined
): string | null {
  const object = parseEditableJsonObject(source)
  if (!object) {
    return null
  }
  return formatEditableJsonObject(setObjectProperty(object, key, value))
}

export function setNestedEditableJsonProperty(
  source: string,
  parentKey: string,
  key: string,
  value: unknown | undefined
): string | null {
  const object = parseEditableJsonObject(source)
  const child = object && isEditableJsonObject(object[parentKey]) ? object[parentKey] : null
  if (!object || !child) {
    return null
  }
  return formatEditableJsonObject(setObjectProperty(object, parentKey, setObjectProperty(child, key, value)))
}

export function addEditableJsonEntry(source: string, key: string, value: EditableJsonObject = {}): string | null {
  const object = parseEditableJsonObject(source)
  if (!object || !key || hasOwn(object, key)) {
    return null
  }
  return formatEditableJsonObject(setObjectProperty(object, key, value))
}

export function renameEditableJsonEntry(source: string, currentKey: string, nextKey: string): string | null {
  const object = parseEditableJsonObject(source)
  const trimmed = nextKey.trim()
  if (!object || !hasOwn(object, currentKey) || !trimmed || (trimmed !== currentKey && hasOwn(object, trimmed))) {
    return null
  }
  return formatEditableJsonObject(Object.fromEntries(
    Object.entries(object).map(([key, value]) => [key === currentKey ? trimmed : key, value])
  ))
}

export function renameThinkingLevelEntry(source: string, currentKey: string, nextKey: string): string | null {
  const object = parseEditableJsonObject(source)
  const currentValue = object?.[currentKey]
  const renamed = renameEditableJsonEntry(source, currentKey, nextKey)
  if (!renamed || !isEditableJsonObject(currentValue) || !hasOwn(currentValue, 'reasoningEffort')) {
    return renamed
  }

  const effort = thinkingEffortFromLevelId(nextKey)
  if (!effort) {
    return renamed
  }

  return setNestedEditableJsonProperty(renamed, nextKey.trim(), 'reasoningEffort', effort) ?? renamed
}

export function removeEditableJsonEntry(source: string, key: string): string | null {
  const object = parseEditableJsonObject(source)
  if (!object || !hasOwn(object, key)) {
    return null
  }
  return formatEditableJsonObject(Object.fromEntries(Object.entries(object).filter(([entryKey]) => entryKey !== key)))
}

export function nextEditableJsonKey(source: string, base: string): string {
  const object = parseEditableJsonObject(source) ?? {}
  if (!hasOwn(object, base)) {
    return base
  }
  let index = 2
  while (hasOwn(object, `${base}-${String(index)}`)) {
    index += 1
  }
  return `${base}-${String(index)}`
}

export function getModelThinkingAvailability(
  model: Pick<ProviderSettingsModelDraft, 'reasoning' | 'variantsJson'>
): ModelThinkingAvailability {
  const variants = parseEditableJsonObject(model.variantsJson)
  const activeLevelCount = variants
    ? Object.values(variants).filter((value) => isReasoningVariant(value)).length
    : 0
  const fromMetadata = model.reasoning === true
  const fromVariants = activeLevelCount > 0
  const source = fromMetadata && fromVariants
    ? 'metadata-and-variants'
    : fromVariants
      ? 'variants'
      : fromMetadata
        ? 'metadata'
        : 'none'

  return {
    available: fromMetadata || fromVariants,
    source,
    activeLevelCount,
    metadata: model.reasoning,
    metadataConflict: model.reasoning === false && fromVariants
  }
}

export function getOrderedThinkingVariantEntries(source: string): Array<[string, unknown]> | null {
  const variants = parseEditableJsonObject(source)
  if (!variants) {
    return null
  }

  return Object.entries(variants)
    .map(([id, value], index) => ({ id, value, index, rank: thinkingVariantRank(id, value) }))
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map(({ id, value }) => [id, value])
}

export function supportsOpenAiServiceTier(
  model: Pick<ProviderSettingsModelDraft, 'id' | 'apiModelId' | 'name' | 'family' | 'npm'>,
  providerNpm: string
): boolean {
  const effectiveAdapter = model.npm.trim() || providerNpm.trim()
  if (effectiveAdapter !== OPENAI_SERVICE_TIER_ADAPTER) {
    return false
  }

  if (model.family.trim().toLowerCase() === 'gpt') {
    return true
  }

  return [model.id, model.apiModelId, model.name].some((value) => {
    const normalized = value.trim().toLowerCase().replace(/^openai[/:]/, '')
    return OPENAI_SERVICE_TIER_MODEL_PATTERN.test(normalized)
  })
}

function setObjectProperty(object: EditableJsonObject, key: string, value: unknown | undefined): EditableJsonObject {
  const entries = Object.entries(object)
  if (value === undefined) {
    return Object.fromEntries(entries.filter(([entryKey]) => entryKey !== key))
  }
  if (hasOwn(object, key)) {
    return Object.fromEntries(entries.map(([entryKey, entryValue]) => [entryKey, entryKey === key ? value : entryValue]))
  }
  return Object.fromEntries([...entries, [key, value]])
}

function isEditableJsonObject(value: unknown): value is EditableJsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isReasoningVariant(value: unknown): boolean {
  if (!isEditableJsonObject(value) || value.disabled === true) {
    return false
  }
  return THINKING_OPTION_KEYS.some((key) => hasMeaningfulThinkingValue(value[key]))
}

function hasMeaningfulThinkingValue(value: unknown): boolean {
  if (typeof value === 'string') {
    return value.trim().length > 0
  }
  if (typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0
  }
  if (Array.isArray(value)) {
    return value.length > 0
  }
  return isEditableJsonObject(value) && Object.keys(value).length > 0
}

function thinkingVariantRank(id: string, value: unknown): number {
  const options = isEditableJsonObject(value) ? value : null
  const effort = typeof options?.reasoningEffort === 'string'
    ? options.reasoningEffort.trim().toLowerCase()
    : ''
  return THINKING_DEPTH_ORDER.get(effort)
    ?? THINKING_DEPTH_ORDER.get(thinkingEffortFromLevelId(id) ?? '')
    ?? Number.MAX_SAFE_INTEGER
}

function thinkingEffortFromLevelId(id: string): string | null {
  const normalizedId = id.trim().toLowerCase()
  const idDepth = normalizedId.split(/[-_.:/]/, 1)[0]
  if (THINKING_DEPTH_ORDER.has(normalizedId)) {
    return normalizedId
  }
  return THINKING_DEPTH_ORDER.has(idDepth) ? idDepth : null
}

function hasOwn(object: EditableJsonObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key)
}
