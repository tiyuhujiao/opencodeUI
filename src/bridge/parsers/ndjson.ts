export type NdjsonParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: Error; line: string };

export interface NdjsonParser<T = unknown> {
  push(chunk: string): NdjsonParseResult<T>[];
  end(): NdjsonParseResult<T>[];
}

export function createNdjsonParser<T = unknown>(): NdjsonParser<T> {
  let buffer = '';

  const parseLine = (rawLine: string): NdjsonParseResult<T> | null => {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (line.trim().length === 0) {
      return null;
    }

    try {
      return {
        ok: true,
        value: JSON.parse(line) as T
      };
    } catch {
      return {
        ok: false,
        error: new Error('NDJSON 行不是合法 JSON'),
        line
      };
    }
  };

  const parseCompleteLines = (): NdjsonParseResult<T>[] => {
    const out: NdjsonParseResult<T>[] = [];
    let lineStart = 0;
    let lineEnd = buffer.indexOf('\n');

    while (lineEnd !== -1) {
      const parsed = parseLine(buffer.slice(lineStart, lineEnd));
      if (parsed !== null) {
        out.push(parsed);
      }

      lineStart = lineEnd + 1;
      lineEnd = buffer.indexOf('\n', lineStart);
    }

    buffer = buffer.slice(lineStart);
    return out;
  };

  return {
    push(chunk: string): NdjsonParseResult<T>[] {
      if (chunk.length === 0) {
        return [];
      }

      buffer += chunk;
      return parseCompleteLines();
    },

    end(): NdjsonParseResult<T>[] {
      const out = parseCompleteLines();

      if (buffer.length > 0) {
        const parsed = parseLine(buffer);
        if (parsed !== null) {
          out.push(parsed);
        }
        buffer = '';
      }

      return out;
    }
  };
}
