export type AuthListParseErrorCode = 'INVALID_INPUT' | 'NO_PROVIDERS';

export class AuthListParseError extends Error {
  public readonly code: AuthListParseErrorCode;
  public readonly cause?: unknown;

  public constructor(code: AuthListParseErrorCode, message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'AuthListParseError';
    this.code = code;
    this.cause = options?.cause;
  }
}

export type AuthProviderEntry = {
  id: string;
  label: string;
};

// `opencode auth list` is a human-formatted output (not JSON).
// We parse provider names from lines like:
//   [...m[...m●  OpenAI [90moauth
//   ●  my8317 api
export function parseAuthList(stdout: string): AuthProviderEntry[] {
  if (typeof stdout !== 'string') {
    throw new AuthListParseError('INVALID_INPUT', '解析 auth list 失败：stdout 不是字符串。');
  }

  const lines = stripAnsi(stdout).split(/\r?\n/);
  const providers: AuthProviderEntry[] = [];
  const seen = new Set<string>();

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line.startsWith('●')) {
      continue;
    }

    const afterBullet = line.replace(/^●\s+/, '').trim();
    if (!afterBullet) {
      continue;
    }

    // remove trailing type tags like "oauth" or "api"
    const label = afterBullet.replace(/\s+(oauth|api)\s*$/i, '').trim();
    if (!label) {
      continue;
    }

    const id = toProviderId(label);
    if (!id || seen.has(id)) {
      continue;
    }

    seen.add(id);
    providers.push({ id, label });
  }

  if (providers.length === 0) {
    throw new AuthListParseError('NO_PROVIDERS', '未找到任何已配置的 provider（opencode auth list）。');
  }

  return providers;
}

function stripAnsi(input: string): string {
  // Some TS/JS parsers are picky about ESC escapes in regex literals.
  // Build it via RegExp to keep this file portable.
  // eslint-disable-next-line no-control-regex
  const ansi = new RegExp(String.raw`\x1b\[[0-9;]*m`, 'g');
  return input.replace(ansi, '');
}

function toProviderId(label: string): string {
  const known = new Map<string, string>([
    ['openai', 'openai'],
    ['github copilot', 'github-copilot'],
    ['google', 'google']
  ]);

  const normalized = label.trim().toLowerCase();
  const mapped = known.get(normalized);
  if (mapped) {
    return mapped;
  }

  // best-effort normalization: "Foo Bar" -> "foo-bar".
  const compact = normalized
    .replace(/[^a-z0-9\s._-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');

  return compact;
}
