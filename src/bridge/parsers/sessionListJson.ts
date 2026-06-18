import { coerceFirstJsonValue } from './lenientJson';

export type SessionListJsonParseErrorCode = 'INVALID_JSON' | 'INVALID_SHAPE';

export class SessionListJsonParseError extends Error {
  public readonly code: SessionListJsonParseErrorCode;
  public readonly cause?: unknown;

  public constructor(code: SessionListJsonParseErrorCode, message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'SessionListJsonParseError';
    this.code = code;
    this.cause = options?.cause;
  }
}

export interface SessionListItem {
  id: string;
  title: string;
  updated: string;
  created: string;
  projectId: string;
  directory: string;
}

export function parseSessionListJson(stdout: string): SessionListItem[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(coerceFirstJsonValue(stdout));
  } catch (error) {
    throw new SessionListJsonParseError('INVALID_JSON', '解析 session list JSON 失败：输入不是合法 JSON。', {
      cause: error
    });
  }

  if (!Array.isArray(parsed)) {
    throw new SessionListJsonParseError('INVALID_SHAPE', '解析 session list JSON 失败：根节点必须是数组。');
  }

  return parsed.map((item, index) => parseSessionItem(item, index));
}

function parseSessionItem(value: unknown, index: number): SessionListItem {
  if (!isRecord(value)) {
    throw new SessionListJsonParseError('INVALID_SHAPE', `解析 session list JSON 失败：sessions[${String(index)}] 必须是对象。`);
  }

  return {
    id: readRequiredString(value, 'id', index),
    title: readRequiredString(value, 'title', index),
    updated: readRequiredTimestamp(value, 'updated', index),
    created: readRequiredTimestamp(value, 'created', index),
    projectId: readRequiredString(value, 'projectId', index),
    directory: readRequiredString(value, 'directory', index)
  };
}

function readRequiredString(record: Record<string, unknown>, key: string, index: number): string {
  if (!(key in record)) {
    throw new SessionListJsonParseError(
      'INVALID_SHAPE',
      `解析 session list JSON 失败：sessions[${String(index)}].${key} 为必填字段。`
    );
  }

  const value = record[key];
  if (typeof value !== 'string') {
    throw new SessionListJsonParseError(
      'INVALID_SHAPE',
      `解析 session list JSON 失败：sessions[${String(index)}].${key} 必须是字符串。`
    );
  }

  return value;
}

function readRequiredTimestamp(record: Record<string, unknown>, key: string, index: number): string {
  if (!(key in record)) {
    throw new SessionListJsonParseError(
      'INVALID_SHAPE',
      `解析 session list JSON 失败：sessions[${String(index)}].${key} 为必填字段。`
    );
  }

  const raw = record[key];

  if (typeof raw === 'string') {
    return raw;
  }

  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const date = new Date(raw);
    const iso = date.toISOString();
    if (iso === 'Invalid Date') {
      throw new SessionListJsonParseError(
        'INVALID_SHAPE',
        `解析 session list JSON 失败：sessions[${String(index)}].${key} 不是合法时间戳。`
      );
    }
    return iso;
  }

  throw new SessionListJsonParseError(
    'INVALID_SHAPE',
    `解析 session list JSON 失败：sessions[${String(index)}].${key} 必须是字符串或数字时间戳。`
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
