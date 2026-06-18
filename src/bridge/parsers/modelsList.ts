export type ModelsListParseErrorCode = 'INVALID_INPUT';

export class ModelsListParseError extends Error {
  public readonly code: ModelsListParseErrorCode;

  public constructor(code: ModelsListParseErrorCode, message: string) {
    super(message);
    this.name = 'ModelsListParseError';
    this.code = code;
  }
}

export interface ModelsListEntry {
  modelName: string;
  providerID: string;
  modelID: string;
}

const MODEL_NAME_PATTERN = /^[\w.@-]+(?:\/[\w.@-]+)+$/;

export function parseModelsList(stdout: string): ModelsListEntry[] {
  if (typeof stdout !== 'string') {
    throw new ModelsListParseError('INVALID_INPUT', '解析 models 失败：stdout 不是字符串。');
  }

  const entries: ModelsListEntry[] = [];

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    if (!MODEL_NAME_PATTERN.test(line)) {
      throw new ModelsListParseError('INVALID_INPUT', `解析 models 失败：存在非法模型名 ${line}。`);
    }

    const slash = line.indexOf('/');
    entries.push({
      modelName: line,
      providerID: line.slice(0, slash),
      modelID: line.slice(slash + 1)
    });
  }

  if (entries.length === 0) {
    throw new ModelsListParseError('INVALID_INPUT', '解析 models 失败：未找到任何模型。');
  }

  return entries;
}
