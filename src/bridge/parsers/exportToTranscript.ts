import type { ExportPayload } from './exportJson';

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
  role: TranscriptRole;
  parts: TranscriptPart[];
};

export function exportToTranscript(payload: ExportPayload): TranscriptMessage[] {
  return payload.messages.map((message) => ({
    role: resolveRole(message.info),
    parts: message.parts.map(mapPart)
  }));
}

function resolveRole(info: unknown): TranscriptRole {
  const role = getStringFromRecord(info, 'role') ?? getNestedStringFromRecord(info, 'author', 'role');
  if (role === 'user' || role === 'assistant') {
    return role;
  }
  return 'unknown';
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
