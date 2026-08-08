import { ExportJsonParseError, type ExportMessage, type ExportPayload } from './exportJson';

export type TranscriptRole = 'user' | 'assistant' | 'unknown';

export type TranscriptPartText = {
  type: 'text';
  text: string;
};

export type TranscriptPartReasoning = {
  type: 'reasoning';
  text: string;
  raw?: unknown;
};

export type TranscriptPartTool = {
  type: 'tool';
  toolName: string;
  status: string;
  raw: unknown;
};

export type TranscriptPartUnknown = {
  type: 'unknown';
  raw: unknown;
};

export type TranscriptPart = TranscriptPartText | TranscriptPartReasoning | TranscriptPartTool | TranscriptPartUnknown;

export type TranscriptMessage = {
  id?: string;
  created?: number;
  completed?: number;
  finish?: string;
  role: TranscriptRole;
  parts: TranscriptPart[];
  contextUsage?: {
    usedTokens: number;
    model?: string;
  };
};

export function exportToTranscript(payload: ExportPayload): TranscriptMessage[] {
  return payload.messages.map((message) => {
    const id = resolveMessageId(message.info);
    const created = resolveCreated(message.info);
    const completed = resolveCompleted(message.info);
    const finish = resolveFinish(message.info);
    const contextUsage = resolveContextUsage(message.info);
    return {
      ...(id ? { id } : {}),
      ...(created !== undefined ? { created } : {}),
      ...(completed !== undefined ? { completed } : {}),
      ...(finish ? { finish } : {}),
      role: resolveRole(message.info),
      parts: message.parts.map(mapPart),
      ...(contextUsage ? { contextUsage } : {})
    };
  });
}

export function liveMessagesToTranscript(value: unknown): TranscriptMessage[] {
  if (!Array.isArray(value)) {
    throw new ExportJsonParseError('INVALID_SHAPE', 'OpenCode session messages must be an array.');
  }

  const messages = value.map((message, index): ExportMessage => {
    if (!isRecord(message) || !Array.isArray(message.parts)) {
      throw new ExportJsonParseError(
        'INVALID_SHAPE',
        `OpenCode session messages[${String(index)}] must include a parts array.`
      );
    }
    return {
      info: message.info,
      parts: message.parts
    };
  });

  return exportToTranscript({ info: undefined, messages });
}

function resolveRole(info: unknown): TranscriptRole {
  const role = getStringFromRecord(info, 'role') ?? getNestedStringFromRecord(info, 'author', 'role');
  if (role === 'user' || role === 'assistant') {
    return role;
  }
  return 'unknown';
}

function resolveMessageId(info: unknown): string | undefined {
  const id = getStringFromRecord(info, 'id');
  return id?.trim() ? id : undefined;
}

function resolveCreated(info: unknown): number | undefined {
  return resolveMessageTime(info, 'created');
}

function resolveCompleted(info: unknown): number | undefined {
  return resolveMessageTime(info, 'completed');
}

function resolveMessageTime(info: unknown, key: 'created' | 'completed'): number | undefined {
  if (!isRecord(info)) {
    return undefined;
  }

  const time = isRecord(info.time) ? info.time : undefined;
  const candidate = time?.[key] ?? info[key];
  if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0) {
    return candidate;
  }
  if (typeof candidate === 'string') {
    const parsed = Date.parse(candidate);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function resolveFinish(info: unknown): string | undefined {
  const finish = getStringFromRecord(info, 'finish')?.trim();
  return finish || undefined;
}

function resolveContextUsage(info: unknown): TranscriptMessage['contextUsage'] {
  if (!isRecord(info)) {
    return undefined;
  }
  const metadata = isRecord(info.metadata) ? info.metadata : undefined;
  const assistant = isRecord(metadata?.assistant) ? metadata.assistant : info;
  const tokens = isRecord(assistant.tokens) ? assistant.tokens : undefined;
  if (!tokens) {
    return undefined;
  }
  const cache = isRecord(tokens.cache) ? tokens.cache : undefined;
  const input = toNonNegativeFiniteNumber(tokens.input);
  const cacheRead = toNonNegativeFiniteNumber(cache?.read);
  if (input === undefined && cacheRead === undefined) {
    return undefined;
  }

  const providerId = getStringFromRecord(assistant, 'providerID');
  const modelId = getStringFromRecord(assistant, 'modelID');
  return {
    usedTokens: (input ?? 0) + (cacheRead ?? 0),
    ...(providerId && modelId ? { model: `${providerId}/${modelId}` } : {})
  };
}

function mapPart(part: unknown): TranscriptPart {
  if (isRecord(part)) {
    const text = getStringFromRecord(part, 'text');
    if (getStringFromRecord(part, 'type') === 'text' && typeof text === 'string') {
      return {
        type: 'text',
        text
      };
    }

    const partType = getStringFromRecord(part, 'type');
    if (partType === 'reasoning' && typeof text === 'string') {
      return {
        type: 'reasoning',
        text,
        raw: part
      };
    }

    if (isToolLikePart(part)) {
      const state = part.state;
      const nestedStatus = isRecord(state) ? getStringFromRecord(state, 'status') : undefined;
      return {
        type: 'tool',
        toolName: getStringFromRecord(part, 'tool') ?? getStringFromRecord(part, 'toolName') ?? getStringFromRecord(part, 'name') ?? 'tool',
        status: nestedStatus ?? getStringFromRecord(part, 'status') ?? getStringFromRecord(part, 'state') ?? 'unknown',
        raw: part
      };
    }
  }

  return {
    type: 'unknown',
    raw: part
  };
}

function isToolLikePart(part: Record<string, unknown>): boolean {
  const partType = getStringFromRecord(part, 'type');
  if (partType?.toLowerCase().includes('tool')) {
    return true;
  }

  return (
    typeof getStringFromRecord(part, 'toolName') === 'string' ||
    typeof getStringFromRecord(part, 'name') === 'string' ||
    typeof getStringFromRecord(part, 'status') === 'string' ||
    typeof getStringFromRecord(part, 'state') === 'string'
  );
}

function getStringFromRecord(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const candidate = value[key];
  return typeof candidate === 'string' ? candidate : undefined;
}

function getNestedStringFromRecord(value: unknown, outer: string, inner: string): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  return getStringFromRecord(value[outer], inner);
}

function toNonNegativeFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
